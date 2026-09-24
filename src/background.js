/**
 * 外掛的背景程式：負責雲端同步。
 *
 * 為什麼同步放在這裡、不放在每個網頁裡：
 * Gemini、ChatGPT、Claude 可能同時開好幾個分頁，如果每個分頁各自登入、各自換 token，
 * 舊的 token 被重複使用時 Supabase 會當成被盜用而把人登出。
 * 所以整個外掛只有這裡這一份負責雲端，面板和小視窗都用訊息請它做事（src/cloud-ext.js）。
 *
 * 它怎麼知道提示詞改了：面板存檔寫進 chrome.storage，這裡聽 onChanged。
 * 雲端來的新資料也是寫進 chrome.storage，所有開著的面板會自己更新。
 */
if (typeof importScripts === 'function') {
  importScripts('store.js', 'share.js', 'cloud-config.js', 'sync.js');
}

const GPN_CLOUD_STATE_KEY = 'gpn_cloud_state';   // 給面板看的狀態（登入了沒、同步到哪）

/** 自己寫進去的內容：onChanged 看到這份就知道不是使用者改的，不用再推一次 */
let gpnLastRemote = '';

const gpnSync = gpnCreateSync({
  config: GPN_CLOUD,
  kv: {
    get: async (k) => (await chrome.storage.local.get(k))[k],
    set: (k, v) => chrome.storage.local.set({ [k]: v }),
    remove: (k) => chrome.storage.local.remove(k),
  },
  readLocal: async () => gpnNormalize((await chrome.storage.local.get(GPN_KEY))[GPN_KEY]),
  writeRemote: async (doc) => {
    gpnLastRemote = JSON.stringify(doc);
    await chrome.storage.local.set({ [GPN_KEY]: doc });
  },
  onState: (s) => chrome.storage.local.set({ [GPN_CLOUD_STATE_KEY]: s }),
});

// 面板或小視窗存檔了 → 推上雲端
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[GPN_KEY]) return;
  if (JSON.stringify(changes[GPN_KEY].newValue) === gpnLastRemote) return;
  gpnSync.markDirty();
});

/**
 * 用 Google 登入：
 *   1. 面板按下去 → 這裡開一個新分頁去 Google 登入
 *   2. 登入完 Google／Supabase 把分頁導回網頁版的 ext-login.html?code=…
 *   3. 那一頁的 content script（ext-login.js）把 code 交回來 → 這裡換成登入 → 關掉那個分頁
 * 不用 chrome.identity：那個要固定外掛的 ID，已經裝好的外掛換 ID 會讀不到原本的提示詞。
 */
async function gpnGoogleStart(sender) {
  const state = await gpnSync.getState();
  if (!state.google) return { ok: false, error: 'Google 登入還沒有設定好' };
  const url = await gpnSync.googleUrl(new URL('ext-login.html', GPN_CLOUD.site).href);
  const opener = sender.tab?.id;
  await chrome.tabs.create({ url, ...(opener ? { openerTabId: opener } : {}) });
  return { ok: true, opened: true };
}

async function gpnGoogleFinish(code, sender) {
  const r = await gpnSync.finishGoogle(code);
  // 登入成功就把那個分頁關掉，回到原本的 AI 網站
  if (r.ok && sender.tab?.id) setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => {}), 1500);
  return r;
}

// 面板、小視窗的請求
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'gpn-cloud') return false;
  const ops = {
    state: () => gpnSync.getState(),
    signIn: () => gpnSync.signIn(msg.email, msg.password),
    signUp: () => gpnSync.signUp(msg.email, msg.password),
    googleStart: () => gpnGoogleStart(sender),
    googleFinish: () => gpnGoogleFinish(String(msg.code || ''), sender),
    signOut: () => gpnSync.signOut({ wipe: !!msg.wipe }),
    syncNow: () => gpnSync.syncNow(),
  };
  const run = ops[msg.op];
  if (!run) return false;
  Promise.resolve()
    .then(run)
    .then((r) => reply(r || {}), (e) => reply({ ok: false, error: String(e?.message || e) }));
  return true;                       // 會非同步回覆
});

// Chrome 一打開就先同步一次，別台改過的東西這台馬上有
chrome.runtime.onStartup.addListener(() => { gpnSync.syncNow(); });
