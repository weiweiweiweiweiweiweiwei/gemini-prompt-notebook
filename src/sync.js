/**
 * 雲端同步（Google 雲端硬碟）：連結同一個 Google 帳號，外掛、網頁版、每一台電腦的提示詞都一樣。
 *
 * src/sync.js 和 web/sync.js 必須一字不差，tools/checksync.py 會檢查。
 *   外掛：只在背景程式（src/background.js）跑一份。AI 網站裡的面板和工具列小視窗
 *         都透過訊息請它做事——登入狀態只有一個主人，換 token 才不會互相打架。
 *   網頁版：在網頁裡直接跑（web/app.js）。
 *
 * 資料存在哪裡：使用者「自己的」Google 雲端硬碟裡的一個檔案（GPN_DRIVE_FILE_NAME，見 cloud-config.js），
 *   整本筆記本存成一份 JSON。我們的伺服器不經手也不保存提示詞。
 *   權限只要 drive.file：只能碰「罐頭P 自己建立的檔案」，看不到雲端硬碟裡的其他東西。
 *   檔案靠 appProperties（gpnNotebook=1）認出來，使用者改檔名、搬資料夾都找得到。
 *
 * 登入（OAuth，授權碼＋PKCE）：
 *   1. 帶著一組只有這裡知道的密語（verifier）去 Google 登入、同意存取雲端硬碟
 *   2. 回來時網址帶著 code；拿 code＋密語，透過 config.tokenUrl 換成 token
 *   3. tokenUrl 是一個很小的中繼（supabase/functions/gpn-google-token）：
 *      Google 規定換 token 要附「用戶端密鑰」，密鑰不能放在網頁或外掛裡，所以放在那裡。
 *      它只轉交 token，不碰雲端硬碟、也不保存任何東西。
 *   access token 一小時就過期，用 refresh token 換新的（一樣經過中繼），使用者不會感覺到。
 *
 * 資料一律先存在這台（外掛：chrome.storage；網頁版：localStorage），存好了才慢慢送上雲端。
 * 所以送出前關掉網頁也不會不見，下次打開會接著送。
 *
 * 同步規則：
 *   - 平常：這台改了就推上去；雲端比較新就拉下來蓋掉這台。
 *   - 兩邊都改過（例如一台離線時改了、關掉網頁時還沒送出、外掛和網頁版都有改）：三方合併（gpnMerge3）。
 *     拿「上次同步好的內容」（GPN_BASE_KEY）當共同的起點，比出兩邊各自做了什麼——
 *     新增、刪除、修改、搬移、排序都保留，刪掉的不會再跑回來；同一則兩邊都改了，以這台為主。
 *   - 同步要花一兩秒，這段時間使用者又改了東西：寫進這台之前再看一次，把他新做的合併進去，
 *     不會被同步到一半的舊內容蓋掉；同步完馬上再送一次。
 *   - 登入（4.16.0 起一定要登入才能用）：一律以雲端為準。
 *       雲端已經有筆記本 → 這台換成雲端的樣子（這台原本的另外留一份 GPN_PRELOGIN_KEY，設定 → 備份 下載得到）
 *       雲端還沒有       → 第一次用：把這台的傳上去
 *     以前是「和雲端合併」，結果中斷連結後在這台亂改、再登入，改壞的會蓋進雲端。
 *     同一個帳號只是登入過期、重新登入：這台還記得上次同步的進度，照平常的三方合併，沒送出的修改不會不見。
 *   - 登出：先把還沒送出的送上去，再清掉這台的提示詞（雲端硬碟上的都還在，再登入就回來）。
 *   雲端硬碟沒有「版本對了才准寫」這種保護，所以寫入前先看一次版本號；
 *   兩台在同一瞬間存檔才可能互蓋，而且雲端硬碟本身會留舊版本，救得回來。
 *
 * 不用 Google 官方的 JS 套件：外掛不能從網路載入程式；這裡只需要換 token、找檔案、讀、寫，fetch 就夠了。
 *
 * 分身（4.24.0）：不用 Google 帳號，用一組 16 碼的代號登入的「小帳號」，見最下面的「分身」那一段。
 *
 * 依賴 store.js（gpnNormalize 等）、share.js（gpnMergeData）、cloud-config.js。
 */

const GPN_SESSION_KEY = 'gpn_gdrive_session_v1';   // 登入狀態（token、Email）
const GPN_SYNC_KEY = 'gpn_gdrive_sync_v1';         // 同步進度（雲端檔案、版本、上次同步的內容指紋）
const GPN_PKCE_KEY = 'gpn_gdrive_pkce_v1';         // 登入途中的密語
const GPN_BASE_KEY = 'gpn_gdrive_base_v1';         // 上次同步好的內容（三方合併的共同起點）
const GPN_PRELOGIN_KEY = 'gpn_prelogin_v1';        // 登入時被雲端換掉的「這台原本的提示詞」（設定 → 備份 可以下載）
const GPN_OWNER_STASH_KEY = 'gpn_owner_stash_v1';  // 建立分身的人「進入分身」時，先收起來的自己的登入和提示詞（回到自己的帳號用）
const GPN_CLONE_HINT_KEY = 'gpn_clone_hint_v1';    // 分身停用時被登出：記著代號，延長後在登入畫面幫他填好
/** 改用 Google 雲端硬碟之前（Supabase 時代）留下的登入資料，用不到了，啟動時清掉 */
const GPN_OLD_KEYS = ['gpn_session_v1', 'gpn_sync_v1', 'gpn_pkce_v1'];

const GPN_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * @param {object}   o
 * @param {object}   o.config       GPN_CLOUD：{ clientId, tokenUrl, site, ... }
 * @param {object}   o.kv           非同步的小儲存：get(key) / set(key, value) / remove(key)
 * @param {Function} o.readLocal    async () => 這台目前的資料
 * @param {Function} o.writeRemote  async (data) => 把雲端來的資料寫進這台，並讓畫面跟著更新
 * @param {Function} [o.onState]    (state) => 狀態變了（連結、同步中、離線…）
 * @param {Function} [o.lock]       async (name, fn) => 同一個瀏覽器開好幾個分頁時，讓同步一次只跑一個
 */
function gpnCreateSync(o) {
  'use strict';

  const { config, kv, readLocal, writeRemote } = o;
  const onState = o.onState || (() => {});
  const lock = o.lock || ((name, fn) => fn());
  const configured = gpnCloudConfigured(config);
  // 測試時可以換成本機的假伺服器（見 .claude/test/test-cloud.js）
  const AUTH_URL = config.authUrl || 'https://accounts.google.com/o/oauth2/v2/auth';
  const API = String(config.apiUrl || 'https://www.googleapis.com').replace(/\/+$/, '');

  const EMPTY_META = { userId: null, fileId: null, base: null, hash: null, lastSyncAt: 0 };
  let session = null;   // { access_token, refresh_token, expires_at(ms), email, sub }
  let meta = { ...EMPTY_META };
  let state = {
    configured,
    signedIn: false, email: '', picture: '',
    fileId: '',           // 雲端硬碟上那個檔案（畫面上「在雲端硬碟查看」用）
    phase: 'idle',        // idle | syncing | offline | error
    pending: false,       // 這台有改過、還沒送上雲端
    lastSyncAt: 0, message: '',
    clone: null,          // 用分身登入時：{ id, label, ownerEmail, expiresAt }
    owner: '',            // 建立分身的人進入了自己的分身：他自己的 Email（可以「回到我的帳號」）
    cloneHint: '',        // 上次用的分身停用了：它的代號（登入畫面幫忙填好）
    inbox: [],            // 別人分享給我的（信箱）：[{ id, from: { key, label, avatar }, item: { title, content }, at, kept }]
  };
  let running = null;
  let switching = null;   // 正在換帳號（連結、中斷）
  let timer = 0;
  let dirtyGen = 0;       // 這台改了幾次（同步途中又改了，同步完要再送一次）
  let again = false;      // 這一輪寫進這台時，合併了使用者途中新做的（還沒送上雲端）
  let synced = null;      // 這一輪同步好的內容（雲端和這台一樣的那份）
  let tidied = false;     // 這次開啟已經整理過雲端上的檔名、頭像了

  function setState(patch) {
    state = { ...state, ...patch };
    try { onState({ ...state }); } catch { /* 畫面出錯不影響同步 */ }
  }

  const ready = (async () => {
    for (const k of GPN_OLD_KEYS) await kv.remove(k);
    if (!configured) return;
    session = (await kv.get(GPN_SESSION_KEY)) || null;
    meta = { ...EMPTY_META, ...((await kv.get(GPN_SYNC_KEY)) || {}) };
    const stash = await kv.get(GPN_OWNER_STASH_KEY);
    const hint = await kv.get(GPN_CLONE_HINT_KEY);
    setState({
      cloneHint: !session && gpnIsCloneId(hint) ? hint : '',
      signedIn: !!session, email: session?.email || '', picture: session?.picture || '',
      fileId: isClone() ? '' : meta.fileId || '', lastSyncAt: meta.lastSyncAt || 0,
      clone: cloneView(session), owner: isClone() && stash?.session ? stash.session.email || '' : '',
    });
  })();

  const saveMeta = () => kv.set(GPN_SYNC_KEY, meta);
  async function saveSession(s) {
    session = s;
    if (s) await kv.set(GPN_SESSION_KEY, s);
    else await kv.remove(GPN_SESSION_KEY);
  }

  const offlineError = () => Object.assign(new Error('offline'), { offline: true });

  /* ========== 登入（token）========== */

  /** 經過中繼跟 Google 換 token：{ code, code_verifier, redirect_uri } 或 { refresh_token } */
  const tokenCall = (body) => relayCall(config.tokenUrl, body);

  /** 呼叫我們在 Supabase 上的小程式（token 中繼、分身），回傳 JSON；失敗丟出帶 status、code 的錯誤 */
  async function relayCall(url, body) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
    } catch {
      // 網路是好的卻連不到：中繼本身不見了或掛了（例如 Supabase 專案被刪掉），不要說成「沒網路」
      throw Object.assign(offlineError(), { relay: true });
    }
    let json = null;
    try { json = await res.json(); } catch { /* 不是 JSON 就算了 */ }
    if (!res.ok) {
      const err = new Error(json?.error_description || json?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = json?.error || '';
      throw err;
    }
    return json || {};
  }

  /** id_token 裡有 Email 和帳號代號（sub）。它是中繼剛從 Google 拿回來的，這裡只拿來顯示和分辨帳號 */
  function readIdToken(t) {
    try {
      const part = String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(part + '='.repeat((4 - part.length % 4) % 4));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    } catch {
      return {};
    }
  }

  /** 拿一個還有效的 access token；快過期就先換一張新的 */
  /**
   * Google 的 token 放在哪裡：平常是登入本身；建立的人進入自己的分身時，是分身登入裡的 owner
   * （用分身代號登入的人沒有 Google 的 token）
   */
  const googleOf = (s) => (s?.kind === 'clone' ? s.owner : s) || null;

  async function accessToken(force = false) {
    let g = googleOf(session);
    if (!g) throw Object.assign(new Error('signed out'), { auth: true });
    if (!force && g.expires_at - Date.now() > 60_000) return g.access_token;

    // 別的分頁可能剛換過：儲存裡的比較新就直接用
    const stored = await kv.get(GPN_SESSION_KEY);
    const sg = googleOf(stored);
    if (!force && sg && stored.sub === session.sub && sg.expires_at - Date.now() > 60_000) {
      session = stored;
      return sg.access_token;
    }
    if (!g.refresh_token) return expired();
    try {
      const r = await tokenCall({ refresh_token: g.refresh_token });
      g = {
        ...g,
        access_token: r.access_token,
        expires_at: Date.now() + (Number(r.expires_in) || 3600) * 1000,
        ...(r.refresh_token ? { refresh_token: r.refresh_token } : {}),
      };
      if (isClone()) {
        await saveSession({ ...session, owner: g });
      } else {
        // 換新 token 時 Google 也會附上最新的頭像（4.16.0 以前登入的沒有，重新登入一次才有）
        const who = readIdToken(r.id_token);
        if (who.picture && who.picture !== session.picture) setState({ picture: who.picture });
        await saveSession({ ...g, ...(who.picture ? { picture: who.picture } : {}) });
      }
      return googleOf(session).access_token;
    } catch (e) {
      // 斷線、或中繼暫時有問題：先別登出，等一下再試
      if (e.offline || !e.status || e.status >= 500) throw e;
      return expired();            // invalid_grant：使用者到 Google 帳號把授權撤銷了，或太久沒用
    }
  }

  async function expired() {
    await saveSession(null);
    setState({ inbox: [], signedIn: false, email: '', picture: '', phase: 'idle', pending: false,
      message: '登入已經過期，請重新登入' });
    throw Object.assign(new Error('expired'), { auth: true });
  }

  /* ========== 雲端硬碟 ========== */

  /**
   * 呼叫雲端硬碟的 API。path 從 /drive/v3 或 /upload/drive/v3 開始。
   * as：'json'（預設）| 'text'。token 過期（401）會換一張再試一次。
   */
  async function drive(path, { method = 'GET', body, type, as = 'json' } = {}, retry = true) {
    const headers = { Authorization: 'Bearer ' + (await accessToken()) };
    if (type) headers['Content-Type'] = type;
    let res;
    try {
      res = await fetch(API + path, { method, headers, body });
    } catch {
      throw offlineError();
    }
    if (res.status === 401 && retry) {
      await accessToken(true);
      return drive(path, { method, body, type, as }, false);
    }
    if (as === 'dataurl' && res.ok) {
      // 圖片：轉成 data: 網址（背景程式裡沒有 FileReader 也能用）
      const bytes = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `data:${res.headers.get('content-type') || 'image/jpeg'};base64,${btoa(bin)}`;
    }
    const text = await res.text();
    if (!res.ok) {
      let json = null;
      try { json = JSON.parse(text); } catch { /* 不是 JSON */ }
      const e = json?.error || {};
      const err = new Error(e.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = e.errors?.[0]?.reason || e.status || '';
      throw err;
    }
    if (as === 'text') return text;
    return text ? JSON.parse(text) : {};
  }

  const FIELDS = 'id,version,modifiedTime,trashed,name';

  /** 找雲端硬碟上的筆記本：先試記住的那個；不見了（被刪、被丟垃圾桶）就用 appProperties 找 */
  async function findFile() {
    if (isClone() && session.owner) {
      // 建立的人進入自己的分身：直接用他的雲端硬碟權限讀寫（分身停用了也進得去）
      const f = await drive(`/drive/v3/files/${encodeURIComponent(session.fileId)}?fields=id,version,trashed,appProperties`);
      if (f.trashed) throw Object.assign(new Error('clone_not_found'), { code: 'clone_not_found', clone: true });
      const p = f.appProperties || {};
      await cloneSeen({ label: p.label, avatar: p.avatar, expiresAt: Number(p.expires) || 0, ownerEmail: session.ownerEmail });
      return { id: f.id, version: String(f.version) };
    }
    if (isClone()) {
      // 分身：檔案在建立的人的雲端硬碟裡，由中繼代為存取
      const r = await cloneCall('head', { id: session.cloneId });
      await cloneSeen(r);
      return { id: r.fileId, version: String(r.version) };
    }
    if (meta.fileId) {
      try {
        const f = await drive(`/drive/v3/files/${encodeURIComponent(meta.fileId)}?fields=${FIELDS}`);
        if (!f.trashed) return f;
      } catch (e) {
        if (e.status !== 404) throw e;
      }
      meta.fileId = null;
      meta.base = null;
    }
    const q = "appProperties has { key='gpnNotebook' and value='1' } and trashed = false";
    const r = await drive('/drive/v3/files?' + new URLSearchParams({
      q, spaces: 'drive', orderBy: 'modifiedTime desc', fields: `files(${FIELDS})`, pageSize: '10',
    }));
    const files = r.files || [];
    if (!files.length) return null;
    // 兩台電腦「第一次連結」剛好同時，會各建一個檔案：併進最新的那個，其他丟垃圾桶
    for (const extra of files.slice(1)) {
      const other = await readFile(extra.id);
      if (other && gpnCountItems(other)) {
        const main = await readFile(files[0].id);
        const m = gpnMergeData(main || gpnDefaultData(), other);
        files[0] = await writeFile(files[0].id, m.data);
      }
      await drive(`/drive/v3/files/${encodeURIComponent(extra.id)}?fields=id`, {
        method: 'PATCH', type: 'application/json', body: JSON.stringify({ trashed: true }),
      });
    }
    return files[0];
  }

  /** 讀出筆記本；檔案被改壞（不是 JSON）就回 null */
  async function readFile(id) {
    const text = viaRelay() ? (await cloneCall('read', { id: session.cloneId })).data
      : await drive(`/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { as: 'text' });
    try {
      return gpnNormalize(JSON.parse(text));
    } catch {
      return null;
    }
  }

  /** 存成好讀的 JSON：使用者打開檔案也看得懂 */
  const fileBody = (doc) => JSON.stringify(doc, null, 2);

  async function writeFile(id, doc) {
    if (viaRelay()) {
      const r = await cloneCall('write', { id: session.cloneId, data: fileBody(doc) });
      return { id: r.fileId, version: String(r.version) };
    }
    return drive(`/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}`, {
      method: 'PATCH', type: 'application/json', body: fileBody(doc),
    });
  }

  function createFile(doc) {
    return createDriveFile({
      name: GPN_DRIVE_FILE_NAME,
      description: '罐頭P 的提示詞，由罐頭P 自動同步。請不要手動修改內容；刪掉這個檔案等於刪掉雲端上的提示詞。',
      appProperties: { gpnNotebook: '1' },
    }, doc);
  }

  /** 在雲端硬碟建一個 JSON 檔（info：名稱、說明、appProperties） */
  async function createDriveFile(info, doc) {
    info = { mimeType: 'application/json', ...info };
    const boundary = 'gpn_' + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(info)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${fileBody(doc)}\r\n` +
      `--${boundary}--`;
    return drive(`/upload/drive/v3/files?uploadType=multipart&fields=${FIELDS}`, {
      method: 'POST', type: `multipart/related; boundary=${boundary}`, body,
    });
  }

  /** 錯誤 → 給人看的中文 */
  function explain(e) {
    if (e?.offline && e.relay && navigator.onLine !== false) {
      return '連不上同步伺服器（網路是好的），會自動再試；一直這樣請通知管理員';
    }
    if (e?.offline) return '連不上網路，恢復連線後會自動同步';
    const s = `${e?.code || ''} ${e?.message || ''}`;
    if (/invalid_grant/i.test(s)) return '登入逾時了，請再按一次連結';
    if (/storageQuotaExceeded/i.test(s)) return 'Google 雲端硬碟的空間滿了，清出一點空間後會自動同步';
    if (/insufficientPermissions|insufficient_scope|appNotAuthorizedToFile/i.test(s)) {
      return '沒有存取雲端硬碟的權限，請中斷連結後重新連結，並勾選允許存取雲端硬碟';
    }
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(s)) return '雲端硬碟功能還沒在後台開啟（管理員要到 Google Cloud 啟用 Google Drive API）';
    if (/clone_not_found/i.test(s)) return '找不到這個分身：代號打錯了，或已經被建立的人銷毀了';
    if (/clone_expired/i.test(s)) return '這個分身已經到期，暫時停用了。請建立的人延長期限，之後用同一組代號再登入';
    if (/peer_gone/i.test(s)) return '有的對象已經不在了（分身被銷毀或停用），請重新選一次';
    if (/too_large/i.test(s)) return '這則提示詞太長了，沒辦法分享';
    if (/bad_date/i.test(s)) return '日期不對：請選今天以後、十年以內的日期';
    if (/owner_token_invalid/i.test(s)) return '建立這個分身的人的 Google 登入失效了，請他打開罐頭P 重新登入一次，分身就能再同步';
    if (/server_not_configured/i.test(s)) return '雲端同步的伺服器還沒設定好（管理員要設定 Google 用戶端密鑰）';
    if (/rateLimit|userRateLimitExceeded|RESOURCE_EXHAUSTED/i.test(s) || e?.status === 429) return '同步太頻繁了，等一下會自動再試';
    if (/domainPolicy|restricted|admin_policy/i.test(s)) return '你的機關帳號不允許這個應用程式存取雲端硬碟，請洽機關的 Google 管理員';
    if (e?.status >= 500) return 'Google 暫時有問題，請稍後再試';
    return '發生錯誤：' + (e?.message || '未知的錯誤');
  }

  /* ========== 同步 ========== */

  /**
   * 資料的指紋：看書籤、內容、最近使用記錄和我的最愛；「目前選哪個書籤」這種畫面狀態不算改動。
   * 我的最愛、符號是空的就不算進去：沒用過這些功能的人，指紋和舊版算出來的一樣，更新後不會多同步一次。
   */
  function hashDoc(d) {
    const parts = [d.tabs, d.recent || []];
    if (d.favs?.length) parts.push(d.favs);
    if (Object.keys(d.marks || {}).length || d.markTypes?.length) parts.push(d.marks || {}, d.markTypes || []);
    if (d.look && ((d.look.bg && d.look.bg !== 'default') || (d.look.theme && d.look.theme !== 'auto'))) parts.push(d.look);
    if (d.trash?.length) parts.push(d.trash);
    const s = JSON.stringify(parts);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }

  /** 雲端來的資料不要把這台「正在看哪個書籤」也蓋掉 */
  function keepActive(doc, local) {
    if (local.activeId === GPN_RECENT_ID || local.activeId === GPN_FAV_ID || local.activeId === GPN_TRASH_ID ||
        (doc.markTypes || []).includes(gpnMarkOfTab(local.activeId)) ||
        doc.tabs.some((t) => t.id === local.activeId)) {
      doc.activeId = local.activeId;
    }
    return doc;
  }

  /**
   * 把雲端（或合併好）的內容寫進這台。
   * snapshot 是這一輪開始時讀到的這台資料。同步要花一兩秒，這段時間使用者可能又刪了、改了東西，
   * 直接蓋掉的話，剛刪的會跑回來。所以寫之前再讀一次：有變就把他新做的合併進去，同步完再送一次。
   */
  async function writeLocal(doc, snapshot) {
    const now = gpnNormalize(await readLocal());
    let out = doc;
    if (hashDoc(now) !== hashDoc(snapshot)) {
      out = gpnMerge3(snapshot, now, doc);
      again = true;
    }
    await writeRemote(keepActive(out, now));
  }

  /** 把雲端版本寫進這台 */
  async function apply(doc, version, local) {
    const d = keepActive(gpnNormalize(doc), local);
    await writeLocal(d, local);
    meta.base = version;
    meta.hash = hashDoc(d);
    synced = d;
    return d;
  }

  async function push(doc) {
    const f = await writeFile(meta.fileId, doc);
    meta.base = f.version;
    meta.hash = hashDoc(doc);
    synced = doc;
  }

  /** 上次同步好的內容。和 meta.hash 對不上（舊版沒存過、存失敗）就當作沒有 */
  async function loadBase(local) {
    if (meta.hash == null) return null;
    const b = await kv.get(GPN_BASE_KEY);
    if (b && hashDoc(b) === meta.hash) return gpnNormalize(b);
    return hashDoc(local) === meta.hash ? local : null;   // 這台從上次同步後沒改過：這台就是起點
  }

  async function syncOnce() {
    // 每次都從儲存重讀：同一個瀏覽器的其他分頁可能剛同步過、剛連結或中斷
    meta = { ...EMPTY_META, ...((await kv.get(GPN_SYNC_KEY)) || {}) };
    session = (await kv.get(GPN_SESSION_KEY)) || null;
    if (!session) {
      setState({ inbox: [], signedIn: false, email: '', picture: '' });
      return {};
    }
    if (!state.signedIn) setState({ inbox: [], signedIn: true, email: session.email || '', picture: session.picture || '' });

    let local = gpnNormalize(await readLocal());
    const adopt = meta.adopt;              // 'cloud' | 'replace'（只在剛登入時有；舊版留下的可能是 'merge'）
    delete meta.adopt;
    const note = {};
    synced = null;
    const file = await findFile();
    if (file && file.id !== meta.fileId) meta.base = null;
    const firstHere = !meta.base;          // 這個帳號的這個檔案，在這台電腦還沒同步過
    const base = firstHere ? null : await loadBase(local);

    if (!file) {
      // 雲端硬碟上還沒有筆記本（第一次用，或使用者把檔案刪了）
      if (adopt === 'replace') {
        local = gpnDefaultData();          // 這台的資料是別的帳號的，不要帶進新帳號
        await writeRemote(local);
        // 馬上記下來「已經換過了」：萬一下面上傳時斷線，下次重試不會又清一次
        await saveMeta();
      }
      const f = await createFile(local);
      meta.fileId = f.id;
      meta.base = f.version;
      meta.hash = hashDoc(local);
      synced = local;
      note.uploaded = gpnCountItems(local);
    } else {
      meta.fileId = file.id;
      let cloud = null;                    // 雲端改過才會有
      if (file.version !== meta.base) {
        cloud = await readFile(file.id);
        if (!cloud) {
          // 檔案被改壞了：用這台的蓋回去（雲端硬碟會留著壞掉的那一版）
          meta.base = file.version;
          await push(local);
          note.uploaded = gpnCountItems(local);
        } else if (!firstHere && hashDoc(cloud) === meta.hash) {
          // 版本號變了，內容卻和上次同步好的一樣（雲端硬碟自己動了檔案）：當作雲端沒改
          meta.base = file.version;
          cloud = null;
        }
      }
      if (cloud && firstHere) {
        if (adopt === 'cloud' && gpnCountItems(local) && hashDoc(local) !== hashDoc(cloud)) {
          // 以雲端為準，這台原本的另外留一份，萬一要找回來（設定 → 備份）
          await kv.set(GPN_PRELOGIN_KEY, { at: Date.now(), data: local });
          note.replaced = gpnCountItems(local);
        }
        if (adopt === 'replace' || adopt === 'cloud' || !gpnCountItems(local)) {
          await apply(cloud, file.version, local);
          note.pulled = gpnCountItems(cloud);
        } else {
          const m = gpnMergeData(cloud, local);
          const merged = await apply(m.data, file.version, local);
          if (m.added || hashDoc(merged) !== hashDoc(cloud)) await push(merged);
          note.pulled = gpnCountItems(cloud);
          note.merged = m.added;
        }
      } else if (cloud) {
        if (hashDoc(local) === meta.hash) {
          await apply(cloud, file.version, local);            // 只有雲端改過
        } else {
          // 兩邊都改過：三方合併。舊版升上來第一次還沒有共同起點，才退回「以雲端為底，加上這台多的」
          const doc = base ? gpnMerge3(base, local, cloud) : gpnMergeData(cloud, local).data;
          const merged = await apply(doc, file.version, local);
          if (hashDoc(merged) !== hashDoc(cloud)) await push(merged);
        }
      } else if (hashDoc(local) !== meta.hash) {
        await push(local);                                    // 只有這台改過
      }
    }

    if (!tidied) {
      tidied = true;
      await tidyUp(file || { id: meta.fileId });
    }

    if (CLONE_URL && Date.now() - inboxAt > 30_000) {
      inboxAt = Date.now();
      try { await checkInbox(); } catch { /* 下一輪再看 */ }
    }

    meta.lastSyncAt = Date.now();
    await saveMeta();
    // 記下這次同步好的內容，下次兩邊都改過時拿來當共同的起點
    if (synced) await kv.set(GPN_BASE_KEY, synced);
    else if (!base && hashDoc(local) === meta.hash) await kv.set(GPN_BASE_KEY, local);
    return note;
  }

  /**
   * 每次開啟只做一次的小整理，失敗了也不影響同步：
   *   1. 改名「罐頭P」之前建的檔案，名字換成新的（使用者自己改過名字的不動）
   *   2. 沒有頭像（登入時 Google 沒給，例如 4.16.0 以前登入的）：向雲端硬碟要這個帳號的大頭貼，
   *      雲端硬碟的權限就拿得到，不用重新登入
   */
  async function tidyUp(file) {
    if (isClone()) return;
    try { await cloneUpkeep(); } catch { /* 下次再說 */ }
    const rename = async (f, from, to) => {
      if (f?.id && f.name === from) {
        await drive(`/drive/v3/files/${encodeURIComponent(f.id)}?fields=id`, {
          method: 'PATCH', type: 'application/json', body: JSON.stringify({ name: to }),
        });
      }
    };
    try { await rename(file, '特務P 提示詞筆記本.json', GPN_DRIVE_FILE_NAME); } catch { /* 下次再說 */ }
    try {
      const r = await drive('/drive/v3/files?' + new URLSearchParams({
        q: "appProperties has { key='gpnWallpaper' and value='1' } and trashed = false",
        spaces: 'drive', fields: 'files(id,name)', pageSize: '1',
      }));
      await rename((r.files || [])[0], '特務P 背景圖', '罐頭P 背景圖');
    } catch { /* 下次再說 */ }
    if (!session?.picture) {
      try {
        const a = await drive('/drive/v3/about?fields=user(photoLink)');
        const pic = a.user?.photoLink || '';
        if (pic && session) {
          await saveSession({ ...session, picture: pic });
          setState({ picture: pic });
        }
      } catch { /* 拿不到就繼續用 Email 第一個字 */ }
    }
  }

  /** 立刻同步一次（拉＋推）。同時只會有一次在跑。 */
  function syncNow() {
    if (running) return running;
    running = (async () => {
      await ready;
      while (switching) await switching.catch(() => {});   // 正在換帳號：換好再同步
      if (!configured) return {};
      const gen = dirtyGen;
      again = false;
      setState({ phase: 'syncing' });
      try {
        const note = await lock('gpn-sync', syncOnce);
        // 同步途中又改了東西：馬上再送一次，不用等下一次改動
        const more = !!session && (again || dirtyGen !== gen);
        setState({ phase: 'idle', pending: more, lastSyncAt: meta.lastSyncAt, fileId: meta.fileId || '', message: '' });
        if (more) {
          clearTimeout(timer);
          timer = setTimeout(syncNow, 300);
        }
        return note;
      } catch (e) {
        if (e.auth) return { error: e.clone ? explain(e) : '和 Google 雲端硬碟的連結已經失效，請重新連結' };
        setState({ phase: e.offline ? 'offline' : 'error', message: explain(e) });
        return { error: explain(e) };
      } finally {
        running = null;
      }
    })();
    return running;
  }

  /**
   * 這台的資料剛改過：等 0.8 秒沒再改，就推上雲端（連續打字時不要每個字都送）。
   * doc 是改好的資料：內容和上次同步好的一樣（例如只是切換書籤），就不用同步。
   */
  function markDirty(doc) {
    if (!configured) return;
    if (doc && !running && meta.hash != null && hashDoc(gpnNormalize(doc)) === meta.hash) return;
    dirtyGen++;
    if (state.signedIn) setState({ pending: true });
    clearTimeout(timer);
    timer = setTimeout(syncNow, 800);   // 沒連結的話 syncNow 會自己什麼都不做
  }

  /** 還沒送出的馬上送（網頁版切到別的分頁、要關掉時用，不等那 0.8 秒） */
  function flush() {
    if (!state.pending) return Promise.resolve({});
    clearTimeout(timer);
    return syncNow();
  }

  /* ========== 連結／中斷 ========== */

  /**
   * 換帳號（連結、中斷）。舊帳號那一輪同步可能還在跑，
   * 它跑完會把「舊的登入」和「舊的同步進度」寫回去，蓋掉剛換好的。
   * 所以先等它跑完；並且拿同一把鎖，和同一個瀏覽器其他分頁的同步錯開。
   */
  async function switchUser(fn) {
    while (running || switching) await (running || switching).catch(() => {});
    inboxAt = 0;                       // 換了帳號：下一輪同步馬上看新帳號的信箱
    switching = lock('gpn-sync', fn);
    try { return await switching; } finally { switching = null; }
  }

  function b64url(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * 產生「去 Google 連結雲端硬碟」的網址。
   * redirectTo：登入完要回到哪個網址（要在 Google Cloud 的「已授權的重新導向 URI」清單裡）
   */
  async function authUrl(redirectTo) {
    await ready;
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));   // 防止別人拿他的 code 塞給我們
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    await kv.set(GPN_PKCE_KEY, { verifier, nonce, redirectTo, at: Date.now() });
    return AUTH_URL + '?' + new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectTo,
      response_type: 'code',
      scope: `openid email profile ${GPN_DRIVE_SCOPE}`,   // profile：拿 Google 頭像
      access_type: 'offline',             // 要拿 refresh token，一小時後才不用重新登入
      prompt: 'select_account consent',   // 每次都讓他選帳號（公司／個人帳號才不會連錯）
      include_granted_scopes: 'true',
      code_challenge: b64url(new Uint8Array(digest)),
      code_challenge_method: 'S256',
      state: nonce,
    });
  }

  /** 從 Google 回來，拿網址上的 code 換成連結 */
  async function finishAuth(code, returnedState) {
    await ready;
    if (!configured) return { ok: false, error: '雲端同步還沒設定' };
    const p = await kv.get(GPN_PKCE_KEY);
    await kv.remove(GPN_PKCE_KEY);          // 一次性，用過就丟
    if (!p?.verifier || Date.now() - p.at > 15 * 60_000) {
      return { ok: false, error: '連結逾時了，請回到設定再按一次' };
    }
    if (returnedState !== p.nonce) return { ok: false, error: '這次的連結不是從這裡開始的，請回到設定再按一次' };

    let r;
    try {
      r = await tokenCall({ code, code_verifier: p.verifier, redirect_uri: p.redirectTo });
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
    // Google 的同意畫面可以只勾一部分：沒勾雲端硬碟就沒辦法同步
    if (!String(r.scope || '').split(' ').includes(GPN_DRIVE_SCOPE)) {
      return { ok: false, error: '剛剛沒有勾選「允許存取 Google 雲端硬碟」，請再連結一次，並把那一項打勾' };
    }
    const who = readIdToken(r.id_token);
    const s = {
      access_token: r.access_token,
      refresh_token: r.refresh_token || '',
      expires_at: Date.now() + (Number(r.expires_in) || 3600) * 1000,
      email: who.email || '',
      picture: who.picture || '',
      sub: who.sub || who.email || 'google',
    };

    await switchUser(() => becomeUser(s));
    setState({ inbox: [], signedIn: true, email: s.email, picture: s.picture, fileId: '', clone: null, owner: '', message: '' });
    const note = await syncNow();
    return { ok: true, ...note };
  }

  /** 登入成這個帳號（Google 或分身）。在 switchUser 裡面呼叫 */
  async function becomeUser(s) {
    await kv.remove(GPN_OWNER_STASH_KEY);   // 重新登入了，之前「進入分身」收起來的那份用不到了
    await saveSession(s);
    tidied = false;                         // 換了帳號：檔名、頭像再整理一次
    meta = { ...EMPTY_META, ...((await kv.get(GPN_SYNC_KEY)) || {}) };
    if (meta.userId !== s.sub) {
      // 換了一個帳號（或第一次登入）：從頭同步，以雲端為準。
      // meta.userId 是空的 = 這台的資料從來沒屬於過任何帳號 → 雲端沒有筆記本的話，把這台的傳上去
      meta = { ...EMPTY_META, userId: s.sub, adopt: meta.userId ? 'replace' : 'cloud' };
      await saveMeta();
      await kv.remove(GPN_BASE_KEY);
    }
  }

  /**
   * 中斷連結。這台的提示詞預設留著（只是不再同步）；雲端硬碟上的檔案也留著。
   * wipe=true 則連這台的資料一起清掉（在別人的電腦上用完時）。
   * 不向 Google 撤銷授權：撤銷會連其他電腦的連結一起斷掉。
   */
  async function signOut({ wipe = false } = {}) {
    await ready;
    if (session) await syncNow();                        // 還沒送出的先送上去
    clearTimeout(timer);
    await switchUser(async () => {
      await saveSession(null);
      await kv.remove(GPN_OWNER_STASH_KEY);
      if (wipe) {
        await writeRemote(gpnDefaultData());
        meta = { ...EMPTY_META };
        await saveMeta();
        await kv.remove(GPN_BASE_KEY);
      }
    });
    setState({ inbox: [], signedIn: false, email: '', picture: '', phase: 'idle', pending: false, message: '', clone: null, owner: '' });
    return { ok: true };
  }

  /* ========== 背景圖 ==========
     自己上傳的背景圖很大（幾百 KB），不放進筆記本（那樣每改一則提示詞都要傳一次圖）。
     另外存一個檔案「罐頭P 背景圖」，appProperties 的 wid 記著是哪一張；筆記本裡只記代號（look.wallpaper）。
     別台看到代號和自己手上的不一樣，才來下載。 */

  const WALLPAPER_Q = "appProperties has { key='gpnWallpaper' and value='1' } and trashed = false";

  async function wallpaperFile() {
    const r = await drive('/drive/v3/files?' + new URLSearchParams({
      q: WALLPAPER_Q, spaces: 'drive', orderBy: 'modifiedTime desc', fields: 'files(id,appProperties)', pageSize: '1',
    }));
    return (r.files || [])[0] || null;
  }

  /** 上傳背景圖（data: 網址）。id 是這張圖的代號 */
  async function putWallpaper(id, dataUrl) {
    await ready;
    if (!session) return { ok: false, error: '還沒登入' };
    if (isClone()) return { ok: false, error: '分身沒辦法上傳自己的背景圖（只存在這台），請選內建的背景' };
    try {
      const [head, b64] = String(dataUrl).split(',');
      const mime = (/^data:([^;,]+)/.exec(head) || [])[1] || 'image/jpeg';
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const f = await wallpaperFile();
      const info = f ? { appProperties: { wid: id } } : {
        name: '罐頭P 背景圖', mimeType: mime,
        description: '罐頭P 的背景圖，由罐頭P 自動同步。',
        appProperties: { gpnWallpaper: '1', wid: id },
      };
      const boundary = 'gpn_' + Math.random().toString(36).slice(2);
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(info)}\r\n` +
        `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, bytes, `\r\n--${boundary}--`]);
      await drive(f ? `/upload/drive/v3/files/${encodeURIComponent(f.id)}?uploadType=multipart&fields=id`
                    : '/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: f ? 'PATCH' : 'POST', type: `multipart/related; boundary=${boundary}`, body,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  /** 下載代號是 id 的背景圖，回傳 { ok, dataUrl }；雲端上的不是這一張就回 ok: false */
  async function getWallpaper(id) {
    await ready;
    if (!session || isClone()) return { ok: false };
    try {
      const f = await wallpaperFile();
      if (!f || f.appProperties?.wid !== id) return { ok: false };
      const r = await drive(`/drive/v3/files/${encodeURIComponent(f.id)}?alt=media`, { as: 'dataurl' });
      return { ok: true, dataUrl: r };
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  /* ========== 分身 ==========
     分身是一個不用 Google 帳號的「小帳號」：建立的人勾選一些提示詞，複製一份成新的筆記本，
     得到一組 16 碼的代號（例如 K7QM-3XPA-9RVD-H2WN）。同事在登入畫面輸入代號，就能像一般帳號一樣使用、編輯。

     資料存在哪裡：建立的人「自己的」雲端硬碟裡，一個分身一個檔案（罐頭P 分身 - 名稱.json）。
       同事沒有 Google 帳號、碰不到那個雲端硬碟，所以由中繼（supabase/functions/gpn-clone）代為讀寫：
       建立分身時，把建立的人的 refresh token 加密交給中繼保管；中繼只存「代號的雜湊 → 哪個檔案」，
       提示詞不存在中繼，讀寫時直接轉給雲端硬碟。權限一樣只有 drive.file（只碰得到罐頭P 建立的檔案）。
     代號就是密碼：16 碼、每碼 32 種，約 2^80 種組合，猜不到。中繼只存它的雜湊。
     一年後到期就「停用」：中繼不再接受這個代號，但什麼都不刪。建立的人可以延長期限（自己選到哪一天），
       或銷毀；停用期間建立的人照樣可以進入分身（他直接用自己的雲端硬碟權限，不經過中繼）。

     建立的人（用自己的 Google 帳號登入時）在 設定 → 分身：
       建立、列出、複製代號、銷毀，「再推一次」把最新的提示詞推進分身（分身自己新增的不動），
       也可以「進入分身」：直接用那個分身的身分使用、編輯，再「回到我的帳號」，不用重新登入 Google。
     分身和原本的筆記本各自獨立，不會自動同步。 */

  const CLONE_URL = config.cloneUrl || '';
  const CLONE_Q = "appProperties has { key='gpnClone' and value='1' } and trashed = false";

  function isClone() { return session?.kind === 'clone'; }
  /** 用分身代號登入的人（不是建立的人自己進來）：讀寫都要經過中繼 */
  function viaRelay() { return isClone() && !session.owner; }

  function cloneView(s) {
    if (s?.kind !== 'clone') return null;
    return { id: s.cloneId, label: s.label || '', ownerEmail: s.ownerEmail || '', expiresAt: s.expiresAt || 0, avatar: s.avatar || '' };
  }

  /** 頭像的代號（avatars.js 的 GPN_AVATARS），這裡只檢查長得像不像，畫面認不得的會改用文字頭像 */
  const avatarId = (v) => (/^[a-z]{1,20}$/.test(String(v || '')) ? String(v) : '');

  function cloneSession(id, r) {
    const label = String(r.label || '分身');
    return {
      kind: 'clone', cloneId: id, sub: 'clone:' + id, email: '分身：' + label, picture: '',
      label, ownerEmail: String(r.ownerEmail || ''), expiresAt: Number(r.expiresAt) || 0, avatar: avatarId(r.avatar),
    };
  }

  /**
   * 分身登入時呼叫中繼。分身被銷毀、到期了：登出，回到登入畫面並說明原因。
   * 錯誤都帶 clone: true，explain() 才認得出是分身的問題。
   */
  async function cloneCall(op, body) {
    if (!CLONE_URL) throw Object.assign(new Error('分身功能還沒開放'), { clone: true });
    try {
      return await relayCall(CLONE_URL, { op, ...body });
    } catch (e) {
      e.clone = true;
      if (session && isClone() && /^clone_(not_found|expired)$/.test(e.code)) {
        const hint = e.code === 'clone_expired' ? session.cloneId : '';
        if (hint) await kv.set(GPN_CLONE_HINT_KEY, hint);
        await saveSession(null);
        await kv.remove(GPN_OWNER_STASH_KEY);
        setState({ inbox: [], signedIn: false, email: '', picture: '', phase: 'idle', pending: false,
          clone: null, owner: '', cloneHint: hint, message: explain(e) });
        e.auth = true;
      }
      throw e;
    }
  }

  /** 中繼回報了分身最新的名稱、到期日：記下來（建立的人改過名稱） */
  async function cloneSeen(r) {
    const next = cloneSession(session.cloneId, r);
    if (next.label === session.label && next.expiresAt === session.expiresAt && next.ownerEmail === session.ownerEmail &&
        next.avatar === (session.avatar || '')) return;
    await saveSession({ ...session, ...next });
    setState({ email: session.email, clone: cloneView(session) });
  }

  /** 分身代號：大寫、去掉中間的「-」和空白 */
  async function cloneSignIn(raw) {
    await ready;
    const id = gpnCleanCloneId(raw);
    if (!gpnIsCloneId(id)) return { ok: false, error: '分身代號是 16 個英文字母和數字，請再檢查一次' };
    if (!CLONE_URL) return { ok: false, error: '分身功能還沒開放' };
    let r;
    try { r = await relayCall(CLONE_URL, { op: 'head', id }); } catch (e) { return { ok: false, error: explain(e) }; }
    const s = cloneSession(id, r);
    await switchUser(() => becomeUser(s));
    await kv.remove(GPN_CLONE_HINT_KEY);
    setState({ inbox: [], signedIn: true, email: s.email, picture: '', fileId: '', clone: cloneView(s), owner: '', cloneHint: '', message: '' });
    const note = await syncNow();
    return { ok: true, label: s.label, ...note };
  }

  /**
   * 建立的人「進入分身」：自己的登入、同步進度、提示詞先收起來（GPN_OWNER_STASH_KEY），換成分身。
   * 自己的提示詞要先同步好才換：收起來的那份，就是之後回來時的起點。
   * 分身的登入裡帶著他自己的 Google token（owner），直接讀寫雲端硬碟上的分身檔案，不經過中繼——
   * 所以分身停用（到期）了，他照樣進得去。c 是 listClones 給的那個分身。
   */
  async function enterClone(c) {
    await ready;
    if (!session || isClone()) return { ok: false, error: '要先用自己的 Google 帳號登入' };
    if (!c?.fileId || !gpnIsCloneId(c.id)) return { ok: false, error: '找不到這個分身' };
    const first = await syncNow();
    if (first?.error) return { ok: false, error: '自己的提示詞還沒同步好，先不切換：' + first.error };
    const ownerEmail = session.email || '';
    let s = null;
    await switchUser(async () => {
      const mine = (await kv.get(GPN_SESSION_KEY)) || session;
      await kv.set(GPN_OWNER_STASH_KEY, {
        at: Date.now(),
        session: mine,
        meta: { ...EMPTY_META, ...((await kv.get(GPN_SYNC_KEY)) || {}) },
        base: (await kv.get(GPN_BASE_KEY)) || null,
        local: gpnNormalize(await readLocal()),
      });
      s = {
        ...cloneSession(c.id, { label: c.label, avatar: c.avatar, expiresAt: c.expiresAt, ownerEmail }),
        fileId: c.fileId,
        owner: { access_token: mine.access_token, refresh_token: mine.refresh_token, expires_at: mine.expires_at },
      };
      await saveSession(s);
      meta = { ...EMPTY_META, userId: s.sub, adopt: 'replace' };   // 這台換成分身雲端上的樣子
      await saveMeta();
      await kv.remove(GPN_BASE_KEY);
    });
    setState({ inbox: [], signedIn: true, email: s.email, picture: '', fileId: '', clone: cloneView(s), owner: ownerEmail, message: '' });
    const note = await syncNow();
    return { ok: true, label: s.label, ...note };
  }

  /**
   * 從分身回到自己的帳號：分身裡還沒送出的先送；送不出去（沒網路）的話先不換，force 才換（那些修改會不見）。
   * 這台換回收起來的那份（和雲端同步好的樣子），再照平常同步一次，拉下這段時間別台改過的。
   */
  async function leaveClone({ force = false } = {}) {
    await ready;
    const stash = await kv.get(GPN_OWNER_STASH_KEY);
    if (!stash?.session) return { ok: false, error: '找不到原本的帳號，請登出後用 Google 帳號登入' };
    if (session && isClone()) {
      const r = await syncNow();
      if (r?.error && !force && session) return { ok: false, unsynced: true, error: r.error };
    }
    clearTimeout(timer);
    await switchUser(async () => {
      await writeRemote(gpnNormalize(stash.local));
      if (stash.base) await kv.set(GPN_BASE_KEY, stash.base);
      else await kv.remove(GPN_BASE_KEY);
      meta = { ...EMPTY_META, ...stash.meta };
      await saveMeta();
      // 在分身裡換過新的 token 的話，用新的
      const g = googleOf(session);
      await saveSession(g && isClone() ? { ...stash.session, ...g } : stash.session);
      await kv.remove(GPN_OWNER_STASH_KEY);
    });
    setState({
      inbox: [], signedIn: true, email: session.email || '', picture: session.picture || '', fileId: meta.fileId || '',
      clone: null, owner: '', message: '',
    });
    const note = await syncNow();
    return { ok: true, ...note };
  }

  /* ---- 建立的人管理自己的分身（直接用他自己的雲端硬碟權限）---- */

  const ownerOnly = () => (session && !isClone() ? '' : '要用自己的 Google 帳號登入才能管理分身');

  function cloneOfFile(f) {
    const p = f.appProperties || {};
    return {
      fileId: f.id, id: p.cloneId || '', label: p.label || '', avatar: avatarId(p.avatar),
      createdAt: Date.parse(f.createdTime) || 0, modifiedAt: Date.parse(f.modifiedTime) || 0,
      expiresAt: Number(p.expires) || 0,
    };
  }

  async function listCloneFiles() {
    const r = await drive('/drive/v3/files?' + new URLSearchParams({
      q: CLONE_Q, spaces: 'drive', orderBy: 'createdTime desc',
      fields: 'files(id,name,createdTime,modifiedTime,appProperties)', pageSize: '100',
    }));
    return (r.files || []).map(cloneOfFile).filter((c) => gpnIsCloneId(c.id));
  }

  const trashFile = (id) => drive(`/drive/v3/files/${encodeURIComponent(id)}?fields=id`, {
    method: 'PATCH', type: 'application/json', body: JSON.stringify({ trashed: true }),
  });

  /**
   * 每次開啟做一次：有分身的話（停用的也算，延長後還要用），把最新的 refresh token 交給中繼。
   * Google 每個帳號最多留 100 張 refresh token，舊的會失效——常常登入的人，中繼手上那張可能被擠掉，
   * 所以每次打開都換一張新的給它，分身才不會突然連不上。
   */
  async function cloneUpkeep() {
    if (!CLONE_URL) return;
    const all = await listCloneFiles();
    if (all.length && session.refresh_token) {
      await relayCall(CLONE_URL, { op: 'token', token: await accessToken(), refresh_token: session.refresh_token });
    }
  }

  async function listClones() {
    await ready;
    if (ownerOnly()) return { ok: false, error: ownerOnly() };
    try {
      return { ok: true, clones: await listCloneFiles() };     // 停用（到期）的也列出來：可以延長或銷毀
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  /** 建立分身：doc 是勾選好的提示詞（gpnCloneSubset 做出來的），avatar 是頭像的代號 */
  async function createClone(label, doc, avatar = '') {
    await ready;
    if (ownerOnly()) return { ok: false, error: ownerOnly() };
    if (!CLONE_URL) return { ok: false, error: '分身功能還沒開放' };
    if (!session.refresh_token) return { ok: false, error: '請登出、再用 Google 帳號登入一次，才能建立分身' };
    label = gpnCloneLabel(label);
    const id = gpnNewCloneId();
    const expiresAt = Date.now() + GPN_CLONE_DAYS * 86400000;
    let f = null;
    try {
      f = await createDriveFile({
        name: `罐頭P 分身 - ${label}.json`,
        description: `罐頭P 的分身「${label}」：用分身代號登入的人在用這份提示詞。刪掉這個檔案等於銷毀這個分身。`,
        appProperties: { gpnClone: '1', cloneId: id, label, expires: String(expiresAt), ...(avatarId(avatar) ? { avatar: avatarId(avatar) } : {}) },
      }, gpnNormalize(doc));
      const r = await relayCall(CLONE_URL, {
        op: 'register', token: await accessToken(), refresh_token: session.refresh_token, id, fileId: f.id, label,
      });
      return {
        ok: true,
        clone: { fileId: f.id, id, label, avatar: avatarId(avatar), createdAt: Date.now(), modifiedAt: Date.now(), expiresAt: Number(r.expiresAt) || expiresAt },
      };
    } catch (e) {
      if (f) { try { await trashFile(f.id); } catch { /* 留著也只是多一個沒人用的檔案 */ } }
      return { ok: false, error: explain(e) };
    }
  }

  /** 延長期限（或改成任何一天）：中繼和雲端硬碟上的檔案都記下新的到期日 */
  async function extendClone(c, expiresAt) {
    await ready;
    if (ownerOnly()) return { ok: false, error: ownerOnly() };
    const at = Number(expiresAt);
    if (!(at > Date.now())) return { ok: false, error: '請選今天以後的日期' };
    try {
      await relayCall(CLONE_URL, { op: 'extend', token: await accessToken(), id: c.id, expiresAt: at });
      await drive(`/drive/v3/files/${encodeURIComponent(c.fileId)}?fields=id`, {
        method: 'PATCH', type: 'application/json', body: JSON.stringify({ appProperties: { expires: String(at) } }),
      });
      return { ok: true, expiresAt: at };
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  /** 銷毀分身：中繼不再接受這個代號，檔案丟進雲端硬碟的垃圾桶（30 天內還救得回來，但代號不能再用） */
  async function destroyClone(c) {
    await ready;
    if (ownerOnly()) return { ok: false, error: ownerOnly() };
    try {
      try {
        await relayCall(CLONE_URL, { op: 'revoke', token: await accessToken(), id: c.id });
      } catch (e) {
        if (e.status !== 404) throw e;
      }
      await trashFile(c.fileId);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  /**
   * 換頭像。c 是建立的人要換的那個分身（直接改他雲端硬碟上那個檔案的 appProperties）；
   * c 是 null：用分身登入的人換自己的（經過中繼）。
   */
  async function setCloneAvatar(c, avatar) {
    await ready;
    const pet = avatarId(avatar);
    if (!pet) return { ok: false, error: '沒有這個頭像' };
    try {
      if (!c && isClone() && session.owner) c = { fileId: session.fileId };   // 建立的人在自己的分身裡：直接改檔案
      if (!c) {
        if (!isClone()) return { ok: false, error: '現在不是用分身登入' };
        await cloneCall('avatar', { id: session.cloneId, avatar: pet });
        if (!session) return { ok: false, error: state.message || '分身已經不在了' };
        await saveSession({ ...session, avatar: pet });
        setState({ clone: cloneView(session) });
        return { ok: true };
      }
      if (!googleOf(session)) return { ok: false, error: ownerOnly() };
      await drive(`/drive/v3/files/${encodeURIComponent(c.fileId)}?fields=id`, {
        method: 'PATCH', type: 'application/json', body: JSON.stringify({ appProperties: { avatar: pet } }),
      });
      if (isClone()) {
        await saveSession({ ...session, avatar: pet });
        setState({ clone: cloneView(session) });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  /** 讀出分身現在的內容（「再推一次」時預先勾好分身裡已經有的） */
  async function readClone(fileId) {
    await ready;
    if (ownerOnly()) return { ok: false, error: ownerOnly() };
    try {
      return { ok: true, data: (await readFile(fileId)) || gpnDefaultData() };
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  /** 再推一次：把勾選的提示詞推進分身（同一則就更新成最新的，沒有的就加進去；分身自己的都不動） */
  async function pushClone(fileId, doc) {
    await ready;
    if (ownerOnly()) return { ok: false, error: ownerOnly() };
    try {
      const cur = (await readFile(fileId)) || gpnDefaultData();
      const m = gpnCloneOverlay(cur, gpnNormalize(doc));
      await writeFile(fileId, m.data);
      return { ok: true, added: m.added, updated: m.updated };
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  /* ========== 分享 ==========
     主人和分身（們）之間互相傳提示詞：卡片的「⋯ → 分享」，勾選要給誰（可以很多個）。
     每一份分享是建立的人雲端硬碟裡的一個小檔案（罐頭P 分享.json），一個收件人一個，裡面是一則提示詞；
     appProperties 記著寄給誰（to）、誰寄的（from）、暫留了沒有（kept）。
       主人是 'owner'，分身是它的檔案代號（fileId）——不用分身代號，分身代號是密碼，不能讓別的分身知道。
     收件人每輪同步看一下信箱（最多 30 秒一次），放進 state.inbox：畫面上頭像變成一封信，數字是還沒看過的。
       採用 → 提示詞放進他選的書籤、資料夾（畫面做），小檔案刪掉（ackShares）
       暫留 → 留在信箱，不算未讀（keepShares，記在小檔案的 appProperties，換一台電腦也一樣）
     用分身代號登入的人碰不到雲端硬碟，一樣由中繼代為處理（peers、share、inbox、keep、ack）。 */

  const SHARE_Q = (to) =>
    `appProperties has { key='gpnShare' and value='1' } and appProperties has { key='to' and value='${to}' } and trashed = false`;
  const isShareKey = (k) => k === 'owner' || /^[\w-]{8,128}$/.test(k);
  const isFileId = (k) => /^[\w-]{8,128}$/.test(k);
  let inboxAt = 0;                 // 上次看信箱的時間
  const gone = new Set();          // 採用、刪掉過的：雲端硬碟的搜尋有時慢幾秒才更新，先別再顯示
  const keptHere = new Set();      // 這台按過暫留的（雲端硬碟還沒記好之前，也先當作暫留了）
  let later = { ack: [], keep: [] };   // 斷線時沒做成的：下次看信箱時再做

  /** 我在分享裡的代號（不經過中繼的時候）：主人是 owner；建立的人進入自己的分身時，是那個分身的檔案 */
  const myShareKey = () => (isClone() ? session.fileId : 'owner');

  const cleanItem = (it) => ({ title: String(it?.title ?? '').slice(0, 60), content: String(it?.content ?? '') });

  function cleanShare(raw) {
    const f = raw?.from || {};
    const item = raw?.item && typeof raw.item === 'object' ? cleanItem(raw.item) : null;
    return {
      id: String(raw?.id || ''),
      from: { key: String(f.key || ''), label: String(f.label || '').slice(0, 60) || '分身', avatar: avatarId(f.avatar) },
      item: item && (item.title || item.content) ? item : null,
      at: Number(raw?.at) || 0,
      kept: !!raw?.kept || keptHere.has(String(raw?.id || '')),
    };
  }

  /** 可以分享給誰：分身看得到主人和其他分身；主人看得到自己的分身。停用的分身不算 */
  async function peersHere() {
    if (viaRelay()) return ((await cloneCall('peers', { id: session.cloneId })).peers || []);
    const now = Date.now();
    const me = isClone() ? session.fileId : '';
    const list = (await listCloneFiles())
      .filter((c) => c.fileId !== me && !(c.expiresAt && c.expiresAt <= now))
      .map((c) => ({ key: c.fileId, label: c.label || '分身', avatar: c.avatar || '' }));
    return isClone() ? [{ key: 'owner', label: '主人', avatar: '', email: session.ownerEmail || '' }, ...list] : list;
  }

  async function listPeers() {
    await ready;
    if (!session) return { ok: false, error: '要先登入才能分享' };
    if (!CLONE_URL) return { ok: false, error: '分享功能還沒開放' };
    try {
      const peers = (await peersHere()).map((x) => ({
        key: String(x.key || ''), label: String(x.label || '分身'), avatar: avatarId(x.avatar), email: String(x.email || ''),
      })).filter((x) => isShareKey(x.key));
      return { ok: true, peers };
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  /** 把一則提示詞（{ title, content }）分享給 to（代號的陣列） */
  async function sharePrompt(item, to) {
    await ready;
    if (!session) return { ok: false, error: '要先登入才能分享' };
    if (!CLONE_URL) return { ok: false, error: '分享功能還沒開放' };
    item = cleanItem(item);
    to = [...new Set((Array.isArray(to) ? to : []).map(String))].filter(isShareKey);
    if (!item.title && !item.content) return { ok: false, error: '沒有要分享的提示詞' };
    if (!to.length) return { ok: false, error: '請勾選要分享給誰' };
    try {
      if (viaRelay()) {
        await cloneCall('share', { id: session.cloneId, to, item });
        return { ok: true, sent: to.length };
      }
      const ok = new Set((await peersHere()).map((x) => x.key));
      if (to.some((k) => !ok.has(k))) return { ok: false, error: explain({ code: 'peer_gone' }) };
      const from = isClone()
        ? { key: session.fileId, label: session.label || '分身', avatar: session.avatar || '' }
        : { key: 'owner', label: '主人', avatar: '' };
      for (const k of to) {
        await createDriveFile({
          name: '罐頭P 分享.json',
          description: '罐頭P 的分享：收到的人在罐頭P 按「採用」或刪掉之後，這個檔案會自動刪掉。',
          appProperties: { gpnShare: '1', to: k, from: from.key },
        }, { v: 1, from, item, at: Date.now() });
      }
      return { ok: true, sent: to.length };
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  /** 雲端硬碟上的分享小檔案：刪掉（ack）或記成暫留（keep） */
  async function touchShares(op, ids) {
    if (viaRelay()) { await cloneCall(op, { id: session.cloneId, ids }); return; }
    for (const id of ids) {
      try {
        if (op === 'ack') await drive(`/drive/v3/files/${encodeURIComponent(id)}`, { method: 'DELETE', as: 'text' });
        else {
          await drive(`/drive/v3/files/${encodeURIComponent(id)}?fields=id`, {
            method: 'PATCH', type: 'application/json', body: JSON.stringify({ appProperties: { kept: '1' } }),
          });
        }
      } catch (e) {
        if (e.status !== 404) throw e;
      }
    }
  }

  /** 看信箱：寄給我的分享放進 state.inbox（舊的在前面） */
  async function checkInbox() {
    if (!session) return;
    for (const op of ['ack', 'keep']) {
      if (!later[op].length) continue;
      const ids = later[op];
      later[op] = [];
      try { await touchShares(op, ids); } catch { later[op].push(...ids); }
    }
    let raw;
    if (viaRelay()) {
      raw = (await cloneCall('inbox', { id: session.cloneId })).shares || [];
    } else {
      const r = await drive('/drive/v3/files?' + new URLSearchParams({
        q: SHARE_Q(myShareKey()), spaces: 'drive', orderBy: 'createdTime', fields: 'files(id,appProperties)', pageSize: '50',
      }));
      raw = [];
      for (const f of r.files || []) {
        if (gone.has(f.id)) continue;
        let j = {};
        try {
          j = JSON.parse(await drive(`/drive/v3/files/${encodeURIComponent(f.id)}?alt=media`, { as: 'text' }));
        } catch (e) {
          if (e.status === 404) continue;                // 剛被刪掉（別台採用了）
          if (!(e instanceof SyntaxError)) throw e;      // 斷線：下次再看；內容壞掉的話當作空的
        }
        raw.push({ ...j, id: f.id, kept: f.appProperties?.kept === '1' });
      }
    }
    const shares = raw.map(cleanShare).filter((x) => isFileId(x.id) && !gone.has(x.id));
    // 壞掉、空的分享：直接刪掉，不要一直掛在信箱裡
    for (const x of shares) if (!x.item) { gone.add(x.id); later.ack.push(x.id); }
    const inbox = shares.filter((x) => x.item);
    if (JSON.stringify(inbox) !== JSON.stringify(state.inbox || [])) setState({ inbox });
  }

  function idsOf(ids) {
    return [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter(isFileId);
  }

  /** 採用了、不要了（ids）：從信箱拿掉，雲端硬碟上的小檔案刪掉 */
  async function ackShares(ids) {
    await ready;
    ids = idsOf(ids);
    if (!session || !ids.length) return { ok: false, error: '找不到這份分享' };
    for (const id of ids) gone.add(id);
    setState({ inbox: (state.inbox || []).filter((x) => !gone.has(x.id)) });
    try { await touchShares('ack', ids); } catch { later.ack.push(...ids); }   // 斷線了：信箱裡先不顯示，下次再刪
    return { ok: true };
  }

  /** 暫留（ids）：還在信箱裡，但不算未讀 */
  async function keepShares(ids) {
    await ready;
    ids = idsOf(ids);
    if (!session || !ids.length) return { ok: false, error: '找不到這份分享' };
    for (const id of ids) keptHere.add(id);
    setState({ inbox: (state.inbox || []).map((x) => (ids.includes(x.id) ? { ...x, kept: true } : x)) });
    try { await touchShares('keep', ids); } catch { later.keep.push(...ids); }
    return { ok: true };
  }

  /** 馬上看一次信箱（打開信箱時用，不等 30 秒） */
  async function refreshInbox() {
    await ready;
    if (!session || !CLONE_URL) return { ok: false };
    try {
      inboxAt = Date.now();
      await checkInbox();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  async function getState() {
    await ready;
    return { ...state };
  }

  return {
    getState, syncNow, markDirty, flush, authUrl, finishAuth, signOut, putWallpaper, getWallpaper,
    cloneSignIn, enterClone, leaveClone, listClones, createClone, extendClone, destroyClone, readClone, pushClone, setCloneAvatar,
    listPeers, sharePrompt, ackShares, keepShares, refreshInbox,
  };
}

/* ========== 三方合併 ==========================================================
   兩邊（這台、雲端）都改過時用。base 是兩邊上次同步好的內容，比出兩邊各自做了什麼再合在一起：
     一邊新增的      → 留下
     一邊刪掉的      → 刪掉（另一邊剛好改了它的標題或內容，就留下改過的：寧可多、不會少）
     一邊改的欄位    → 用改過的；兩邊都改了同一個欄位 → 以這台為主
     一邊搬的、排的  → 照搬過、排過的
     書籤、資料夾被一邊刪了，另一邊卻在裡面新增了提示詞 → 書籤、資料夾留著，提示詞才有地方放
   ============================================================================ */

/** 把一份資料攤平：書籤、資料夾、提示詞各自用 id 找得到，再加上各自的順序（gpnNormalize 保證 id 不重複） */
function gpnFlatten(d) {
  const tabs = new Map(), folders = new Map(), items = new Map(), lists = new Map();
  for (const t of d.tabs) {
    tabs.set(t.id, { label: t.label, color: t.color, folders: !!t.folders, order: t.folders ? t.folders.map((f) => f.id) : [] });
    for (const l of gpnListsOf(t)) {
      const fid = l === t ? '' : l.id;
      if (fid) folders.set(fid, { tab: t.id, label: l.label });
      lists.set(t.id + '\u0000' + fid, l.items.map((i) => i.id));
      // at：放在哪裡（書籤＋資料夾當成一個欄位比，搬家才不會一半用這台、一半用雲端的）
      for (const it of l.items) items.set(it.id, { title: it.title, content: it.content, at: t.id + '\u0000' + fid });
    }
  }
  return {
    tabOrder: d.tabs.map((t) => t.id), tabs, folders, items, lists,
    favs: d.favs || [], marks: d.marks || {}, markTypes: d.markTypes || [], recent: d.recent || [], look: d.look, trash: d.trash || [],
  };
}

/**
 * 合併兩邊的排列順序。誰動過順序（和 base 比）就以誰為主，另一邊多出來的插在它原本前一個的後面；
 * 兩邊都動過以這台為主。回傳的可能含已經刪掉的 id，由呼叫的人過濾。
 */
function gpnMergeOrder(base, local, cloud) {
  const keepIn = (a, b) => { const s = new Set(b); return a.filter((x) => s.has(x)); };
  const moved = keepIn(local, base).join('\u0000') !== keepIn(base, local).join('\u0000');
  const [main, other] = moved ? [local, cloud] : [cloud, local];
  const out = [...main];
  const has = new Set(out);
  other.forEach((id, i) => {
    if (has.has(id)) return;
    let j = i - 1;
    while (j >= 0 && !has.has(other[j])) j--;
    out.splice(j < 0 ? 0 : out.indexOf(other[j]) + 1, 0, id);
    has.add(id);
  });
  return out;
}

/** 合併同一種東西（書籤、資料夾、提示詞）。keys 是要比的欄位；keepIfEdited 是「被刪了但另一邊改過就留下」看的欄位 */
function gpnMergeMap(B, L, C, keys, keepIfEdited = []) {
  const out = new Map();
  for (const id of new Set([...L.keys(), ...C.keys()])) {
    const b = B.get(id), l = L.get(id), c = C.get(id);
    if (l && c) {
      if (!b) { out.set(id, { ...l }); continue; }           // 兩邊都新增了同一個（例如同時開啟資料夾）
      const v = {};
      for (const k of keys) v[k] = l[k] !== b[k] ? l[k] : c[k];
      out.set(id, v);
    } else if (!b) {
      out.set(id, { ...(l || c) });                           // 只有一邊新增的
    } else {
      const kept = l || c;                                    // 另一邊刪掉了
      if (keepIfEdited.some((k) => kept[k] !== b[k])) out.set(id, { ...kept });
    }
  }
  return out;
}

/** 三方合併：base 上次同步好的、local 這台現在的、cloud 雲端現在的 → 合併後的資料 */
function gpnMerge3(base, local, cloud) {
  const B = gpnFlatten(gpnNormalize(base));
  const L = gpnFlatten(gpnNormalize(local));
  const C = gpnFlatten(gpnNormalize(cloud));
  const find = (kind, id) => L[kind].get(id) || C[kind].get(id) || B[kind].get(id);

  const tabs = gpnMergeMap(B.tabs, L.tabs, C.tabs, ['label', 'color', 'folders']);
  const folders = gpnMergeMap(B.folders, L.folders, C.folders, ['label', 'tab']);
  const items = gpnMergeMap(B.items, L.items, C.items, ['title', 'content', 'at'], ['title', 'content']);
  for (const it of items.values()) {
    const i = it.at.indexOf('\u0000');
    it.tab = it.at.slice(0, i);
    it.folder = it.at.slice(i + 1);
  }

  // 提示詞所在的書籤被另一邊刪了：書籤留著
  for (const it of items.values()) {
    if (!tabs.has(it.tab)) {
      const t = find('tabs', it.tab);
      tabs.set(it.tab, { label: t.label, color: t.color, folders: t.folders });
    }
  }

  // 書籤的順序；超過上限（兩邊各加了幾個）的書籤，提示詞併進最後一個，一則都不丟
  const tabOrder = gpnMergeOrder(B.tabOrder, L.tabOrder, C.tabOrder).filter((id) => tabs.has(id));
  for (const id of tabs.keys()) if (!tabOrder.includes(id)) tabOrder.push(id);
  const extraTabs = new Set(tabOrder.splice(GPN_MAX_TABS));
  const lastTab = tabOrder[tabOrder.length - 1];
  for (const it of items.values()) {
    if (extraTabs.has(it.tab)) { it.tab = lastTab; it.folder = ''; }
  }

  // 提示詞所在的資料夾被另一邊刪了：資料夾留著（書籤還開著資料夾的話）
  for (const it of items.values()) {
    if (!tabs.get(it.tab).folders || !it.folder || folders.has(it.folder)) continue;
    const f = find('folders', it.folder);
    if (f && f.tab === it.tab) folders.set(it.folder, { ...f });
  }

  // 每個書籤的資料夾順序；同樣有上限，超過的併進最後一個
  const folderOrder = new Map();
  for (const tid of tabOrder) {
    if (!tabs.get(tid).folders) continue;
    const mine = (fid) => folders.get(fid)?.tab === tid;
    const order = gpnMergeOrder(B.tabs.get(tid)?.order || [], L.tabs.get(tid)?.order || [], C.tabs.get(tid)?.order || [])
      .filter(mine);
    for (const [fid] of folders) if (mine(fid) && !order.includes(fid)) order.push(fid);
    const extra = new Set(order.splice(GPN_MAX_FOLDERS));
    for (const it of items.values()) {
      if (it.tab === tid && extra.has(it.folder)) it.folder = order[order.length - 1];
    }
    folderOrder.set(tid, order);
  }

  // 每則提示詞放進合法的位置：書籤沒開資料夾就放書籤裡；開著但資料夾不見了就放第一個資料夾
  for (const it of items.values()) {
    const order = folderOrder.get(it.tab);
    if (!order) { it.folder = ''; continue; }
    if (order.includes(it.folder)) continue;
    if (!order.length) {
      const fid = 'f_' + it.tab;
      folders.set(fid, { tab: it.tab, label: GPN_DEFAULT_FOLDER });
      order.push(fid);
    }
    it.folder = order[0];
  }

  // 每個清單裡提示詞的順序
  const members = new Map();
  for (const [id, it] of items) {
    const key = it.tab + '\u0000' + it.folder;
    if (!members.has(key)) members.set(key, new Set());
    members.get(key).add(id);
  }
  const listItems = (key) => {
    const set = members.get(key);
    if (!set) return [];
    const order = gpnMergeOrder(B.lists.get(key) || [], L.lists.get(key) || [], C.lists.get(key) || [])
      .filter((id) => set.has(id));
    for (const id of set) if (!order.includes(id)) order.push(id);
    return order.map((id) => {
      const it = items.get(id);
      return { id, title: it.title, content: it.content };
    });
  };

  // 我的最愛、每一種符號、使用中的符號種類：一邊拿掉就拿掉、一邊加了就加
  const mergeSet = (b, l, c) => {
    const bS = new Set(b), lS = new Set(l), cS = new Set(c);
    return gpnMergeOrder(b, l, c).filter((x) => (bS.has(x) ? lS.has(x) && cS.has(x) : lS.has(x) || cS.has(x)));
  };
  const favs = mergeSet(B.favs, L.favs, C.favs).filter((id) => items.has(id));
  const marks = {};
  for (const m of GPN_MARKS) {
    const ids = mergeSet(B.marks[m] || [], L.marks[m] || [], C.marks[m] || []).filter((id) => items.has(id));
    if (m !== GPN_MARK_FAV && ids.length) marks[m] = ids;
  }
  // 一則只能有一種符號：兩邊各換成不同的，以這台為主
  const markLists = [favs, ...Object.values(marks)];
  const localMark = (id) => gpnMarkOf(L, id);
  for (const list of markLists) {
    const m = list === favs ? GPN_MARK_FAV : Object.keys(marks).find((k) => marks[k] === list);
    for (let i = list.length - 1; i >= 0; i--) {
      const id = list[i];
      const dup = markLists.some((other) => other !== list && other.includes(id));
      if (dup && localMark(id) && localMark(id) !== m) list.splice(i, 1);
    }
  }
  const markTypes = mergeSet(B.markTypes, L.markTypes, C.markTypes);
  // 背景：誰換過就用誰的（兩邊都換了以這台為主）
  const same = (a, b) => JSON.stringify(gpnCleanLook(a)) === JSON.stringify(gpnCleanLook(b));
  const look = same(L.look, B.look) ? C.look : L.look;
  // 回收桶：一邊丟進去的就有；一邊還原了或永久刪除了（上次有、這次沒有）就拿掉
  const tIds = mergeSet(B.trash.map((r) => r.id), L.trash.map((r) => r.id), C.trash.map((r) => r.id));
  const tById = new Map([...C.trash, ...L.trash].map((r) => [r.id, r]));
  const trash = tIds.map((id) => tById.get(id)).filter((r) => r && !items.has(r.id));

  // 最近使用：兩邊合在一起、同一則取最近那次；一邊移除（或清空）了、之後也沒再用過的就拿掉
  const recent = new Map();
  for (const r of [...L.recent, ...C.recent]) {
    if (!recent.has(r.id) || recent.get(r.id).usedAt < r.usedAt) recent.set(r.id, r);
  }
  const lR = new Set(L.recent.map((r) => r.id)), cR = new Set(C.recent.map((r) => r.id));
  for (const b of B.recent) {
    const r = recent.get(b.id);
    if (r && (!lR.has(b.id) || !cR.has(b.id)) && r.usedAt <= b.usedAt) recent.delete(b.id);
  }

  return gpnNormalize({
    version: GPN_VERSION,
    activeId: local.activeId,
    tabs: tabOrder.map((tid) => {
      const t = tabs.get(tid);
      const head = { id: tid, label: t.label, color: t.color };
      const order = folderOrder.get(tid);
      if (!order || !order.length) return { ...head, items: listItems(tid + '\u0000') };
      return { ...head, folders: order.map((fid) => ({ id: fid, label: folders.get(fid).label, items: listItems(tid + '\u0000' + fid) })) };
    }),
    recent: [...recent.values()],
    favs,
    marks,
    markTypes,
    look,
    trash,
  });
}
