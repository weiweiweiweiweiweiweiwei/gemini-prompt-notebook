/**
 * 面板本體：書籤 ＞（資料夾）＞ 提示詞
 *
 * 三個地方用的是「同一份」面板，所以長相、操作一模一樣：
 *   外掛：AI 網站裡的面板（src/content.js）、工具列小視窗（src/popup.js）
 *   網頁版（web/app.js）
 * src/panel.js 和 web/panel.js 必須一字不差，tools/checksync.py 會檢查。
 *
 * 資料夾是每個書籤各自決定要不要用的（齒輪 → 名稱與資料夾）：
 *   沒開 → 紙張裡只有卡片，和最早的版本一樣
 *   有開 → 左邊多一欄資料夾，點書籤一律先顯示第一個資料夾
 *
 * 各處的差別只由呼叫端決定：
 *   onUse       點提示詞時要做什麼
 *               AI 網站裡的面板：填進輸入框＋複製；其他地方：只能複製（同源政策）
 *   standalone  true＝面板就是整個畫面：一直開著、沒有遮罩、點外面或按 Esc 都不會關
 *
 * 依賴 store.js（資料格式、GpnStore）和 share.js（匯出／匯入），載入順序要在它們之後。
 */

/**
 * 版本號，顯示在設定視窗左下角。外掛和網頁版看到的數字一樣，才代表兩邊是同一版。
 * 要和 manifest.json 的 version 一致，tools/checksync.py 會檢查。
 */
const GPN_APP_VERSION = '4.11.0';

/**
 * @param {object}   opts
 * @param {ShadowRoot} opts.root         面板要畫在哪裡（樣式表由呼叫端掛好）
 * @param {boolean}  [opts.standalone]   面板就是整個畫面（網頁版、工具列小視窗）
 * @param {string}   [opts.edition]      顯示在版本號旁邊，例如「外掛」「網頁版」
 * @param {Function} opts.onUse          async (item) => ({ badge?, toast?, bad? })
 * @param {Function} [opts.onOpenChange] (open) => void，外掛用來同步觸發按鈕的狀態
 * @param {string}   [opts.notice]       紙張最上方的紅色提醒（例如網頁版不能存檔）
 * @param {string}   [opts.allPageUrl]   「全部提示詞」純文字頁的網址；有給才會出現那顆按鈕（網頁版：all.html）
 * @param {object}   [opts.cloud]        雲端同步：getState / onState / connect / signOut / syncNow
 *                                       （canConnect === false：這個環境沒辦法連結，例如直接開檔案的網頁版）
 *                                       （網頁版是 sync.js 本身，外掛是 cloud-ext.js 轉給背景程式）
 */
function gpnCreatePanel(opts) {
  'use strict';

  const {
    root,
    standalone = false,
    edition = '',
    onUse,
    onOpenChange = () => {},
    notice = '',
    cloud = null,
    allPageUrl = '',
  } = opts;

  /* ========== 圖示（SVG，不依賴任何網站的圖示字體） ========== */

  const ICON_PENCIL =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41' +
    'l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

  /** 齒輪：設定（名稱與資料夾、雲端同步、備份）
      注意：path 一定要寫成「單一字串」。之前用字串相接，接點漏掉一個空格
      （`.06-.94` + `0-.32` → `.06-.940-.32`），整段路徑語法就壞掉、畫不出來。 */
  const ICON_GEAR =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>';

  const ICON_GRIP =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="9" cy="5" r="1.7"/><circle cx="15" cy="5" r="1.7"/>' +
    '<circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/>' +
    '<circle cx="9" cy="19" r="1.7"/><circle cx="15" cy="19" r="1.7"/></svg>';

  const ICON_TAB =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2zm0 15l-5-2.18L7 18V5h10v13z"/></svg>';

  const ICON_SYNC =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>';

  /* 雲端狀態：已同步／沒連上（都是單一 path，理由同上面的齒輪）；同步中的雲朵在下面 ICON_CLOUD_SYNCING */
  const ICON_CLOUD_DONE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM10 17l-3.5-3.5 1.41-1.41L10 14.17l5.18-5.18 1.41 1.41L10 17z"/></svg>';
  const ICON_CLOUD_OFF =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4c-1.48 0-2.85.43-4.01 1.17l1.46 1.46A5.497 5.497 0 0 1 17.5 11v.5H19c1.66 0 3 1.34 3 3 0 1.13-.64 2.11-1.56 2.62l1.45 1.45C23.16 17.16 24 15.68 24 14c0-2.64-2.05-4.78-4.65-4.96zM3 5.27l2.75 2.74C2.56 8.15 0 10.77 0 14c0 3.31 2.69 6 6 6h11.73l2 2L21 20.73 4.27 4 3 5.27zM7.73 10l8 8H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h1.73z"/></svg>';

  /** 同步中：雲朵本身不動，裡面的箭頭一直往上跑（動畫在 styles.css 的 .gpn-cloud-arrow） */
  const ICON_CLOUD_SYNCING =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h.71C7.37 7.69 9.48 6 12 6c3.04 0 5.5 2.46 5.5 5.5v.5H19c1.66 0 3 1.34 3 3s-1.34 3-3 3z"/>' +
    '<path class="gpn-cloud-arrow" d="M12 8.5L8.5 12H11v4h2v-4h2.5z"/></svg>';

  /** 圖片：設定裡的「背景」 */
  const ICON_IMAGE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';

  /** 條列：「全部提示詞」頁 */
  const ICON_LIST =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>';

  /** 時鐘加倒轉箭頭：「最近使用」 */
  const ICON_HISTORY =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>';

  /** 星號：「我的最愛」（實心＝已加入，空心＝還沒加入） */
  const ICON_STAR =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
  const ICON_STAR_OUTLINE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/></svg>';

  const ICON_CLOSE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

  /** Google 規定要用的彩色 G（連結雲端硬碟的按鈕） */
  const ICON_GOOGLE =
    '<svg viewBox="0 0 48 48" aria-hidden="true">' +
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

  /* ========== 小工具 ========== */

  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;       // 只用在寫死的 SVG
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const kid of kids) if (kid) node.append(kid);
    return node;
  }

  /** 表單欄位：粗體標籤 + 灰色小字說明 + 內容 */
  const field = (label, sub, ...kids) => el('div', { class: 'gpn-field' },
    el('label', { class: 'gpn-label' }, label, sub ? el('span', { text: '　' + sub }) : null),
    ...kids);

  /** 依 id 順序重排陣列；清單裡沒出現的（例如別的分頁剛新增的）接在最後 */
  function reorder(arr, order) {
    const byId = new Map(arr.map((x) => [x.id, x]));
    const next = order.map((id) => byId.get(id)).filter(Boolean);
    for (const x of arr) if (!order.includes(x.id)) next.push(x);
    return next;
  }

  /* ========== 狀態 ========== */

  let data = gpnDefaultData();
  /** 目前看的資料夾。刻意不存檔：依需求，點書籤一律從「第一個資料夾」開始。 */
  let folderId = null;
  let editing = null;        // 提示詞編輯中 { tabId, folderId | null, id | null }
  let newTabColor = null;    // 新增書籤對話框選的顏色
  let settingsTabId = null;  // 設定視窗正在設定哪個書籤
  let folderEditing = null;  // 資料夾編輯中 { tabId, id | null }
  let delArmed = false, delTimer = 0;
  let tabDelArmed = false, tabDelTimer = 0;
  let folderDelArmed = false, folderDelTimer = 0;
  let backupMode = 'merge';  // 'merge' | 'replace'，預設挑不會弄丟東西的那個
  let backupFile = null;     // 選好的備份檔 { name, text }
  let impArmed = false, impTimer = 0;
  let cloudState = { configured: false };   // 雲端同步的狀態（見 sync.js）
  let wipeArmed = false, wipeTimer = 0;
  /** 對話框開著時雲端送來新資料，先不重畫（免得打到一半的字不見），關掉對話框再畫 */
  let staleWhileLayer = false;
  const ui = {};

  /**
   * 「最近使用」「我的最愛」兩個固定書籤：不在 data.tabs 裡（見 store.js），
   * 畫面上固定在最右邊（我的最愛在左、最近使用在右）。
   * 不能刪、不能改名、不能拖、不能直接新增提示詞（fixed）。
   */
  const recentTab = () => ({
    id: GPN_RECENT_ID, label: '最近使用', color: 'recent', fixed: true, recent: true, items: data.recent || [],
  });
  const favTab = () => ({
    id: GPN_FAV_ID, label: '我的最愛', color: 'fav', fixed: true, fav: true, items: [],
  });
  const tabById = (id) => (id === GPN_RECENT_ID ? recentTab()
    : id === GPN_FAV_ID ? favTab()
    : data.tabs.find((t) => t.id === id));
  const isFav = (id) => (data.favs || []).includes(id);
  const activeTab = () => tabById(data.activeId) || data.tabs[0];
  /** 目前的資料夾；書籤沒開資料夾時是 null */
  const activeFolder = () => {
    const tab = activeTab();
    if (!tab.folders) return null;
    return tab.folders.find((f) => f.id === folderId) || tab.folders[0];
  };
  /** 裝提示詞的清單：有資料夾就是那個資料夾，沒有就是書籤本身（兩者都有 .items） */
  const listOf = (tabId, fid) => {
    const tab = tabById(tabId);
    if (!tab) return null;
    return tab.folders ? tab.folders.find((f) => f.id === fid) || null : tab;
  };
  const whereLabel = (tabId, fid) => {
    const tab = tabById(tabId);
    const folder = tab?.folders ? listOf(tabId, fid) : null;
    return folder ? `${tab.label} › ${folder.label}` : tab?.label;
  };
  const persist = () => GpnStore.save(data);

  /* ---- 這台電腦自己的偏好（筆記本寬度、背景圖）：不跟著雲端同步，也不放進備份 ----
     外掛（AI 網站裡的面板、工具列小視窗）存在 chrome.storage，網頁版存在 localStorage。
     key 和提示詞資料（GPN_KEY）不同，store.js 監聽資料變動時不會被它們觸發。 */
  const prefs = (() => {
    const ext = typeof chrome !== 'undefined' && !!chrome.storage?.local;
    return {
      async get(k) {
        try {
          if (ext) return (await chrome.storage.local.get(k))[k] ?? null;
          const v = localStorage.getItem(k);
          return v == null ? null : JSON.parse(v);
        } catch { return null; }
      },
      /** 存不下（空間不夠、無痕模式）會回傳 false */
      async set(k, v) {
        try {
          if (ext) await chrome.storage.local.set({ [k]: v });
          else localStorage.setItem(k, JSON.stringify(v));
          return true;
        } catch { return false; }
      },
      async remove(k) {
        try {
          if (ext) await chrome.storage.local.remove(k);
          else localStorage.removeItem(k);
        } catch { /* 無痕模式 */ }
      },
    };
  })();

  /* ==========================================================================
     一、骨架
     ========================================================================== */

  function build() {
    ui.list = el('div', { class: 'gpn-list', role: 'list' });
    ui.tabs = el('div', { class: 'gpn-tabs', role: 'tablist' });
    ui.tabEls = new Map();        // id → 書籤元素（切換時要重複使用才有動畫）

    /* ---- 底部右邊的齒輪：設定 ----
       也兼當雲端同步的狀態燈（見 paintGear）：以前旁邊還有一顆雲朵鈕，狀態都已經整合進設定，就拿掉了。
       有狀況（沒連上、同步失敗）時右上角會有一個點，點齒輪直接打開「雲端同步」那一頁。 */
    ui.gearIcon = el('span', { class: 'gpn-gear-icon', html: ICON_GEAR });
    ui.gear = el('button', {
      class: 'gpn-tool gpn-gear', type: 'button', title: '設定', 'aria-label': '設定',
      onclick: () => openSettings(data.activeId, ui.gear.getAttribute('data-alert') ? 'account' : 'tab'),
    }, ui.gearIcon, el('span', { class: 'gpn-gear-dot', 'aria-hidden': 'true' }));

    /* ---- 資料夾欄（寬的時候在左邊直排，窄的時候變成上面一排） ---- */
    ui.folderList = el('div', {
      class: 'gpn-folder-list', role: 'tablist', 'aria-label': '資料夾',
    });
    ui.folderAdd = el('button', {
      class: 'gpn-folder-add', type: 'button', title: '在這個書籤裡新增一個資料夾',
      'aria-label': '新增資料夾',
      onclick: () => openFolderEditor(null),
    }, el('span', { text: '＋' }), el('span', { class: 'gpn-folder-add-text', text: ' 新增資料夾' }));
    wheelToRow(ui.folderList);

    ui.book = el('div', { class: 'gpn-book' },
      ui.tabs,
      el('div', { class: 'gpn-paper' },
        notice ? el('div', { class: 'gpn-notice', role: 'alert', text: notice }) : null,
        el('div', { class: 'gpn-body' },
          el('nav', { class: 'gpn-folders' }, ui.folderList),
          ui.list),
        el('div', { class: 'gpn-foot' },
          ui.addBtn = el('button', {
            class: 'gpn-add', type: 'button',
            onclick: () => openEditor(data.activeId, activeFolder()?.id ?? null, null),
          }, '＋ 新增提示詞'),
          // 「最近使用」書籤底下換成這顆（按兩次才會清）
          ui.clearRecentBtn = el('button', {
            class: 'gpn-add gpn-add--quiet', type: 'button', hidden: '',
            onclick: onClearRecent,
          }, '清除全部使用記錄'),
          el('div', { class: 'gpn-tools' }, ui.gear)
        )
      )
    );

    // 左右兩邊可以拖曳調整寬度（見「筆記本寬度」）
    ui.book.append(buildGutter('left'), buildGutter('right'));

    // 筆記本左下角外面、和「新增提示詞」同高的小圖示：「全部提示詞」。
    // 是一般連結，按了整頁換到純文字的清單頁（網頁版的 all.html）
    if (allPageUrl) {
      ui.book.append(el('a', {
        class: 'gpn-all-link', href: allPageUrl, 'aria-label': '全部提示詞',
        title: '全部提示詞：所有書籤的提示詞，完整內容用純文字列在同一頁（方便「問問 Gemini」讀）',
        html: ICON_LIST,
      }));
    }

    ui.overlay = el('div', {
      class: 'gpn-overlay', role: 'dialog', 'aria-modal': standalone ? null : 'true',
      'aria-label': '特務P',
      onmousedown: (e) => { if (!standalone && e.target === ui.overlay) close(); },
    }, ui.book);

    ui.toast = el('div', { class: 'gpn-toast', role: 'status' });

    buildEditLayer();
    buildNewTabLayer();
    buildFolderLayer();
    buildSettingsLayer();
    root.append(ui.overlay, ui.editLayer, ui.newTabLayer, ui.folderLayer, ui.settingsLayer, ui.toast);
  }

  /* ---- 筆記本寬度 ----
     左右兩邊的邊緣可以拖曳（像 NotebookLM 的面板分隔線），按兩下恢復預設。
     筆記本是置中的，所以拖一邊、兩邊一起變寬，拖的那一邊會一直跟在滑鼠底下。
     可以按的範圍（16px）比看得到的細線寬一點，比較好抓。寬度記在這台電腦（prefs）。 */
  const GPN_BOOK_MIN_W = 480;
  const GPN_BOOK_W_KEY = 'gpn_book_width';

  function buildGutter(side) {
    const g = el('div', {
      class: `gpn-gutter gpn-gutter--${side}`, role: 'separator', 'aria-orientation': 'vertical',
      'aria-label': '調整筆記本寬度', title: '拖曳調整寬度，按兩下恢復預設',
      ondblclick: resetBookWidth,
    });
    g.addEventListener('pointerdown', (e) => startResize(e, side, g));
    return g;
  }

  const setBookWidth = (w) => { ui.book.style.width = w ? `${w}px` : ''; };

  function startResize(e, side, g) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const cs = getComputedStyle(ui.book);
    const startW = parseFloat(cs.width);
    // 網頁版整個放大 140%：滑鼠移動的距離要換算回筆記本自己的 px
    const scale = ui.book.getBoundingClientRect().width / startW || 1;
    const maxW = parseFloat(cs.maxWidth) || Infinity;
    const startX = e.clientX;
    let w = startW;
    try { g.setPointerCapture(e.pointerId); } catch { /* 沒抓到也能拖 */ }
    ui.book.classList.add('is-resizing');

    const move = (ev) => {
      const dx = ((ev.clientX - startX) / scale) * (side === 'right' ? 1 : -1);
      w = Math.round(Math.min(maxW, Math.max(GPN_BOOK_MIN_W, startW + dx * 2)));
      setBookWidth(w);
    };
    const up = () => {
      g.removeEventListener('pointermove', move);
      g.removeEventListener('pointerup', up);
      g.removeEventListener('pointercancel', up);
      ui.book.classList.remove('is-resizing');
      if (w !== startW) prefs.set(GPN_BOOK_W_KEY, w);
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
    g.addEventListener('pointercancel', up);
  }

  function resetBookWidth() {
    setBookWidth(0);
    prefs.remove(GPN_BOOK_W_KEY);
  }

  /**
   * 資料夾排成橫的一排時（面板很窄），滑鼠滾輪預設只會上下捲，
   * 長輩不會知道要按 Shift。這裡把直向滾動轉成橫向。
   */
  function wheelToRow(node) {
    node.addEventListener('wheel', (e) => {
      if (getComputedStyle(node).flexDirection !== 'row') return;
      if (node.scrollWidth <= node.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      node.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }

  /* ---- 書籤寬度規則 ----
     自己的書籤數量越少就讓它們佔越寬，不要在中間留一大片空白。
     注意：自己的書籤「等寬」，作用中與否不影響寬度——
     改用高度來表現選取狀態，按起來才不會一直位移。
     最右邊的「我的最愛」「最近使用」只有圖示，寬度固定（見 styles.css 的 .gpn-tab.is-fixed）。 */
  const GPN_TAB_SHARE = { 1: 0.40, 2: 0.60, 3: 0.75, 4: 0.86, 5: 0.90, 6: 0.93, 7: 0.95, 8: 0.96 };
  const GPN_TAB_GAP = 4;          // .gpn-tabs 的 gap
  const GPN_TAB_ADD_W = 44;       // 「＋」按鈕的寬度＋左邊距
  const GPN_TAB_FIXED_W = 58;     // 一個固定書籤的寬度（要和 styles.css 的 .gpn-tab.is-fixed 一致）

  function layoutTabs() {
    const n = data.tabs.length;
    if (!n) return;
    // 先扣掉空隙、「＋」按鈕和兩個固定書籤，自己的書籤再照比例分剩下的寬度，才不會擠出紙張外
    const items = n + 2 + (ui.addTabBtn ? 1 : 0);
    const reserve = GPN_TAB_GAP * (items - 1) + (ui.addTabBtn ? GPN_TAB_ADD_W : 0) + GPN_TAB_FIXED_W * 2;
    const share = (GPN_TAB_SHARE[n] ?? 0.96) / n;
    for (const t of data.tabs) {
      const node = ui.tabEls.get(t.id);
      if (node) node.style.width = `calc((100% - ${reserve}px) * ${share.toFixed(4)})`;
    }
  }

  /**
   * 只更新「哪個書籤是作用中」——不重建元素，高度變化才有動畫。
   * animate=true 時，被點到的書籤會先下沉再升起（像把索引標籤抽出來）。
   */
  function updateTabStates(animate = false) {
    const tab = activeTab();
    if (!tab) return;
    ui.book.setAttribute('data-color', tab.color);

    for (const [id, node] of ui.tabEls) {
      const on = id === tab.id;
      node.classList.toggle('is-active', on);
      node.querySelector('.gpn-tab-main')?.setAttribute('aria-selected', String(on));

      if (on && animate) {
        node.classList.remove('is-popping');
        void node.offsetWidth;          // 強制重排，動畫才會重新播放
        node.classList.add('is-popping');
      }
    }
    layoutTabs();
  }

  /** 點書籤：有資料夾的話，一律顯示該書籤的「第一個資料夾」 */
  function switchTab(id) {
    if (id === data.activeId) return;
    data.activeId = id;
    folderId = null;
    persist();
    updateTabStates(true);   // 下沉 → 升起
    renderFolders();
    renderList();
    revealActiveFolder();
  }

  function switchFolder(id) {
    if (id === folderId) return;
    folderId = id;
    renderFolders();
    renderList();
    ui.list.scrollTop = 0;
  }

  /** 重建整條書籤列（資料結構有變時才呼叫，例如新增／刪除書籤） */
  function renderTabs() {
    const tab = activeTab();
    if (!tab) return;
    ui.tabs.replaceChildren();
    ui.tabEls = new Map();

    for (const t of data.tabs) {
      const isActive = t.id === tab.id;

      const main = el('button', {
        class: 'gpn-tab-main', type: 'button', role: 'tab',
        'aria-selected': String(isActive),
        title: t.label,
        onclick: () => { if (t.id !== data.activeId) switchTab(t.id); },
      }, t.label);

      // 設定鈕不放在書籤上——它會佔掉空間，害書籤上的字無法置中（齒輪在底部，見 build）
      const node = el('div', {
        class: 'gpn-tab' + (isActive ? ' is-active' : ''),
        'data-color': t.color, 'data-id': t.id,
        onanimationend: () => node.classList.remove('is-popping'),
      }, main);

      attachHoldDrag({
        handle: main, node, box: ui.tabs, selector: '.gpn-tab:not(.is-fixed)',
        // 拖到最後面時排在「＋」前面；書籤滿了沒有「＋」，就排在右邊的固定書籤前面
        anchor: () => ui.addTabBtn || ui.tabEls.get(GPN_FAV_ID),
        vertical: () => false,
        canStart: () => data.tabs.length > 1,
        onDrop: (order) => { data.tabs = reorder(data.tabs, order); persist(); },
      });
      ui.tabEls.set(t.id, node);
      ui.tabs.append(node);
    }

    ui.addTabBtn = data.tabs.length < GPN_MAX_TABS
      ? el('button', {
          class: 'gpn-tab-add', type: 'button',
          'aria-label': '新增書籤', title: '新增一個書籤分類',
          onclick: openNewTab,
        }, '＋')
      : null;
    if (ui.addTabBtn) ui.tabs.append(ui.addTabBtn);

    // 最右邊固定兩個：「我的最愛」「最近使用」。不能刪、不能拖，其他書籤也拖不到它們後面
    ui.tabs.append(
      fixedTabNode(GPN_FAV_ID, 'fav', '我的最愛', ICON_STAR,
        '我的最愛（在提示詞右邊按星號，就會收進這裡）', 'gpn-tab--push'),
      fixedTabNode(GPN_RECENT_ID, 'recent', '最近使用', ICON_HISTORY,
        `最近使用（最近用過的 ${GPN_RECENT_MAX} 則）`));

    ui.book.setAttribute('data-color', tab.color);
    layoutTabs();
  }

  /** 固定書籤（我的最愛、最近使用）：只有圖示，名稱放在滑鼠提示和讀螢幕軟體用的 aria-label */
  function fixedTabNode(id, color, label, icon, title, extraClass = '') {
    const on = activeTab().id === id;
    const node = el('div', {
      class: 'gpn-tab is-fixed' + (extraClass ? ' ' + extraClass : '') + (on ? ' is-active' : ''),
      'data-color': color, 'data-id': id,
      onanimationend: () => node.classList.remove('is-popping'),
    }, el('button', {
      class: 'gpn-tab-main', type: 'button', role: 'tab', 'aria-selected': String(on),
      'aria-label': label, title,
      onclick: () => { if (data.activeId !== id) switchTab(id); },
    }, el('span', { class: 'gpn-tab-icon', html: icon })));
    ui.tabEls.set(id, node);
    return node;
  }

  /* ==========================================================================
     二、資料夾欄（只有開了資料夾的書籤才會出現）
     ========================================================================== */

  function renderFolders() {
    const tab = activeTab();
    ui.book.classList.toggle('has-folders', !!tab.folders);
    ui.folderList.replaceChildren();
    if (!tab.folders) { folderId = null; return; }

    const cur = activeFolder();
    folderId = cur.id;

    for (const f of tab.folders) {
      const on = f.id === cur.id;
      const main = el('button', {
        class: 'gpn-folder-main', type: 'button', role: 'tab',
        'aria-selected': String(on), title: `${f.label}（長按可以拖曳排序）`,
        onclick: () => switchFolder(f.id),
      },
        el('span', { class: 'gpn-folder-name', text: f.label }),
        // 選中的那一格把位置讓給鉛筆，數量改在上方提示列看
        on ? null : el('span', { class: 'gpn-folder-count', text: String(f.items.length) })
      );

      const row = el('div', { class: 'gpn-folder' + (on ? ' is-active' : ''), 'data-id': f.id },
        main,
        on ? el('button', {
          class: 'gpn-folder-edit', type: 'button',
          title: '資料夾設定（改名／刪除）', 'aria-label': `資料夾「${f.label}」設定`,
          html: ICON_PENCIL,
          onclick: () => openFolderEditor(f.id),
        }) : null
      );

      // 和書籤一樣：長按後拖曳排序。欄是直的就上下拖，窄螢幕變成一排時就左右拖。
      attachHoldDrag({
        handle: main, node: row, box: ui.folderList, selector: '.gpn-folder',
        anchor: () => ui.folderAdd,
        vertical: () => getComputedStyle(ui.folderList).flexDirection !== 'row',
        canStart: () => (activeTab().folders?.length ?? 0) > 1,
        onDrop: (order) => {
          const t = activeTab();
          if (!t.folders) return;
          t.folders = reorder(t.folders, order);
          persist();
        },
      });
      ui.folderList.append(row);
    }

    ui.folderAdd.hidden = tab.folders.length >= GPN_MAX_FOLDERS;
    ui.folderList.append(ui.folderAdd);
  }

  /** 選中的資料夾若被捲到看不見的地方，把它捲回來 */
  function revealActiveFolder() {
    ui.folderList.querySelector('.gpn-folder.is-active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /* ==========================================================================
     三、提示詞卡片
     ========================================================================== */

  function render() {
    renderTabs();
    renderFolders();
    renderList();
  }

  function renderList() {
    const tab = activeTab();
    if (!tab) return;
    // 底部按鈕：一般書籤是「新增提示詞」，「最近使用」換成「清除全部使用記錄」，「我的最愛」都沒有
    // （右邊的雲端、設定圖示一直都在）
    ui.addBtn.hidden = !!tab.fixed;
    ui.clearRecentBtn.hidden = !tab.recent;
    disarmClearRecent();
    if (tab.recent) { renderRecent(); return; }
    if (tab.fav) { renderFavs(); return; }

    const folder = activeFolder();
    const list = folder || tab;

    const n = list.items.length;

    ui.list.replaceChildren();
    if (!n) {
      ui.list.append(
        el('div', { class: 'gpn-empty' },
          el('div', { class: 'gpn-empty-emoji', text: '📒' }),
          el('div', { class: 'gpn-empty-title', text: '還沒有任何提示詞' }),
          el('div', { class: 'gpn-empty-desc', text: '點下面的「＋ 新增提示詞」開始建立' }),
          el('div', { class: 'gpn-empty-arrow', text: '↓' })
        )
      );
      return;
    }
    const fid = folder ? folder.id : null;
    for (const item of list.items) ui.list.append(buildCard(item, tab.id, fid));
  }

  /**
   * 一則提示詞的卡片：把手、標題、星號（我的最愛）、鉛筆。
   * from：在「我的最愛」裡顯示時傳「從哪個書籤來的」，拖曳排序改排我的最愛的順序。
   */
  function buildCard(item, tabId, fid, from = null) {
    const grip = el('div', {
      class: 'gpn-grip', title: '按住拖曳可調整順序', 'aria-label': '拖曳排序', html: ICON_GRIP,
    });

    const titleBtn = el('button', {
      class: 'gpn-title', type: 'button',
      title: standalone ? '點一下：複製這段提示詞' : '點一下：填入輸入框並複製',
      onclick: () => usePrompt(item, card, tabId, fid),
    },
      el('div', { class: 'gpn-title-text', text: item.title || '(未命名)' }),
      el('div', { class: 'gpn-title-sub' },
        from ? el('span', { class: 'gpn-from', text: from }) : null, preview(item.content))
    );

    const starBtn = el('button', {
      class: 'gpn-star', type: 'button',
      onclick: (e) => { e.stopPropagation(); toggleFav(item, starBtn); },
    });
    paintStar(starBtn, item);

    const editBtn = el('button', {
      class: 'gpn-edit', type: 'button', title: '編輯', 'aria-label': `編輯 ${item.title}`,
      html: ICON_PENCIL,
      onclick: (e) => { e.stopPropagation(); openEditor(tabId, fid, item.id); },
    });

    const card = el('div', { class: 'gpn-card', role: 'listitem', 'data-id': item.id },
      grip, titleBtn, starBtn, editBtn);
    if (from) attachDrag(grip, card, GPN_FAV_ID, null);
    else attachDrag(grip, card, tabId, fid);
    return card;
  }

  function paintStar(btn, item) {
    const on = isFav(item.id);
    btn.classList.toggle('is-on', on);
    btn.innerHTML = on ? ICON_STAR : ICON_STAR_OUTLINE;
    btn.title = on ? '從「我的最愛」移除' : '加入「我的最愛」';
    btn.setAttribute('aria-label', `${btn.title}：${item.title}`);
    btn.setAttribute('aria-pressed', String(on));
  }

  /* ==========================================================================
     「我的最愛」：在任何提示詞右邊按星號收進來，集中在一個書籤；可以拖曳排自己的順序。
     提示詞本身還是留在原本的書籤（見 store.js），在這裡編輯改的就是原本那則。
     ========================================================================== */

  function toggleFav(item, btn) {
    const on = isFav(item.id);
    data.favs = on ? data.favs.filter((x) => x !== item.id) : [...(data.favs || []), item.id];
    persist();
    // 在「我的最愛」裡取消：那張卡片直接拿掉；在一般書籤：只換星號，不重畫（捲動位置不會跳）
    if (activeTab().fav) renderList();
    else paintStar(btn, item);
    toast(on ? '已從「我的最愛」移除（提示詞本身還在）' : '已加入「我的最愛」');
  }

  function renderFavs() {
    const where = indexItems();
    const favs = (data.favs || []).map((id) => where.get(id)).filter(Boolean);
    const n = favs.length;

    ui.list.replaceChildren();
    if (!n) {
      ui.list.append(
        el('div', { class: 'gpn-empty' },
          el('div', { class: 'gpn-empty-emoji', text: '⭐' }),
          el('div', { class: 'gpn-empty-title', text: '還沒有我的最愛' }),
          el('div', { class: 'gpn-empty-desc', text: '在任何一則提示詞右邊按「☆」，就會收進這裡，不用再到處找' })
        )
      );
      return;
    }
    for (const f of favs) {
      const from = f.tab.label + (f.folder ? ` › ${f.folder.label}` : '');
      ui.list.append(buildCard(f.it, f.tab.id, f.folder ? f.folder.id : null, from));
    }
  }

  const preview = (c) => {
    const one = String(c).replace(/\s+/g, ' ').trim();
    return one.length > 42 ? one.slice(0, 42) + '…' : one;
  };

  /* ==========================================================================
     「最近使用」：像 YouTube 的觀看記錄，依日期分段，最新的在最上面，最多 50 則
     ========================================================================== */

  /** 所有提示詞的 id 對照表：記錄裡存的是當時的樣子，原本那則還在的話，改用它現在的標題和內容 */
  function indexItems() {
    const map = new Map();
    for (const t of data.tabs) {
      for (const l of gpnListsOf(t)) {
        for (const it of l.items) map.set(it.id, { it, tab: t, folder: l === t ? null : l });
      }
    }
    return map;
  }

  const WEEK = '日一二三四五六';
  const startOfDay = (ts) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

  /** 「今天」「昨天」「星期三（9/17）」「9月10日（星期三）」 */
  function dayLabel(ts) {
    const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
    const d = new Date(ts);
    const wk = '星期' + WEEK[d.getDay()];
    if (days <= 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${wk}（${d.getMonth() + 1}/${d.getDate()}）`;
    const year = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()}年`;
    return `${year}${d.getMonth() + 1}月${d.getDate()}日（${wk}）`;
  }

  /** 「下午2:32」 */
  const clock = (ts) => new Date(ts).toLocaleTimeString('zh-TW', { hour: 'numeric', minute: '2-digit' });

  function renderRecent() {
    const recent = data.recent || [];
    const n = recent.length;

    ui.list.replaceChildren();
    if (!n) {
      ui.list.append(
        el('div', { class: 'gpn-empty' },
          el('div', { class: 'gpn-empty-emoji', text: '🕘' }),
          el('div', { class: 'gpn-empty-title', text: '還沒有使用記錄' }),
          el('div', { class: 'gpn-empty-desc', text: `點任何一則提示詞，就會記在這裡（最多 ${GPN_RECENT_MAX} 則）` })
        )
      );
      return;
    }

    const where = indexItems();
    let day = '';
    for (const r of recent) {
      const label = dayLabel(r.usedAt);
      if (label !== day) {
        day = label;
        ui.list.append(el('div', { class: 'gpn-day', role: 'heading', 'aria-level': '3', text: label }));
      }
      ui.list.append(buildRecentCard(r, where.get(r.id)));
    }
  }

  function buildRecentCard(r, found) {
    const cur = found ? found.it : r;
    const from = found
      ? found.tab.label + (found.folder ? ` › ${found.folder.label}` : '')
      : '原本的提示詞已刪除';
    const item = { id: r.id, title: cur.title, content: cur.content };

    const card = el('div', { class: 'gpn-card gpn-card--recent', role: 'listitem', 'data-id': r.id },
      el('div', { class: 'gpn-card-time', text: clock(r.usedAt) }),
      el('button', {
        class: 'gpn-title', type: 'button',
        title: standalone ? '點一下：複製這段提示詞' : '點一下：填入輸入框並複製',
        onclick: () => usePrompt(item, card,
          found ? found.tab.id : r.tabId, found ? found.folder?.id || '' : r.folderId),
      },
        el('div', { class: 'gpn-title-text', text: cur.title || '(未命名)' }),
        el('div', { class: 'gpn-title-sub' },
          el('span', { class: 'gpn-from', text: from }), preview(cur.content))
      ),
      el('button', {
        class: 'gpn-edit', type: 'button', title: '從記錄中移除',
        'aria-label': `從記錄中移除 ${cur.title}`, html: ICON_CLOSE,
        onclick: (e) => { e.stopPropagation(); removeRecent(r.id); },
      })
    );
    return card;
  }

  /** 記下這次使用：同一則只留最新這次，最多 GPN_RECENT_MAX 則 */
  function recordUse(item, tabId, fid) {
    data.recent = gpnCleanRecent([
      { id: item.id, title: item.title, content: item.content, usedAt: Date.now(),
        tabId: tabId || '', folderId: fid || '' },
      ...(data.recent || []),
    ]);
    persist();
  }

  function removeRecent(id) {
    data.recent = (data.recent || []).filter((r) => r.id !== id);
    persist();
    renderList();
    toast('已從記錄中移除');
  }

  let clearArmed = false, clearTimer = 0;
  function onClearRecent() {
    if (!(data.recent || []).length) return;
    if (!clearArmed) {
      clearArmed = true;
      armButton(ui.clearRecentBtn, `確定清除全部 ${data.recent.length} 筆記錄？再按一次`);
      clearTimeout(clearTimer);
      clearTimer = setTimeout(disarmClearRecent, 5000);
      return;
    }
    data.recent = [];
    persist();
    renderList();
    toast('已清除使用記錄（提示詞本身都還在）');
  }

  function disarmClearRecent() {
    clearTimeout(clearTimer);
    clearArmed = false;
    if (ui.clearRecentBtn) disarmButton(ui.clearRecentBtn, '清除全部使用記錄');
  }

  /* ========== 一鍵使用：不關面板，改在卡片上播動畫 ========== */

  async function usePrompt(item, card, tabId, fid) {
    const r = (await onUse(item)) || {};
    recordUse(item, tabId, fid);
    // 在「最近使用」裡點的：它會跑到最上面，Copied 改播在新的位置
    if (activeTab().recent && isOpen()) {
      renderList();
      ui.list.scrollTop = 0;
      card = ui.list.querySelector('.gpn-card') || card;
    }
    if (r.badge) flashCopied(card, r.badge);
    if (r.toast) toast(r.toast, !!r.bad);
  }

  /** 卡片維持原樣，只讓 "Copied" 字樣升起後淡出（動畫在 CSS 裡） */
  const GPN_COPY_MS = 1200;
  function flashCopied(card, msg) {
    if (!card) return;
    card.querySelector('.gpn-copied')?.remove();
    clearTimeout(card._copyTimer);

    const badge = el('div', { class: 'gpn-copied' }, el('span', { text: msg }));
    card.append(badge);
    card.classList.add('is-copied');

    card._copyTimer = setTimeout(() => {
      badge.remove();
      card.classList.remove('is-copied');
    }, GPN_COPY_MS);
  }

  let toastTimer = 0;
  function toast(msg, bad = false) {
    ui.toast.textContent = msg;
    ui.toast.classList.toggle('is-bad', bad);
    ui.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('is-on'), bad ? 4200 : 2200);
  }

  /* ========== 卡片上下拖曳排序（按住左邊把手，馬上就能拖） ========== */

  function attachDrag(handle, card, tabId, fid) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();

      const list = ui.list;
      let moved = false;
      card.classList.add('is-dragging');
      list.classList.add('is-dragging');
      try { handle.setPointerCapture(e.pointerId); } catch { /* 沒抓到也能拖 */ }

      const onMove = (ev) => {
        moved = true;
        const y = ev.clientY;
        const box = list.getBoundingClientRect();
        if (y < box.top + 50) list.scrollTop -= 14;
        else if (y > box.bottom - 50) list.scrollTop += 14;

        const after = cardAfter(list, y);
        if (after === null) {
          if (list.lastElementChild !== card) list.append(card);
        } else if (after !== card.nextElementSibling) {
          list.insertBefore(card, after);
        }
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        card.classList.remove('is-dragging');
        list.classList.remove('is-dragging');
        if (moved) saveOrder(tabId, fid);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  function cardAfter(list, y) {
    for (const node of list.querySelectorAll('.gpn-card:not(.is-dragging)')) {
      const box = node.getBoundingClientRect();
      if (y < box.top + box.height / 2) return node;
    }
    return null;
  }

  function saveOrder(tabId, fid) {
    const order = [...ui.list.querySelectorAll('.gpn-card')].map((n) => n.getAttribute('data-id'));
    if (tabId === GPN_FAV_ID) {
      // 我的最愛只排自己的順序，提示詞在原本書籤裡的位置不動
      const rest = (data.favs || []).filter((id) => !order.includes(id));
      data.favs = [...order, ...rest];
      persist();
      return;
    }
    const list = listOf(tabId, fid);
    if (!list) return;
    list.items = reorder(list.items, order);
    persist();
  }

  /* ==========================================================================
     長按後拖曳排序：書籤（左右）、資料夾（上下）共用
     刻意設計成「長按 250ms 才進入拖曳」，一般點選不會誤觸。
     （原本是 450ms，使用者覺得要等太久；一般點一下大約 100ms，250ms 仍不會誤觸。）
     按住期間只要移動超過 8px 就取消（視為想點擊或捲動）。
     ========================================================================== */

  const GPN_HOLD_MS = 250;   // 要按多久才進入拖曳
  const GPN_HOLD_SLOP = 8;   // 按住期間允許的手抖範圍(px)

  /**
   * @param {object} o
   * @param {Element}  o.handle    按下去的地方
   * @param {Element}  o.node      要搬動的元素
   * @param {Element}  o.box       容器（能捲動的話，拖到邊緣會自動捲）
   * @param {string}   o.selector  容器裡「可以排序的兄弟」
   * @param {Function} o.anchor    () => 永遠要排在最後的元素（「＋」按鈕），沒有就回 null
   * @param {Function} o.vertical  () => 是否上下排列
   * @param {Function} o.canStart  () => 現在能不能排序
   * @param {Function} o.onDrop    (新的 id 順序) => void
   */
  function attachHoldDrag(o) {
    const { handle, node, box, selector } = o;

    handle.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!o.canStart()) return;

      const startX = e.clientX, startY = e.clientY;
      let dragging = false;
      const holdTimer = setTimeout(startDrag, GPN_HOLD_MS);

      function startDrag() {
        dragging = true;
        node.classList.add('is-drag');
        box.classList.add('is-reordering');
        try { handle.setPointerCapture(e.pointerId); } catch { /* 沒抓到也能拖 */ }
      }

      const onMove = (ev) => {
        if (!dragging) {
          // 還沒進入拖曳：動太多就視為一般點擊／捲動，取消長按
          if (Math.abs(ev.clientX - startX) > GPN_HOLD_SLOP ||
              Math.abs(ev.clientY - startY) > GPN_HOLD_SLOP) {
            clearTimeout(holdTimer);
            cleanup();
          }
          return;
        }
        ev.preventDefault();
        const v = o.vertical();
        const pos = v ? ev.clientY : ev.clientX;

        const r = box.getBoundingClientRect();
        if (v) {
          if (pos < r.top + 36) box.scrollTop -= 10;
          else if (pos > r.bottom - 36) box.scrollTop += 10;
        } else {
          if (pos < r.left + 36) box.scrollLeft -= 10;
          else if (pos > r.right - 36) box.scrollLeft += 10;
        }

        let after = null;
        for (const n of box.querySelectorAll(selector + ':not(.is-drag)')) {
          const b = n.getBoundingClientRect();
          if (pos < (v ? b.top + b.height / 2 : b.left + b.width / 2)) { after = n; break; }
        }
        // 拖到最後面時，要排在「＋」按鈕前面
        const target = after || o.anchor();
        if (target !== node && target !== node.nextElementSibling) box.insertBefore(node, target);
      };

      const onUp = () => {
        clearTimeout(holdTimer);
        if (dragging) {
          node.classList.remove('is-drag');
          box.classList.remove('is-reordering');
          o.onDrop([...box.querySelectorAll(selector)].map((n) => n.getAttribute('data-id')));
          // 擋掉這次放開後的 click，避免拖完又觸發切換
          handle.addEventListener('click', swallow, { capture: true, once: true });
          setTimeout(() => handle.removeEventListener('click', swallow, true), 300);
        }
        cleanup();
      };

      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };

      function cleanup() {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      }

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  /* ==========================================================================
     四、對話框共用：打開任何一層時，筆記本退到後面
     ========================================================================== */

  const layerOpen = (layer) => layer.classList.contains('is-open');
  const anyLayerOpen = () =>
    [ui.editLayer, ui.newTabLayer, ui.folderLayer, ui.settingsLayer].some(layerOpen);

  function showLayer(layer) {
    layer.classList.add('is-open');
    ui.overlay.classList.add('is-editing');
  }

  function hideLayer(layer) {
    if (!layerOpen(layer)) return;
    layer.classList.remove('is-open');
    const still = anyLayerOpen();
    ui.overlay.classList.toggle('is-editing', still);
    // 對話框開著時雲端送來了新資料：現在可以畫了
    if (!still && staleWhileLayer) {
      staleWhileLayer = false;
      render();
    }
  }

  /** 刪除這類動作一律「按兩次」：第一次先把按鈕變成確認文字 */
  function armButton(btn, text) {
    btn.classList.add('is-confirm');
    btn.textContent = text;
  }
  function disarmButton(btn, text) {
    btn.classList.remove('is-confirm');
    btn.textContent = text;
  }

  /**
   * 書籤顏色：平常只有一顆小按鈕（色點＋顏色名稱），點了才展開六個色票，選好就收起來。
   * 以前六個大色票一直攤在畫面上，太搶眼。
   * 回傳 { node, set(顏色), close() }；onPick(顏色)
   */
  function buildColorPicker(onPick) {
    const dot = el('span', { class: 'gpn-color-dot' });
    const name = el('span', { class: 'gpn-color-name' });
    const btn = el('button', {
      class: 'gpn-color-btn', type: 'button', 'aria-expanded': 'false',
      onclick: () => toggle(),
    }, dot, name, el('span', { class: 'gpn-color-caret', 'aria-hidden': 'true' }));
    const box = el('div', { class: 'gpn-swatches', hidden: '' });
    for (const c of GPN_COLORS) {
      box.append(el('button', {
        class: 'gpn-swatch', type: 'button', 'data-color': c,
        'aria-label': GPN_COLOR_LABELS[c], title: GPN_COLOR_LABELS[c],
        onclick: () => { set(c); close(); onPick(c); },
      }));
    }
    function toggle(open = box.hidden) {
      box.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    }
    const close = () => toggle(false);
    function set(color) {
      dot.setAttribute('data-color', color);
      name.textContent = GPN_COLOR_LABELS[color] || '';
      for (const s of box.children) s.classList.toggle('is-on', s.getAttribute('data-color') === color);
    }
    return { node: el('div', { class: 'gpn-color' }, btn, box), set, close };
  }

  const stop = (e) => e.stopPropagation();

  /* ==========================================================================
     五、提示詞編輯
     ========================================================================== */

  function buildEditLayer() {
    ui.eTitle = el('input', {
      class: 'gpn-input', type: 'text', maxlength: '40', placeholder: '例如：翻譯成英文',
      oninput: () => { ui.eTitle.classList.remove('is-bad'); ui.eTitleHint.classList.remove('is-on'); },
    });
    ui.eTitleHint = el('div', { class: 'gpn-hint', text: '請先輸入按鈕顯示標題' });

    ui.eBody = el('textarea', {
      class: 'gpn-textarea', placeholder: '這裡貼上真正要送給 AI 的完整指令內容…',
      oninput: () => {
        ui.eBody.classList.remove('is-bad');
        ui.eBodyHint.classList.remove('is-on');
        updateCount();
      },
    });
    ui.eBodyHint = el('div', { class: 'gpn-hint', text: '請先輸入提示詞內容' });
    ui.eCount = el('div', {
      class: 'gpn-count', 'aria-live': 'polite',
      title: '字數：中文每個字算 1，英文每個單字算 1，標點和空白不算。\n字元：每個字、字母、標點、空白、換行都算 1。',
    });

    // 放在哪裡：可以跨書籤搬。有資料夾的書籤用 optgroup 把資料夾列在底下。
    ui.eWhere = el('select', { class: 'gpn-input gpn-select' });
    ui.eWhereMap = [];

    ui.eHead = el('h2');
    ui.eDel = el('button', { class: 'gpn-btn gpn-btn--del', type: 'button', onclick: onDelete }, '刪除');

    ui.editLayer = el('div', { class: 'gpn-edit-layer' },
      el('div', { class: 'gpn-dialog', onmousedown: stop },
        ui.eHead,
        el('div', { class: 'gpn-dialog-body' },
          field('按鈕顯示標題', '（卡片上看到的字）', ui.eTitle, ui.eTitleHint),
          field('實際的 Prompt 內容', '（點標題時用的文字）', ui.eBody,
            el('div', { class: 'gpn-under' }, ui.eBodyHint, ui.eCount)),
          field('放在哪裡', '（改這裡就能搬到別的書籤或資料夾）',
            el('div', { class: 'gpn-select-wrap' }, ui.eWhere))
        ),
        el('div', { class: 'gpn-actions' },
          ui.eDel,
          el('button', { class: 'gpn-btn gpn-btn--cancel', type: 'button', onclick: closeEditor }, '取消'),
          el('button', { class: 'gpn-btn gpn-btn--save', type: 'button', onclick: onSave }, '儲存')
        )
      )
    );
  }

  /**
   * 字數統計，算法和 Word 的「字數」一樣：中日韓文每個字算 1、英文每個單字算 1，標點和空白不算。
   * 另外附上字元數（什麼都算），給想知道「整段有多長」的人看。
   */
  const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
  function countWords(text) {
    const cjk = (text.match(CJK) || []).length;
    const words = (text.replace(CJK, ' ').match(/[\p{L}\p{N}]+(?:['’._-][\p{L}\p{N}]+)*/gu) || []).length;
    return cjk + words;
  }

  function updateCount() {
    const text = ui.eBody.value;
    const fmt = (n) => n.toLocaleString('zh-TW');
    ui.eCount.textContent = text.trim()
      ? `字數 ${fmt(countWords(text))}　•　字元 ${fmt([...text].length)}`
      : '字數 0';
  }

  function fillWhere(tabId, fid) {
    ui.eWhere.replaceChildren();
    ui.eWhereMap = [];
    const option = (text, t, f) => {
      const opt = el('option', { value: String(ui.eWhereMap.length), text });
      if (t.id === tabId && (f ? f.id : null) === fid) opt.selected = true;
      ui.eWhereMap.push({ tabId: t.id, folderId: f ? f.id : null });
      return opt;
    };
    for (const t of data.tabs) {
      if (!t.folders) ui.eWhere.append(option(t.label, t, null));
      else ui.eWhere.append(el('optgroup', { label: t.label }, ...t.folders.map((f) => option(f.label, t, f))));
    }
  }

  function openEditor(tabId, fid, id) {
    const list = listOf(tabId, fid);
    if (!list) return;
    const item = id ? list.items.find((it) => it.id === id) : null;
    editing = { tabId, folderId: fid, id: item ? id : null };

    ui.eHead.textContent = item ? '編輯提示詞' : `在「${list.label}」新增提示詞`;
    ui.eTitle.value = item ? item.title : '';
    ui.eBody.value = item ? item.content : '';
    updateCount();
    fillWhere(tabId, fid);
    ui.eWhere.dataset.start = ui.eWhere.value;
    ui.eDel.style.display = item ? '' : 'none';
    disarmDelete();

    for (const n of [ui.eTitle, ui.eBody]) n.classList.remove('is-bad');
    for (const n of [ui.eTitleHint, ui.eBodyHint]) n.classList.remove('is-on');

    showLayer(ui.editLayer);
    setTimeout(() => ui.eTitle.focus(), 40);
  }

  function closeEditor() {
    hideLayer(ui.editLayer);
    editing = null;
    disarmDelete();
  }

  async function onSave() {
    if (!editing) return;
    const title = ui.eTitle.value.trim();
    const content = ui.eBody.value.trim();

    let bad = false;
    if (!title) { ui.eTitle.classList.add('is-bad'); ui.eTitleHint.classList.add('is-on'); bad = true; }
    if (!content) { ui.eBody.classList.add('is-bad'); ui.eBodyHint.classList.add('is-on'); bad = true; }
    if (bad) { (title ? ui.eBody : ui.eTitle).focus(); return; }

    const src = listOf(editing.tabId, editing.folderId);
    const to = ui.eWhereMap[Number(ui.eWhere.value)] || { tabId: editing.tabId, folderId: editing.folderId };
    const dest = listOf(to.tabId, to.folderId) || src;
    if (!src || !dest) return;
    const moved = dest !== src;

    if (editing.id) {
      const idx = src.items.findIndex((it) => it.id === editing.id);
      if (idx >= 0) {
        const item = src.items[idx];
        item.title = title;
        item.content = content;
        if (moved) { src.items.splice(idx, 1); dest.items.push(item); }
      }
      toast(moved ? `已搬到「${whereLabel(to.tabId, to.folderId)}」` : '已儲存修改');
    } else {
      dest.items.push({ id: gpnNewId(), title, content });
      toast(moved ? `已新增到「${whereLabel(to.tabId, to.folderId)}」` : '已新增提示詞');
    }

    await persist();
    closeEditor();
    render();
  }

  function onDelete() {
    if (!editing || !editing.id) return;
    if (!delArmed) {
      delArmed = true;
      armButton(ui.eDel, '確定刪除？再按一次');
      clearTimeout(delTimer);
      delTimer = setTimeout(disarmDelete, 4000);
      return;
    }
    const list = listOf(editing.tabId, editing.folderId);
    if (list) {
      const idx = list.items.findIndex((it) => it.id === editing.id);
      if (idx >= 0) list.items.splice(idx, 1);
    }
    data.favs = (data.favs || []).filter((id) => id !== editing.id);
    persist();
    closeEditor();
    render();
    toast('已刪除');
  }

  function disarmDelete() {
    clearTimeout(delTimer);
    delArmed = false;
    disarmButton(ui.eDel, '刪除');
  }

  /** 編輯到一半按 Esc：有改過就不關，避免打好的字不見 */
  function editorDirty() {
    const item = editing?.id
      ? listOf(editing.tabId, editing.folderId)?.items.find((it) => it.id === editing.id)
      : null;
    return ui.eTitle.value.trim() !== (item?.title ?? '') ||
           ui.eBody.value.trim() !== (item?.content ?? '') ||
           ui.eWhere.value !== ui.eWhere.dataset.start;
  }

  /* ==========================================================================
     六、新增書籤（自己的書籤後面那個「＋」）
     已經存在的書籤要改名、換色、刪除，都在齒輪的設定裡。
     ========================================================================== */

  function buildNewTabLayer() {
    ui.nName = el('input', {
      class: 'gpn-input', type: 'text', maxlength: '8', placeholder: '例如：工作',
      oninput: () => { ui.nName.classList.remove('is-bad'); ui.nNameHint.classList.remove('is-on'); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); onNewTabSave(); } },
    });
    ui.nNameHint = el('div', { class: 'gpn-hint', text: '請輸入書籤名稱' });
    ui.nColor = buildColorPicker((c) => { newTabColor = c; });

    ui.newTabLayer = el('div', { class: 'gpn-edit-layer' },
      el('div', { class: 'gpn-dialog gpn-dialog--sm', onmousedown: stop },
        el('h2', { text: '新增書籤' }),
        el('div', { class: 'gpn-dialog-body' },
          field('書籤名稱', null, ui.nName, ui.nNameHint),
          field('書籤顏色', null, ui.nColor.node)
        ),
        el('div', { class: 'gpn-actions' },
          el('button', { class: 'gpn-btn gpn-btn--cancel', type: 'button', onclick: closeNewTab }, '取消'),
          el('button', { class: 'gpn-btn gpn-btn--save', type: 'button', onclick: onNewTabSave }, '新增')
        )
      )
    );
  }

  function openNewTab() {
    if (data.tabs.length >= GPN_MAX_TABS) return;
    // 預設挑一個還沒用過的顏色
    const used = new Set(data.tabs.map((t) => t.color));
    newTabColor = GPN_COLORS.find((c) => !used.has(c)) || GPN_COLORS[0];
    ui.nColor.set(newTabColor);
    ui.nColor.close();
    ui.nName.value = '';
    ui.nName.classList.remove('is-bad');
    ui.nNameHint.classList.remove('is-on');
    showLayer(ui.newTabLayer);
    setTimeout(() => ui.nName.focus(), 40);
  }

  function closeNewTab() {
    hideLayer(ui.newTabLayer);
  }

  async function onNewTabSave() {
    const label = ui.nName.value.trim();
    if (!label) {
      ui.nName.classList.add('is-bad');
      ui.nNameHint.classList.add('is-on');
      ui.nName.focus();
      return;
    }
    const tab = { id: gpnNewId('t'), label, color: newTabColor, items: [] };
    data.tabs.push(tab);
    data.activeId = tab.id;          // 新增後直接切過去
    folderId = null;
    await persist();
    closeNewTab();
    render();
    toast('已新增書籤');
  }

  /* ==========================================================================
     七、資料夾編輯：改名、刪除（排序改成在資料夾欄長按拖曳）
     ========================================================================== */

  function buildFolderLayer() {
    ui.fName = el('input', {
      class: 'gpn-input', type: 'text', maxlength: '16', placeholder: '例如：寫作與改寫',
      oninput: () => { ui.fName.classList.remove('is-bad'); ui.fNameHint.classList.remove('is-on'); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); onFolderSave(); } },
    });
    ui.fNameHint = el('div', { class: 'gpn-hint', text: '請輸入資料夾名稱' });
    ui.fNote = el('div', { class: 'gpn-note' });

    ui.fHead = el('h2');
    ui.fDel = el('button', { class: 'gpn-btn gpn-btn--del', type: 'button', onclick: onFolderDelete }, '刪除');

    ui.folderLayer = el('div', { class: 'gpn-edit-layer' },
      el('div', { class: 'gpn-dialog gpn-dialog--sm', onmousedown: stop },
        ui.fHead,
        el('div', { class: 'gpn-dialog-body' },
          field('資料夾名稱', '（最多 16 個字）', ui.fName, ui.fNameHint),
          ui.fNote
        ),
        el('div', { class: 'gpn-actions' },
          ui.fDel,
          el('button', { class: 'gpn-btn gpn-btn--cancel', type: 'button', onclick: closeFolderEditor }, '取消'),
          el('button', { class: 'gpn-btn gpn-btn--save', type: 'button', onclick: onFolderSave }, '儲存')
        )
      )
    );
  }

  function openFolderEditor(id) {
    const tab = activeTab();
    if (!tab.folders) return;
    const folder = id ? tab.folders.find((f) => f.id === id) : null;
    if (!folder && tab.folders.length >= GPN_MAX_FOLDERS) {
      toast(`一個書籤最多 ${GPN_MAX_FOLDERS} 個資料夾`, true);
      return;
    }
    folderEditing = { tabId: tab.id, id: folder ? id : null };

    ui.fHead.textContent = folder ? '資料夾設定' : `在「${tab.label}」新增資料夾`;
    ui.fName.value = folder ? folder.label : '';
    ui.fName.classList.remove('is-bad');
    ui.fNameHint.classList.remove('is-on');

    // 每個書籤至少要留一個資料夾；真的不想分，請他去設定把資料夾整個關掉
    const last = folder && tab.folders.length <= 1;
    ui.fDel.style.display = (folder && !last) ? '' : 'none';
    ui.fNote.textContent = !folder
      ? '想調整順序的話，在左邊的資料夾上「長按」，就可以上下拖曳。'
      : last
        ? '這是最後一個資料夾，不能刪除。不想分資料夾的話，可以到齒輪 → 名稱與資料夾 把它關掉。'
        : '想調整順序的話，在左邊的資料夾上「長按」，就可以上下拖曳。';
    disarmFolderDelete();

    showLayer(ui.folderLayer);
    setTimeout(() => ui.fName.focus(), 40);
  }

  function closeFolderEditor() {
    hideLayer(ui.folderLayer);
    folderEditing = null;
    disarmFolderDelete();
  }

  async function onFolderSave() {
    if (!folderEditing) return;
    const tab = tabById(folderEditing.tabId);
    if (!tab?.folders) return;
    const label = ui.fName.value.trim();
    if (!label) {
      ui.fName.classList.add('is-bad');
      ui.fNameHint.classList.add('is-on');
      ui.fName.focus();
      return;
    }

    if (folderEditing.id) {
      const folder = tab.folders.find((f) => f.id === folderEditing.id);
      if (folder) folder.label = label;
      toast('已更新資料夾');
    } else {
      const folder = { id: gpnNewId('f'), label, items: [] };
      tab.folders.push(folder);
      folderId = folder.id;             // 新增後直接切過去
      toast('已新增資料夾');
    }

    await persist();
    closeFolderEditor();
    render();
    revealActiveFolder();
  }

  function onFolderDelete() {
    const tab = tabById(folderEditing?.tabId);
    if (!tab?.folders || !folderEditing.id || tab.folders.length <= 1) return;
    const folder = tab.folders.find((f) => f.id === folderEditing.id);
    if (!folder) return;

    if (!folderDelArmed) {
      folderDelArmed = true;
      armButton(ui.fDel, folder.items.length
        ? `連同 ${folder.items.length} 則提示詞一起刪除？再按一次`
        : '確定刪除？再按一次');
      clearTimeout(folderDelTimer);
      folderDelTimer = setTimeout(disarmFolderDelete, 5000);
      return;
    }

    tab.folders.splice(tab.folders.indexOf(folder), 1);
    if (folderId === folder.id) folderId = null;

    persist();
    closeFolderEditor();
    render();
    toast(`已刪除資料夾「${folder.label}」`);
  }

  function disarmFolderDelete() {
    clearTimeout(folderDelTimer);
    folderDelArmed = false;
    disarmButton(ui.fDel, '刪除');
  }

  /* ==========================================================================
     八、設定（底部的齒輪）
     左邊選單、右邊內容。第一頁是「這個書籤」的名稱與資料夾，後面是全部書籤共用的雲端同步、備份。
     改名、換色、開關資料夾都是「改了就存」，不必按儲存，也就不會有改了卻忘記存的狀況。
     ========================================================================== */

  function buildSettingsLayer() {
    /* ---- 左邊選單 ---- */
    ui.sNavGroup = el('div', { class: 'gpn-nav-group' });
    const navItem = (key, icon, text) => el('button', {
      class: 'gpn-nav-item', type: 'button', role: 'tab', 'data-section': key,
      onclick: () => showSection(key),
    }, el('span', { class: 'gpn-nav-icon', html: icon }), el('span', { class: 'gpn-nav-text', text }));
    ui.sNavItems = [
      navItem('tab', ICON_TAB, '名稱與資料夾'),
      // 沒有雲端功能的地方（例如測試）就不出現這一項
      cloud ? navItem('account', ICON_CLOUD_DONE, '雲端同步') : null,
      navItem('backup', ICON_SYNC, '備份'),
      // 背景圖只鋪在「面板就是整個畫面」的地方（網頁版、工具列小視窗）；AI 網站裡的面板背後是網站本身
      standalone ? navItem('look', ICON_IMAGE, '背景') : null,
    ].filter(Boolean);
    const [navTab, ...navAll] = ui.sNavItems;
    const nav = el('nav', { class: 'gpn-settings-nav', role: 'tablist', 'aria-orientation': 'vertical' },
      el('h2', { text: '設定' }),
      ui.sNavGroup, navTab,
      el('div', { class: 'gpn-nav-group', text: '所有書籤' }), ...navAll,
      // 外掛和網頁版長得不一樣時，先看這裡的數字是不是一樣
      el('div', {
        class: 'gpn-nav-version',
        text: `版本 ${GPN_APP_VERSION}` + (edition ? `　${edition}` : ''),
      }));

    /* ---- 名稱與資料夾（這個書籤）：名稱 → 顏色 → 資料夾開關 → 最下面是刪除書籤 ---- */
    ui.sName = el('input', {
      class: 'gpn-input', type: 'text', maxlength: '8', placeholder: '例如：工作',
      oninput: onSettingsName,
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); ui.sName.blur(); } },
    });
    ui.sNameHint = el('div', { class: 'gpn-hint', text: '名稱不能空白' });
    ui.sColor = buildColorPicker(onSettingsColor);
    ui.sDelNote = el('div', { class: 'gpn-note' });
    ui.sDel = el('button', { class: 'gpn-btn gpn-btn--del', type: 'button', onclick: onTabDelete }, '刪除這個書籤');
    ui.sDanger = el('div', { class: 'gpn-danger' },
      el('div', { class: 'gpn-label', text: '刪除書籤' }), ui.sDelNote, ui.sDel);

    ui.sSwitchTitle = el('b', { text: '使用資料夾' });
    ui.sSwitchState = el('span');
    ui.sSwitch = el('button', {
      class: 'gpn-switch-row', type: 'button', role: 'switch', 'aria-checked': 'false',
      onclick: onFolderSwitch,
    },
      el('span', { class: 'gpn-switch', 'aria-hidden': 'true' }),
      el('span', { class: 'gpn-switch-text' }, ui.sSwitchTitle, ui.sSwitchState));
    ui.sFolderNote = el('div', { class: 'gpn-note' });

    // 關閉資料夾會把分類攤平，所以先講清楚會發生什麼事，再讓他決定
    ui.sConfirmText = el('div');
    ui.sConfirm = el('div', { class: 'gpn-confirm', role: 'alert' },
      ui.sConfirmText,
      el('div', { class: 'gpn-brow' },
        el('button', { class: 'gpn-btn2 gpn-btn2--danger', type: 'button', onclick: disableFolders }, '確定關閉'),
        el('button', { class: 'gpn-btn2', type: 'button', onclick: hideFolderConfirm }, '先不要')));
    ui.sConfirm.hidden = true;

    const secTab = el('section', { class: 'gpn-section', 'data-section': 'tab' },
      el('h3', { text: '名稱與資料夾' }),
      field('書籤名稱', null, ui.sName, ui.sNameHint),
      field('書籤顏色', null, ui.sColor.node),
      field('資料夾', null, ui.sSwitch, ui.sConfirm, ui.sFolderNote),
      ui.sDanger);

    /* ---- 雲端同步 ---- */
    const secAccount = cloud ? buildAccountSection() : null;

    /* ---- 備份 ---- */
    const secBackup = buildBackupSection();

    /* ---- 背景 ---- */
    const secLook = standalone ? buildLookSection() : null;

    ui.sSections = [secTab, secAccount, secBackup, secLook].filter(Boolean);
    ui.sBody = el('div', { class: 'gpn-settings-body' }, ...ui.sSections);

    ui.settings = el('div', { class: 'gpn-dialog gpn-settings', onmousedown: stop },
      el('div', { class: 'gpn-settings-grid' },
        nav,
        el('div', { class: 'gpn-settings-pane' },
          ui.sBody,
          el('div', { class: 'gpn-actions' },
            el('button', {
              class: 'gpn-btn gpn-btn--cancel gpn-btn--done', type: 'button', onclick: closeSettings,
            }, '完成')))));

    ui.settingsLayer = el('div', { class: 'gpn-edit-layer' }, ui.settings);
  }

  function openSettings(tabId, section = 'tab') {
    const tab = tabById(tabId);
    if (!tab) return;
    // 「最近使用」「我的最愛」沒有名稱、顏色、資料夾可以改，直接打開全部書籤共用的那幾頁
    const hasAccount = !!cloud && !!cloudState.configured;
    if (tab.fixed && section === 'tab') section = hasAccount ? 'account' : 'backup';
    if (section === 'account' && !hasAccount) section = tab.fixed ? 'backup' : 'tab';
    settingsTabId = tabId;
    ui.sName.value = tab.label;
    ui.sName.classList.remove('is-bad');
    ui.sNameHint.classList.remove('is-on');
    ui.sColor.close();
    disarmTabDelete();
    resetBackup();
    resetAccount();
    refreshSettings();
    showSection(section);
    showLayer(ui.settingsLayer);
    if (section === 'account') setTimeout(() => focusAccount(), 40);
  }

  function closeSettings() {
    hideLayer(ui.settingsLayer);
    settingsTabId = null;
    disarmTabDelete();
    disarmImport();
    disarmWipe();
    hideFolderConfirm();
  }

  function showSection(key) {
    for (const b of ui.sNavItems) {
      const on = b.getAttribute('data-section') === key;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    }
    for (const s of ui.sSections) s.hidden = s.getAttribute('data-section') !== key;
    ui.sBody.scrollTop = 0;
    hideFolderConfirm();
    disarmTabDelete();
    disarmWipe();
  }

  /** 設定視窗裡所有「跟著資料變」的文字，一次更新 */
  function refreshSettings() {
    const tab = tabById(settingsTabId);
    if (!tab) return;

    const folders = gpnCountFolders(data);
    ui.bStats.textContent = `${data.tabs.length} 個書籤、` +
      (folders ? `${folders} 個資料夾、` : '') + `${gpnCountItems(data)} 則提示詞`;

    // 「最近使用」「我的最愛」：藏起「這個書籤」那一組（名稱與資料夾）
    // 雲端還沒設定好：「雲端同步」整頁不出現，免得使用者看到一堆給管理員的說明
    const fixed = !!tab.fixed;
    ui.sNavGroup.hidden = fixed;
    for (const b of ui.sNavItems) {
      const key = b.getAttribute('data-section');
      if (key === 'tab') b.hidden = fixed;
      if (key === 'account') b.hidden = !cloudState.configured;
    }
    if (fixed) return;

    const n = gpnTabItemCount(tab);
    ui.sNavGroup.textContent = `「${tab.label}」這個書籤`;
    ui.sColor.set(tab.color);

    const on = !!tab.folders;
    ui.sSwitch.setAttribute('aria-checked', String(on));
    ui.sSwitchState.textContent = on ? `開啟中・${tab.folders.length} 個資料夾` : '關閉中';
    ui.sFolderNote.textContent = on
      ? '新增、改名資料夾在主畫面左邊那一欄'
      : n ? `開啟後，現有的 ${n} 則會先放進「${GPN_DEFAULT_FOLDER}」` : '';

    ui.sDanger.hidden = data.tabs.length <= 1;        // 最後一個書籤不給刪
    ui.sDelNote.textContent = n ? `裡面的 ${n} 則提示詞會一起刪除，刪了就找不回來` : '';
  }

  function onSettingsName() {
    const tab = tabById(settingsTabId);
    if (!tab || tab.fixed) return;
    const label = ui.sName.value.trim();
    ui.sName.classList.toggle('is-bad', !label);
    ui.sNameHint.classList.toggle('is-on', !label);
    if (!label || label === tab.label) return;
    tab.label = label;
    persist();
    renderTabs();
    refreshSettings();
  }

  function onSettingsColor(color) {
    const tab = tabById(settingsTabId);
    if (!tab || tab.fixed || tab.color === color) return;
    tab.color = color;
    persist();
    renderTabs();
    refreshSettings();
  }

  function onFolderSwitch() {
    const tab = tabById(settingsTabId);
    if (!tab || tab.fixed) return;

    if (!tab.folders) {
      const n = tab.items.length;
      gpnEnableFolders(tab);
      folderId = null;
      persist();
      render();
      refreshSettings();
      toast(n ? `已開啟資料夾，原本的 ${n} 則放在「${GPN_DEFAULT_FOLDER}」` : '已開啟資料夾');
      return;
    }

    // 只有一個資料夾時，關掉不會失去任何分類，直接關
    if (tab.folders.length > 1) {
      ui.sConfirmText.textContent =
        `${tab.folders.length} 個資料夾會合併成一個清單。提示詞都會留著，只是不再分資料夾。`;
      ui.sConfirm.hidden = false;
      return;
    }
    disableFolders();
  }

  function disableFolders() {
    const tab = tabById(settingsTabId);
    if (!tab?.folders) return;
    gpnDisableFolders(tab);
    folderId = null;
    hideFolderConfirm();
    persist();
    render();
    refreshSettings();
    toast('已關閉資料夾，提示詞都還在');
  }

  function hideFolderConfirm() {
    if (ui.sConfirm) ui.sConfirm.hidden = true;
  }

  /** 刪除書籤：會連裡面的提示詞一起刪，所以訊息要講清楚 + 二段式確認 */
  function onTabDelete() {
    const tab = tabById(settingsTabId);
    if (!tab || tab.fixed || data.tabs.length <= 1) return;

    if (!tabDelArmed) {
      tabDelArmed = true;
      const n = gpnTabItemCount(tab);
      armButton(ui.sDel, n ? `連同 ${n} 則提示詞一起刪除？再按一次` : '確定刪除？再按一次');
      clearTimeout(tabDelTimer);
      tabDelTimer = setTimeout(disarmTabDelete, 5000);
      return;
    }

    data.tabs.splice(data.tabs.indexOf(tab), 1);
    if (!tabById(data.activeId)) { data.activeId = data.tabs[0].id; folderId = null; }

    persist();
    closeSettings();
    render();
    toast(`已刪除書籤「${tab.label}」`);
  }

  function disarmTabDelete() {
    clearTimeout(tabDelTimer);
    tabDelArmed = false;
    if (ui.sDel) disarmButton(ui.sDel, '刪除這個書籤');
  }

  /* ---- 雲端同步（Google 雲端硬碟）----
     連結 Google 帳號，外掛、網頁版、每一台電腦的提示詞就會自動同步（見 sync.js）。
     提示詞存在使用者「自己的」Google 雲端硬碟裡的一個檔案（GPN_DRIVE_FILE_NAME）。
     沒連結也能照常用，只是資料只存在這一台。

     流程：按「用 Google 帳號連結雲端硬碟」→ 到 Google 選帳號、按「允許」→ 回來就開始同步
       網頁版：整頁換到 Google，再回到網頁版
       外掛：另開一個分頁，連結完那個分頁會自己關掉 */

  function buildAccountSection() {
    /* ---- 還沒連結 ---- */
    ui.aConnect = el('button', {
      class: 'gpn-social-btn', type: 'button', 'data-provider': 'google', onclick: onConnect,
    }, el('span', { class: 'gpn-social-icon', html: ICON_GOOGLE }), el('span', { text: '用 Google 帳號連結雲端硬碟' }));
    ui.aNoConnect = el('div', { class: 'gpn-note gpn-note--status is-bad', text:
      '直接雙擊檔案打開的網頁版沒辦法連結雲端硬碟。請改用網址打開網頁版，或用 Chrome 外掛。' });
    ui.aMsg = el('div', { class: 'gpn-note gpn-note--status', role: 'status' });

    ui.aOut = el('div', {},
      el('p', { class: 'gpn-lede', text:
        '連結你的 Google 帳號，提示詞會存到你自己的 Google 雲端硬碟，' +
        '外掛、網頁版、每一台電腦都會自動同步，換電腦也不怕不見。' }),
      el('div', { class: 'gpn-social' }, ui.aConnect),
      ui.aNoConnect,
      ui.aMsg,
      el('div', { class: 'gpn-note gpn-note--roomy', text:
        '按下去會到 Google 的畫面：先選要用哪個帳號（公司、個人帳號請選對），再按「允許」。' +
        '特務P 只碰得到它自己建立的那一個檔案，看不到雲端硬碟裡的其他東西。' }),
      el('div', { class: 'gpn-note', text: '不連結也能照常用，只是提示詞只存在這台電腦。' }));

    /* ---- 已連結 ---- */
    ui.aWho = el('div', { class: 'gpn-account-email' });
    ui.aStatusIcon = el('span', { class: 'gpn-cloud-icon' });
    ui.aStatus = el('span');
    ui.aSyncBtn = el('button', { class: 'gpn-btn2', type: 'button', onclick: onSyncNow }, '⟳　立即同步');
    ui.aFileLink = el('a', { class: 'gpn-link gpn-file-link', target: '_blank', rel: 'noopener' },
      '在 Google 雲端硬碟裡查看這個檔案');
    ui.aWipe = el('button', {
      class: 'gpn-btn gpn-btn--del', type: 'button', onclick: () => onSignOut(true),
    }, '中斷連結並清除這台電腦上的提示詞');

    ui.aIn = el('div', {},
      el('div', { class: 'gpn-account-card' },
        el('span', { class: 'gpn-account-avatar gpn-account-avatar--google', html: ICON_GOOGLE }),
        el('div', { class: 'gpn-account-info' },
          el('div', { class: 'gpn-note', text: '已連結 Google 雲端硬碟' }), ui.aWho)),
      el('div', { class: 'gpn-account-status' }, ui.aStatusIcon, ui.aStatus),
      el('div', { class: 'gpn-brow' },
        ui.aSyncBtn,
        el('button', { class: 'gpn-btn2', type: 'button', onclick: () => onSignOut(false) }, '中斷連結')),
      el('div', { class: 'gpn-note', text:
        `提示詞存在你的 Google 雲端硬碟，檔名是「${GPN_DRIVE_FILE_NAME}」。` +
        '一改就會自動同步，平常不用按「立即同步」。' }),
      ui.aFileLink,
      el('div', { class: 'gpn-note', text:
        '中斷連結後，這台電腦上的提示詞、雲端硬碟上的檔案都會留著，只是不再同步。' +
        '不想用了，中斷連結後到雲端硬碟把那個檔案刪掉就好。' }),
      el('div', { class: 'gpn-danger' },
        el('div', { class: 'gpn-label', text: '在別人的電腦上用完了？' }),
        el('div', { class: 'gpn-note', text:
          '中斷連結，並把這台電腦上的提示詞清掉，別人就看不到。雲端硬碟上的檔案不會刪，下次連結就回來了。' }),
        ui.aWipe));

    return el('section', { class: 'gpn-section', 'data-section': 'account' },
      el('h3', { text: '雲端同步' }), ui.aOut, ui.aIn,
      el('a', {
        class: 'gpn-link gpn-privacy', href: new URL('privacy.html', GPN_CLOUD.site).href,
        target: '_blank', rel: 'noopener',
      }, '隱私權政策：資料存在哪裡、怎麼刪除'));
  }

  function resetAccount() {
    if (!ui.aOut) return;
    setAccountMsg('');
    disarmWipe();
    refreshAccount();
  }

  function focusAccount() {
    if (ui.aOut && !ui.aOut.hidden && !ui.aConnect.hidden) ui.aConnect.focus();
  }

  function setAccountMsg(msg, kind = 'bad') {
    ui.aMsg.textContent = msg;
    ui.aMsg.classList.toggle('is-bad', !!msg && kind === 'bad');
    ui.aMsg.classList.toggle('is-ok', !!msg && kind === 'ok');
  }

  /** 連結雲端硬碟：網頁版會整頁換到 Google；外掛會另開一個分頁，連結完自己關掉 */
  async function onConnect() {
    ui.aConnect.disabled = true;
    setAccountMsg('');
    const r = await cloud.connect();
    ui.aConnect.disabled = false;
    if (!r || !r.ok) { setAccountMsg(r?.error || '沒辦法開始連結，請稍後再試'); return; }
    if (r.opened) {
      setAccountMsg('已經開了一個新分頁：請在那裡選 Google 帳號、按「允許」。' +
        '完成後那個分頁會自動關掉，回到這裡就好。', 'ok');
    }
  }

  async function onSyncNow() {
    ui.aSyncBtn.disabled = true;
    const r = await cloud.syncNow();
    ui.aSyncBtn.disabled = false;
    toast(r?.error ? r.error : '已同步', !!r?.error);
  }

  /** 中斷連結。wipe＝連這台的提示詞一起清掉，要按兩次 */
  async function onSignOut(wipe) {
    if (wipe && !wipeArmed) {
      wipeArmed = true;
      armButton(ui.aWipe, '確定清除這台的提示詞並中斷連結？再按一次');
      clearTimeout(wipeTimer);
      wipeTimer = setTimeout(disarmWipe, 5000);
      return;
    }
    disarmWipe();
    await cloud.signOut({ wipe });
    folderId = null;
    toast(wipe ? '已中斷連結，這台電腦上的提示詞也清掉了'
               : '已中斷連結。這台的提示詞還在，只是不會再同步');
    refreshCloud(await cloud.getState());
  }

  function disarmWipe() {
    clearTimeout(wipeTimer);
    wipeArmed = false;
    if (ui.aWipe) disarmButton(ui.aWipe, '中斷連結並清除這台電腦上的提示詞');
  }

  /** 「剛剛」「5 分鐘前」「14:32」 */
  function ago(ts) {
    if (!ts) return '';
    const sec = Math.round((Date.now() - ts) / 1000);
    if (sec < 45) return '剛剛';
    if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} 分鐘前`;
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    const day = Date.now() - ts < 86400000 ? '' : `${d.getMonth() + 1}/${d.getDate()} `;
    return `${day}${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 狀態 → 圖示、短字（放主畫面）、長句（放雲端同步頁） */
  function describeCloud(s) {
    if (!s.signedIn) {
      return { icon: ICON_CLOUD_OFF, short: '雲端同步', long: '', kind: 'invite' };
    }
    if (s.phase === 'syncing') {
      return { icon: ICON_CLOUD_SYNCING, short: '同步中', long: '同步中…', kind: 'busy' };
    }
    if (s.phase === 'offline') {
      return { icon: ICON_CLOUD_OFF, short: '未連線', long: s.message || '連不上網路，恢復連線後會自動同步', kind: 'warn' };
    }
    if (s.phase === 'error') {
      return { icon: ICON_CLOUD_OFF, short: '同步失敗', long: s.message || '同步失敗', kind: 'bad' };
    }
    if (s.pending) {
      return { icon: ICON_CLOUD_SYNCING, short: '待同步', long: '有修改還沒同步，馬上就會送出', kind: 'busy' };
    }
    const when = ago(s.lastSyncAt);
    return { icon: ICON_CLOUD_DONE, short: '已同步', long: '已同步' + (when ? `（${when}）` : ''), kind: 'ok' };
  }

  function refreshCloud(s) {
    if (s) cloudState = s;
    paintGear(cloudState);
    refreshAccount();
  }

  /**
   * 齒輪兼當雲端同步的狀態燈：
   *   這台剛改過、正在送上雲端 → 齒輪變成綠色雲朵，雲朵不動、裡面的箭頭往上跑
   *   送完                     → 打勾的綠色雲朵停一下，再變回齒輪
   *   沒連上網路／同步失敗      → 齒輪右上角一個黃點／紅點
   * 只有「自己改了東西」才會變：每次打開面板順便跟雲端對一下，不會讓齒輪一直閃。
   */
  let gearMode = '', gearTimer = 0;

  function setGearMode(mode) {
    if (mode === gearMode) return;       // 同一個狀態不重畫，箭頭動畫才不會一直重來
    gearMode = mode;
    ui.gear.setAttribute('data-sync', mode);
    ui.gearIcon.innerHTML = mode === 'up' ? ICON_CLOUD_SYNCING : mode === 'done' ? ICON_CLOUD_DONE : ICON_GEAR;
  }

  function paintGear(st) {
    const on = !!cloud && !!st.configured && !!st.signedIn;
    const alert = !on ? '' : st.phase === 'offline' ? 'warn' : st.phase === 'error' ? 'bad' : '';
    const uploading = on && !!st.pending && !alert;
    if (uploading) {
      clearTimeout(gearTimer);
      setGearMode('up');
    } else if (gearMode === 'up') {
      if (alert) {
        setGearMode('');
      } else {
        setGearMode('done');
        gearTimer = setTimeout(() => setGearMode(''), 1500);
      }
    }
    ui.gear.setAttribute('data-alert', alert);
    const d = describeCloud(st);
    const label = uploading ? '設定（正在同步到 Google 雲端硬碟）'
      : alert ? `設定（雲端同步：${d.short}）` : '設定';
    ui.gear.setAttribute('aria-label', label);
    ui.gear.title = alert ? `${d.long}（點一下看雲端同步）` : label;
  }

  function refreshAccount() {
    if (!ui.aOut) return;
    const st = cloudState;
    ui.aOut.hidden = !st.configured || !!st.signedIn;
    ui.aIn.hidden = !st.configured || !st.signedIn;
    // 直接開檔案（file://）的網頁版，Google 沒辦法把人帶回來
    ui.aConnect.hidden = cloud.canConnect === false;
    ui.aNoConnect.hidden = cloud.canConnect !== false;

    if (!st.signedIn) {
      // 連結失效之類的訊息，第一次顯示在這裡
      if (st.message && !ui.aMsg.textContent) setAccountMsg(st.message);
      return;
    }
    const d = describeCloud(st);
    ui.aWho.textContent = st.email || 'Google 帳號';
    ui.aStatusIcon.innerHTML = d.icon;
    ui.aStatus.textContent = d.long;
    ui.aStatus.parentElement.setAttribute('data-kind', d.kind);
    ui.aFileLink.hidden = !st.fileId;
    if (st.fileId) ui.aFileLink.href = `https://drive.google.com/file/d/${encodeURIComponent(st.fileId)}/view`;
  }

  /* ---- 備份 ----
     為什麼需要這個：公家機關的電腦不能裝擴充功能，所以另外做了網頁版，兩邊是各自獨立的儲存空間。
     沒連結雲端硬碟時，靠這裡的「備份檔」手動搬資料；有連結之後，這裡變成「額外留一份」和「分享給別人」用。
     以前還有「複製代碼／貼上代碼」，兩種方法並存反而讓人看不懂，現在統一只用備份檔。 */

  function buildBackupSection() {
    /* 下載 */
    ui.bStats = el('div', { class: 'gpn-note' });

    /* 匯入：選檔案 → 選合併或完全取代 → 按兩次匯入 */
    ui.bFile = el('input', {
      type: 'file', accept: '.json,application/json', class: 'gpn-file',
      onchange: async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';                 // 選同一個檔案兩次也要觸發
        if (!file) return;
        try {
          backupFile = { name: file.name, text: await gpnReadFile(file) };
        } catch {
          backupFile = null;
          toast('這個檔案讀不起來', true);
        }
        disarmImport();
        refreshBackupPreview();
      },
    });
    ui.bPickText = el('span', { class: 'gpn-pick-name' });
    ui.bPick = el('button', { class: 'gpn-btn2 gpn-pick', type: 'button', onclick: () => ui.bFile.click() },
      el('span', { text: '📁' }), ui.bPickText);

    ui.bMerge = el('button', {
      class: 'gpn-seg is-on', type: 'button',
      onclick: () => setBackupMode('merge'),
    }, '合併');
    ui.bReplace = el('button', {
      class: 'gpn-seg', type: 'button',
      onclick: () => setBackupMode('replace'),
    }, '完全取代');

    ui.bNote = el('div', { class: 'gpn-note gpn-note--status' });
    ui.bImport = el('button', {
      class: 'gpn-btn gpn-btn--save gpn-btn--block', type: 'button', onclick: onImport,
    }, '匯入');

    return el('section', { class: 'gpn-section', 'data-section': 'backup' },
      el('h3', { text: '備份' }),
      el('div', { class: 'gpn-brow' },
        el('button', {
          class: 'gpn-btn2', type: 'button',
          onclick: () => { gpnDownloadExport(data); toast('備份檔已開始下載'); },
        }, '⬇　下載備份檔')),
      ui.bStats,
      el('div', { class: 'gpn-sep' }),
      field('匯入備份檔', null,
        el('div', { class: 'gpn-brow' }, ui.bPick),
        ui.bFile,
        el('div', { class: 'gpn-seg-row' }, ui.bMerge, ui.bReplace),
        ui.bNote,
        ui.bImport)
    );
  }

  function setBackupMode(mode) {
    backupMode = mode;
    ui.bMerge.classList.toggle('is-on', mode === 'merge');
    ui.bReplace.classList.toggle('is-on', mode === 'replace');
    disarmImport();
    refreshBackupPreview();
  }

  /** 解析選好的備份檔，把「會發生什麼事」寫進 ui.bNote，同時回傳解析結果 */
  function refreshBackupPreview() {
    ui.bPickText.textContent = backupFile ? backupFile.name : '選擇備份檔…';
    ui.bPick.classList.toggle('is-done', !!backupFile);
    ui.bNote.classList.remove('is-bad', 'is-ok');

    if (!backupFile) {
      // 還沒選檔案：只用一句話說明兩個選項的差別
      ui.bNote.textContent = backupMode === 'merge' ? '保留現有的，只加入新的' : '現有的會全部被換掉';
      ui.bNote.classList.toggle('is-bad', backupMode === 'replace');
      ui.bImport.hidden = true;
      return null;
    }

    const parsed = gpnParseImport(backupFile.text);
    if (!parsed.ok) {
      ui.bNote.textContent = parsed.error;
      ui.bNote.classList.add('is-bad');
      ui.bImport.hidden = true;
      return null;
    }

    ui.bImport.hidden = false;
    if (backupMode === 'merge') {
      const p = gpnPreviewMerge(data, parsed.data);
      ui.bNote.classList.add('is-ok');
      ui.bNote.textContent = p.added
        ? `會加入 ${p.added} 則新的提示詞` + (p.skipped ? `，${p.skipped} 則已經有了` : '')
        : `${parsed.itemCount} 則都已經有了，不會有變化`;
    } else {
      const have = gpnCountItems(data);
      ui.bNote.classList.add('is-bad');
      ui.bNote.textContent = `現有的 ${have} 則會換成備份裡的 ${parsed.itemCount} 則`;
    }
    return parsed;
  }

  /** 匯入會動到既有資料，所以一律二段式確認（和刪除同一套做法） */
  async function onImport() {
    const parsed = refreshBackupPreview();
    if (!parsed) return;

    if (!impArmed) {
      impArmed = true;
      armButton(ui.bImport, backupMode === 'merge' ? '確定合併？再按一次' : '確定取代？再按一次');
      clearTimeout(impTimer);
      impTimer = setTimeout(disarmImport, 6000);
      return;
    }

    let msg;
    if (backupMode === 'merge') {
      const r = gpnMergeData(data, parsed.data);
      data = r.data;
      msg = r.added ? `已加入 ${r.added} 則提示詞` : '沒有新的提示詞，資料維持原樣';
    } else {
      // 使用記錄、我的最愛是自己的，不跟著備份換掉（我的最愛只留備份裡還找得到的那幾則）
      data = gpnNormalize({ ...parsed.data, recent: data.recent, favs: data.favs });
      msg = `已匯入 ${gpnCountItems(data)} 則提示詞`;
    }
    folderId = null;
    await persist();
    closeSettings();          // 關掉設定，讓他直接看到匯入的結果
    render();
    toast(msg);
  }

  function disarmImport() {
    clearTimeout(impTimer);
    impArmed = false;
    disarmButton(ui.bImport, '匯入');
  }

  function resetBackup() {
    backupFile = null;
    setBackupMode('merge');          // 每次都從最安全的選項開始
  }

  /* ---- 背景（只有網頁版、工具列小視窗）----
     換成自己的桌布：筆記本是霧面玻璃，背後的圖會模糊地透出來。
     圖片先縮小（最長邊 1920px、存成 JPG）再存在這台電腦（prefs），不會同步、也不放進備份。 */
  const GPN_WALLPAPER_KEY = 'gpn_wallpaper';
  let wallpaperUrl = '';     // 目前套用中的 blob: 網址

  function buildLookSection() {
    ui.lPreviewText = el('span');
    ui.lPreview = el('div', { class: 'gpn-wall-preview is-default' }, ui.lPreviewText);
    ui.lFile = el('input', { type: 'file', accept: 'image/*', class: 'gpn-file', onchange: onPickWallpaper });
    ui.lReset = el('button', { class: 'gpn-btn2', type: 'button', hidden: '', onclick: onResetWallpaper }, '恢復預設');
    return el('section', { class: 'gpn-section', 'data-section': 'look' },
      el('h3', { text: '背景' }),
      ui.lPreview,
      el('div', { class: 'gpn-brow' },
        el('button', { class: 'gpn-btn2 gpn-pick', type: 'button', onclick: () => ui.lFile.click() },
          el('span', { class: 'gpn-btn2-icon', html: ICON_IMAGE }), '上傳圖片…'),
        ui.lReset),
      ui.lFile,
      el('div', { class: 'gpn-note', text: '圖片只存在這台電腦，不會同步' }));
  }

  async function applyWallpaper(dataUrl) {
    if (wallpaperUrl.startsWith('blob:')) URL.revokeObjectURL(wallpaperUrl);
    wallpaperUrl = '';
    if (dataUrl) {
      // 換成 blob: 短網址再交給 CSS，比直接塞一整串 base64 輕
      try { wallpaperUrl = URL.createObjectURL(await (await fetch(dataUrl)).blob()); } catch { wallpaperUrl = dataUrl; }
    }
    const bg = wallpaperUrl ? `url("${wallpaperUrl}")` : '';
    ui.overlay.style.backgroundImage = bg;
    ui.overlay.classList.toggle('has-wallpaper', !!wallpaperUrl);
    if (!ui.lPreview) return;
    ui.lPreview.style.backgroundImage = bg;
    ui.lPreview.classList.toggle('is-default', !wallpaperUrl);
    ui.lPreviewText.textContent = wallpaperUrl ? '' : '預設：彩色光暈';
    ui.lReset.hidden = !wallpaperUrl;
  }

  /** 縮小成最長邊 1920px 的 JPG（data: 網址）；手機拍的原圖動輒好幾 MB，原樣存會塞爆儲存空間 */
  async function shrinkImage(file) {
    const img = await createImageBitmap(file);
    const k = Math.min(1, 1920 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    img.close?.();
    return c.toDataURL('image/jpeg', 0.85);
  }

  async function onPickWallpaper(e) {
    const file = e.target.files?.[0];
    e.target.value = '';                 // 選同一張兩次也要觸發
    if (!file) return;
    let url;
    try {
      url = await shrinkImage(file);
    } catch {
      toast('這張圖片讀不起來，請換一張（JPG、PNG 都可以）', true);
      return;
    }
    if (!(await prefs.set(GPN_WALLPAPER_KEY, url))) {
      toast('這台電腦的儲存空間不夠，存不下這張圖', true);
      return;
    }
    await applyWallpaper(url);
    toast('已換成新的背景');
  }

  async function onResetWallpaper() {
    await prefs.remove(GPN_WALLPAPER_KEY);
    await applyWallpaper('');
    toast('已恢復預設背景');
  }

  /* ==========================================================================
     九、開關與鍵盤
     ========================================================================== */

  const isOpen = () => ui.overlay.classList.contains('is-open');

  async function open() {
    data = await GpnStore.load();
    render();
    ui.overlay.classList.add('is-open');
    revealActiveFolder();
    onOpenChange(true);
    // 每次打開都跟雲端對一下：別台剛改的東西，這裡馬上看得到
    cloud?.syncNow();
  }

  function close() {
    if (standalone) return;          // 網頁版、工具列小視窗：面板就是整個畫面，不能關
    closeEditor();
    closeNewTab();
    closeFolderEditor();
    closeSettings();
    ui.overlay.classList.remove('is-open');
    onOpenChange(false);
  }

  function onKeydown(e) {
    if (e.key !== 'Escape' || !isOpen()) return;

    if (layerOpen(ui.settingsLayer)) {
      if (!ui.sConfirm.hidden) hideFolderConfirm();
      else closeSettings();
    } else if (layerOpen(ui.folderLayer)) {
      closeFolderEditor();
    } else if (layerOpen(ui.newTabLayer)) {
      closeNewTab();
    } else if (layerOpen(ui.editLayer)) {
      if (editorDirty()) toast('還沒儲存喔，請按「儲存」或「取消」');
      else closeEditor();
    } else if (!standalone) {
      close();
    } else {
      return;
    }
    e.stopPropagation();
    e.preventDefault();
  }

  /* ========== 啟動 ========== */

  build();
  document.addEventListener('keydown', onKeydown, true);
  prefs.get(GPN_BOOK_W_KEY).then((w) => { if (w > 0) setBookWidth(w); });
  if (standalone) prefs.get(GPN_WALLPAPER_KEY).then((u) => applyWallpaper(u || ''));

  // 其他分頁或雲端改了資料時同步過來；正在編輯就先別動畫面，免得打到一半的字不見
  GpnStore.onExternalChange((fresh) => {
    data = fresh;
    if (!isOpen()) return;
    if (anyLayerOpen()) {
      staleWhileLayer = true;
      if (layerOpen(ui.settingsLayer)) refreshSettings();   // 設定裡的數字（幾則、幾個資料夾）先更新
    } else {
      render();
    }
  });

  if (cloud) {
    cloud.onState((s) => refreshCloud(s));
    cloud.getState().then((s) => refreshCloud(s), () => {});
    // 「5 分鐘前」這種字要跟著時間走
    setInterval(() => { if (isOpen()) refreshCloud(); }, 30_000);
  }

  // toast：網頁版從登入、驗證信回來時，用它顯示結果
  // openAccount：打開「雲端同步」那一頁（網頁版連結失敗回來時用）
  return {
    open, close, isOpen, toast,
    openAccount: () => { if (cloud && cloudState.configured) openSettings(data.activeId, 'account'); },
  };
}
