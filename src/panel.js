/**
 * 面板本體：書籤 ＞（資料夾）＞ 提示詞
 *
 * 三個地方用的是「同一份」面板，所以長相、操作一模一樣：
 *   外掛：AI 網站裡的面板（src/content.js）、工具列小視窗（src/popup.js）
 *   網頁版（web/app.js）
 * src/panel.js 和 web/panel.js 必須一字不差，tools/checksync.py 會檢查。
 *
 * 資料夾是每個書籤各自決定要不要用的（齒輪 → 資料夾）：
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
const GPN_APP_VERSION = '4.4.0';

/**
 * @param {object}   opts
 * @param {ShadowRoot} opts.root         面板要畫在哪裡（樣式表由呼叫端掛好）
 * @param {boolean}  [opts.standalone]   面板就是整個畫面（網頁版、工具列小視窗）
 * @param {string}   [opts.edition]      顯示在版本號旁邊，例如「外掛」「網頁版」
 * @param {Function} opts.onUse          async (item) => ({ badge?, toast?, bad? })
 * @param {Function} [opts.onOpenChange] (open) => void，外掛用來同步觸發按鈕的狀態
 * @param {string}   [opts.notice]       紙張最上方的紅色提醒（例如網頁版不能存檔）
 * @param {object}   [opts.cloud]        雲端同步：getState / onState / signIn / signUp / signOut / syncNow
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
  } = opts;

  /* ========== 圖示（SVG，不依賴任何網站的圖示字體） ========== */

  const ICON_PENCIL =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41' +
    'l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

  /** 齒輪：設定（名稱、顏色、資料夾、備份）
      注意：path 一定要寫成「單一字串」。之前用字串相接，接點漏掉一個空格
      （`.06-.94` + `0-.32` → `.06-.940-.32`），整段路徑語法就壞掉、畫不出來。 */
  const ICON_GEAR =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>';

  const ICON_GRIP =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="9" cy="5" r="1.7"/><circle cx="15" cy="5" r="1.7"/>' +
    '<circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/>' +
    '<circle cx="9" cy="19" r="1.7"/><circle cx="15" cy="19" r="1.7"/></svg>';

  const ICON_FOLDER =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>';

  const ICON_TAB =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2zm0 15l-5-2.18L7 18V5h10v13z"/></svg>';

  const ICON_SYNC =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>';

  /* 雲端狀態：已同步／等待同步／沒連上（都是單一 path，理由同上面的齒輪） */
  const ICON_CLOUD_DONE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM10 17l-3.5-3.5 1.41-1.41L10 14.17l5.18-5.18 1.41 1.41L10 17z"/></svg>';
  const ICON_CLOUD_UP =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>';
  const ICON_CLOUD_OFF =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4c-1.48 0-2.85.43-4.01 1.17l1.46 1.46A5.497 5.497 0 0 1 17.5 11v.5H19c1.66 0 3 1.34 3 3 0 1.13-.64 2.11-1.56 2.62l1.45 1.45C23.16 17.16 24 15.68 24 14c0-2.64-2.05-4.78-4.65-4.96zM3 5.27l2.75 2.74C2.56 8.15 0 10.77 0 14c0 3.31 2.69 6 6 6h11.73l2 2L21 20.73 4.27 4 3 5.27zM7.73 10l8 8H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h1.73z"/></svg>';
  const ICON_PERSON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';

  /** 時鐘加倒轉箭頭：「最近使用」 */
  const ICON_HISTORY =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>';

  const ICON_CLOSE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

  /* 社群登入的品牌圖示：LINE、Facebook、Apple 的圖形取自 Simple Icons（CC0 授權） */
  const ICON_LINE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>';
  const ICON_FACEBOOK =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>';
  const ICON_APPLE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>';

  /** Google 登入鈕規定要用的彩色 G */
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
  let impArmed = false, impTimer = 0;
  let cloudState = { configured: false };   // 雲端同步的狀態（見 sync.js）
  let accountMode = 'signin';               // 帳號頁：'signin' 登入 | 'signup' 註冊
  let wipeArmed = false, wipeTimer = 0;
  /** 對話框開著時雲端送來新資料，先不重畫（免得打到一半的字不見），關掉對話框再畫 */
  let staleWhileLayer = false;
  const ui = {};

  /**
   * 「最近使用」書籤：不在 data.tabs 裡（見 store.js），畫面上固定在最左邊。
   * 它的 items 就是使用記錄，不能刪、不能改名、不能新增提示詞。
   */
  const recentTab = () => ({
    id: GPN_RECENT_ID, label: '最近使用', color: 'recent', recent: true, items: data.recent || [],
  });
  const tabById = (id) => (id === GPN_RECENT_ID ? recentTab() : data.tabs.find((t) => t.id === id));
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

  /* ==========================================================================
     一、骨架
     ========================================================================== */

  function build() {
    ui.list = el('div', { class: 'gpn-list', role: 'list' });
    ui.tabs = el('div', { class: 'gpn-tabs', role: 'tablist' });
    ui.tabEls = new Map();        // id → 書籤元素（切換時要重複使用才有動畫）
    ui.hintText = el('span', { class: 'gpn-hint-text' });
    ui.gear = el('button', {
      class: 'gpn-tab-edit', type: 'button', title: '設定（名稱、顏色、資料夾、帳號、備份）',
      html: ICON_GEAR,
      onclick: () => openSettings(data.activeId),
    });
    // 雲端狀態：沒登入時顯示「登入同步」邀請；登入後顯示同步到哪。點了打開帳號頁。
    ui.cloudIcon = el('span', { class: 'gpn-cloud-icon' });
    ui.cloudText = el('span', { class: 'gpn-cloud-text' });
    ui.cloudBtn = el('button', {
      class: 'gpn-cloud-btn', type: 'button',
      onclick: () => openSettings(data.activeId, 'account'),
    }, ui.cloudIcon, ui.cloudText);
    ui.cloudBtn.hidden = true;
    ui.hint = el('div', { class: 'gpn-paper-head' },
      // 左邊這格剛好對齊下方的資料夾欄，當作那一欄的標題（沒開資料夾時隱藏）
      el('span', { class: 'gpn-head-folders', html: ICON_FOLDER + '<span>資料夾</span>' }),
      ui.hintText, ui.cloudBtn, ui.gear);

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
        ui.hint,
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
          }, '清除全部使用記錄')
        )
      )
    );

    ui.overlay = el('div', {
      class: 'gpn-overlay', role: 'dialog', 'aria-modal': standalone ? null : 'true',
      'aria-label': '常用提示詞',
      onmousedown: (e) => { if (!standalone && e.target === ui.overlay) close(); },
    }, ui.book);

    ui.toast = el('div', { class: 'gpn-toast', role: 'status' });

    buildEditLayer();
    buildNewTabLayer();
    buildFolderLayer();
    buildSettingsLayer();
    root.append(ui.overlay, ui.editLayer, ui.newTabLayer, ui.folderLayer, ui.settingsLayer, ui.toast);
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
     書籤數量越少就讓它們佔越寬，不要在右邊留一大片空白。
     注意：所有書籤「等寬」，作用中與否不影響寬度——
     改用高度來表現選取狀態，按起來才不會一直位移。 */
  const GPN_TAB_SHARE = { 1: 0.40, 2: 0.60, 3: 0.75, 4: 0.86, 5: 0.90, 6: 0.93, 7: 0.95, 8: 0.96, 9: 0.97 };

  function layoutTabs() {
    const n = ui.tabEls.size;              // 含最左邊的「最近使用」
    if (!n) return;
    const each = ((GPN_TAB_SHARE[n] ?? 0.97) / n) * 100;
    for (const [, node] of ui.tabEls) node.style.width = each.toFixed(2) + '%';
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

    // 最左邊固定是「最近使用」：不能刪、不能拖，其他書籤也拖不到它前面
    const recentOn = tab.id === GPN_RECENT_ID;
    const recentNode = el('div', {
      class: 'gpn-tab is-fixed' + (recentOn ? ' is-active' : ''),
      'data-color': 'recent', 'data-id': GPN_RECENT_ID,
      onanimationend: () => recentNode.classList.remove('is-popping'),
    }, el('button', {
      class: 'gpn-tab-main', type: 'button', role: 'tab',
      'aria-selected': String(recentOn), title: `最近使用（最近用過的 ${GPN_RECENT_MAX} 則）`,
      onclick: () => { if (data.activeId !== GPN_RECENT_ID) switchTab(GPN_RECENT_ID); },
    }, el('span', { class: 'gpn-tab-icon', html: ICON_HISTORY }), '最近使用'));
    ui.tabEls.set(GPN_RECENT_ID, recentNode);
    ui.tabs.append(recentNode);

    for (const t of data.tabs) {
      const isActive = t.id === tab.id;

      const main = el('button', {
        class: 'gpn-tab-main', type: 'button', role: 'tab',
        'aria-selected': String(isActive),
        title: t.label,
        onclick: () => { if (t.id !== data.activeId) switchTab(t.id); },
      }, t.label);

      // 設定鈕不放在書籤上——它會佔掉空間，害書籤上的字無法置中。
      // 改放到下方 paper-head 的右側（見 build 的 ui.gear）。
      const node = el('div', {
        class: 'gpn-tab' + (isActive ? ' is-active' : ''),
        'data-color': t.color, 'data-id': t.id,
        onanimationend: () => node.classList.remove('is-popping'),
      }, main);

      attachHoldDrag({
        handle: main, node, box: ui.tabs, selector: '.gpn-tab:not(.is-fixed)',
        anchor: () => ui.addTabBtn || null,
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

    ui.book.setAttribute('data-color', tab.color);
    layoutTabs();
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
    // 底部按鈕：一般書籤是「新增提示詞」，「最近使用」換成「清除全部使用記錄」
    ui.addBtn.hidden = !!tab.recent;
    ui.clearRecentBtn.hidden = !tab.recent;
    disarmClearRecent();
    if (tab.recent) { renderRecent(); return; }

    const folder = activeFolder();
    const list = folder || tab;

    const n = list.items.length;
    ui.hintText.textContent = n
      ? `${n} 則　•　` + (standalone ? '點標題複製，再貼到 AI' : '點標題填入輸入框並複製') +
        '　•　拖曳左側可排序'
      : folder ? '這個資料夾還沒有提示詞' : '這個書籤還沒有提示詞';
    ui.gear.setAttribute('aria-label', `「${tab.label}」的設定`);

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

  function buildCard(item, tabId, fid) {
    const grip = el('div', {
      class: 'gpn-grip', title: '按住拖曳可調整順序', 'aria-label': '拖曳排序', html: ICON_GRIP,
    });

    const titleBtn = el('button', {
      class: 'gpn-title', type: 'button',
      title: standalone ? '點一下：複製這段提示詞' : '點一下：填入輸入框並複製',
      onclick: () => usePrompt(item, card, tabId, fid),
    },
      el('div', { class: 'gpn-title-text', text: item.title || '(未命名)' }),
      el('div', { class: 'gpn-title-sub', text: preview(item.content) })
    );

    const editBtn = el('button', {
      class: 'gpn-edit', type: 'button', title: '編輯', 'aria-label': `編輯 ${item.title}`,
      html: ICON_PENCIL,
      onclick: (e) => { e.stopPropagation(); openEditor(tabId, fid, item.id); },
    });

    const card = el('div', { class: 'gpn-card', role: 'listitem', 'data-id': item.id },
      grip, titleBtn, editBtn);
    attachDrag(grip, card, tabId, fid);
    return card;
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
    ui.hintText.textContent = n
      ? `最近用過的 ${n} 則（最多 ${GPN_RECENT_MAX} 則）　•　最新的在最上面`
      : '還沒有使用記錄';
    ui.gear.setAttribute('aria-label', '設定');

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
    const list = listOf(tabId, fid);
    if (!list) return;
    const order = [...ui.list.querySelectorAll('.gpn-card')].map((n) => n.getAttribute('data-id'));
    list.items = reorder(list.items, order);
    persist();
  }

  /* ==========================================================================
     長按後拖曳排序：書籤（左右）、資料夾（上下）共用
     刻意設計成「長按 450ms 才進入拖曳」，一般點選不會誤觸。
     按住期間只要移動超過 8px 就取消（視為想點擊或捲動）。
     ========================================================================== */

  const GPN_HOLD_MS = 450;   // 要按多久才進入拖曳
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

  /** 六色色票；onPick(顏色) */
  function buildSwatches(onPick) {
    const box = el('div', { class: 'gpn-swatches' });
    for (const c of GPN_COLORS) {
      box.append(el('button', {
        class: 'gpn-swatch', type: 'button', 'data-color': c,
        'aria-label': GPN_COLOR_LABELS[c], title: GPN_COLOR_LABELS[c],
        onclick: () => onPick(c),
      }));
    }
    return box;
  }
  function markSwatch(box, color) {
    for (const s of box.children) s.classList.toggle('is-on', s.getAttribute('data-color') === color);
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
      oninput: () => { ui.eBody.classList.remove('is-bad'); ui.eBodyHint.classList.remove('is-on'); },
    });
    ui.eBodyHint = el('div', { class: 'gpn-hint', text: '請先輸入提示詞內容' });

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
          field('實際的 Prompt 內容', '（點標題時用的文字）', ui.eBody, ui.eBodyHint),
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
     六、新增書籤（書籤列最右邊的「＋」）
     已經存在的書籤要改名、換色、刪除，都在齒輪的設定裡。
     ========================================================================== */

  function buildNewTabLayer() {
    ui.nName = el('input', {
      class: 'gpn-input', type: 'text', maxlength: '8', placeholder: '例如：工作',
      oninput: () => { ui.nName.classList.remove('is-bad'); ui.nNameHint.classList.remove('is-on'); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); onNewTabSave(); } },
    });
    ui.nNameHint = el('div', { class: 'gpn-hint', text: '請輸入書籤名稱' });
    ui.nSwatches = buildSwatches((c) => { newTabColor = c; markSwatch(ui.nSwatches, c); });

    ui.newTabLayer = el('div', { class: 'gpn-edit-layer' },
      el('div', { class: 'gpn-dialog gpn-dialog--sm', onmousedown: stop },
        el('h2', { text: '新增書籤' }),
        el('div', { class: 'gpn-dialog-body' },
          field('書籤名稱', '（最多 8 個字）', ui.nName, ui.nNameHint),
          field('書籤顏色', null, ui.nSwatches),
          el('div', { class: 'gpn-note', text: '新書籤一開始不分資料夾。之後需要的話，可以在齒輪的設定裡開啟。' })
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
    markSwatch(ui.nSwatches, newTabColor);
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
        ? '這是最後一個資料夾，不能刪除。不想分資料夾的話，可以到齒輪 → 資料夾 把它關掉。'
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
     八、設定（紙張右上角的齒輪）
     左邊選單、右邊內容。前兩頁是「這個書籤」的設定，最後一頁是全部資料的備份。
     改名、換色、開關資料夾都是「改了就存」，不必按儲存，也就不會有改了卻忘記存的狀況。
     ========================================================================== */

  function buildSettingsLayer() {
    /* ---- 左邊選單 ---- */
    ui.sNavGroup = el('div', { class: 'gpn-nav-group' });
    ui.sNavBadge = el('span', { class: 'gpn-nav-badge' });
    const navItem = (key, icon, text, extra) => el('button', {
      class: 'gpn-nav-item', type: 'button', role: 'tab', 'data-section': key,
      onclick: () => showSection(key),
    }, el('span', { class: 'gpn-nav-icon', html: icon }), el('span', { class: 'gpn-nav-text', text }), extra);
    ui.sNavItems = [
      navItem('tab', ICON_TAB, '名稱與顏色'),
      navItem('folders', ICON_FOLDER, '資料夾', ui.sNavBadge),
      // 沒有雲端功能的地方（例如測試）就不出現這一項
      cloud ? navItem('account', ICON_PERSON, '帳號與同步') : null,
      navItem('backup', ICON_SYNC, '備份與同步'),
    ].filter(Boolean);
    const [navTab, navFolders, ...navAll] = ui.sNavItems;
    const nav = el('nav', { class: 'gpn-settings-nav', role: 'tablist', 'aria-orientation': 'vertical' },
      el('h2', { text: '設定' }),
      ui.sNavGroup, navTab, navFolders,
      el('div', { class: 'gpn-nav-group', text: '所有書籤' }), ...navAll,
      // 外掛和網頁版長得不一樣時，先看這裡的數字是不是一樣
      el('div', {
        class: 'gpn-nav-version',
        text: `版本 ${GPN_APP_VERSION}` + (edition ? `　${edition}` : ''),
      }));

    /* ---- 名稱與顏色 ---- */
    ui.sName = el('input', {
      class: 'gpn-input', type: 'text', maxlength: '8', placeholder: '例如：工作',
      oninput: onSettingsName,
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); ui.sName.blur(); } },
    });
    ui.sNameHint = el('div', { class: 'gpn-hint', text: '名稱不能空白；留空的話會保留原本的名稱' });
    ui.sSwatches = buildSwatches(onSettingsColor);
    ui.sDelNote = el('div', { class: 'gpn-note' });
    ui.sDel = el('button', { class: 'gpn-btn gpn-btn--del', type: 'button', onclick: onTabDelete }, '刪除這個書籤');
    ui.sDanger = el('div', { class: 'gpn-danger' },
      el('div', { class: 'gpn-label', text: '刪除書籤' }), ui.sDelNote, ui.sDel);

    const secTab = el('section', { class: 'gpn-section', 'data-section': 'tab' },
      el('h3', { text: '名稱與顏色' }),
      field('書籤名稱', '（最多 8 個字）', ui.sName, ui.sNameHint),
      field('書籤顏色', null, ui.sSwatches),
      el('div', { class: 'gpn-note', text: '改好會自動儲存。' }),
      ui.sDanger);

    /* ---- 資料夾 ---- */
    ui.sSwitchTitle = el('b');
    ui.sSwitchState = el('span');
    ui.sSwitch = el('button', {
      class: 'gpn-switch-row', type: 'button', role: 'switch', 'aria-checked': 'false',
      onclick: onFolderSwitch,
    },
      el('span', { class: 'gpn-switch', 'aria-hidden': 'true' }),
      el('span', { class: 'gpn-switch-text' }, ui.sSwitchTitle, ui.sSwitchState));
    ui.sFolderNote = el('div', { class: 'gpn-note gpn-note--roomy' });

    // 關閉資料夾會把分類攤平，所以先講清楚會發生什麼事，再讓他決定
    ui.sConfirmText = el('div');
    ui.sConfirm = el('div', { class: 'gpn-confirm', role: 'alert' },
      ui.sConfirmText,
      el('div', { class: 'gpn-brow' },
        el('button', { class: 'gpn-btn2 gpn-btn2--danger', type: 'button', onclick: disableFolders }, '確定關閉'),
        el('button', { class: 'gpn-btn2', type: 'button', onclick: hideFolderConfirm }, '先不要')));
    ui.sConfirm.hidden = true;

    const secFolders = el('section', { class: 'gpn-section', 'data-section': 'folders' },
      el('h3', { text: '資料夾' }),
      el('p', {
        class: 'gpn-lede',
        text: '提示詞很多的書籤，可以再分成幾個資料夾，左邊會多一欄讓你切換。' +
              '提示詞不多的書籤（例如「常用」）不開也沒關係。',
      }),
      ui.sSwitch, ui.sConfirm, ui.sFolderNote);

    /* ---- 帳號與同步 ---- */
    const secAccount = cloud ? buildAccountSection() : null;

    /* ---- 備份與同步 ---- */
    const secBackup = buildBackupSection();

    ui.sSections = [secTab, secFolders, secAccount, secBackup].filter(Boolean);
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
    // 「最近使用」沒有名稱、顏色、資料夾可以改，直接打開全部書籤共用的那幾頁
    const hasAccount = !!cloud && !!cloudState.configured;
    if (tab.recent && (section === 'tab' || section === 'folders')) section = hasAccount ? 'account' : 'backup';
    if (section === 'account' && !hasAccount) section = tab.recent ? 'backup' : 'tab';
    settingsTabId = tabId;
    ui.sName.value = tab.label;
    ui.sName.classList.remove('is-bad');
    ui.sNameHint.classList.remove('is-on');
    disarmTabDelete();
    resetBackup();
    resetAccountForm();
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
    disarmAccountDelete();
    // 密碼不要留在畫面上
    if (ui.aPass) { for (const n of [ui.aPass, ui.aPass2, ui.aNew1, ui.aNew2]) n.value = ''; }
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
    disarmAccountDelete();
  }

  /** 設定視窗裡所有「跟著資料變」的文字，一次更新 */
  function refreshSettings() {
    const tab = tabById(settingsTabId);
    if (!tab) return;

    ui.bStats.textContent =
      `這台目前有 ${data.tabs.length} 個書籤、${gpnCountFolders(data)} 個資料夾、` +
      `${gpnCountItems(data)} 則提示詞`;
    ui.settings.setAttribute('data-color', tab.color);

    // 「最近使用」：藏起「這個書籤」那一組（名稱與顏色、資料夾）
    // 雲端還沒設定好：「帳號與同步」整頁不出現，免得使用者看到一堆給管理員的說明
    const fixed = !!tab.recent;
    ui.sNavGroup.hidden = fixed;
    for (const b of ui.sNavItems) {
      const key = b.getAttribute('data-section');
      if (key === 'tab' || key === 'folders') b.hidden = fixed;
      if (key === 'account') b.hidden = !cloudState.configured;
    }
    if (fixed) return;

    const n = gpnTabItemCount(tab);
    ui.sNavGroup.textContent = `「${tab.label}」這個書籤`;
    markSwatch(ui.sSwatches, tab.color);

    const on = !!tab.folders;
    ui.sSwitch.setAttribute('aria-checked', String(on));
    ui.sSwitchTitle.textContent = `「${tab.label}」使用資料夾`;
    ui.sSwitchState.textContent = on ? '開啟中' : '關閉中';
    ui.sNavBadge.textContent = on ? '開' : '關';
    ui.sNavBadge.classList.toggle('is-on', on);
    ui.sFolderNote.textContent = on
      ? `目前有 ${tab.folders.length} 個資料夾、${n} 則提示詞。` +
        '新增、改名、刪除資料夾，都在主畫面左邊那一欄；在資料夾上「長按」可以上下拖曳排序。'
      : n
        ? `開啟後，現在的 ${n} 則提示詞會先放進「${GPN_DEFAULT_FOLDER}」資料夾，` +
          '之後可以再新增資料夾，用鉛筆把提示詞搬過去。'
        : `開啟後，會先建立一個「${GPN_DEFAULT_FOLDER}」資料夾。`;

    ui.sDanger.hidden = data.tabs.length <= 1;        // 最後一個書籤不給刪
    ui.sDelNote.textContent = n
      ? `書籤裡的 ${n} 則提示詞會一起刪除，刪了就找不回來。刪之前可以先到「備份與同步」下載備份。`
      : '這個書籤裡沒有提示詞。';
  }

  function onSettingsName() {
    const tab = tabById(settingsTabId);
    if (!tab || tab.recent) return;
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
    if (!tab || tab.recent || tab.color === color) return;
    tab.color = color;
    persist();
    renderTabs();
    refreshSettings();
  }

  function onFolderSwitch() {
    const tab = tabById(settingsTabId);
    if (!tab || tab.recent) return;

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
        `關閉後，${tab.folders.length} 個資料夾裡的 ${gpnTabItemCount(tab)} 則提示詞，` +
        '會依資料夾的順序合併成一個清單。提示詞一則都不會刪除，但資料夾的分類就沒有了。';
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
    if (!tab || tab.recent || data.tabs.length <= 1) return;

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

  /* ---- 帳號與同步 ----
     登入同一個帳號，外掛、網頁版、每一台電腦的提示詞就會自動同步（見 sync.js）。
     沒登入也能照常用，只是資料只存在這一台。

     會經歷的流程：
       社群登入：按「用 ○○ 帳號登入」→ 到那一家選帳號 → 回來就登入了（第一次會自動建帳號）
       Email 註冊：填 Email、密碼 → 收驗證信 → 點信裡的連結 → 回到網頁版就登入了
       忘記密碼：填 Email → 收「重設密碼」信 → 點連結回到網頁版 → 設新密碼 */

  /** 支援的社群登入。cloud-config.js 的 providers 開了哪幾家，畫面就出現哪幾顆 */
  const PROVIDERS = {
    google: { name: 'Google', icon: ICON_GOOGLE },
    'custom:line': { name: 'LINE', icon: ICON_LINE },
    facebook: { name: 'Facebook', icon: ICON_FACEBOOK },
    apple: { name: 'Apple', icon: ICON_APPLE },
  };
  const providerName = (p) => PROVIDERS[p]?.name || (p === 'email' || !p ? 'Email' : p);
  let pendingEmail = '';        // 剛註冊、等著驗證的 Email（「重新寄驗證信」用）
  let deleteArmed = false, deleteTimer = 0;

  function buildAccountSection() {
    /* ---- 沒登入：社群登入 ＋ Email 登入／註冊 ---- */
    ui.aSocial = el('div', { class: 'gpn-social' });
    ui.aSocialBox = el('div', {},
      ui.aSocial,
      el('div', { class: 'gpn-or' }, el('span', { text: '或用 Email 和密碼' })));

    ui.aSignin = el('button', { class: 'gpn-seg is-on', type: 'button', onclick: () => setAccountMode('signin') }, '登入');
    ui.aSignup = el('button', { class: 'gpn-seg', type: 'button', onclick: () => setAccountMode('signup') }, '註冊新帳號');

    const submitOnEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); onAccountSubmit(); } };
    const clearBad = (e) => { e.target.classList.remove('is-bad'); setAccountMsg(''); };
    ui.aEmail = el('input', {
      class: 'gpn-input', type: 'email', autocomplete: 'email', placeholder: '例如：name@gmail.com',
      spellcheck: 'false', oninput: clearBad, onkeydown: submitOnEnter,
    });
    ui.aPass = el('input', {
      class: 'gpn-input', type: 'password', autocomplete: 'current-password',
      oninput: clearBad, onkeydown: submitOnEnter,
    });
    ui.aPass2 = el('input', {
      class: 'gpn-input', type: 'password', autocomplete: 'new-password',
      oninput: clearBad, onkeydown: submitOnEnter,
    });
    ui.aPass2Field = field('再輸入一次密碼', '（確認沒有打錯）', ui.aPass2);
    ui.aShow = el('input', {
      type: 'checkbox',
      onchange: () => {
        for (const n of [ui.aPass, ui.aPass2]) n.type = ui.aShow.checked ? 'text' : 'password';
      },
    });
    ui.aPassLabel = el('span', { text: '（至少 6 個字）' });
    ui.aForgot = el('button', { class: 'gpn-link', type: 'button', onclick: onForgot }, '忘記密碼？');
    ui.aMsg = el('div', { class: 'gpn-note gpn-note--status', role: 'status' });
    ui.aResend = el('button', { class: 'gpn-btn2', type: 'button', onclick: onResend }, '📧　重新寄驗證信');
    ui.aResend.hidden = true;
    ui.aSubmit = el('button', {
      class: 'gpn-btn gpn-btn--save gpn-btn--block', type: 'button', onclick: onAccountSubmit,
    }, '登入');

    ui.aOut = el('div', {},
      el('p', { class: 'gpn-lede', text:
        '登入同一個帳號，外掛、網頁版、每一台電腦的提示詞就會自動同步，換電腦也不怕不見。' +
        '不登入也能照常用，只是資料只存在這台電腦。' }),
      ui.aSocialBox,
      el('div', { class: 'gpn-seg-row gpn-seg-row--top' }, ui.aSignin, ui.aSignup),
      field('Email', null, ui.aEmail),
      el('div', { class: 'gpn-field' },
        el('label', { class: 'gpn-label' }, '密碼', ui.aPassLabel),
        ui.aPass,
        el('div', { class: 'gpn-pass-row' },
          el('label', { class: 'gpn-check' }, ui.aShow, el('span', { text: '顯示密碼' })),
          ui.aForgot)),
      ui.aPass2Field,
      ui.aMsg,
      ui.aResend,
      ui.aSubmit);

    /* ---- 從「重設密碼」信回來：設新密碼 ---- */
    ui.aNew1 = el('input', { class: 'gpn-input', type: 'password', autocomplete: 'new-password' });
    ui.aNew2 = el('input', {
      class: 'gpn-input', type: 'password', autocomplete: 'new-password',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); onNewPassword(); } },
    });
    ui.aNewMsg = el('div', { class: 'gpn-note gpn-note--status', role: 'status' });
    ui.aNewBtn = el('button', {
      class: 'gpn-btn gpn-btn--save gpn-btn--block', type: 'button', onclick: onNewPassword,
    }, '更新密碼');
    ui.aRecover = el('div', { class: 'gpn-recover' },
      el('div', { class: 'gpn-label', text: '請設定新的密碼' }),
      el('div', { class: 'gpn-note', text: '你是從「重設密碼」的信回來的，已經先幫你登入了。' }),
      field('新密碼', '（至少 6 個字）', ui.aNew1),
      field('再輸入一次新密碼', null, ui.aNew2),
      ui.aNewMsg, ui.aNewBtn);

    /* ---- 已登入 ---- */
    ui.aWhoHow = el('div', { class: 'gpn-note' });
    ui.aWho = el('div', { class: 'gpn-account-email' });
    ui.aStatusIcon = el('span', { class: 'gpn-cloud-icon' });
    ui.aStatus = el('span');
    ui.aSyncBtn = el('button', { class: 'gpn-btn2', type: 'button', onclick: onSyncNow }, '⟳　立即同步');
    ui.aWipe = el('button', {
      class: 'gpn-btn gpn-btn--del', type: 'button', onclick: () => onSignOut(true),
    }, '登出並清除這台電腦上的提示詞');
    ui.aDelete = el('button', {
      class: 'gpn-btn gpn-btn--del', type: 'button', onclick: onDeleteAccount,
    }, '刪除我的帳號');

    ui.aIn = el('div', {},
      ui.aRecover,
      el('div', { class: 'gpn-account-card' },
        el('span', { class: 'gpn-account-avatar', html: ICON_PERSON }),
        el('div', { class: 'gpn-account-info' }, ui.aWhoHow, ui.aWho)),
      el('div', { class: 'gpn-account-status' }, ui.aStatusIcon, ui.aStatus),
      el('div', { class: 'gpn-brow' },
        ui.aSyncBtn,
        el('button', { class: 'gpn-btn2', type: 'button', onclick: () => onSignOut(false) }, '登出')),
      el('div', { class: 'gpn-note', text:
        '提示詞一改就會自動同步，平常不用按「立即同步」。' +
        '登出後，這台電腦上的提示詞會留著，只是不再同步。' }),
      el('div', { class: 'gpn-danger' },
        el('div', { class: 'gpn-label', text: '在別人的電腦上用完了？' }),
        el('div', { class: 'gpn-note', text:
          '登出，並把這台電腦上的提示詞清掉，別人就看不到。雲端上的資料不會刪，下次登入就回來了。' }),
        ui.aWipe),
      el('div', { class: 'gpn-danger' },
        el('div', { class: 'gpn-label', text: '不想用了？' }),
        el('div', { class: 'gpn-note', text:
          '永久刪除這個帳號，和存在雲端上的所有提示詞、使用記錄。刪了就找不回來。' +
          '這台電腦上的提示詞會留著。' }),
        ui.aDelete));

    return el('section', { class: 'gpn-section', 'data-section': 'account' },
      el('h3', { text: '帳號與同步' }), ui.aOut, ui.aIn,
      el('a', {
        class: 'gpn-link gpn-privacy', href: new URL('privacy.html', GPN_CLOUD.site).href,
        target: '_blank', rel: 'noopener',
      }, '隱私權政策：我們存了什麼、怎麼刪除'));
  }

  /** 社群登入按鈕：照 cloud-config.js 的 providers 畫出來 */
  function renderSocial(providers) {
    const key = providers.join(',');
    if (ui.aSocial.dataset.key === key) return;
    ui.aSocial.dataset.key = key;
    ui.aSocial.replaceChildren(...providers.filter((p) => PROVIDERS[p]).map((p) => el('button', {
      class: 'gpn-social-btn', type: 'button', 'data-provider': p.replace('custom:', ''),
      onclick: (e) => onSocial(p, e.currentTarget),
    }, el('span', { class: 'gpn-social-icon', html: PROVIDERS[p].icon }),
       el('span', { text: `用 ${PROVIDERS[p].name} 帳號登入` }))));
  }

  function setAccountMode(mode) {
    accountMode = mode;
    const up = mode === 'signup';
    ui.aSignin.classList.toggle('is-on', !up);
    ui.aSignup.classList.toggle('is-on', up);
    ui.aPass2Field.hidden = !up;
    ui.aPassLabel.hidden = !up;
    ui.aForgot.hidden = up;
    ui.aPass.autocomplete = up ? 'new-password' : 'current-password';
    ui.aSubmit.textContent = up ? '註冊' : '登入';
    ui.aResend.hidden = true;
    setAccountMsg('');
  }

  function resetAccountForm() {
    if (!ui.aOut) return;
    for (const n of [ui.aPass, ui.aPass2, ui.aNew1, ui.aNew2]) n.value = '';
    ui.aShow.checked = false;
    for (const n of [ui.aPass, ui.aPass2]) n.type = 'password';
    for (const n of [ui.aEmail, ui.aPass, ui.aPass2]) n.classList.remove('is-bad');
    setAccountMode('signin');
    disarmWipe();
    disarmAccountDelete();
    refreshAccount();
  }

  function focusAccount() {
    if (ui.aOut && !ui.aOut.hidden) (ui.aEmail.value ? ui.aPass : ui.aEmail).focus();
    else if (ui.aRecover && !ui.aRecover.hidden) ui.aNew1.focus();
  }

  function setAccountMsg(msg, kind = 'bad', node = ui.aMsg) {
    node.textContent = msg;
    node.classList.toggle('is-bad', !!msg && kind === 'bad');
    node.classList.toggle('is-ok', !!msg && kind === 'ok');
  }

  const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  async function onAccountSubmit() {
    if (ui.aSubmit.disabled) return;
    const email = ui.aEmail.value.trim();
    const pw = ui.aPass.value;
    const up = accountMode === 'signup';

    // 先在這裡擋掉常見的打錯，不必等雲端回覆
    const bad = (node, msg) => { node.classList.add('is-bad'); node.focus(); setAccountMsg(msg); };
    if (!emailOk(email)) return bad(ui.aEmail, '請輸入正確的 Email');
    if (!pw) return bad(ui.aPass, '請輸入密碼');
    if (up && pw.length < 6) return bad(ui.aPass, '密碼至少要 6 個字');
    if (up && pw !== ui.aPass2.value) return bad(ui.aPass2, '兩次輸入的密碼不一樣');

    const label = ui.aSubmit.textContent;
    ui.aSubmit.disabled = true;
    ui.aSubmit.textContent = up ? '註冊中…' : '登入中…';
    setAccountMsg('');
    ui.aResend.hidden = true;
    const r = await (up ? cloud.signUp(email, pw) : cloud.signIn(email, pw));
    ui.aSubmit.disabled = false;
    ui.aSubmit.textContent = label;

    if (!r || !r.ok) {
      setAccountMsg(r?.error || '登入失敗，請再試一次');
      if (r?.unconfirmed) { pendingEmail = email; ui.aResend.hidden = false; }
      return;
    }
    if (r.needConfirm) {
      // 註冊成功，但要先到信箱點驗證連結
      pendingEmail = email;
      setAccountMode('signin');
      ui.aPass.value = '';
      setAccountMsg(`註冊成功！驗證信已經寄到 ${email}。請打開那封信，按「確認我的信箱」` +
        (cloud.linksOpenWeb
          ? '。驗證完，回到這裡輸入密碼、按「登入」就好。'
          : '，就會回到網頁版並自動登入。') +
        '（找不到信的話看一下垃圾郵件）', 'ok');
      ui.aResend.hidden = false;
      return;
    }

    ui.aPass.value = '';
    ui.aPass2.value = '';
    folderId = null;
    toast(signedInMessage(r), !!r.error);
    refreshCloud(await cloud.getState());
  }

  /** 登入成功後要跟他說的話（依這次同步的結果） */
  function signedInMessage(r) {
    return r.error ? `已登入，但同步失敗：${r.error}`
      : r.merged ? `已登入。這台原本的 ${r.merged} 則已經合併到雲端`
      : r.pulled ? `已登入，從雲端載入了 ${r.pulled} 則提示詞`
      : r.uploaded ? `已登入，這台的 ${r.uploaded} 則已經存到雲端`
      : '已登入，之後會自動同步';
  }

  async function onResend() {
    const email = pendingEmail || ui.aEmail.value.trim();
    if (!emailOk(email)) { setAccountMsg('請先在上面輸入註冊時用的 Email'); return; }
    ui.aResend.disabled = true;
    const r = await cloud.resendConfirm(email);
    ui.aResend.disabled = false;
    setAccountMsg(r?.ok ? `已經重新寄到 ${email}，請到信箱看看（也看一下垃圾郵件）。`
      : (r?.error || '寄不出去，請稍後再試'), r?.ok ? 'ok' : 'bad');
  }

  async function onForgot() {
    const email = ui.aEmail.value.trim();
    if (!emailOk(email)) {
      ui.aEmail.classList.add('is-bad');
      ui.aEmail.focus();
      setAccountMsg('請先在上面輸入你註冊時用的 Email，再按「忘記密碼？」');
      return;
    }
    ui.aForgot.disabled = true;
    const r = await cloud.resetPassword(email);
    ui.aForgot.disabled = false;
    setAccountMsg(r?.ok
      ? `如果 ${email} 有註冊過，我們已經寄出「重設密碼」的信。請打開那封信按連結，` +
        (cloud.linksOpenWeb
          ? '會打開網頁版讓你設新密碼；設好之後，回到這裡用新密碼登入。'
          : '會回到網頁版讓你設新密碼。')
      : (r?.error || '寄不出去，請稍後再試'), r?.ok ? 'ok' : 'bad');
  }

  async function onNewPassword() {
    const pw = ui.aNew1.value;
    if (pw.length < 6) { setAccountMsg('密碼至少要 6 個字', 'bad', ui.aNewMsg); ui.aNew1.focus(); return; }
    if (pw !== ui.aNew2.value) { setAccountMsg('兩次輸入的密碼不一樣', 'bad', ui.aNewMsg); ui.aNew2.focus(); return; }
    ui.aNewBtn.disabled = true;
    const r = await cloud.updatePassword(pw);
    ui.aNewBtn.disabled = false;
    if (!r?.ok) { setAccountMsg(r?.error || '更新失敗，請再試一次', 'bad', ui.aNewMsg); return; }
    ui.aNew1.value = '';
    ui.aNew2.value = '';
    setAccountMsg('', 'ok', ui.aNewMsg);
    toast('密碼已經更新，之後請用新密碼登入');
    refreshCloud(await cloud.getState());
  }

  /** 社群登入：網頁版會直接換到那一家的登入頁；外掛會另開一個分頁，登入完自己關掉 */
  async function onSocial(provider, btn) {
    btn.disabled = true;
    setAccountMsg('');
    const r = await cloud.signInWithProvider(provider);
    btn.disabled = false;
    if (!r || !r.ok) { setAccountMsg(r?.error || '沒辦法開始登入，請稍後再試'); return; }
    if (r.opened) {
      setAccountMsg(`已經開了一個新分頁，請在那裡用 ${providerName(provider)} 登入；` +
        '登入完那個分頁會自動關掉，回到這裡就好。', 'ok');
    }
  }

  async function onSyncNow() {
    ui.aSyncBtn.disabled = true;
    const r = await cloud.syncNow();
    ui.aSyncBtn.disabled = false;
    toast(r?.error ? r.error : '已同步', !!r?.error);
  }

  /** 登出。wipe＝連這台的提示詞一起清掉，要按兩次 */
  async function onSignOut(wipe) {
    if (wipe && !wipeArmed) {
      wipeArmed = true;
      armButton(ui.aWipe, '確定清除這台的提示詞並登出？再按一次');
      clearTimeout(wipeTimer);
      wipeTimer = setTimeout(disarmWipe, 5000);
      return;
    }
    disarmWipe();
    await cloud.signOut({ wipe });
    folderId = null;
    toast(wipe ? '已登出，這台電腦上的提示詞也清掉了'
               : '已登出。這台的提示詞還在，只是不會再同步');
    refreshCloud(await cloud.getState());
  }

  function disarmWipe() {
    clearTimeout(wipeTimer);
    wipeArmed = false;
    if (ui.aWipe) disarmButton(ui.aWipe, '登出並清除這台電腦上的提示詞');
  }

  /** 刪除帳號：永久刪除，按兩次 */
  async function onDeleteAccount() {
    if (!deleteArmed) {
      deleteArmed = true;
      armButton(ui.aDelete, '確定永久刪除帳號和雲端上的提示詞？再按一次');
      clearTimeout(deleteTimer);
      deleteTimer = setTimeout(disarmAccountDelete, 6000);
      return;
    }
    disarmAccountDelete();
    ui.aDelete.disabled = true;
    const r = await cloud.deleteAccount();
    ui.aDelete.disabled = false;
    if (!r?.ok) { toast(r?.error || '刪除失敗，請稍後再試', true); return; }
    toast('帳號已經刪除。這台電腦上的提示詞還在，只是不會再同步');
    refreshCloud(await cloud.getState());
  }

  function disarmAccountDelete() {
    clearTimeout(deleteTimer);
    deleteArmed = false;
    if (ui.aDelete) disarmButton(ui.aDelete, '刪除我的帳號');
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

  /** 狀態 → 圖示、短字（放主畫面）、長句（放帳號頁） */
  function describeCloud(s) {
    if (!s.signedIn) {
      return { icon: ICON_CLOUD_OFF, short: '登入同步', long: '', kind: 'invite' };
    }
    if (s.phase === 'syncing') {
      return { icon: ICON_SYNC, short: '同步中', long: '同步中…', kind: 'busy' };
    }
    if (s.phase === 'offline') {
      return { icon: ICON_CLOUD_OFF, short: '未連線', long: s.message || '連不上網路，恢復連線後會自動同步', kind: 'warn' };
    }
    if (s.phase === 'error') {
      return { icon: ICON_CLOUD_OFF, short: '同步失敗', long: s.message || '同步失敗', kind: 'bad' };
    }
    if (s.pending) {
      return { icon: ICON_CLOUD_UP, short: '待同步', long: '有修改還沒同步，馬上就會送出', kind: 'busy' };
    }
    const when = ago(s.lastSyncAt);
    return { icon: ICON_CLOUD_DONE, short: '已同步', long: '已同步' + (when ? `（${when}）` : ''), kind: 'ok' };
  }

  function refreshCloud(s) {
    if (s) cloudState = s;
    const st = cloudState;
    const d = describeCloud(st);

    // 主畫面的小按鈕
    ui.cloudBtn.hidden = !cloud || !st.configured;
    ui.cloudBtn.setAttribute('data-kind', d.kind);
    ui.cloudIcon.innerHTML = d.icon;
    ui.cloudText.textContent = d.short;
    ui.cloudBtn.title = st.signedIn
      ? `${st.email || providerName(st.provider) + ' 帳號'}　${d.long || d.short}（點一下看帳號）`
      : '登入帳號，每台電腦的提示詞就會自動同步';

    refreshAccount();
  }

  function refreshAccount() {
    if (!ui.aOut) return;
    const st = cloudState;
    ui.aOut.hidden = !st.configured || !!st.signedIn;
    ui.aIn.hidden = !st.configured || !st.signedIn;

    // 社群登入：後台開好了哪幾家（st.providers），而且這個環境做得到（直接開檔案的網頁版就不行）
    const providers = cloud.canSocial === false ? [] : (st.providers || []);
    renderSocial(providers);
    ui.aSocialBox.hidden = !providers.length;

    if (!st.signedIn) {
      // 登入過期之類的訊息，第一次顯示在表單上
      if (st.message && !ui.aMsg.textContent) setAccountMsg(st.message);
      return;
    }
    const d = describeCloud(st);
    ui.aRecover.hidden = !st.recovery;
    ui.aWhoHow.textContent = `已登入（用 ${providerName(st.provider)} 帳號）`;
    ui.aWho.textContent = st.email || `${providerName(st.provider)} 帳號`;
    ui.aStatusIcon.innerHTML = d.icon;
    ui.aStatus.textContent = d.long;
    ui.aStatus.parentElement.setAttribute('data-kind', d.kind);
  }

  /* ---- 備份與同步 ----
     為什麼需要這個：公家機關的電腦不能裝擴充功能，所以另外做了網頁版。
     兩邊是各自獨立的儲存空間，靠這裡的「代碼／備份檔」手動搬資料。
     有了帳號同步之後，這裡變成「額外留一份」和「分享給別人」用。 */

  function buildBackupSection() {
    /* ① 帶出去 */
    ui.bStats = el('div', { class: 'gpn-note' });

    const outRow = el('div', { class: 'gpn-brow' },
      el('button', {
        class: 'gpn-btn2', type: 'button',
        onclick: () => { gpnDownloadExport(data); toast('備份檔已開始下載'); },
      }, '⬇　下載備份檔'),
      el('button', {
        class: 'gpn-btn2', type: 'button',
        onclick: async (e) => {
          const btn = e.currentTarget;
          const ok = await gpnShareCopy(gpnExportCode(data));
          toast(ok ? '代碼已複製，貼到另一台就好' : '複製失敗，請改用下載備份檔', !ok);
          if (ok) {
            btn.classList.add('is-done');
            setTimeout(() => btn.classList.remove('is-done'), 1400);
          }
        },
      }, '⧉　複製代碼')
    );

    /* ② 帶回來 */
    ui.bCode = el('textarea', {
      class: 'gpn-textarea gpn-textarea--code', spellcheck: 'false',
      placeholder: '在這裡貼上另一台複製的代碼，或整份 .json 內容…',
      oninput: () => { disarmImport(); refreshBackupPreview(); },
    });

    ui.bFile = el('input', {
      type: 'file', accept: '.json,application/json', class: 'gpn-file',
      onchange: async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';                 // 選同一個檔案兩次也要觸發
        if (!file) return;
        try {
          ui.bCode.value = await gpnReadFile(file);
        } catch {
          toast('這個檔案讀不起來', true);
          return;
        }
        disarmImport();
        refreshBackupPreview();
      },
    });

    ui.bMerge = el('button', {
      class: 'gpn-seg is-on', type: 'button',
      onclick: () => setBackupMode('merge'),
    }, '合併', el('span', { text: '推薦' }));

    ui.bReplace = el('button', {
      class: 'gpn-seg', type: 'button',
      onclick: () => setBackupMode('replace'),
    }, '完全取代');

    ui.bModeNote = el('div', { class: 'gpn-note' });
    ui.bNote = el('div', { class: 'gpn-note gpn-note--status' });

    ui.bImport = el('button', {
      class: 'gpn-btn gpn-btn--save gpn-btn--block', type: 'button', onclick: onImport,
    }, '匯入');

    return el('section', { class: 'gpn-section', 'data-section': 'backup' },
      el('h3', { text: '備份與同步' }),
      el('p', { class: 'gpn-lede', text:
        '所有書籤一起備份成一個檔案或一段代碼：可以額外留一份以防萬一，或把提示詞分享給別人。' +
        '（登入帳號的話，每台電腦會自動同步，不需要靠這裡搬。）' }),
      field('① 把資料帶出去', '（給另一台電腦、外掛或網頁版用）', outRow, ui.bStats),
      el('div', { class: 'gpn-sep' }),
      field('② 把資料帶回來', '（貼上代碼，或選一個備份檔）',
        ui.bCode,
        el('div', { class: 'gpn-brow' },
          el('button', {
            class: 'gpn-btn2', type: 'button',
            onclick: () => ui.bFile.click(),
          }, '📁　改用備份檔…'),
          el('button', {
            class: 'gpn-btn2', type: 'button',
            onclick: () => { ui.bCode.value = ''; disarmImport(); refreshBackupPreview(); },
          }, '清空')
        ),
        ui.bFile,
        el('div', { class: 'gpn-seg-row' }, ui.bMerge, ui.bReplace),
        ui.bModeNote,
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

  /** 解析目前輸入框的內容，把結果寫進 ui.bNote，同時回傳解析結果 */
  function refreshBackupPreview() {
    const raw = ui.bCode.value.trim();
    ui.bNote.classList.remove('is-bad', 'is-ok');

    ui.bModeNote.textContent = backupMode === 'merge'
      ? '保留你現在的提示詞，只把還沒有的加進來。'
      : '現在這台的提示詞會被整個蓋掉，換成備份裡的內容。';

    if (!raw) {
      ui.bNote.textContent = '';
      ui.bImport.disabled = true;
      return null;
    }

    const parsed = gpnParseImport(raw);
    if (!parsed.ok) {
      ui.bNote.textContent = parsed.error;
      ui.bNote.classList.add('is-bad');
      ui.bImport.disabled = true;
      return null;
    }

    ui.bImport.disabled = false;
    ui.bNote.classList.add('is-ok');
    if (backupMode === 'merge') {
      const p = gpnPreviewMerge(data, parsed.data);
      const extra = [
        p.newTabs ? `${p.newTabs} 個新書籤` : '',
        p.newFolders ? `${p.newFolders} 個新資料夾` : '',
      ].filter(Boolean).join('、');
      ui.bNote.textContent = p.added
        ? `讀到 ${parsed.itemCount} 則提示詞，其中 ${p.added} 則是新的，會加進來` +
          (extra ? `（含 ${extra}）` : '') +
          (p.skipped ? `；${p.skipped} 則重複的會跳過` : '')
        : `讀到 ${parsed.itemCount} 則提示詞，但你這台都已經有了，不會有變化`;
    } else {
      ui.bNote.textContent =
        `讀到 ${parsed.tabCount} 個書籤、${parsed.folderCount} 個資料夾、` +
        `${parsed.itemCount} 則提示詞，會取代現在的全部內容`;
    }
    return parsed;
  }

  /** 匯入會動到既有資料，所以一律二段式確認（和刪除同一套做法） */
  async function onImport() {
    const parsed = refreshBackupPreview();
    if (!parsed) { ui.bCode.focus(); return; }

    if (!impArmed) {
      impArmed = true;
      const have = gpnCountItems(data);
      armButton(ui.bImport, backupMode === 'merge'
        ? '確定合併？再按一次'
        : have ? `確定取代？現有 ${have} 則會不見，再按一次` : '確定取代？再按一次');
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
      const recent = data.recent;          // 使用記錄是自己的，不跟著備份換掉
      data = gpnNormalize(parsed.data);
      data.recent = recent;
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
    ui.bCode.value = '';
    setBackupMode('merge');          // 每次都從最安全的選項開始
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
  // openAccount：從「重設密碼」信回來時，直接打開帳號頁讓他設新密碼
  return {
    open, close, isOpen, toast,
    openAccount: () => { if (cloud && cloudState.configured) openSettings(data.activeId, 'account'); },
  };
}
