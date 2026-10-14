/**
 * 罐頭P：分身的中繼（Supabase Edge Function）
 *
 * 分身是什麼：建立的人（用自己的 Google 帳號）勾選一些提示詞，複製一份成「分身」，得到一組 16 碼的代號。
 * 同事沒有 Google 帳號，輸入代號就能使用、編輯。見 src/sync.js 的「分身」。
 *
 * 分身的提示詞存在建立的人「自己的」Google 雲端硬碟（一個分身一個檔案）。同事碰不到那個雲端硬碟，
 * 所以由這裡代為讀寫：建立分身時，建立的人把他的 refresh token 交給這裡加密保管；
 * 同事拿代號來讀寫時，這裡用那張 token 換一張 access token，直接轉給雲端硬碟。
 *   - 提示詞不存在這裡，讀寫時直接轉手；也不記錄。
 *   - 權限只有 drive.file：那張 token 只碰得到罐頭P 自己建立的檔案，看不到雲端硬碟裡的其他東西。
 *   - 代號就是密碼（約 2^80 種組合，猜不到），這裡只存它的 SHA-256 雜湊。
 *   - 建立滿一年到期就「停用」：不再接受這個代號，但什麼都不刪；建立的人可以延長（extend）或銷毀（revoke）。
 *     停用期間建立的人自己照樣進得去（他直接用自己的雲端硬碟權限，不經過這裡）。
 *   - 一個人的分身全部銷毀了，他的 refresh token 和紀錄也一起刪掉，不再保管。
 *
 * 資料表（supabase/migrations/20261013_gpn_clones.sql）：
 *   gpn_clone_owners  建立的人：Google 帳號代號（sub）、Email、加密過的 refresh token
 *   gpn_clones        分身：代號的雜湊、屬於誰、哪個檔案、名稱、到期日
 *   兩張都開了 RLS 而且沒有任何 policy：只有這個函式（service role）讀寫得到。
 *
 * 放在和 flowstudy 共用的 Supabase 專案裡，名稱都加了 gpn 開頭。需要的密鑰（Edge Functions → Secrets）：
 *   GPN_GOOGLE_CLIENT_ID、GPN_GOOGLE_CLIENT_SECRET  和 gpn-google-token 共用（換 token 要用）
 *   GPN_CLONE_KEY（可省略）  加密 refresh token 的金鑰；沒設就由 GPN_GOOGLE_CLIENT_SECRET 推出來
 *   SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY  Supabase 自己會給
 *
 * 部署時關掉 JWT 驗證（verify_jwt = false），理由同 gpn-google-token：呼叫的人沒有 Supabase 帳號。
 *
 * 請求一律 POST JSON { op, ... }：
 *   建立的人（token = 他的 Google access token，這裡向 Google 確認是誰）
 *     register { token, refresh_token, id, fileId, label }  登記一個剛建好的分身
 *     token    { token, refresh_token }                     換一張新的 refresh token 給這裡保管
 *     extend   { token, id, expiresAt }                     延長期限（改成哪一天，毫秒）
 *     disable  { token, id }                                停用：代號馬上失效（到期日改成現在），什麼都不刪，延長期限就能重新啟用
 *     revoke   { token, id }                                銷毀（代號不能再用）
 *   用分身的人（id = 分身代號）
 *     head   { id }          → { fileId, version, label, avatar, ownerEmail, expiresAt }
 *     read   { id }          → 同上 + data（檔案內容，JSON 文字）
 *     write  { id, data }    → { fileId, version }
 *     avatar { id, avatar }  換頭像（頭像的代號）
 *   分享（主人和分身之間互相傳提示詞，見 src/sync.js 的「分享」）
 *     peers  { id }                  → { me, peers: [{ key, label, avatar, email? }] }  可以分享給誰
 *     share  { id, to: [key], item }  寄出一則提示詞 { title, content }（一個收件人一個小檔案，放在建立的人的雲端硬碟）
 *     inbox  { id }                  → { shares: [{ id, from, item, at, kept }] }  寄給我的
 *     keep   { id, ids }              暫留：還留在信箱，但不算未讀
 *     ack    { id, ids }              採用了、不要了：刪掉那幾個小檔案
 *     keep、ack 只動得到寄給自己的
 *   key：主人是 'owner'，分身是它的檔案代號（不是分身代號：分身代號是密碼，不能給別的分身看到）
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

class Fail extends Error {
  constructor(public status: number, public code: string, message = code) { super(message); }
}

const env = (k: string) => Deno.env.get(k) || '';
const GOOGLE_API = env('GPN_GOOGLE_API') || 'https://www.googleapis.com';          // 測試時可以換成假的
const GOOGLE_TOKEN = env('GPN_GOOGLE_TOKEN_URL') || 'https://oauth2.googleapis.com/token';
const DB = env('SUPABASE_URL').replace(/\/+$/, '') + '/rest/v1';
const YEAR = 365 * 86400000;
const MAX_BYTES = 5_000_000;                       // 一本筆記本再大也不會到這麼大，只是防呆
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CLONE_Q = "appProperties has { key='gpnClone' and value='1' } and trashed = false";
const SHARE_Q = (to: string) =>
  `appProperties has { key='gpnShare' and value='1' } and appProperties has { key='to' and value='${to}' } and trashed = false`;
const isKey = (k: string) => k === 'owner' || /^[\w-]{8,128}$/.test(k);
const MAX_SHARE_BYTES = 300_000;

const cleanId = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const isId = (id: string) => id.length === 16 && [...id].every((c) => ALPHABET.includes(c));

async function sha256(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- 資料庫（PostgREST，用 service role）---------- */

async function db(path: string, init: RequestInit = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(DB + path, {
    ...init,
    headers: {
      apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
      Prefer: 'return=representation', ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Fail(500, 'db_error', text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}
const q = encodeURIComponent;

/* ---------- 加密 refresh token（AES-GCM）---------- */

let keyP: Promise<CryptoKey> | null = null;
function aesKey() {
  keyP ||= (async () => {
    const secret = env('GPN_CLONE_KEY') || env('GPN_GOOGLE_CLIENT_SECRET');
    if (!secret) throw new Fail(500, 'server_not_configured');
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('gpn-clone'), info: new TextEncoder().encode('refresh-token-v1') },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  })();
  return keyP;
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function seal(text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(), new TextEncoder().encode(text)));
  return b64(iv) + '.' + b64(ct);
}
async function unseal(s: string) {
  const [iv, ct] = s.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(), unb64(ct));
  return new TextDecoder().decode(pt);
}

/* ---------- Google ---------- */

/** access token 是誰的：{ sub, email } */
async function whoIs(token: string) {
  const res = await fetch(GOOGLE_API + '/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Fail(401, 'bad_token', '登入已經過期，請重新整理後再試');
  const u = await res.json();
  if (!u.sub) throw new Fail(401, 'bad_token');
  return { sub: String(u.sub), email: String(u.email || '') };
}

/** refresh token → access token。Google 說不行（撤銷了、被擠掉了）就是 owner_token_invalid */
async function refresh(rt: string) {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GPN_GOOGLE_CLIENT_ID'), client_secret: env('GPN_GOOGLE_CLIENT_SECRET'),
      grant_type: 'refresh_token', refresh_token: rt,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status >= 500) throw new Fail(502, 'google_error');
  if (!res.ok || !j.access_token) throw new Fail(409, 'owner_token_invalid');
  return { access_token: String(j.access_token), expires_in: Number(j.expires_in) || 3600 };
}

/** 確認這張 refresh token 真的是這個人的（不然可以拿別人的 token 來登記） */
async function checkRefresh(rt: string, sub: string) {
  if (!rt) throw new Fail(400, 'no_refresh_token');
  let at;
  try { at = await refresh(rt); } catch { throw new Fail(400, 'bad_refresh_token'); }
  if ((await whoIs(at.access_token)).sub !== sub) throw new Fail(403, 'token_mismatch');
  return at;
}

async function drive(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(GOOGLE_API + path, {
    ...init, headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) },
  });
  if (res.status === 404) throw new Fail(404, 'clone_not_found');
  if (res.status === 401) throw new Fail(409, 'owner_token_invalid');
  if (res.status === 429 || res.status === 403) throw new Fail(429, 'rateLimit', `Drive HTTP ${res.status}`);
  if (!res.ok) throw new Fail(502, 'google_error', `Drive HTTP ${res.status}`);
  return res;
}
const fileMeta = async (token: string, id: string) =>
  (await drive(token, `/drive/v3/files/${q(id)}?fields=id,version,trashed,appProperties`)).json();

/* 建立的人的 access token：同一個 instance 裡暫存到快過期，不用每次都換 */
const tokenCache = new Map<string, { token: string; exp: number }>();

async function ownerToken(owner: { sub: string; rt_enc: string }) {
  const hit = tokenCache.get(owner.sub);
  if (hit && hit.exp - Date.now() > 120_000) return hit.token;
  let rt;
  try { rt = await unseal(owner.rt_enc); } catch { throw new Fail(409, 'owner_token_invalid'); }
  const at = await refresh(rt);
  tokenCache.set(owner.sub, { token: at.access_token, exp: Date.now() + at.expires_in * 1000 });
  return at.access_token;
}

/* ---------- 分身 ---------- */

/** 這個人已經沒有分身了：他的 refresh token 不用再保管，連同他的紀錄一起刪掉 */
async function forgetOwnerIfDone(sub: string) {
  const left = await db(`/gpn_clones?owner_sub=eq.${q(sub)}&select=id_hash&limit=1`);
  if (left?.length) return;
  await db(`/gpn_clone_owners?sub=eq.${q(sub)}`, { method: 'DELETE' });
  tokenCache.delete(sub);
}

async function loadClone(rawId: unknown) {
  const id = cleanId(rawId);
  if (!isId(id)) throw new Fail(404, 'clone_not_found');
  const hash = await sha256(id);
  const rows = await db(`/gpn_clones?id_hash=eq.${q(hash)}&select=*,owner:gpn_clone_owners(sub,email,rt_enc)`);
  const c = rows?.[0];
  if (!c || !c.owner) throw new Fail(404, 'clone_not_found');
  // 到期了就停用：什麼都不刪，等建立的人延長或銷毀
  if (Date.parse(c.expires_at) <= Date.now()) throw new Fail(410, 'clone_expired');
  const token = await ownerToken(c.owner);
  const f = await fileMeta(token, c.file_id);
  if (f.trashed) throw new Fail(404, 'clone_not_found');   // 建立的人自己把檔案丟進垃圾桶了
  return {
    token, fileId: String(c.file_id), version: String(f.version), sub: String(c.owner.sub),
    info: {
      label: String(f.appProperties?.label || c.label || ''), avatar: String(f.appProperties?.avatar || ''),
      ownerEmail: String(c.owner.email || ''), expiresAt: Date.parse(c.expires_at),
    },
  };
}

/* ---------- 分享 ---------- */

type Loaded = Awaited<ReturnType<typeof loadClone>>;

/** 同一個建立的人的其他分身（停用的不算）＋主人，不含自己 */
async function peersOf(c: Loaded) {
  const rows: { file_id: string; label: string; expires_at: string }[] =
    await db(`/gpn_clones?owner_sub=eq.${q(c.sub)}&select=file_id,label,expires_at`) || [];
  const live = new Map(rows.filter((r) => Date.parse(r.expires_at) > Date.now() && r.file_id !== c.fileId)
    .map((r) => [String(r.file_id), r]));
  const list = await (await drive(c.token, '/drive/v3/files?' + new URLSearchParams({
    q: CLONE_Q, spaces: 'drive', fields: 'files(id,appProperties)', pageSize: '100',
  }))).json();
  const peers = [{ key: 'owner', label: '主人', avatar: '', email: c.info.ownerEmail }];
  for (const f of list.files || []) {
    const r = live.get(String(f.id));
    if (!r) continue;
    peers.push({ key: String(f.id), label: String(f.appProperties?.label || r.label || '分身'), avatar: String(f.appProperties?.avatar || '') });
  }
  return peers;
}

/** 分享的那則提示詞：只留標題、內容 */
function shareItem(raw: unknown) {
  const it = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const item = { title: String(it.title ?? '').slice(0, 60), content: String(it.content ?? '') };
  if (!item.title && !item.content) throw new Fail(400, 'bad_request');
  if (item.content.length > MAX_SHARE_BYTES) throw new Fail(413, 'too_large');
  return item;
}

/** 寄給這個分身的分享檔案（keep、ack 用）：不是寄給它的就跳過；已經不在的也跳過 */
async function eachMine(c: Loaded, raw: unknown, fn: (id: string) => Promise<unknown>) {
  const ids = (Array.isArray(raw) ? raw : []).map(String).filter((x) => /^[\w-]{8,128}$/.test(x)).slice(0, 50);
  let done = 0;
  for (const id of ids) {
    try {
      const f = await fileMeta(c.token, id);
      if (f.appProperties?.gpnShare !== '1' || f.appProperties?.to !== c.fileId) continue;
      await fn(id);
      done++;
    } catch (e) {
      if (!(e instanceof Fail && e.code === 'clone_not_found')) throw e;
    }
  }
  return done;
}

const ops: Record<string, (b: Record<string, unknown>) => Promise<unknown>> = {
  async register(b) {
    const me = await whoIs(String(b.token || ''));
    const id = cleanId(b.id);
    const fileId = String(b.fileId || '');
    if (!isId(id) || !fileId) throw new Fail(400, 'bad_request');
    const rt = String(b.refresh_token || '');
    await checkRefresh(rt, me.sub);
    // 檔案要是他的、而且就是這個分身（appProperties 裡記著同一個代號）
    const f = await fileMeta(String(b.token), fileId);
    if (f.trashed || f.appProperties?.gpnClone !== '1' || f.appProperties?.cloneId !== id) throw new Fail(400, 'bad_file');
    await db('/gpn_clone_owners?on_conflict=sub', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ sub: me.sub, email: me.email, rt_enc: await seal(rt), updated_at: new Date().toISOString() }),
    });
    tokenCache.delete(me.sub);
    const expiresAt = Date.now() + YEAR;
    await db('/gpn_clones', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id_hash: await sha256(id), owner_sub: me.sub, file_id: fileId,
        label: String(b.label || '').slice(0, 60), expires_at: new Date(expiresAt).toISOString(),
      }),
    });
    return { ok: true, expiresAt };
  },

  async token(b) {
    const me = await whoIs(String(b.token || ''));
    const rt = String(b.refresh_token || '');
    await checkRefresh(rt, me.sub);
    // 只更新已經有分身的人：沒建過分身的人，refresh token 不用交給這裡
    await db(`/gpn_clone_owners?sub=eq.${q(me.sub)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ email: me.email, rt_enc: await seal(rt), updated_at: new Date().toISOString() }),
    });
    tokenCache.delete(me.sub);
    return { ok: true };
  },

  async extend(b) {
    const me = await whoIs(String(b.token || ''));
    const id = cleanId(b.id);
    if (!isId(id)) throw new Fail(404, 'clone_not_found');
    const at = Number(b.expiresAt);
    if (!Number.isFinite(at) || at <= Date.now() || at > Date.now() + 10 * YEAR) throw new Fail(400, 'bad_date');
    const rows = await db(`/gpn_clones?id_hash=eq.${q(await sha256(id))}&owner_sub=eq.${q(me.sub)}`, {
      method: 'PATCH', body: JSON.stringify({ expires_at: new Date(at).toISOString() }),
    });
    if (!rows?.length) throw new Fail(404, 'clone_not_found');
    return { ok: true, expiresAt: at };
  },

  async disable(b) {
    const me = await whoIs(String(b.token || ''));
    const id = cleanId(b.id);
    if (!isId(id)) throw new Fail(404, 'clone_not_found');
    const at = Date.now();
    const rows = await db(`/gpn_clones?id_hash=eq.${q(await sha256(id))}&owner_sub=eq.${q(me.sub)}`, {
      method: 'PATCH', body: JSON.stringify({ expires_at: new Date(at).toISOString() }),
    });
    if (!rows?.length) throw new Fail(404, 'clone_not_found');
    return { ok: true, expiresAt: at };
  },

  async revoke(b) {
    const me = await whoIs(String(b.token || ''));
    const id = cleanId(b.id);
    if (!isId(id)) throw new Fail(404, 'clone_not_found');
    const gone = await db(`/gpn_clones?id_hash=eq.${q(await sha256(id))}&owner_sub=eq.${q(me.sub)}`, { method: 'DELETE' });
    if (!gone?.length) throw new Fail(404, 'clone_not_found');
    await forgetOwnerIfDone(me.sub);
    return { ok: true };
  },

  async head(b) {
    const c = await loadClone(b.id);
    return { fileId: c.fileId, version: c.version, ...c.info };
  },

  async read(b) {
    const c = await loadClone(b.id);
    const data = await (await drive(c.token, `/drive/v3/files/${q(c.fileId)}?alt=media`)).text();
    return { fileId: c.fileId, version: c.version, ...c.info, data };
  },

  /** 用分身的人換頭像（頭像的代號，見 src/avatars.js） */
  async avatar(b) {
    const avatar = String(b.avatar || '');
    if (!/^[a-z]{1,20}$/.test(avatar)) throw new Fail(400, 'bad_request');
    const c = await loadClone(b.id);
    await drive(c.token, `/drive/v3/files/${q(c.fileId)}?fields=id`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appProperties: { avatar } }),
    });
    return { ok: true };
  },

  async peers(b) {
    const c = await loadClone(b.id);
    return { me: c.fileId, peers: await peersOf(c) };
  },

  async share(b) {
    const item = shareItem(b.item);
    const to = [...new Set((Array.isArray(b.to) ? b.to : []).map(String))].filter(isKey);
    if (!to.length) throw new Fail(400, 'bad_request');
    const c = await loadClone(b.id);
    const ok = new Set((await peersOf(c)).map((p) => p.key));
    if (to.some((k) => !ok.has(k))) throw new Fail(404, 'peer_gone');
    const from = { key: c.fileId, label: c.info.label || '分身', avatar: c.info.avatar };
    const body = JSON.stringify({ v: 1, from, item, at: Date.now() });
    for (const k of to) {
      const boundary = 'gpn_' + crypto.randomUUID();
      const info = {
        name: '罐頭P 分享.json', mimeType: 'application/json',
        description: '罐頭P 的分享：收到的人在罐頭P 按「採用」或刪掉之後，這個檔案會自動刪掉。',
        appProperties: { gpnShare: '1', to: k, from: c.fileId },
      };
      await drive(c.token, '/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(info)}\r\n` +
          `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`,
      });
    }
    return { ok: true, sent: to.length };
  },

  async inbox(b) {
    const c = await loadClone(b.id);
    const r = await (await drive(c.token, '/drive/v3/files?' + new URLSearchParams({
      q: SHARE_Q(c.fileId), spaces: 'drive', orderBy: 'createdTime', fields: 'files(id,appProperties)', pageSize: '50',
    }))).json();
    const shares = [];
    for (const f of r.files || []) {
      let j: Record<string, unknown> = {};
      try {
        j = JSON.parse(await (await drive(c.token, `/drive/v3/files/${q(f.id)}?alt=media`)).text());
      } catch (e) {
        if (e instanceof Fail && e.code === 'clone_not_found') continue;   // 剛被刪掉（別台採用了）
        if (e instanceof Fail) throw e;                                     // 雲端硬碟暫時有問題：下次再看
        /* 內容壞掉（不是 JSON）：item 是空的，畫面會直接刪掉 */
      }
      shares.push({ id: String(f.id), from: j.from || {}, item: j.item || null, at: Number(j.at) || 0, kept: f.appProperties?.kept === '1' });
    }
    return { shares };
  },

  async keep(b) {
    const c = await loadClone(b.id);
    const done = await eachMine(c, b.ids, (id) => drive(c.token, `/drive/v3/files/${q(id)}?fields=id`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appProperties: { kept: '1' } }),
    }));
    return { ok: true, done };
  },

  async ack(b) {
    const c = await loadClone(b.id);
    const done = await eachMine(c, b.ids, (id) => drive(c.token, `/drive/v3/files/${q(id)}`, { method: 'DELETE' }));
    return { ok: true, done };
  },

  async write(b) {
    const data = String(b.data ?? '');
    if (!data || data.length > MAX_BYTES) throw new Fail(413, 'too_large');
    let doc;
    try { doc = JSON.parse(data); } catch { throw new Fail(400, 'bad_data'); }
    if (!doc || !Array.isArray(doc.tabs)) throw new Fail(400, 'bad_data');
    const c = await loadClone(b.id);
    const res = await drive(c.token, `/upload/drive/v3/files/${q(c.fileId)}?uploadType=media&fields=id,version`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: data,
    });
    const f = await res.json();
    return { fileId: String(f.id), version: String(f.version) };
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  if (!env('GPN_GOOGLE_CLIENT_ID') || !env('GPN_GOOGLE_CLIENT_SECRET') || !env('SUPABASE_SERVICE_ROLE_KEY')) {
    return reply({ error: 'server_not_configured' }, 500);
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: 'bad_request' }, 400); }
  const run = ops[String(body?.op || '')];
  if (!run) return reply({ error: 'bad_request' }, 400);
  try {
    return reply(await run(body));
  } catch (e) {
    if (e instanceof Fail) return reply({ error: e.code, error_description: e.message }, e.status);
    return reply({ error: 'server_error' }, 500);
  }
});
