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
 *   權限只要 drive.file：只能碰「特務P 自己建立的檔案」，看不到雲端硬碟裡的其他東西。
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
 *   - 這台電腦第一次連結：
 *       這台的資料從沒屬於過任何帳號 → 和雲端合併（第一次用雲端時，原本的提示詞不會不見）
 *       這台的資料屬於另一個帳號   → 不合併，直接換成這個帳號的雲端資料（不會把別人的資料帶過去）
 *     第一次沒有共同的起點，所以用「備份 → 合併」那一套（gpnMergeData）：以雲端為底，把這台多的加進去。
 *   雲端硬碟沒有「版本對了才准寫」這種保護，所以寫入前先看一次版本號；
 *   兩台在同一瞬間存檔才可能互蓋，而且雲端硬碟本身會留舊版本，救得回來。
 *
 * 不用 Google 官方的 JS 套件：外掛不能從網路載入程式；這裡只需要換 token、找檔案、讀、寫，fetch 就夠了。
 *
 * 依賴 store.js（gpnNormalize 等）、share.js（gpnMergeData）、cloud-config.js。
 */

const GPN_SESSION_KEY = 'gpn_gdrive_session_v1';   // 登入狀態（token、Email）
const GPN_SYNC_KEY = 'gpn_gdrive_sync_v1';         // 同步進度（雲端檔案、版本、上次同步的內容指紋）
const GPN_PKCE_KEY = 'gpn_gdrive_pkce_v1';         // 登入途中的密語
const GPN_BASE_KEY = 'gpn_gdrive_base_v1';         // 上次同步好的內容（三方合併的共同起點）
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
    signedIn: false, email: '',
    fileId: '',           // 雲端硬碟上那個檔案（畫面上「在雲端硬碟查看」用）
    phase: 'idle',        // idle | syncing | offline | error
    pending: false,       // 這台有改過、還沒送上雲端
    lastSyncAt: 0, message: '',
  };
  let running = null;
  let switching = null;   // 正在換帳號（連結、中斷）
  let timer = 0;
  let dirtyGen = 0;       // 這台改了幾次（同步途中又改了，同步完要再送一次）
  let again = false;      // 這一輪寫進這台時，合併了使用者途中新做的（還沒送上雲端）
  let synced = null;      // 這一輪同步好的內容（雲端和這台一樣的那份）

  function setState(patch) {
    state = { ...state, ...patch };
    try { onState({ ...state }); } catch { /* 畫面出錯不影響同步 */ }
  }

  const ready = (async () => {
    for (const k of GPN_OLD_KEYS) await kv.remove(k);
    if (!configured) return;
    session = (await kv.get(GPN_SESSION_KEY)) || null;
    meta = { ...EMPTY_META, ...((await kv.get(GPN_SYNC_KEY)) || {}) };
    setState({
      signedIn: !!session, email: session?.email || '',
      fileId: meta.fileId || '', lastSyncAt: meta.lastSyncAt || 0,
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
  async function tokenCall(body) {
    let res;
    try {
      res = await fetch(config.tokenUrl, {
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
  async function accessToken(force = false) {
    if (!session) throw Object.assign(new Error('signed out'), { auth: true });
    if (!force && session.expires_at - Date.now() > 60_000) return session.access_token;

    // 別的分頁可能剛換過：儲存裡的比較新就直接用
    const stored = await kv.get(GPN_SESSION_KEY);
    if (!force && stored && stored.expires_at - Date.now() > 60_000) {
      session = stored;
      return session.access_token;
    }
    if (!session.refresh_token) return expired();
    try {
      const r = await tokenCall({ refresh_token: session.refresh_token });
      await saveSession({
        ...session,
        access_token: r.access_token,
        expires_at: Date.now() + (Number(r.expires_in) || 3600) * 1000,
        ...(r.refresh_token ? { refresh_token: r.refresh_token } : {}),
      });
      return session.access_token;
    } catch (e) {
      // 斷線、或中繼暫時有問題：先別登出，等一下再試
      if (e.offline || !e.status || e.status >= 500) throw e;
      return expired();            // invalid_grant：使用者到 Google 帳號把授權撤銷了，或太久沒用
    }
  }

  async function expired() {
    await saveSession(null);
    setState({ signedIn: false, email: '', phase: 'idle', pending: false,
      message: '和 Google 雲端硬碟的連結已經失效，請重新連結' });
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

  const FIELDS = 'id,version,modifiedTime,trashed';

  /** 找雲端硬碟上的筆記本：先試記住的那個；不見了（被刪、被丟垃圾桶）就用 appProperties 找 */
  async function findFile() {
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
    const text = await drive(`/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { as: 'text' });
    try {
      return gpnNormalize(JSON.parse(text));
    } catch {
      return null;
    }
  }

  /** 存成好讀的 JSON：使用者打開檔案也看得懂 */
  const fileBody = (doc) => JSON.stringify(doc, null, 2);

  async function writeFile(id, doc) {
    return drive(`/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}`, {
      method: 'PATCH', type: 'application/json', body: fileBody(doc),
    });
  }

  async function createFile(doc) {
    const boundary = 'gpn_' + Math.random().toString(36).slice(2);
    const info = {
      name: GPN_DRIVE_FILE_NAME,
      mimeType: 'application/json',
      description: '特務P 的提示詞，由特務P 自動同步。請不要手動修改內容；刪掉這個檔案等於刪掉雲端上的提示詞。',
      appProperties: { gpnNotebook: '1' },
    };
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
    if (local.activeId === GPN_RECENT_ID || local.activeId === GPN_FAV_ID ||
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
      setState({ signedIn: false, email: '' });
      return {};
    }
    if (!state.signedIn) setState({ signedIn: true, email: session.email || '' });

    let local = gpnNormalize(await readLocal());
    const adopt = meta.adopt;              // 'merge' | 'replace'（只在剛連結時有）
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
        if (adopt === 'replace' || !gpnCountItems(local)) {
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

    meta.lastSyncAt = Date.now();
    await saveMeta();
    // 記下這次同步好的內容，下次兩邊都改過時拿來當共同的起點
    if (synced) await kv.set(GPN_BASE_KEY, synced);
    else if (!base && hashDoc(local) === meta.hash) await kv.set(GPN_BASE_KEY, local);
    return note;
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
        if (e.auth) return { error: '和 Google 雲端硬碟的連結已經失效，請重新連結' };
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
      scope: `openid email ${GPN_DRIVE_SCOPE}`,
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
      sub: who.sub || who.email || 'google',
    };

    await switchUser(async () => {
      await saveSession(s);
      meta = { ...EMPTY_META, ...((await kv.get(GPN_SYNC_KEY)) || {}) };
      if (meta.userId !== s.sub) {
        // 換了一個帳號（或第一次連結）：從頭同步。
        // meta.userId 是空的 = 這台的資料從來沒屬於過任何帳號 → 和雲端合併
        meta = { ...EMPTY_META, userId: s.sub, adopt: meta.userId ? 'replace' : 'merge' };
        await saveMeta();
        await kv.remove(GPN_BASE_KEY);
      }
    });
    setState({ signedIn: true, email: s.email, message: '' });
    const note = await syncNow();
    return { ok: true, ...note };
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
      if (wipe) {
        await writeRemote(gpnDefaultData());
        meta = { ...EMPTY_META };
        await saveMeta();
        await kv.remove(GPN_BASE_KEY);
      }
    });
    setState({ signedIn: false, email: '', phase: 'idle', pending: false, message: '' });
    return { ok: true };
  }

  async function getState() {
    await ready;
    return { ...state };
  }

  return { getState, syncNow, markDirty, flush, authUrl, finishAuth, signOut };
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
    favs: d.favs || [], marks: d.marks || {}, markTypes: d.markTypes || [], recent: d.recent || [],
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
  });
}
