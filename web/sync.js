/**
 * 雲端同步（Supabase）：登入同一個帳號，外掛、網頁版、每一台電腦的提示詞都一樣。
 *
 * src/sync.js 和 web/sync.js 必須一字不差，tools/checksync.py 會檢查。
 *   外掛：只在背景程式（src/background.js）跑一份。AI 網站裡的面板和工具列小視窗
 *         都透過訊息請它做事——登入狀態只有一個主人，換 token 才不會互相打架。
 *   網頁版：在網頁裡直接跑（web/app.js）。
 *
 * 雲端的資料長相（見 supabase/schema.sql）：每個帳號一列，
 *   notebooks { user_id, doc: 整本筆記本 JSON, version: 每存一次 +1 }
 *
 * 同步規則：
 *   - 平常：這台改了就推上去；雲端比較新就拉下來蓋掉這台。
 *   - 兩邊都改過（例如一台離線時改了）：以雲端為底，把這台多出來的提示詞加進去，
 *     和「備份與同步 → 合併」同一套規則，寧可多、不會少。
 *   - 這台電腦第一次登入：
 *       這台的資料從沒屬於過任何帳號 → 和雲端合併（第一次用雲端時，原本的提示詞不會不見）
 *       這台的資料屬於另一個帳號   → 不合併，直接換成這個帳號的雲端資料（不會把別人的資料帶過去）
 *
 * 不用 Supabase 官方的 JS 套件：外掛不能從網路載入程式，打包進來又要多一大包；
 * 這裡只需要登入、換 token、讀一列、存一列，直接用 fetch 就夠了。
 *
 * 依賴 store.js（gpnNormalize 等）、share.js（gpnMergeData）、cloud-config.js。
 */

const GPN_SESSION_KEY = 'gpn_session_v1';   // 登入狀態（token）
const GPN_SYNC_KEY = 'gpn_sync_v1';         // 同步進度（雲端版本、上次同步的內容指紋）

/**
 * @param {object}   o
 * @param {object}   o.config       GPN_CLOUD：{ url, key }
 * @param {object}   o.kv           非同步的小儲存：get(key) / set(key, value) / remove(key)
 * @param {Function} o.readLocal    async () => 這台目前的資料
 * @param {Function} o.writeRemote  async (data) => 把雲端來的資料寫進這台，並讓畫面跟著更新
 * @param {Function} [o.onState]    (state) => 狀態變了（登入、同步中、離線…）
 * @param {Function} [o.lock]       async (name, fn) => 同一個瀏覽器開好幾個分頁時，讓同步一次只跑一個
 */
function gpnCreateSync(o) {
  'use strict';

  const { config, kv, readLocal, writeRemote } = o;
  const onState = o.onState || (() => {});
  const lock = o.lock || ((name, fn) => fn());
  const configured = gpnCloudConfigured(config);
  const base = configured ? String(config.url).replace(/\/+$/, '') : '';

  const EMPTY_META = { userId: null, base: 0, hash: null, lastSyncAt: 0 };
  let session = null;   // { access_token, refresh_token, expires_at(ms), user: { id, email } }
  let meta = { ...EMPTY_META };
  let state = {
    configured, google: configured && !!config.google, signedIn: false, email: '',
    phase: 'idle',        // idle | syncing | offline | error
    pending: false,       // 這台有改過、還沒送上雲端
    lastSyncAt: 0, message: '',
  };
  let running = null;
  let timer = 0;

  function setState(patch) {
    state = { ...state, ...patch };
    try { onState({ ...state }); } catch { /* 畫面出錯不影響同步 */ }
  }

  const ready = (async () => {
    if (!configured) return;
    session = (await kv.get(GPN_SESSION_KEY)) || null;
    meta = { ...EMPTY_META, ...((await kv.get(GPN_SYNC_KEY)) || {}) };
    setState({
      signedIn: !!session, email: session?.user?.email || '', lastSyncAt: meta.lastSyncAt || 0,
    });
  })();

  const saveMeta = () => kv.set(GPN_SYNC_KEY, meta);
  async function saveSession(s) {
    session = s;
    if (s) await kv.set(GPN_SESSION_KEY, s);
    else await kv.remove(GPN_SESSION_KEY);
  }

  /* ========== 連線 ========== */

  async function call(path, { method = 'GET', body, auth = false } = {}) {
    const headers = { apikey: config.key, 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = 'Bearer ' + (await accessToken());
    let res;
    try {
      res = await fetch(base + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw Object.assign(new Error('offline'), { offline: true });
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 不是 JSON 就算了 */ }
    if (!res.ok) {
      const err = new Error(json?.msg || json?.error_description || json?.message ||
                            json?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = json?.error_code || json?.code || json?.error || '';
      throw err;
    }
    return json;
  }

  /** Supabase 回傳的登入結果 → 我們存的格式 */
  function toSession(r) {
    return {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_at: r.expires_at ? r.expires_at * 1000 : Date.now() + (r.expires_in || 3600) * 1000,
      user: { id: r.user?.id, email: r.user?.email },
    };
  }

  /** 拿一個還有效的 token；快過期就先換一張新的 */
  async function accessToken() {
    if (!session) throw Object.assign(new Error('signed out'), { auth: true });
    if (session.expires_at - Date.now() > 60_000) return session.access_token;

    // 別的分頁可能剛換過：儲存裡的比較新就直接用，不要拿舊的去換（會被當成盜用而登出）
    const stored = await kv.get(GPN_SESSION_KEY);
    if (stored && stored.expires_at - Date.now() > 60_000) {
      session = stored;
      return session.access_token;
    }
    try {
      const r = await call('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: session.refresh_token },
      });
      await saveSession(toSession(r));
      return session.access_token;
    } catch (e) {
      if (e.offline) throw e;
      await saveSession(null);
      setState({ signedIn: false, email: '', phase: 'idle', message: '登入已過期，請重新登入' });
      throw Object.assign(new Error('expired'), { auth: true });
    }
  }

  /** 錯誤 → 給人看的中文 */
  function explain(e) {
    if (e?.offline) return '連不上網路，恢復連線後會自動同步';
    const s = `${e?.code || ''} ${e?.message || ''}`;
    if (/invalid_credentials|invalid login credentials|invalid_grant/i.test(s)) return 'Email 或密碼不對';
    if (/email_not_confirmed|not confirmed/i.test(s)) return '這個帳號還沒完成信箱驗證，請先到信箱點確認連結';
    if (/user_already_exists|already registered/i.test(s)) return '這個 Email 已經註冊過了，請直接登入';
    if (/weak_password|at least \d+ characters|password should/i.test(s)) return '密碼太短，至少要 6 個字';
    if (/email_address_invalid|invalid format|validate email/i.test(s)) return 'Email 格式不對';
    if (/rate_limit|too many/i.test(s) || e?.status === 429) return '操作太頻繁，請過幾分鐘再試';
    if (/signup_disabled|signups not allowed/i.test(s)) return '目前不開放註冊新帳號';
    if (e?.status >= 500) return '雲端暫時有問題，請稍後再試';
    return '發生錯誤：' + (e?.message || '未知的錯誤');
  }

  /* ========== 同步 ========== */

  /** 資料的指紋：看書籤、內容和最近使用記錄；「目前選哪個書籤」這種畫面狀態不算改動 */
  function hashDoc(d) {
    const s = JSON.stringify([d.tabs, d.recent || []]);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }

  /** 雲端來的資料不要把這台「正在看哪個書籤」也蓋掉 */
  function keepActive(doc, local) {
    if (local.activeId === GPN_RECENT_ID || doc.tabs.some((t) => t.id === local.activeId)) {
      doc.activeId = local.activeId;
    }
    return doc;
  }

  /** 把雲端版本寫進這台 */
  async function apply(doc, version, local) {
    const d = keepActive(gpnNormalize(doc), local);
    await writeRemote(d);
    meta.base = version;
    meta.hash = hashDoc(d);
    return d;
  }

  /** 推上雲端；雲端被別台搶先改了，就合併後再推（最多試 3 次） */
  async function push(doc) {
    for (let i = 0; i < 3; i++) {
      const rows = await call('/rest/v1/rpc/gpn_save', {
        method: 'POST', auth: true, body: { p_doc: doc, p_base: meta.base },
      });
      const r = Array.isArray(rows) ? rows[0] : rows;
      if (r?.saved) {
        meta.base = Number(r.new_version);
        meta.hash = hashDoc(doc);
        return;
      }
      const m = gpnMergeData(gpnNormalize(r.cloud_doc), doc);
      doc = await apply(m.data, Number(r.new_version), doc);
    }
    throw new Error('同時有好幾台在改，請稍後再同步一次');
  }

  async function syncOnce() {
    // 每次都從儲存重讀：同一個瀏覽器的其他分頁可能剛同步過、剛登入或登出
    meta = { ...EMPTY_META, ...((await kv.get(GPN_SYNC_KEY)) || {}) };
    session = (await kv.get(GPN_SESSION_KEY)) || null;
    if (!session) {
      setState({ signedIn: false, email: '' });
      return {};
    }
    if (!state.signedIn) setState({ signedIn: true, email: session.user?.email || '' });

    const rows = await call('/rest/v1/notebooks?select=doc,version', { auth: true });
    const row = Array.isArray(rows) ? rows[0] : null;
    let local = gpnNormalize(await readLocal());
    const firstHere = !meta.base;          // 這個帳號在這台電腦還沒同步過
    const adopt = meta.adopt;              // 'merge' | 'replace'（只在剛登入時有）
    delete meta.adopt;
    const note = {};

    if (!row) {
      // 雲端還沒有資料（新帳號）
      if (adopt === 'replace') {
        local = gpnDefaultData();          // 這台的資料是別的帳號的，不要帶進新帳號
        await writeRemote(local);
        // 馬上記下來「已經換過了」：萬一下面推送時斷線，下次重試不會又清一次
        await saveMeta();
      }
      meta.base = 0;
      await push(local);
      note.uploaded = gpnCountItems(local);
    } else if (firstHere) {
      const cloud = gpnNormalize(row.doc);
      if (adopt === 'replace' || !gpnCountItems(local)) {
        await apply(cloud, Number(row.version), local);
        note.pulled = gpnCountItems(cloud);
      } else {
        const m = gpnMergeData(cloud, local);
        const merged = await apply(m.data, Number(row.version), local);
        if (m.added) await push(merged);
        note.pulled = gpnCountItems(cloud);
        note.merged = m.added;
      }
    } else {
      const dirty = hashDoc(local) !== meta.hash;
      if (Number(row.version) === meta.base) {
        if (dirty) await push(local);
      } else if (!dirty) {
        await apply(row.doc, Number(row.version), local);
      } else {
        // 兩邊都改過：以雲端為底，把這台多的加進去
        const m = gpnMergeData(gpnNormalize(row.doc), local);
        const merged = await apply(m.data, Number(row.version), local);
        await push(merged);
      }
    }

    meta.lastSyncAt = Date.now();
    await saveMeta();
    return note;
  }

  /** 立刻同步一次（拉＋推）。同時只會有一次在跑。 */
  function syncNow() {
    if (running) return running;
    running = (async () => {
      await ready;
      if (!configured) return {};
      setState({ phase: 'syncing' });
      try {
        const note = await lock('gpn-sync', syncOnce);
        setState({ phase: 'idle', pending: false, lastSyncAt: meta.lastSyncAt, message: '' });
        return note;
      } catch (e) {
        if (e.auth) return { error: '登入已過期，請重新登入' };
        setState({ phase: e.offline ? 'offline' : 'error', message: explain(e) });
        return { error: explain(e) };
      } finally {
        running = null;
      }
    })();
    return running;
  }

  /** 這台的資料剛改過：等 0.8 秒沒再改，就推上雲端（連續打字時不要每個字都送） */
  function markDirty() {
    if (!configured) return;
    if (state.signedIn) setState({ pending: true });
    clearTimeout(timer);
    timer = setTimeout(syncNow, 800);   // 沒登入的話 syncNow 會自己什麼都不做
  }

  /* ========== 帳號 ========== */

  async function afterSignIn(s) {
    await saveSession(s);
    meta = { ...EMPTY_META, ...((await kv.get(GPN_SYNC_KEY)) || {}) };
    if (meta.userId !== s.user.id) {
      // 換了一個帳號（或第一次登入）：從頭同步。
      // meta.userId 是空的 = 這台的資料從來沒屬於過任何帳號 → 和雲端合併
      meta = { ...EMPTY_META, userId: s.user.id, adopt: meta.userId ? 'replace' : 'merge' };
      await saveMeta();
    }
    setState({ signedIn: true, email: s.user.email || '', message: '' });
    const note = await syncNow();
    return { ok: true, ...note };
  }

  async function signIn(email, password) {
    await ready;
    if (!configured) return { ok: false, error: '雲端同步還沒設定' };
    try {
      const r = await call('/auth/v1/token?grant_type=password', {
        method: 'POST', body: { email, password },
      });
      return await afterSignIn(toSession(r));
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  async function signUp(email, password) {
    await ready;
    if (!configured) return { ok: false, error: '雲端同步還沒設定' };
    try {
      const r = await call('/auth/v1/signup', { method: 'POST', body: { email, password } });
      // Supabase 若開了「要先確認信箱」，註冊後不會直接登入
      if (!r?.access_token) return { ok: true, needConfirm: true };
      return await afterSignIn(toSession(r));
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  /* ---- 用 Google 帳號登入 ----
     走 OAuth 的 PKCE 流程：出發前先產生一組只有這裡知道的密語（verifier），
     Google 登入完回來只會帶一個 code；拿 code 加上密語才換得到登入。
     就算 code 在網址上被別人看到，沒有密語也沒用。 */

  const GPN_PKCE_KEY = 'gpn_pkce_v1';

  function b64url(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** 產生「去 Google 登入」的網址。redirectTo＝登入完要回到哪個網址（要在 Supabase 的允許清單裡） */
  async function googleUrl(redirectTo) {
    await ready;
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    await kv.set(GPN_PKCE_KEY, { verifier, at: Date.now() });
    return `${base}/auth/v1/authorize?` + new URLSearchParams({
      provider: 'google',
      redirect_to: redirectTo,
      code_challenge: b64url(new Uint8Array(digest)),
      code_challenge_method: 's256',
    });
  }

  /** Google 登入完回來，拿網址上的 code 換成登入 */
  async function finishGoogle(code) {
    await ready;
    const p = await kv.get(GPN_PKCE_KEY);
    await kv.remove(GPN_PKCE_KEY);          // 一次性，用過就丟
    if (!p?.verifier || Date.now() - p.at > 15 * 60_000) {
      return { ok: false, error: '登入逾時了，請再按一次「用 Google 帳號登入」' };
    }
    try {
      const r = await call('/auth/v1/token?grant_type=pkce', {
        method: 'POST', body: { auth_code: code, code_verifier: p.verifier },
      });
      return await afterSignIn(toSession(r));
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  /**
   * 登出。這台的提示詞預設留著（只是不再同步）；
   * wipe=true 則連這台的資料一起清掉（在別人的電腦上用完時）。
   */
  async function signOut({ wipe = false } = {}) {
    await ready;
    if (session) {
      await syncNow();                                   // 還沒送出的先送上去
      try { await call('/auth/v1/logout', { method: 'POST', auth: true }); } catch { /* 離線也照樣登出 */ }
    }
    clearTimeout(timer);
    await saveSession(null);
    if (wipe) {
      await writeRemote(gpnDefaultData());
      meta = { ...EMPTY_META };
      await saveMeta();
    }
    setState({ signedIn: false, email: '', phase: 'idle', pending: false, message: '' });
    return { ok: true };
  }

  async function getState() {
    await ready;
    return { ...state };
  }

  return { getState, signIn, signUp, signOut, syncNow, markDirty, googleUrl, finishGoogle };
}
