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
const GPN_APP_VERSION = '4.28.0';

/**
 * 卡片「⋮ → 開啟 Gemini／ChatGPT」時，外掛先把提示詞放在這裡，新分頁裡的 content.js 讀到就填進輸入框。
 * 網頁版沒有 chrome.storage：這台也裝了外掛的話交給外掛的 web-bridge.js 代放，沒有就只能複製後請他自己貼上。
 */
const GPN_PENDING_FILL = 'gpn_pending_fill';

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

  /** 圓圈裡一個人（外框）：設定裡的「帳號」。單一 path，理由同上面的齒輪 */
  const ICON_ACCOUNT =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM7.07 18.28c.43-.9 3.05-1.78 4.93-1.78s4.51.88 4.93 1.78C15.57 19.36 13.86 20 12 20s-3.57-.64-4.93-1.72zm11.29-1.45c-1.43-1.74-4.9-2.33-6.36-2.33s-4.93.59-6.36 2.33A7.95 7.95 0 0 1 4 12c0-4.41 3.59-8 8-8s8 3.59 8 8c0 1.82-.62 3.49-1.64 4.83zM12 6c-1.94 0-3.5 1.56-3.5 3.5S10.06 13 12 13s3.5-1.56 3.5-3.5S13.94 6 12 6zm0 5c-.83 0-1.5-.67-1.5-1.5S11.17 8 12 8s1.5.67 1.5 1.5S12.83 11 12 11z"/></svg>';

  /** 圓圈裡一個 i：分身頁右上角的說明 */
  const ICON_INFO =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<circle cx="12.8" cy="7.6" r="1.35" fill="currentColor"/>' +
    '<path d="M10.7 10.9h2.2l-1.45 5.3c-.16.62.34.86.76.5l.95-.78" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  /** 放大／縮小：兩個斜向箭頭（線條圓角） */
  const ICON_EXPAND =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4.5h5.5V10M19.5 4.5l-6 6M10 19.5H4.5V14M4.5 19.5l6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_SHRINK =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 10H14V4.5M14 10l6-6M4.5 14H10v5.5M10 14l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /** 兩個人：設定裡的「分身」 */
  const ICON_CLONE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>';

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

  /** 卡片右邊的「⋮」和它的選單：在新分頁開啟、刪除 */
  const ICON_MORE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="18.5" r="2"/></svg>';
  const ICON_OPEN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>';
  /** 警示三角形：資源回收桶最上面 */
  const ICON_WARN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>';
  /** 回收桶背景冒出來的大警示三角形（圓角三角形＋白色驚嘆號） */
  const ICON_WARN_BIG =
    '<svg viewBox="0 0 100 90" aria-hidden="true"><path d="M44 6a7 7 0 0 1 12 0l42 72a7 7 0 0 1-6 11H8a7 7 0 0 1-6-11z" fill="#e53935"/>' +
    '<rect x="45" y="28" width="10" height="34" rx="5" fill="#fff"/><circle cx="50" cy="73" r="6" fill="#fff"/></svg>';
  /** 放大鏡：搜尋 */
  const ICON_SEARCH =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>';
  /** 繞回去的箭頭：還原 */
  const ICON_RESTORE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18z"/></svg>';
  const ICON_DUPLICATE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>';
  const ICON_DELETE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

  /* 「⋯」選單的四格＋刪除（4.28.0）：Gemini、ChatGPT 用它們自己的標誌，其他是線條圖示 */
  const ICON_GEMINI =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="gpn-gemini-g" x1="4" y1="20" x2="20" y2="4" gradientUnits="userSpaceOnUse">' +
    '<stop offset="0" stop-color="#4893fc"/><stop offset=".55" stop-color="#969dff"/><stop offset="1" stop-color="#bd99fe"/></linearGradient></defs>' +
    '<path fill="url(#gpn-gemini-g)" d="M12 2.2c.55 5.2 4.6 9.25 9.8 9.8-5.2.55-9.25 4.6-9.8 9.8-.55-5.2-4.6-9.25-9.8-9.8 5.2-.55 9.25-4.6 9.8-9.8z"/></svg>';
  const ICON_CHATGPT =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zm-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.8.8 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5zm-9.66-4.13a4.47 4.47 0 0 1-.53-3.01l.14.09 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.49 4.49 0 0 1 2.37-1.98v5.68a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.87zm16.6 3.86-5.84-3.39 2.02-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.79.79 0 0 0-.4-.66zm2-3.02-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86 6.29 11.7a.08.08 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08L8.7 5.46a.79.79 0 0 0-.39.68zm1.1-2.37 2.6-1.5 2.61 1.5v3l-2.6 1.5-2.6-1.5z"/></svg>';
  const ICON_TILE_COPY =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">' +
    '<rect x="8.5" y="7.5" width="11" height="13.5" rx="2.4"/><path d="M15.5 7.5V5.4A2.4 2.4 0 0 0 13.1 3H6.9A2.4 2.4 0 0 0 4.5 5.4v9.2A2.4 2.4 0 0 0 6.9 17h1.6"/></g></svg>';
  const ICON_TILE_SHARE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 4.5 20.5 11 14 17.5"/><path d="M20.5 11h-8.5C7.4 11 4 14.3 4 19v.5"/></g></svg>';
  const ICON_TILE_DELETE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 6.5h16M9.5 6.5V4.2h5v2.3M6.3 6.5l.9 13.1a1.6 1.6 0 0 0 1.6 1.4h6.4a1.6 1.6 0 0 0 1.6-1.4l.9-13.1M10 10.5v6.5M14 10.5v6.5"/></g></svg>';
  /** 信封：收到的分享（頭像換成它，右上角是還沒看過的數字） */
  const ICON_MAIL =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="5.5" width="18" height="13" rx="2.6"/><path d="m4.2 7.4 7.8 5.7 7.8-5.7"/></g></svg>';

  /**
   * 星號的長相，照 Gmail：六種顏色的星星，和六種方塊符號（！、»、✓、i、？）。
   * [形狀, 底色, 符號色]；黃色星星跟著主題的金黃色（和以前「我的最愛」的星星一樣）。
   * 顏色寫在 style 裡：外面的 .gpn-star svg { fill: currentColor } 蓋不掉。
   */
  const MARK_LOOK = {
    'yellow-star':      ['star', 'var(--c-fav-accent)'],
    'orange-star':      ['star', '#f28b2c'],
    'red-star':         ['star', '#e5484d'],
    'purple-star':      ['star', '#a864d9'],
    'blue-star':        ['star', '#4a8af4'],
    'green-star':       ['star', '#2f9e56'],
    'red-bang':         ['bang', '#e5484d', '#ffffff'],
    'orange-guillemet': ['guillemet', '#f5a142', '#3b2100'],
    'yellow-bang':      ['bang', '#f6c342', '#3b2e00'],
    'green-check':      ['check', '#34a853', '#ffffff'],
    'blue-info':        ['info', '#5b9cf5', '#0d2447'],
    'purple-question':  ['question', '#b57be8', '#2a0f40'],
  };
  const STAR_PATH = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';

  function markIcon(m) {
    const [shape, bg, fg] = MARK_LOOK[m] || MARK_LOOK[GPN_MARK_FAV];
    const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
    if (shape === 'star') return svg(`<path style="fill:${bg}" d="${STAR_PATH}"/>`);
    const dot = `style="fill:${fg}"`;
    const line = `style="fill:none;stroke:${fg}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`;
    const glyph = {
      bang: `<rect ${dot} x="10.7" y="6" width="2.6" height="8.4" rx="1.3"/><circle ${dot} cx="12" cy="17.6" r="1.55"/>`,
      info: `<circle ${dot} cx="12" cy="7.2" r="1.6"/><rect ${dot} x="10.7" y="10" width="2.6" height="8.2" rx="1.3"/>`,
      question: `<path ${line} d="M9.3 9.4a2.8 2.8 0 1 1 4.2 2.4c-.9.5-1.5 1.1-1.5 2.1v.4"/><circle ${dot} cx="12" cy="17.7" r="1.5"/>`,
      check: `<path ${line} d="M7.2 12.4l3.2 3.2 6.4-6.6"/>`,
      guillemet: `<path ${line} d="M7 8l4 4-4 4M12.5 8l4 4-4 4"/>`,
    }[shape];
    return svg(`<rect x="2.5" y="2.5" width="19" height="19" rx="4" style="fill:${bg};stroke:rgba(0,0,0,.2)" stroke-width="1"/>${glyph}`);
  }
  /** 書籤上面那條細色帶的顏色 */
  const markAccent = (m) => (MARK_LOOK[m] || MARK_LOOK[GPN_MARK_FAV])[1];
  /** 給人看的名稱：黃色星星叫「我的最愛」 */
  const markLabel = (m) => (m === GPN_MARK_FAV ? '我的最愛' : GPN_MARK_LABELS[m] || '');

  /** 罐頭P 的 logo（戴紳士帽的 P，和網頁版的 web/logo.svg 同一筆畫）：登入畫面用 */
  const ICON_LOGO =
    '<svg viewBox="200 140 1660 1460" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="80" stroke-linecap="round" stroke-linejoin="round"><path d="M570 635 L735 285 C760 232 782 212 822 222 C880 236 955 276 1012 280 C1068 283 1150 228 1196 210 C1232 197 1252 212 1268 240 L1340 385"/><path d="M1455 640 C1570 600 1720 562 1762 520 C1795 486 1745 466 1650 467 C1500 470 1350 500 1200 526 C950 570 700 612 520 662 C380 702 245 762 268 815 C290 862 420 842 560 815 C800 770 1050 724 1215 724 C1405 726 1508 805 1500 925 C1490 1085 1250 1152 950 1180 C912 1184 902 1205 902 1240 L902 1390 C902 1470 800 1522 720 1525 C640 1528 595 1478 595 1420 L595 895"/></g></svg>';

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
  // 分身（設定 → 分身）：clones 是建立過的分身；cPick 是正在勾選的 { mode: 'create' | 'push', clone, tabs, folders, items, open }
  const hasClones = () => !!cloud && typeof cloud.listClones === 'function' && !!GPN_CLOUD.cloneUrl;
  let clones = null, clonesBusy = false, cPick = null, cDelArmed = '', cDelTimer = 0, leaveArmed = false;
  // 分享（卡片「⋯ → 分享」）：sharing 是正在分享的 { item, peers, picked }；信箱見 cloudState.inbox
  let sharing = null;
  let lastAdopt = null;      // 上次「採用」放到哪裡 { tabId, folderId }：下次預設同一個地方
  let cAvatarOpen = '';          // 哪個分身的「換頭像」打開著（分身代號）
  let cExtendOpen = '';          // 哪個分身的「延長期限」打開著（分身代號）
  const hasAvatars = () => typeof GPN_AVATARS !== 'undefined';
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
    id: GPN_FAV_ID, label: '我的最愛', color: 'fav', fixed: true, mark: GPN_MARK_FAV, items: [],
  });
  /** 設定 → 星號 裡「使用中」的其他符號，每一種一個書籤，在「我的最愛」左邊 */
  const markTab = (m) => ({
    id: GPN_MARK_TAB + m, label: GPN_MARK_LABELS[m], color: 'mark', fixed: true, mark: m, items: [],
  });
  /** 資源回收桶：不在書籤列上，從 設定 最下面點進來 */
  const trashTab = () => ({
    id: GPN_TRASH_ID, label: '資源回收桶', color: 'trash', fixed: true, trash: true, items: [],
  });
  const tabById = (id) => (id === GPN_RECENT_ID ? recentTab()
    : id === GPN_TRASH_ID ? trashTab()
    : id === GPN_FAV_ID ? favTab()
    : (data.markTypes || []).includes(gpnMarkOfTab(id)) ? markTab(gpnMarkOfTab(id))
    : data.tabs.find((t) => t.id === id));
  const activeTab = () => tabById(data.activeId) || data.tabs[0];
  /** 這則標了哪種符號（沒有是空字串）；連續點星號時照「黃色星星、再來使用中的順序」輪流換 */
  const markOf = (id) => gpnMarkOf(data, id);
  const marksInUse = () => [GPN_MARK_FAV, ...(data.markTypes || [])];
  const markedIds = (m) => (m === GPN_MARK_FAV ? data.favs : data.marks?.[m]) || [];
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

  /* ---- 音效 ----
     點書籤、換資料夾、用提示詞、加星號、儲存、刪除、拖曳…都有一個很短的聲音。
     全部用 Web Audio 當場合成（幾個正弦波、三角波），不用音檔，外掛和網頁版都一樣。
     （4.22.0 起拿掉了「設定 → 音效」那一頁：音效一律開著。）
     瀏覽器規定要使用者先點過東西才能出聲，所以第一次播的時候才建 AudioContext。 */
  const soundOn = true;
  let audio = null;

  function audioCtx() {
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio = new AC();
    }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }

  /** 一個音：頻率 f（可以滑到 f2）、長度 dur 秒、波形、音量、延遲幾秒才響 */
  function tone(a, { f, f2 = 0, dur = 0.08, type = 'sine', gain = 0.1, delay = 0 }) {
    const t = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  const SOUNDS = {
    tab:    [{ f: 480, f2: 720, dur: 0.11, type: 'triangle', gain: 0.09 }],                     // 翻到另一個書籤
    folder: [{ f: 620, f2: 820, dur: 0.07, type: 'triangle', gain: 0.07 }],
    copy:   [{ f: 880, dur: 0.09, gain: 0.08 }, { f: 1320, dur: 0.16, gain: 0.06, delay: 0.07 }],  // 叮咚
    star:   [{ f: 1046, dur: 0.07, gain: 0.06 }, { f: 1318, dur: 0.07, gain: 0.05, delay: 0.05 },
             { f: 1568, dur: 0.14, gain: 0.05, delay: 0.1 }],                                      // 閃一下
    unstar: [{ f: 700, f2: 420, dur: 0.13, type: 'triangle', gain: 0.07 }],
    click:  [{ f: 520, dur: 0.04, type: 'triangle', gain: 0.06 }],
    open:   [{ f: 360, f2: 640, dur: 0.13, gain: 0.07 }],
    save:   [{ f: 660, dur: 0.08, gain: 0.07 }, { f: 990, dur: 0.18, gain: 0.06, delay: 0.07 }],
    del:    [{ f: 240, f2: 110, dur: 0.2, type: 'triangle', gain: 0.12 }],
    pick:   [{ f: 300, f2: 520, dur: 0.07, type: 'triangle', gain: 0.06 }],
    drop:   [{ f: 520, f2: 300, dur: 0.09, type: 'triangle', gain: 0.07 }],
  };

  /**
   * 錄好的音效（sounds.js，data: 網址）：有的話用它，沒有才用上面合成的。
   * 換書籤用真的「卡嚓」聲（使用者挑的）。第一次播的時候才解碼，之後重複用同一份。
   */
  const SAMPLES = { tab: typeof GPN_SOUND_TAB !== 'undefined' ? GPN_SOUND_TAB : '' };
  const decoded = {};

  function sample(a, name) {
    if (!decoded[name]) {
      // 不用 fetch：外掛在 AI 網站裡時，網站的安全設定可能擋掉 data: 網址
      const b64 = SAMPLES[name].split(',')[1];
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      decoded[name] = a.decodeAudioData(bytes.buffer);
    }
    return decoded[name].then((buf) => {
      const src = a.createBufferSource();
      const g = a.createGain();
      g.gain.value = 0.9;
      src.buffer = buf;
      src.connect(g).connect(a.destination);
      src.start();
    });
  }

  function sfx(name) {
    if (!soundOn || !(SAMPLES[name] || SOUNDS[name])) return;
    try {
      const a = audioCtx();
      if (!a) return;
      if (SAMPLES[name]) sample(a, name).catch(() => { for (const n of SOUNDS[name] || []) tone(a, n); });
      else for (const n of SOUNDS[name]) tone(a, n);
    } catch { /* 沒聲音就算了，不影響操作 */ }
  }

  /* ==========================================================================
     一、骨架
     ========================================================================== */

  function build() {
    ui.list = el('div', { class: 'gpn-list', role: 'list' });
    ui.tabs = el('div', { class: 'gpn-tabs', role: 'tablist' });
    ui.tabEls = new Map();        // id → 書籤元素（切換時要重複使用才有動畫）
    // 筆記本變寬變窄（拖邊緣、視窗縮放）時，重新決定書籤要不要擠一點（見 layoutTabs）
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => layoutTabs()).observe(ui.tabs);

    /* ---- 底部右邊的齒輪：設定 ----
       也兼當雲端同步的狀態燈（見 paintGear）：以前旁邊還有一顆雲朵鈕，狀態都已經整合進設定，就拿掉了。
       有狀況（沒連上、同步失敗）時右上角會有一個點，點齒輪直接打開「雲端同步」那一頁。 */
    ui.gearIcon = el('span', { class: 'gpn-gear-icon', html: ICON_GEAR });
    ui.gear = el('button', {
      class: 'gpn-tool gpn-gear', type: 'button', title: '設定', 'aria-label': '設定',
      onclick: () => openSettings(data.activeId, ui.gear.getAttribute('data-alert') ? 'account' : 'tab'),
    }, ui.gearIcon, el('span', { class: 'gpn-gear-dot', 'aria-hidden': 'true' }));

    /* ---- 齒輪左邊：登入中的 Google 帳號頭像 ----
       有兩個帳號時一眼看得出現在是哪一個。和齒輪一樣大、排在同一列，點了打開「雲端同步」。 */
    ui.avatar = el('button', {
      class: 'gpn-tool gpn-avatar', type: 'button', hidden: '',
      onclick: () => (inboxOf().length ? openInbox() : openSettings(data.activeId, 'account')),
    });

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

    /* ---- 搜尋：齒輪左邊的放大鏡；按了紙張最上面出現搜尋列 ---- */
    ui.searchBtn = el('button', {
      class: 'gpn-tool gpn-search-btn', type: 'button', title: '搜尋所有提示詞', 'aria-label': '搜尋',
      html: ICON_SEARCH, onclick: enterSearch,
    });
    ui.searchInput = el('input', {
      class: 'gpn-search-input', type: 'search', placeholder: '搜尋標題或內容…', 'aria-label': '搜尋提示詞',
      oninput: () => { searchQ = ui.searchInput.value; renderList(); },
      onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); exitSearch(); } },
    });
    ui.searchBar = el('div', { class: 'gpn-search-bar', hidden: '' },
      el('span', { class: 'gpn-search-icon', html: ICON_SEARCH }),
      ui.searchInput,
      el('button', {
        class: 'gpn-search-close', type: 'button', title: '離開搜尋', 'aria-label': '離開搜尋',
        html: ICON_CLOSE, onclick: () => exitSearch(),
      }));

    ui.book = el('div', { class: 'gpn-book' },
      ui.tabs,
      el('div', { class: 'gpn-paper' },
        notice ? el('div', { class: 'gpn-notice', role: 'alert', text: notice }) : null,
        ui.searchBar,
        ui.trashTop = el('div', { class: 'gpn-trash-top', hidden: '' },
          el('button', {
            class: 'gpn-trash-back', type: 'button', title: '回到設定', onclick: () => leaveTrash(true),
          }, el('span', { class: 'gpn-trash-back-arrow', text: '←' }), el('span', { text: '回到設定' })),
          el('div', { class: 'gpn-trash-title' },
            el('span', { class: 'gpn-trash-sign', html: ICON_WARN }),
            el('b', { text: '資源回收桶' }),
            ui.trashCount = el('span', { class: 'gpn-trash-count' })),
          ui.trashEmpty = el('button', {
            class: 'gpn-trash-empty', type: 'button', onclick: onTrashEmpty,
          }, '清空')),
        el('div', { class: 'gpn-body' },
          el('nav', { class: 'gpn-folders' }, ui.folderList),
          ui.list),
        el('div', { class: 'gpn-foot' },
          // 最左邊：登入中的 Google 帳號頭像
          ui.avatar,
          ui.addBtn = el('button', {
            class: 'gpn-add', type: 'button',
            onclick: () => openEditor(data.activeId, activeFolder()?.id ?? null, null),
          }, '＋ 新增提示詞'),
          // 「最近使用」書籤底下換成這顆（按兩次才會清）
          ui.clearRecentBtn = el('button', {
            class: 'gpn-add gpn-add--quiet', type: 'button', hidden: '',
            onclick: onClearRecent,
          }, '清除全部使用記錄'),
          // 資源回收桶裡換成這兩顆：還原選取的、永久刪除（沒選取時是清空）
          ui.trashRestore = el('button', {
            class: 'gpn-add gpn-add--restore', type: 'button', hidden: '',
            onclick: () => restoreTrash([...trashSel]),
          }, '還原'),
          ui.trashPurge = el('button', {
            class: 'gpn-add gpn-add--danger', type: 'button', hidden: '', onclick: onTrashPurge,
          }, '永久刪除'),
          el('div', { class: 'gpn-tools' }, ui.searchBtn, ui.gear)
        )
      )
    );

    // 左右兩邊可以拖曳調整寬度（見「筆記本寬度」）
    ui.book.append(buildGutter('left'), buildGutter('right'));
    buildCardMenu();

    // 「全部提示詞」（網頁版的 all.html）以前在筆記本左下角外面，4.20.0 起收進 設定 的左邊選單

    ui.overlay = el('div', {
      class: 'gpn-overlay', role: 'dialog', 'aria-modal': standalone ? null : 'true',
      'aria-label': '罐頭P',
      onmousedown: (e) => { if (!standalone && e.target === ui.overlay) close(); },
    }, ui.book);
    // 雲端的狀態還沒拿到之前先別露出筆記本（不然沒登入的人會先閃一下內容），最多等 3 秒
    if (cloud) {
      buildGate();
      ui.overlay.classList.add('is-waiting');
      setTimeout(() => ui.overlay.classList.remove('is-waiting'), 3000);
    }

    ui.toast = el('div', { class: 'gpn-toast', role: 'status' });

    buildEditLayer();
    buildNewTabLayer();
    buildFolderLayer();
    buildSettingsLayer();
    if (hasClones()) { buildShareLayer(); buildInboxLayer(); }
    // 信箱放在編輯視窗前面：在信箱按「採用」打開的編輯視窗，要蓋在信箱上面
    root.append(...[ui.overlay, ui.inboxLayer, ui.editLayer, ui.newTabLayer, ui.folderLayer, ui.settingsLayer, ui.cPickLayer,
      ui.shareLayer, ui.toast].filter(Boolean));
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
     最右邊的符號、「我的最愛」「最近使用」只有圖示，寬度固定（見 styles.css 的 .gpn-tab.is-fixed）。 */
  const GPN_TAB_SHARE = { 1: 0.40, 2: 0.60, 3: 0.75, 4: 0.86, 5: 0.90, 6: 0.93, 7: 0.95, 8: 0.96 };
  const GPN_TAB_GAP = 4;          // .gpn-tabs 的 gap
  const GPN_TAB_ADD_W = 44;       // 「＋」按鈕的寬度＋左邊距
  const GPN_TAB_FIXED_W = 58;     // 一個固定書籤的寬度（要和 styles.css 的 .gpn-tab.is-fixed 一致）
  const GPN_TAB_MARK_W = 50;      // 符號書籤窄一點（要和 styles.css 的 .gpn-tab.is-mark 一致）

  const GPN_TAB_MIN_W = 54;       // 自己的書籤最窄多少（styles.css 的 .gpn-tab min-width）

  function layoutTabs() {
    const n = data.tabs.length;
    if (!n) return;
    // 先扣掉空隙、「＋」按鈕和固定書籤，自己的書籤再照比例分剩下的寬度，才不會擠出紙張外
    const marks = (data.markTypes || []).length;
    const items = n + 2 + marks + (ui.addTabBtn ? 1 : 0);
    const reserveWith = (fixedW, markW) => GPN_TAB_GAP * (items - 1) + (ui.addTabBtn ? GPN_TAB_ADD_W : 0) +
      fixedW * 2 + markW * marks;
    // 書籤很多、又開了好幾種符號（或筆記本拉得很窄）時放不下：只有圖示的那幾個先縮窄
    const width = parseFloat(getComputedStyle(ui.tabs).width) || 0;
    const crowded = width > 0 && reserveWith(GPN_TAB_FIXED_W, GPN_TAB_MARK_W) + GPN_TAB_MIN_W * n > width;
    // 還是放不下（書籤滿 8 個、符號也開滿 6 種）：每一個都再縮到最窄（styles.css 的 .is-squeezed）
    const squeezed = crowded && reserveWith(44, 40) + 44 * n > width;
    ui.tabs.classList.toggle('is-crowded', crowded);
    ui.tabs.classList.toggle('is-squeezed', squeezed);
    const reserve = squeezed ? reserveWith(34, 32) : crowded ? reserveWith(44, 40) : reserveWith(GPN_TAB_FIXED_W, GPN_TAB_MARK_W);
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
    paintBookColor(tab);

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
    if (searchQ !== null && id !== data.activeId) exitSearch(false);
    if (id === data.activeId) { if (searchQ !== null) { exitSearch(); } return; }
    sfx('tab');
    trashSel = new Set();
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
    sfx('folder');
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
        onclick: () => switchTab(t.id),          // 搜尋中點目前的書籤＝離開搜尋
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
        anchor: () => ui.addTabBtn || ui.tabs.querySelector('.gpn-tab.is-fixed'),
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

    // 最右邊固定：自己開的符號（設定 → 星號）、「我的最愛」「最近使用」。
    // 不能刪；自己的書籤拖不到它們後面。符號書籤之間可以長按左右拖，換的就是連續點星號時的順序
    const fixed = (data.markTypes || []).map((m) => {
      const node = fixedTabNode(GPN_MARK_TAB + m, 'mark', GPN_MARK_LABELS[m], markIcon(m),
        `${GPN_MARK_LABELS[m]}（連續點提示詞右邊的星號，換到這個符號就會收進這裡；長按可以左右拖曳排順序）`, 'is-mark');
      node.style.setProperty('--mark-accent', markAccent(m));
      attachHoldDrag({
        handle: node.querySelector('.gpn-tab-main'), node, box: ui.tabs, selector: '.gpn-tab.is-mark',
        anchor: () => ui.tabEls.get(GPN_FAV_ID),           // 拖到最後面：排在「我的最愛」前面
        vertical: () => false,
        canStart: () => (data.markTypes || []).length > 1,
        onDrop: (order) => setMarkOrder(order.map(gpnMarkOfTab)),
      });
      return node;
    });
    fixed.push(
      fixedTabNode(GPN_FAV_ID, 'fav', '我的最愛', ICON_STAR, '我的最愛（在提示詞右邊按星號，就會收進這裡）'),
      fixedTabNode(GPN_RECENT_ID, 'recent', '最近使用', ICON_HISTORY, `最近使用（最近用過的 ${GPN_RECENT_MAX} 則）`));
    ui.tabs.append(...fixed);

    paintBookColor(tab);
    layoutTabs();
  }

  /** 筆記本跟著作用中的書籤換重點色；符號書籤的顏色是那個符號的顏色 */
  function paintBookColor(tab) {
    ui.book.setAttribute('data-color', tab.color);
    ui.book.style.setProperty('--mark-accent', tab.color === 'mark' ? markAccent(tab.mark) : '');
  }

  /** 固定書籤（符號、我的最愛、最近使用）：只有圖示，名稱放在滑鼠提示和讀螢幕軟體用的 aria-label */
  function fixedTabNode(id, color, label, icon, title, extraClass = '') {
    const on = activeTab().id === id;
    const node = el('div', {
      class: 'gpn-tab is-fixed' + (extraClass ? ' ' + extraClass : '') + (on ? ' is-active' : ''),
      'data-color': color, 'data-id': id,
      onanimationend: () => node.classList.remove('is-popping'),
    }, el('button', {
      class: 'gpn-tab-main', type: 'button', role: 'tab', 'aria-selected': String(on),
      'aria-label': label, title,
      onclick: () => switchTab(id),
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
        el('span', { class: 'gpn-folder-count', text: String(f.items.length) })
      );

      // 平常右邊顯示有幾則；滑鼠移到這一格時，數量的位置換成鉛筆（styles.css 的 .gpn-folder:hover）
      const row = el('div', { class: 'gpn-folder' + (on ? ' is-active' : ''), 'data-id': f.id },
        main,
        el('button', {
          class: 'gpn-folder-edit', type: 'button',
          title: '資料夾設定（改名／刪除）', 'aria-label': `資料夾「${f.label}」設定`,
          html: ICON_PENCIL,
          onclick: () => openFolderEditor(f.id),
        })
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
    closeCardMenu();
    // 底部按鈕：一般書籤是「新增提示詞」，「最近使用」換成「清除全部使用記錄」，「我的最愛」和符號都沒有
    // （右邊的雲端、設定圖示一直都在）
    const searching = searchQ !== null;
    // 資源回收桶是一個獨立的空間：上面的書籤、底下的頭像、搜尋、設定都收起來（styles.css 的 .is-trash）
    const inTrash = !!tab.trash && !searching;
    ui.book.classList.toggle('is-trash', inTrash);
    ui.trashTop.hidden = !inTrash;
    paintTrashFx(inTrash);
    ui.addBtn.hidden = !!tab.fixed || searching;
    ui.clearRecentBtn.hidden = !tab.recent || searching;
    ui.trashRestore.hidden = ui.trashPurge.hidden = true;
    disarmClearRecent();
    if (searching) { renderSearch(); return; }
    if (tab.trash) { renderTrash(); return; }
    if (tab.recent) { renderRecent(); return; }
    if (tab.mark) { renderMarked(tab.mark); return; }

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
   * 一則提示詞的卡片：把手、標題、星號（我的最愛和其他符號）、鉛筆、⋯（用 AI 開啟、刪除）。
   * from：在「我的最愛」或符號書籤裡顯示時傳「從哪個書籤來的」；
   * sortList：那個書籤的 id，拖曳排序改排它自己的順序，不動提示詞在原本書籤裡的位置。
   */
  function buildCard(item, tabId, fid, from = null, sortList = null, noDrag = false) {
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
      onclick: (e) => { e.stopPropagation(); cycleMark(item, starBtn); },
    });
    paintStar(starBtn, item);

    const editBtn = el('button', {
      class: 'gpn-edit', type: 'button', title: '編輯', 'aria-label': `編輯 ${item.title}`,
      html: ICON_PENCIL,
      onclick: (e) => { e.stopPropagation(); openEditor(tabId, fid, item.id); },
    });

    const moreBtn = el('button', {
      class: 'gpn-more', type: 'button', title: '更多：用 Gemini、ChatGPT 開啟、拷貝、分享，或刪除',
      'aria-label': `更多動作：${item.title}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
      html: ICON_MORE,
      onclick: (e) => { e.stopPropagation(); toggleCardMenu(moreBtn, item, tabId, fid); },
    });

    const card = el('div', { class: 'gpn-card', role: 'listitem', 'data-id': item.id },
      grip, titleBtn, starBtn, editBtn, moreBtn);
    if (noDrag) grip.classList.add('is-off');          // 搜尋結果：順序是搜出來的，不能拖
    else if (sortList) attachDrag(grip, card, sortList, null);
    else attachDrag(grip, card, tabId, fid, true);
    return card;
  }

  function paintStar(btn, item) {
    const m = markOf(item.id);
    const order = marksInUse();
    btn.classList.toggle('is-on', !!m);
    btn.innerHTML = m ? markIcon(m) : ICON_STAR_OUTLINE;
    // 只用黃色星星（預設）時和以前一樣是開關；開了其他符號，提示「再點一下會變成什麼」
    const next = m && !order.includes(m) ? '' : order[order.indexOf(m) + 1] || '';
    btn.title = !m ? '加入「我的最愛」' + (order.length > 1 ? '（連續點可以換成其他符號）' : '')
      : m === GPN_MARK_FAV && !next ? '從「我的最愛」移除'
      : `${markLabel(m)}（再點一下：${next ? markLabel(next) : '取消'}）`;
    btn.setAttribute('aria-label', `${btn.title}：${item.title}`);
    btn.setAttribute('aria-pressed', String(!!m));
  }

  /* ==========================================================================
     「我的最愛」和其他符號：在任何提示詞右邊按星號收進來，集中在一個書籤；可以拖曳排自己的順序。
     和 Gmail 的星號一樣，連續點會照設定裡「使用中」的順序換成下一種符號，換完一輪就取消。
     提示詞本身還是留在原本的書籤（見 store.js），在這裡編輯改的就是原本那則。
     ========================================================================== */

  /** 把這則的符號換成 m（空字串＝拿掉）。一則只會有一種符號 */
  function setMark(id, m) {
    data.favs = (data.favs || []).filter((x) => x !== id);
    const marks = {};
    for (const [k, ids] of Object.entries(data.marks || {})) {
      const rest = ids.filter((x) => x !== id);
      if (rest.length) marks[k] = rest;
    }
    if (m === GPN_MARK_FAV) data.favs.push(id);
    else if (m) marks[m] = [...(marks[m] || []), id];
    data.marks = marks;
  }

  function cycleMark(item, btn) {
    const order = marksInUse();
    const cur = markOf(item.id);
    // 標的是已經不用的符號（設定裡移到「沒使用」了）：點一下就拿掉
    const next = cur && !order.includes(cur) ? '' : order[order.indexOf(cur) + 1] || '';
    sfx(next ? 'star' : 'unstar');
    setMark(item.id, next);
    persist();
    // 在「我的最愛」、符號書籤裡換掉：那張卡片直接拿掉；在一般書籤：只換星號，不重畫（捲動位置不會跳）
    if (activeTab().mark) renderList();
    else paintStar(btn, item);
    toast(next === GPN_MARK_FAV ? '已加入「我的最愛」'
      : next ? `已換成「${GPN_MARK_LABELS[next]}」`
      : cur === GPN_MARK_FAV ? '已從「我的最愛」移除（提示詞本身還在）'
      : '已拿掉符號（提示詞本身還在）');
  }

  function renderMarked(m) {
    const where = indexItems();
    const found = markedIds(m).map((id) => where.get(id)).filter(Boolean);

    ui.list.replaceChildren();
    if (!found.length) {
      const fav = m === GPN_MARK_FAV;
      ui.list.append(
        el('div', { class: 'gpn-empty' },
          fav ? el('div', { class: 'gpn-empty-emoji', text: '⭐' })
            : el('div', { class: 'gpn-empty-emoji gpn-empty-mark', html: markIcon(m) }),
          el('div', { class: 'gpn-empty-title', text: fav ? '還沒有我的最愛' : `還沒有標「${GPN_MARK_LABELS[m]}」的提示詞` }),
          el('div', { class: 'gpn-empty-desc', text: fav
            ? '在任何一則提示詞右邊按「☆」，就會收進這裡，不用再到處找'
            : '連續點提示詞右邊的星號，換到這個符號，就會收進這裡' })
        )
      );
      return;
    }
    const sortList = m === GPN_MARK_FAV ? GPN_FAV_ID : GPN_MARK_TAB + m;
    for (const f of found) {
      const from = f.tab.label + (f.folder ? ` › ${f.folder.label}` : '');
      ui.list.append(buildCard(f.it, f.tab.id, f.folder ? f.folder.id : null, from, sortList));
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
        onclick: () => usePrompt(item, card, '', '', true),
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

  /**
   * fromRecent：在「最近使用」裡點的。這時不重新記一次，順序才不會跳：
   * 不然點第三則，它會瞬間跑到第一則、Copied 也跟著跑到最上面；一直點最後一則還會整排輪流換位置。
   */
  async function usePrompt(item, card, tabId, fid, fromRecent = false) {
    const r = (await onUse(item)) || {};
    if (!r.bad) sfx('copy');
    if (!fromRecent) recordUse(item, tabId, fid);
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
  /** ms：要停多久；有操作說明、字比較多的訊息給久一點 */
  function toast(msg, bad = false, ms = 0) {
    ui.toast.textContent = msg;
    ui.toast.classList.toggle('is-bad', bad);
    ui.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('is-on'), ms || (bad ? 4200 : 2200));
  }

  /* ==========================================================================
     卡片右邊的「⋯」（4.28.0 起是四格＋最下面一條）：
       左上 Gemini、右上 ChatGPT（在新分頁打開）、左下 拷貝、右下 分享，最下面 刪除
     只有圖示，名稱在滑鼠提示（title）和讀螢幕軟體用的 aria-label。
     選單只有一個，放在筆記本上（不放在卡片裡：卡片的清單會捲動、會切掉超出去的部分），
     打開時對齊按下去的那顆「⋯」，下面放不下就往上開。資源回收桶的「⋮」還是一行一行的清單。
     ========================================================================== */

  let menuFor = null;                 // 選單目前開在哪一顆「⋯」上
  let menuDelArmed = false, menuDelTimer = 0;

  const isMac = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  const PASTE_KEY = isMac ? '⌘＋V' : 'Ctrl＋V';
  const AI_SITES = {
    gemini:  { label: 'Gemini',  url: 'https://gemini.google.com/app' },
    chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/' },
  };
  /** 外掛（AI 網站裡的面板、工具列小視窗）才有 chrome.storage，可以把提示詞交給新分頁自動填入 */
  const canHandOff = typeof chrome !== 'undefined' && !!chrome.storage?.local;
  /** 網頁版：這台電腦也裝了外掛的話，外掛的 web-bridge.js 會在 <html> 標上 data-gpn-ext，可以借它代填 */
  const hasBridge = () => !canHandOff && document.documentElement.hasAttribute('data-gpn-ext');
  const autoFills = () => canHandOff || hasBridge();

  /** 網頁版把提示詞交給外掛（src/web-bridge.js）；外掛收好了才回 true，等太久當作沒有 */
  function handOffToExtension(site, text) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const done = (ok) => { window.removeEventListener('message', onReply); clearTimeout(timer); resolve(ok); };
      const onReply = (e) => {
        if (e.source === window && e.data?.type === 'gpn-pending-fill-ok' && e.data.id === id) done(!!e.data.ok);
      };
      const timer = setTimeout(() => done(false), 800);
      window.addEventListener('message', onReply);
      window.postMessage({ type: 'gpn-pending-fill', id, site, text }, location.origin);
    });
  }

  function buildCardMenu() {
    ui.menu = el('div', { class: 'gpn-menu', role: 'menu', hidden: '', onkeydown: onMenuKey });
    ui.book.append(ui.menu);
    // 點選單外面就關（點同一顆「⋯」交給它自己的 onclick 關）
    root.addEventListener('pointerdown', (e) => {
      if (menuFor && !ui.menu.contains(e.target) && !menuFor.contains(e.target)) closeCardMenu();
    }, true);
    ui.list.addEventListener('scroll', () => closeCardMenu(), { passive: true });
    ui.list.addEventListener('click', (e) => {
      if (activeTab().trash && e.target === ui.list && trashSel.size) { trashSel = new Set(); paintTrashSelection(); }
    });
    window.addEventListener('resize', () => closeCardMenu());
  }

  function toggleCardMenu(btn, item, tabId, fid) {
    if (menuFor === btn) { closeCardMenu(); return; }
    closeCardMenu();
    sfx('click');
    const card = btn.closest('.gpn-card');
    const open = (site) => () => { closeCardMenu(); openInAI(site, item, card, tabId, fid); };
    const fills = autoFills() ? '（在新分頁打開，自動填好）' : '（在新分頁打開）';

    openMenuWith(btn, [
      menuTile(ICON_GEMINI, '開啟 Gemini' + fills, open('gemini')),
      menuTile(ICON_CHATGPT, '開啟 ChatGPT' + fills, open('chatgpt')),
      menuTile(ICON_TILE_COPY, '拷貝（在下面多一則一樣的）', () => { closeCardMenu(); duplicateItem(tabId, fid, item.id); }),
      menuTile(ICON_TILE_SHARE, '分享（給主人、分身）', () => { closeCardMenu(); openShare(item); }),
      menuTile(ICON_TILE_DELETE, '刪除（先放進資源回收桶）', () => {
        closeCardMenu();
        deleteItem(tabId, fid, item.id);
        toast(`已把「${item.title}」移到資源回收桶（設定 → 資源回收桶 可以還原）`, false, 4200);
      }, ' gpn-menu-tile--wide gpn-menu-tile--del'),
    ], true);
  }

  /** 選單裡的一格：只有圖示 */
  function menuTile(icon, label, onclick, cls = '') {
    return el('button', {
      class: 'gpn-menu-item gpn-menu-tile' + cls, type: 'button', role: 'menuitem',
      title: label, 'aria-label': label, html: icon, onclick,
    });
  }

  function menuEntry(icon, text, sub, onclick, cls = '') {
    return el('button', {
      class: 'gpn-menu-item' + cls, type: 'button', role: 'menuitem', onclick,
    }, el('span', { class: 'gpn-menu-icon', html: icon }),
      el('span', { class: 'gpn-menu-text' }, el('span', { text }), sub ? el('small', { text: sub }) : null));
  }

  /** grid：四格的那種（卡片的「⋯」）；不然是一行一行的清單 */
  function openMenuWith(btn, nodes, grid = false) {
    const card = btn.closest('.gpn-card');
    ui.menu.replaceChildren(...nodes);
    ui.menu.classList.toggle('is-grid', grid);
    menuFor = btn;
    btn.setAttribute('aria-expanded', 'true');
    card?.classList.add('has-menu');
    ui.menu.hidden = false;
    placeMenu(btn);
    ui.menu.querySelector('.gpn-menu-item').focus({ preventScroll: true });
  }

  /**
   * 選單的位置以筆記本為準。網頁版整個放大 140%：畫面上量到的距離要換算回筆記本自己的 px
   * （和「筆記本寬度」的拖曳同一個算法）。
   */
  function placeMenu(btn) {
    const book = ui.book.getBoundingClientRect();
    const scale = book.width / parseFloat(getComputedStyle(ui.book).width) || 1;
    const b = btn.getBoundingClientRect();
    const h = ui.menu.getBoundingClientRect().height / scale;
    const bookH = book.height / scale;
    let top = (b.bottom - book.top) / scale - 2;
    if (top + h > bookH - 8) top = (b.top - book.top) / scale - h + 2;
    ui.menu.style.top = `${Math.max(8, top)}px`;
    ui.menu.style.right = `${Math.max(8, (book.right - b.right) / scale)}px`;
  }

  function closeCardMenu() {
    clearTimeout(menuDelTimer);
    menuDelArmed = false;
    if (!menuFor) return;
    menuFor.setAttribute('aria-expanded', 'false');
    menuFor.closest('.gpn-card')?.classList.remove('has-menu');
    menuFor = null;
    ui.menu.hidden = true;
  }

  /** 選單裡用方向鍵移動：清單只看上下（頭尾相接）；四格的往按的方向找最近的一格 */
  function onMenuKey(e) {
    const dir = { ArrowDown: [0, 1], ArrowUp: [0, -1], ArrowRight: [1, 0], ArrowLeft: [-1, 0] }[e.key];
    if (!dir) return;
    const items = [...ui.menu.querySelectorAll('.gpn-menu-item')];
    const i = items.indexOf(root.activeElement);
    if (!ui.menu.classList.contains('is-grid')) {
      if (!dir[1]) return;
      e.preventDefault();
      items[(i + dir[1] + items.length) % items.length].focus();
      return;
    }
    e.preventDefault();
    if (i < 0) { items[0]?.focus(); return; }
    const mid = (n) => { const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const [cx, cy] = mid(items[i]);
    let best = null, bestD = Infinity;
    for (const n of items) {
      if (n === items[i]) continue;
      const [x, y] = mid(n);
      const along = dir[0] ? (x - cx) * dir[0] : (y - cy) * dir[1];
      if (along <= 1) continue;
      const d = along + 2 * (dir[0] ? Math.abs(y - cy) : Math.abs(x - cx));
      if (d < bestD) { bestD = d; best = n; }
    }
    best?.focus();
  }

  /**
   * 用 AI 開啟：一律先複製（保險）、記進「最近使用」。
   *   Gemini、ChatGPT：開新分頁。外掛會把提示詞交給新分頁的 content.js 自動填好（不會自動送出）；
   *                    網頁版自己做不到（同源政策）：這台也裝了外掛就借外掛代填，沒有就請他自己貼上
   */
  async function openInAI(site, item, card, tabId, fid) {
    const copied = await gpnShareCopy(item.content);
    if (copied) sfx('copy');
    recordUse(item, tabId, fid);

    const s = AI_SITES[site];
    let fills = false;
    if (canHandOff) {
      try {
        await chrome.storage.local.set({ [GPN_PENDING_FILL]: { site, text: item.content, at: Date.now() } });
        fills = true;
      } catch { /* 外掛剛更新過、這一頁還是舊的：退回自己貼上 */ }
    } else if (hasBridge()) {
      fills = await handOffToExtension(site, item.content);
    }
    const w = window.open(s.url, '_blank');
    if (!w) {
      toast(`瀏覽器擋住了新分頁，請自己打開 ${s.label}` + (copied ? `，提示詞已複製，按 ${PASTE_KEY} 貼上` : ''), true, 7000);
      return;
    }
    try { w.opener = null; } catch { /* 跨網域時本來就碰不到 */ }
    toast(fills ? `已在新分頁打開 ${s.label}，提示詞會自動填進輸入框（不會自動送出）`
      : copied ? `已在新分頁打開 ${s.label}，提示詞已複製，在輸入框按 ${PASTE_KEY} 貼上`
      : `已在新分頁打開 ${s.label}`, false, 6000);
  }

  /** 選單裡的「刪除」：和編輯畫面的刪除一樣要按兩次 */
  function onMenuDelete(item, tabId, fid) {
    const text = ui.menuDel.querySelector('.gpn-menu-text > span');
    if (!menuDelArmed) {
      menuDelArmed = true;
      ui.menuDel.classList.add('is-confirm');
      text.textContent = '確定刪除？再按一次';
      clearTimeout(menuDelTimer);
      menuDelTimer = setTimeout(() => {
        menuDelArmed = false;
        ui.menuDel.classList.remove('is-confirm');
        text.textContent = '刪除';
      }, 4000);
      return;
    }
    closeCardMenu();
    deleteItem(tabId, fid, item.id);
    toast(`已刪除「${item.title}」`);
  }

  /**
   * 拷貝：在這一則正下方多一則一模一樣的，標題後面加「 (複製)」，內容不變。
   * 新的那則不帶星號（我的最愛、符號只在原本那則上）。在我的最愛、符號書籤裡拷貝，新的放在原本那則所在的書籤。
   */
  function duplicateItem(tabId, fid, id) {
    const list = listOf(tabId, fid);
    const idx = list ? list.items.findIndex((it) => it.id === id) : -1;
    if (idx < 0) return;
    const src = list.items[idx];
    const copy = { id: gpnNewId(), title: `${src.title} (複製)`.slice(0, 60), content: src.content };
    list.items.splice(idx + 1, 0, copy);
    sfx('save');
    persist();
    render();
    toast(activeTab().mark ? `已拷貝到「${whereLabel(tabId, fid)}」` : '已拷貝，在原本那則的下面');
  }

  /**
   * 刪掉一則提示詞：先放進資源回收桶（記著原本在哪、標了什麼符號），我的最愛、符號裡的也一起拿掉。
   * 最近使用記錄留著，會顯示「原本的提示詞已刪除」。
   */
  function deleteItem(tabId, fid, id) {
    sfx('del');
    const list = listOf(tabId, fid);
    const idx = list ? list.items.findIndex((it) => it.id === id) : -1;
    if (idx >= 0) toTrash(list.items.splice(idx, 1)[0], tabId, fid);
    else setMark(id, '');
    persist();
    render();
  }

  /* ==========================================================================
     資源回收桶（4.20.0）：刪掉的提示詞先放這裡，可以還原、也可以永久刪除，像電腦的資源回收桶。
     從 設定 最下面的「資源回收桶」進來；點上面任何一個書籤就離開。
     裡面的提示詞不能用、不能拖、不能加星號、不能編輯：點一下是「選取」，
     按住 Shift 點選一整段、按住 Ctrl 點選跳著選（Mac 是 ⌘），Ctrl＋A 全選。
     選好了用底下的「還原」「永久刪除」；每一則右邊的 ⋮ 也可以單獨還原、永久刪除。
     ========================================================================== */

  let trashSel = new Set();      // 選取中的 id
  let trashAnchor = '';          // Shift 選一段的起點
  let purgeArmed = false, purgeTimer = 0;

  const trashList = () => data.trash || [];

  /** 刪掉的提示詞放進回收桶：記著原本在哪、標了什麼符號，還原時放回去 */
  function toTrash(item, tabId, fid) {
    data.trash = [{
      id: item.id, title: item.title, content: item.content, deletedAt: Date.now(),
      tabId: tabId || '', folderId: fid || '', mark: markOf(item.id),
    }, ...trashList().filter((r) => r.id !== item.id)];
    setMark(item.id, '');
  }

  let trashReturn = '';            // 進回收桶之前在看哪個書籤（回去時回到那裡）

  function openTrash() {
    closeSettings();
    exitSearch(false);
    trashSel = new Set();
    trashAnchor = '';
    if (!activeTab().trash) trashReturn = data.activeId;
    switchTab(GPN_TRASH_ID);
  }

  /** 離開回收桶：回到進來前的書籤；toSettings＝再打開設定（回收桶是從設定進來的，「上一層」就是設定） */
  function leaveTrash(toSettings) {
    const back = tabById(trashReturn) && trashReturn !== GPN_TRASH_ID ? trashReturn : data.tabs[0].id;
    trashSel = new Set();
    switchTab(back);
    if (toSettings) openSettings(data.activeId);
  }

  /** 「刪除於 10/12 下午3:20」 */
  const deletedLabel = (ts) => {
    const d = new Date(ts);
    return ts ? `刪除於 ${d.getMonth() + 1}/${d.getDate()} ${clock(ts)}` : '';
  };

  function renderTrash() {
    const list = trashList();
    for (const id of [...trashSel]) if (!list.some((r) => r.id === id)) trashSel.delete(id);
    ui.list.replaceChildren();
    if (!list.length) {
      ui.list.append(el('div', { class: 'gpn-empty' },
        el('div', { class: 'gpn-empty-emoji gpn-empty-mark', html: ICON_DELETE }),
        el('div', { class: 'gpn-empty-title', text: '資源回收桶是空的' }),
        el('div', { class: 'gpn-empty-desc', text: '刪掉的提示詞會先放在這裡，需要時可以還原' })));
    } else {
      ui.list.append(el('div', { class: 'gpn-trash-head' },
        el('span', { text: '點一下選取；按住 Shift 選一整段、按住 Ctrl 跳著選、Ctrl＋A 全選' })));
      const where = (r) => {
        const t = data.tabs.find((x) => x.id === r.tabId);
        const f = t?.folders?.find((x) => x.id === r.folderId);
        return t ? t.label + (f ? ` › ${f.label}` : '') : '原本的書籤已刪除';
      };
      for (const r of list) {
        const more = el('button', {
          class: 'gpn-more', type: 'button', title: '還原或永久刪除這一則',
          'aria-label': `還原或永久刪除：${r.title}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
          html: ICON_MORE,
          onclick: (e) => { e.stopPropagation(); toggleTrashMenu(more, r); },
        });
        const card = el('div', {
          class: 'gpn-card gpn-card--trash' + (trashSel.has(r.id) ? ' is-selected' : ''),
          role: 'listitem', 'data-id': r.id, 'aria-selected': String(trashSel.has(r.id)),
        },
          el('button', {
            class: 'gpn-title', type: 'button', title: '點一下選取（Shift：選一整段；Ctrl：跳著選）',
            onclick: (e) => selectTrash(r.id, e),
          },
            el('div', { class: 'gpn-title-text', text: r.title || '(未命名)' }),
            el('div', { class: 'gpn-title-sub' },
              el('span', { class: 'gpn-from', text: where(r) }),
              el('span', { class: 'gpn-from gpn-from--time', text: deletedLabel(r.deletedAt) }),
              preview(r.content))),
          more);
        ui.list.append(card);
      }
    }
    paintTrashBar();
  }

  /** 點選：一般點＝只選這一則；Shift＝從上次點的那則選到這一則；Ctrl／⌘＝加選或取消這一則 */
  function selectTrash(id, e) {
    const ids = trashList().map((r) => r.id);
    if (e.shiftKey && trashAnchor && ids.includes(trashAnchor)) {
      const [a, b] = [ids.indexOf(trashAnchor), ids.indexOf(id)].sort((x, y) => x - y);
      if (!(e.ctrlKey || e.metaKey)) trashSel = new Set();
      for (const x of ids.slice(a, b + 1)) trashSel.add(x);
    } else if (e.ctrlKey || e.metaKey) {
      if (trashSel.has(id)) trashSel.delete(id); else trashSel.add(id);
      trashAnchor = id;
    } else {
      trashSel = new Set([id]);
      trashAnchor = id;
    }
    sfx('click');
    paintTrashSelection();
  }

  function paintTrashSelection() {
    for (const c of ui.list.querySelectorAll('.gpn-card--trash')) {
      const on = trashSel.has(c.getAttribute('data-id'));
      c.classList.toggle('is-selected', on);
      c.setAttribute('aria-selected', String(on));
    }
    paintTrashBar();
  }

  /** 底下只有「還原」「永久刪除」兩顆（沒選取時按不下去）；清空在最上面那條的右邊 */
  function paintTrashBar() {
    const n = trashSel.size, total = trashList().length;
    disarmPurge();
    ui.trashRestore.hidden = ui.trashPurge.hidden = false;
    ui.trashRestore.disabled = ui.trashPurge.disabled = !n;
    ui.trashRestore.textContent = n ? `還原（${n}）` : '還原';
    ui.trashPurge.textContent = n ? `永久刪除（${n}）` : '永久刪除';
    ui.trashCount.textContent = total ? `${total} 則` : '';
    ui.trashEmpty.hidden = !total;
    disarmButton(ui.trashEmpty, '清空');
  }

  function onTrashEmpty() {
    purgeTrash([], ui.trashEmpty, '清空');
  }

  /** 還原：放回原本的書籤、資料夾（不在了就放第一個書籤），符號也標回去 */
  function restoreTrash(ids) {
    const back = trashList().filter((r) => ids.includes(r.id));
    if (!back.length) return;
    for (const r of [...back].reverse()) {
      const tab = data.tabs.find((t) => t.id === r.tabId) || data.tabs[0];
      const list = tab.folders ? tab.folders.find((f) => f.id === r.folderId) || tab.folders[0] : tab;
      list.items.push({ id: r.id, title: r.title, content: r.content });
      if (r.mark && (r.mark === GPN_MARK_FAV || GPN_MARKS.includes(r.mark))) setMark(r.id, r.mark);
    }
    data.trash = trashList().filter((r) => !ids.includes(r.id));
    for (const id of ids) trashSel.delete(id);
    sfx('save');
    persist();
    render();
    toast(back.length === 1 ? `已還原「${back[0].title}」` : `已還原 ${back.length} 則`);
  }

  /** 永久刪除（按兩次）：ids 是空的就是清空整個回收桶 */
  function purgeTrash(ids, btn, label) {
    const n = ids.length || trashList().length;
    if (!n) return;
    if (!purgeArmed) {
      purgeArmed = true;
      armButton(btn, ids.length ? `永久刪除 ${n} 則？再按一次` : `清空 ${n} 則？再按一次`);
      clearTimeout(purgeTimer);
      purgeTimer = setTimeout(() => { purgeArmed = false; disarmButton(btn, label); }, 5000);
      return;
    }
    purgeArmed = false;
    data.trash = ids.length ? trashList().filter((r) => !ids.includes(r.id)) : [];
    trashSel = new Set();
    sfx('del');
    persist();
    renderList();
    toast(ids.length ? `已永久刪除 ${n} 則` : '資源回收桶已清空');
  }

  function disarmPurge() {
    clearTimeout(purgeTimer);
    purgeArmed = false;
    ui.trashPurge?.classList.remove('is-confirm');
  }

  function onTrashPurge() {
    const ids = [...trashSel];
    if (!ids.length) return;
    purgeTrash(ids, ui.trashPurge, `永久刪除（${ids.length}）`);
  }

  /** 回收桶裡每一則右邊的 ⋮：還原、永久刪除 */
  function toggleTrashMenu(btn, r) {
    if (menuFor === btn) { closeCardMenu(); return; }
    closeCardMenu();
    sfx('click');
    const del = menuEntry(ICON_DELETE, '永久刪除', '刪了就找不回來', () => {
      const text = del.querySelector('.gpn-menu-text > span');
      if (!menuDelArmed) {
        menuDelArmed = true;
        del.classList.add('is-confirm');
        text.textContent = '確定永久刪除？再按一次';
        return;
      }
      closeCardMenu();
      data.trash = trashList().filter((x) => x.id !== r.id);
      trashSel.delete(r.id);
      sfx('del');
      persist();
      renderList();
      toast(`已永久刪除「${r.title}」`);
    }, ' gpn-menu-item--del');
    openMenuWith(btn, [
      menuEntry(ICON_RESTORE, '還原', '放回原本的書籤', () => { closeCardMenu(); restoreTrash([r.id]); }),
      el('div', { class: 'gpn-menu-sep', role: 'separator' }),
      del,
    ]);
  }

  /* ==========================================================================
     搜尋（4.20.0）：底下放大鏡。打任何字，標題或內容有出現的提示詞都列出來，
     不分書籤、全部放在同一頁；空白隔開的幾個字要「都有出現」才算。點一下照樣是使用。
     點上面任何一個書籤、按 Esc 或右邊的 × 就離開搜尋。
     ========================================================================== */

  let searchQ = null;            // null＝沒在搜尋

  function enterSearch() {
    if (searchQ !== null) { ui.searchInput.focus(); return; }
    sfx('open');
    searchQ = '';
    ui.searchInput.value = '';
    ui.book.classList.add('is-searching');
    ui.searchBar.hidden = false;
    renderList();
    setTimeout(() => ui.searchInput.focus(), 30);
  }

  function exitSearch(rerender = true) {
    if (searchQ === null) return;
    searchQ = null;
    ui.book.classList.remove('is-searching');
    ui.searchBar.hidden = true;
    if (rerender) { renderFolders(); renderList(); }
  }

  /** 把 text 裡出現的關鍵字包成 <mark>（用 DOM 組，不用 innerHTML，提示詞裡的 < > 才不會出事） */
  function highlight(text, terms) {
    const frag = document.createDocumentFragment();
    if (!terms.length) { frag.append(text); return frag; }
    const lower = text.toLowerCase();
    let i = 0;
    while (i < text.length) {
      let hit = -1, len = 0;
      for (const t of terms) {
        const at = lower.indexOf(t, i);
        if (at >= 0 && (hit < 0 || at < hit)) { hit = at; len = t.length; }
      }
      if (hit < 0) { frag.append(text.slice(i)); break; }
      if (hit > i) frag.append(text.slice(i, hit));
      frag.append(el('mark', { class: 'gpn-hit', text: text.slice(hit, hit + len) }));
      i = hit + len;
    }
    return frag;
  }

  /** 內容裡第一個關鍵字附近的一小段（前面留一點上下文） */
  function snippet(content, terms) {
    const one = String(content).replace(/\s+/g, ' ').trim();
    const lower = one.toLowerCase();
    const at = Math.min(...terms.map((t) => { const i = lower.indexOf(t); return i < 0 ? Infinity : i; }));
    if (!isFinite(at) || at < 20) return one.length > 60 ? one.slice(0, 60) + '…' : one;
    const start = at - 16;
    const piece = one.slice(start, start + 60);
    return '…' + piece + (start + 60 < one.length ? '…' : '');
  }

  function renderSearch() {
    const terms = String(searchQ || '').toLowerCase().split(/\s+/).filter(Boolean);
    ui.list.replaceChildren();
    if (!terms.length) {
      ui.list.append(el('div', { class: 'gpn-empty' },
        el('div', { class: 'gpn-empty-emoji gpn-empty-mark', html: ICON_SEARCH }),
        el('div', { class: 'gpn-empty-title', text: '搜尋所有提示詞' }),
        el('div', { class: 'gpn-empty-desc', text: '在上面打字，標題或內容有出現的都會列出來（不分書籤）' })));
      return;
    }
    const found = [];
    for (const t of data.tabs) {
      for (const l of gpnListsOf(t)) {
        for (const it of l.items) {
          const hay = (it.title + '\n' + it.content).toLowerCase();
          if (terms.every((x) => hay.includes(x))) found.push({ it, t, f: l === t ? null : l });
        }
      }
    }
    ui.list.append(el('div', { class: 'gpn-trash-head' },
      el('b', { text: found.length ? `找到 ${found.length} 則` : '找不到' }),
      el('span', { text: found.length ? '點一下就能使用' : '換個字試試看，或少打幾個字' })));
    for (const { it, t, f } of found) {
      const card = buildCard(it, t.id, f ? f.id : null, t.label + (f ? ` › ${f.label}` : ''), null, true);
      card.querySelector('.gpn-title-text').replaceChildren(highlight(it.title || '(未命名)', terms));
      const sub = card.querySelector('.gpn-title-sub');
      const from = sub.querySelector('.gpn-from');
      sub.replaceChildren(from, highlight(snippet(it.content, terms), terms));
      ui.list.append(card);
    }
  }

  /* ==========================================================================
     把提示詞拖到左邊的資料夾、或上面別的書籤（4.20.0）：像在檔案總管把檔案拖到別的資料夾。
     拖著卡片的 ⣿ 移到資料夾（或書籤）上，那一格會亮起來，放開就搬過去（放在最後面）。
     ========================================================================== */

  /** 滑鼠底下是不是一個可以放的資料夾、書籤：回傳 { node, tabId, folderId }，不是就 null */
  function dropTargetAt(x, y, fromTab, fromFolder) {
    const hit = root.elementFromPoint?.(x, y);
    if (!hit) return null;
    const folder = hit.closest?.('.gpn-folder');
    if (folder && ui.folderList.contains(folder)) {
      const fid = folder.getAttribute('data-id');
      if (fid === fromFolder) return null;
      return { node: folder, tabId: activeTab().id, folderId: fid };
    }
    const tab = hit.closest?.('.gpn-tab:not(.is-fixed)');
    if (tab && ui.tabs.contains(tab)) {
      const tid = tab.getAttribute('data-id');
      const t = data.tabs.find((x) => x.id === tid);
      if (!t || (tid === fromTab && !t.folders)) return null;
      if (tid === fromTab) return null;            // 同一個書籤的資料夾，請拖到左邊的資料夾
      return { node: tab, tabId: tid, folderId: t.folders ? t.folders[0].id : null };
    }
    return null;
  }

  /**
   * 拖曳時跟著滑鼠的「殘影」，像在檔案總管拖檔案：半透明的卡片縮圖，
   * 移到資料夾、書籤上面時，底下多一行「→ 移動至 工作 › 一般」。
   * 只在離開清單（拖出去找地方放）或對準了資料夾、書籤時出現；在清單裡上下排順序時，卡片本身就在動，不用殘影。
   * 放在 shadow root 最上層（position: fixed），不受筆記本的毛玻璃影響。
   */
  function makeGhost(card) {
    const label = el('div', { class: 'gpn-drag-label' });
    const g = el('div', { class: 'gpn-drag-ghost', 'aria-hidden': 'true' },
      el('div', { class: 'gpn-drag-card' },
        el('div', { class: 'gpn-drag-title', text: card.querySelector('.gpn-title-text')?.textContent || '' }),
        el('div', { class: 'gpn-drag-sub', text: card.querySelector('.gpn-title-sub')?.textContent || '' })),
      label);
    root.append(g);
    g._label = label;
    return g;
  }

  function moveGhost(g, ev, target, show) {
    // 網頁版整個放大了（zoom），fixed 的位置要除回去
    const k = root.host?.currentCSSZoom || parseFloat(getComputedStyle(root.host || document.body).zoom) || 1;
    g.style.transform = `translate(${(ev.clientX + 14) / k}px, ${(ev.clientY + 18) / k}px)`;
    g.classList.toggle('is-on', show);
    g._label.hidden = !target;
    if (target) g._label.textContent = `→ 移動至 ${whereLabel(target.tabId, target.folderId)}`;
  }

  function moveItemTo(fromTab, fromFolder, id, to) {
    const src = listOf(fromTab, fromFolder);
    const dest = listOf(to.tabId, to.folderId);
    if (!src || !dest || src === dest) return false;
    const idx = src.items.findIndex((it) => it.id === id);
    if (idx < 0) return false;
    const [item] = src.items.splice(idx, 1);
    dest.items.push(item);
    persist();
    renderFolders();
    renderList();
    updateTabStates();
    toast(`已搬到「${whereLabel(to.tabId, to.folderId)}」`);
    return true;
  }


  /**
   * 拖曳時跟著滑鼠走：移動、放開都聽「整個視窗」，不聽按下去的那個元素。
   * 拖曳途中會把元素搬到新位置（insertBefore），Chrome 一搬就取消那個元素的 pointer capture，
   * 聽元素的話之後的移動、放開都收不到——以前就是這樣：只能移一格就卡住，放開了還浮在半空中。
   * 回傳「不要再聽了」的函式。
   */
  function followPointer(pointerId, onMove, onEnd) {
    const move = (ev) => { if (ev.pointerId === pointerId) onMove(ev); };
    const end = (ev) => { if (ev.pointerId === pointerId) { off(); onEnd(ev); } };
    const off = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    return off;
  }

  /* ========== 卡片上下拖曳排序（按住左邊把手，馬上就能拖） ========== */

  /** canMove：一般書籤裡的卡片，可以拖到左邊的資料夾、上面別的書籤（我的最愛、符號書籤裡的只排順序） */
  function attachDrag(handle, card, tabId, fid, canMove = false) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      closeCardMenu();

      const list = ui.list;
      let moved = false;
      let target = null;               // 滑鼠底下可以放的資料夾、書籤
      sfx('pick');
      card.classList.add('is-dragging');
      list.classList.add('is-dragging');
      if (canMove) ui.book.classList.add('is-carrying');
      const ghost = canMove ? makeGhost(card) : null;

      const onMove = (ev) => {
        moved = true;
        if (canMove) {
          const t = dropTargetAt(ev.clientX, ev.clientY, tabId, fid);
          if (t?.node !== target?.node) {
            target?.node.classList.remove('is-drop');
            t?.node.classList.add('is-drop');
            target = t;
          }
          const lb = list.getBoundingClientRect();
          const outside = ev.clientX < lb.left || ev.clientX > lb.right || ev.clientY < lb.top || ev.clientY > lb.bottom;
          moveGhost(ghost, ev, target, !!target || outside);
          if (target || outside) return;   // 在資料夾、書籤上面（或拖出清單）：先不排順序
        }
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
        ghost?.remove();
        card.classList.remove('is-dragging');
        list.classList.remove('is-dragging');
        ui.book.classList.remove('is-carrying');
        target?.node.classList.remove('is-drop');
        if (!moved) return;
        sfx('drop');
        if (target && moveItemTo(tabId, fid, card.getAttribute('data-id'), target)) return;
        saveOrder(tabId, fid);
      };
      followPointer(e.pointerId, onMove, onUp);
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
    const m = tabId === GPN_FAV_ID ? GPN_MARK_FAV : gpnMarkOfTab(tabId);
    if (m) {
      // 我的最愛、符號書籤只排自己的順序，提示詞在原本書籤裡的位置不動
      const ids = markedIds(m);
      const next = [...order, ...ids.filter((id) => !order.includes(id))];
      if (m === GPN_MARK_FAV) data.favs = next;
      else data.marks = { ...data.marks, [m]: next };
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
   * @param {boolean}  [o.grid]    會換行的一排（設定裡的符號）：先比上下、同一列再比左右
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
        closeCardMenu();
        sfx('pick');
        node.classList.add('is-drag');
        box.classList.add('is-reordering');
      }

      const onMove = (ev) => {
        if (!dragging) {
          // 還沒進入拖曳：動太多就視為一般點擊／捲動，取消長按
          if (Math.abs(ev.clientX - startX) > GPN_HOLD_SLOP ||
              Math.abs(ev.clientY - startY) > GPN_HOLD_SLOP) {
            clearTimeout(holdTimer);
            off();
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
          const before = o.grid
            ? ev.clientY < b.top || (ev.clientY < b.bottom && ev.clientX < b.left + b.width / 2)
            : pos < (v ? b.top + b.height / 2 : b.left + b.width / 2);
          if (before) { after = n; break; }
        }
        // 拖到最後面時，要排在「＋」按鈕前面
        const target = after || o.anchor();
        if (target !== node && target !== node.nextElementSibling) box.insertBefore(node, target);
      };

      const onUp = () => {
        clearTimeout(holdTimer);
        if (!dragging) return;
        node.classList.remove('is-drag');
        box.classList.remove('is-reordering');
        sfx('drop');
        o.onDrop([...box.querySelectorAll(selector)].map((n) => n.getAttribute('data-id')));
        // 擋掉這次放開後的 click，避免拖完又觸發切換（放開的地方不一定還在原本那顆上，所以擋在整個視窗）
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, true), 300);
      };

      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };

      const off = followPointer(e.pointerId, onMove, onUp);
    });
  }

  /* ==========================================================================
     四、對話框共用：打開任何一層時，筆記本退到後面
     ========================================================================== */

  const layerOpen = (layer) => layer.classList.contains('is-open');
  const anyLayerOpen = () =>
    [ui.inboxLayer, ui.editLayer, ui.newTabLayer, ui.folderLayer, ui.settingsLayer, ui.cPickLayer, ui.shareLayer]
      .filter(Boolean).some(layerOpen);

  function showLayer(layer) {
    closeCardMenu();
    if (!layerOpen(layer)) sfx('open');
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
          ui.eWhereField = field('放在哪裡', '（改這裡就能搬到別的書籤或資料夾）',
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
    ui.eWhereField.querySelector('.gpn-label > span').textContent = '　（改這裡就能搬到別的書籤或資料夾）';
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
      if (editing.share) toast(`已採用，放在「${whereLabel(to.tabId, to.folderId)}」`, false, 3600);
      else toast(moved ? `已新增到「${whereLabel(to.tabId, to.folderId)}」` : '已新增提示詞');
    }

    sfx('save');
    await persist();
    const share = editing?.share;
    closeEditor();
    render();
    if (share) {
      // 採用了：信箱裡拿掉（雲端硬碟上的那份分享刪掉）；信箱空了就順便關掉
      lastAdopt = { tabId: to.tabId, folderId: to.folderId };
      cloud?.ackShares([share]);
      if (!inboxOf().some((x) => x.id !== share)) closeInbox();
    }
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
    const { tabId, folderId: fid, id } = editing;
    closeEditor();
    deleteItem(tabId, fid, id);
    toast('已移到資源回收桶（設定 → 資源回收桶 可以還原）', false, 4200);
  }

  function disarmDelete() {
    clearTimeout(delTimer);
    delArmed = false;
    disarmButton(ui.eDel, '刪除');
  }

  /** 編輯到一半按 Esc：有改過就不關，避免打好的字不見 */
  function editorDirty() {
    const item = editing?.orig || (editing?.id
      ? listOf(editing.tabId, editing.folderId)?.items.find((it) => it.id === editing.id)
      : null);
    return ui.eTitle.value.trim() !== (item?.title ?? '').trim() ||
           ui.eBody.value.trim() !== (item?.content ?? '').trim() ||
           ui.eWhere.value !== ui.eWhere.dataset.start;
  }

  /* ==========================================================================
     六、新增書籤（自己的書籤後面那個「＋」）
     已經存在的書籤要改名、換色、刪除，都在齒輪的設定裡。
     ========================================================================== */

  function buildNewTabLayer() {
    ui.nName = el('input', {
      class: 'gpn-input', type: 'text', maxlength: String(GPN_MAX_LABEL), placeholder: '例如：工作',
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
    sfx('save');
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

    sfx('save');
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

    sfx('del');
    for (const it of folder.items) toTrash(it, tab.id, folder.id);
    tab.folders.splice(tab.folders.indexOf(folder), 1);
    if (folderId === folder.id) folderId = null;

    persist();
    closeFolderEditor();
    render();
    toast(folder.items.length ? `已刪除資料夾「${folder.label}」，裡面的提示詞在資源回收桶` : `已刪除資料夾「${folder.label}」`);
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
      // 從「我的最愛」、符號書籤打開設定時，第一組換成這一頁（和一般書籤的「名稱與資料夾」同一個位置）
      navItem('markTab', ICON_STAR, '這個符號'),
      navItem('marks', ICON_STAR, '星號'),
      // 沒有雲端功能的地方（例如測試）就不出現這一項
      cloud ? navItem('account', ICON_ACCOUNT, '帳號') : null,
      hasClones() ? navItem('clones', ICON_CLONE, '分身') : null,
      navItem('backup', ICON_SYNC, '備份'),
      // 背景圖只鋪在「面板就是整個畫面」的地方（網頁版、工具列小視窗）；AI 網站裡的面板背後是網站本身
      standalone ? navItem('look', ICON_IMAGE, '背景') : null,
    ].filter(Boolean);
    const [navTab, navMarkTab, ...navAll] = ui.sNavItems;
    // 最下面兩個不是設定頁，是「去別的地方」：全部提示詞（只有網頁版）、資源回收桶
    const navGo = (icon, text, onclick, extra = {}) => el(extra.href ? 'a' : 'button', {
      class: 'gpn-nav-item gpn-nav-item--go', type: extra.href ? null : 'button', onclick, ...extra,
    }, el('span', { class: 'gpn-nav-icon', html: icon }), el('span', { class: 'gpn-nav-text', text }));
    ui.sTrashNav = navGo(ICON_DELETE, '資源回收桶', openTrash);
    const nav = el('nav', { class: 'gpn-settings-nav', role: 'tablist', 'aria-orientation': 'vertical' },
      el('h2', { text: '設定' }),
      ui.sNavGroup, navTab, navMarkTab,
      el('div', { class: 'gpn-nav-group', text: '所有書籤' }), ...navAll,
      el('div', { class: 'gpn-nav-group', text: '其他' }),
      allPageUrl ? navGo(ICON_LIST, '全部提示詞', null, {
        href: allPageUrl, target: '_blank', rel: 'noopener',
        title: '所有書籤的提示詞，完整內容用純文字列在同一頁（方便「問問 Gemini」讀）；在新分頁打開',
      }) : null,
      ui.sTrashNav,
      // 外掛和網頁版長得不一樣時，先看這裡的數字是不是一樣
      el('div', {
        class: 'gpn-nav-version',
        text: `版本 ${GPN_APP_VERSION}` + (edition ? `　${edition}` : ''),
      }));

    /* ---- 名稱與資料夾（這個書籤）：名稱 → 顏色 → 資料夾開關 → 最下面是刪除書籤 ---- */
    ui.sName = el('input', {
      class: 'gpn-input', type: 'text', maxlength: String(GPN_MAX_LABEL), placeholder: '例如：工作',
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

    /* ---- 星號 ---- */
    const secMarks = buildMarksSection();

    /* ---- 這個符號（從我的最愛、符號書籤打開設定時）---- */
    const secMarkTab = buildMarkTabSection();


    /* ---- 雲端同步 ---- */
    const secAccount = cloud ? buildAccountSection() : null;

    /* ---- 分身 ---- */
    const secClones = hasClones() ? buildClonesSection() : null;

    /* ---- 備份 ---- */
    const secBackup = buildBackupSection();

    /* ---- 背景 ---- */
    const secLook = standalone ? buildLookSection() : null;

    ui.sSections = [secTab, secMarkTab, secMarks, secAccount, secClones, secBackup, secLook].filter(Boolean);
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
    // 「最近使用」「我的最愛」、符號書籤沒有名稱、顏色、資料夾可以改，直接打開全部書籤共用的那幾頁
    // （我的最愛、符號書籤打開「星號」）
    const hasAccount = !!cloud && !!cloudState.configured;
    if (tab.mark && section === 'tab') section = 'markTab';
    if (!tab.mark && section === 'markTab') section = 'tab';
    if (tab.mark) resetMarkTab(tab);
    if (tab.fixed && section === 'tab') section = hasAccount ? 'account' : 'backup';
    if ((section === 'account' || section === 'clones') && !hasAccount) section = tab.fixed ? 'backup' : 'tab';
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
    disarmMarkTab();
    toggleCloneInfo(false);
    if (key === 'clones') openClones();
  }

  /** 設定視窗裡所有「跟著資料變」的文字，一次更新 */
  function refreshSettings() {
    const tab = tabById(settingsTabId);
    if (!tab) return;

    const folders = gpnCountFolders(data);
    const nTrash = trashList().length;
    ui.sTrashNav.querySelector('.gpn-nav-text').textContent = nTrash ? `資源回收桶（${nTrash}）` : '資源回收桶';
    ui.bStats.textContent = `${data.tabs.length} 個書籤、` +
      (folders ? `${folders} 個資料夾、` : '') + `${gpnCountItems(data)} 則提示詞`;
    refreshMarks();

    // 「最近使用」「我的最愛」：藏起「這個書籤」那一組（名稱與資料夾）
    // 雲端還沒設定好：「雲端同步」整頁不出現，免得使用者看到一堆給管理員的說明
    const fixed = !!tab.fixed;
    ui.sNavGroup.hidden = fixed && !tab.mark;
    if (tab.mark) ui.sNavGroup.textContent = `「${markLabel(tab.mark)}」這個書籤`;
    refreshMarkTab(tab);
    for (const b of ui.sNavItems) {
      const key = b.getAttribute('data-section');
      if (key === 'tab') b.hidden = fixed;
      if (key === 'markTab') b.hidden = !tab.mark;
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
    ui.sDelNote.textContent = n ? `裡面的 ${n} 則提示詞會一起移到資源回收桶（需要時可以還原）` : '';
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
    sfx('click');
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

    sfx('del');
    for (const l of gpnListsOf(tab)) for (const it of l.items) toTrash(it, tab.id, l === tab ? '' : l.id);
    data.tabs.splice(data.tabs.indexOf(tab), 1);
    if (!tabById(data.activeId)) { data.activeId = data.tabs[0].id; folderId = null; }

    persist();
    closeSettings();
    render();
    toast(gpnTabItemCount(tab) ? `已刪除書籤「${tab.label}」，裡面的提示詞在資源回收桶` : `已刪除書籤「${tab.label}」`);
  }

  function disarmTabDelete() {
    clearTimeout(tabDelTimer);
    tabDelArmed = false;
    if (ui.sDel) disarmButton(ui.sDel, '刪除這個書籤');
  }



  /* ---- 星號 ----
     和 Gmail 的「星號」設定一樣：上面「使用中」、下面「沒使用」。連續點提示詞的星號時，照「使用中」的順序換。
     Gmail 是用拖的；這裡改成「點一下就移過去」，比較好按。順序就是點進來的順序。
     黃色星星就是「我的最愛」，固定排第一個、不能移走。其他每用一種，書籤列（我的最愛左邊）就多一個書籤。 */

  function buildMarksSection() {
    ui.mUse = el('div', { class: 'gpn-marks', role: 'list', 'aria-label': '使用中' });
    ui.mOff = el('div', { class: 'gpn-marks gpn-marks--off', role: 'list', 'aria-label': '沒使用' });
    const preset = (text, types) => el('button', {
      class: 'gpn-btn2', type: 'button', onclick: () => setMarkTypes(types, `已換成「${text}」`),
    }, text);
    return el('section', { class: 'gpn-section', 'data-section': 'marks' },
      el('h3', { text: '星號' }),
      el('p', { class: 'gpn-lede', text:
        '和 Gmail 的星號一樣：連續點提示詞右邊的星號，會照「使用中」的順序換成不同的符號，換完一輪就取消。' +
        '每一種符號在書籤列都有自己的書籤（在「我的最愛」左邊），標了那個符號的提示詞會收在裡面。' }),
      field('使用中', '（點一下就移到「沒使用」；長按可以左右拖曳排順序）', ui.mUse),
      field('沒使用', '（點一下就加到「使用中」的最後面）', ui.mOff),
      el('div', { class: 'gpn-note', text:
        `黃色星星就是「我的最愛」，固定排第一個。黃色星星以外最多再用 ${GPN_MAX_MARKS} 種，書籤列才放得下。` +
        '順序就是連續點星號時換的順序，書籤列上的符號書籤也照這個順序；在這裡或書籤列上長按拖曳都能換。' }),
      el('div', { class: 'gpn-sep' }),
      field('預先設定', '（和 Gmail 一樣）',
        el('div', { class: 'gpn-brow' },
          preset('1 顆星', []),
          preset('4 顆星', ['blue-star', 'green-check', 'red-bang']))));
  }

  function refreshMarks() {
    if (!ui.mUse) return;
    const using = marksInUse();
    const chip = (m, on) => {
      const locked = m === GPN_MARK_FAV;
      const n = markedIds(m).length;
      return el('button', {
        class: 'gpn-mark-chip' + (locked ? ' is-locked' : ''), type: 'button', role: 'listitem', 'data-id': m,
        title: locked ? '黃色星星就是「我的最愛」，固定排第一個'
          : (on ? '點一下：移到「沒使用」' : '點一下：加到「使用中」') + (n ? `（現在有 ${n} 則標了這個）` : ''),
        'aria-disabled': locked ? 'true' : null,
        onclick: () => { if (!locked) toggleMarkType(m); },
      },
        el('span', { class: 'gpn-mark-icon', html: markIcon(m) }),
        el('span', { text: markLabel(m) }),
        n ? el('span', { class: 'gpn-mark-n', text: String(n) }) : null);
    };
    ui.mUse.replaceChildren(...using.map((m) => chip(m, true)));
    // 使用中的（黃色星星以外）長按可以拖曳排順序，和書籤一樣
    for (const node of ui.mUse.querySelectorAll('.gpn-mark-chip:not(.is-locked)')) {
      attachHoldDrag({
        handle: node, node, box: ui.mUse, selector: '.gpn-mark-chip:not(.is-locked)', grid: true,
        anchor: () => null,
        vertical: () => false,
        canStart: () => (data.markTypes || []).length > 1,
        onDrop: (order) => setMarkOrder(order),
      });
    }
    ui.mOff.replaceChildren(...GPN_MARKS.filter((m) => !using.includes(m)).map((m) => chip(m, false)));
  }

  /* ---- 這個符號（我的最愛、符號書籤的設定）----
     符號書籤只是把「標了同一種符號」的提示詞集中起來看，提示詞本身還在原本的書籤。這一頁可以：
       建立成新書籤：把這些提示詞複製一份，變成一個一般的書籤（和「＋ 新增書籤」的一樣，可以改名、開資料夾…）。
                    複製的不帶符號；原本的提示詞、這個符號書籤都不動。
       清除全部標記：這些提示詞都拿掉這個符號（提示詞本身留著）。
       刪除這些提示詞：全部移到資源回收桶（需要時可以還原）。
       拿掉這個符號書籤：書籤列上不再出現（和 設定 → 星號 移到「沒使用」一樣；我的最愛不能拿掉）。
     後面三個都是「按兩次」。 */

  let mtColor = 'amber', mtArmed = '', mtTimer = 0;

  /** 標了這個符號、而且還找得到的提示詞（照符號書籤裡的順序） */
  function markedItems(m) {
    const where = indexItems();
    return markedIds(m).map((id) => where.get(id)).filter(Boolean);
  }

  function buildMarkTabSection() {
    ui.mtHead = el('h3');
    ui.mtStats = el('p', { class: 'gpn-lede' });
    ui.mtName = el('input', {
      class: 'gpn-input', type: 'text', maxlength: String(GPN_MAX_LABEL), placeholder: '新書籤的名稱',
      oninput: () => { ui.mtName.classList.remove('is-bad'); ui.mtNameHint.classList.remove('is-on'); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); onMarkToTab(); } },
    });
    ui.mtNameHint = el('div', { class: 'gpn-hint', text: '名稱不能空白' });
    ui.mtColor = buildColorPicker((c) => { mtColor = c; });
    ui.mtMake = el('button', { class: 'gpn-btn gpn-btn--save gpn-btn--block', type: 'button', onclick: onMarkToTab }, '建立成新書籤');
    ui.mtMakeNote = el('div', { class: 'gpn-note' });

    ui.mtUnmark = el('button', { class: 'gpn-btn2', type: 'button', onclick: () => onMarkTabDanger('unmark') });
    ui.mtDelete = el('button', { class: 'gpn-btn2 gpn-clone-del', type: 'button', onclick: () => onMarkTabDanger('delete') });
    ui.mtRemove = el('button', { class: 'gpn-btn2', type: 'button', onclick: () => onMarkTabDanger('remove') });
    ui.mtRemoveNote = el('div', { class: 'gpn-note' });

    return el('section', { class: 'gpn-section', 'data-section': 'markTab' },
      ui.mtHead, ui.mtStats,
      el('div', { class: 'gpn-label', text: '建立成新書籤' }),
      el('div', { class: 'gpn-note gpn-note--roomy', text:
        '把這些提示詞複製一份，變成一個一般的書籤（和「＋ 新增書籤」建立的一樣，可以改名、開資料夾、拖曳排序）。' +
        '複製出來的不帶符號；原本的提示詞和這個符號書籤都不會變。' }),
      field('新書籤的名稱', null, ui.mtName, ui.mtNameHint),
      field('書籤顏色', null, ui.mtColor.node),
      ui.mtMake, ui.mtMakeNote,
      el('div', { class: 'gpn-sep' }),
      el('div', { class: 'gpn-label', text: '一次處理全部' }),
      el('div', { class: 'gpn-brow gpn-mt-danger' }, ui.mtUnmark, ui.mtDelete),
      el('div', { class: 'gpn-note', text:
        '「清除全部標記」只拿掉符號，提示詞還在原本的書籤；「刪除」會把這些提示詞移到資源回收桶（需要時可以還原）。兩個都要按兩次。' }),
      el('div', { class: 'gpn-sep' }),
      ui.mtRemoveBox = el('div', {},
        el('div', { class: 'gpn-label', text: '書籤列' }),
        el('div', { class: 'gpn-brow' }, ui.mtRemove),
        ui.mtRemoveNote));
  }

  /** 每次從符號書籤打開設定：名稱預設成符號的名字，顏色挑一個還沒用過的 */
  function resetMarkTab(tab) {
    if (!ui.mtName) return;
    disarmMarkTab();
    ui.mtName.value = markLabel(tab.mark);
    ui.mtName.classList.remove('is-bad');
    ui.mtNameHint.classList.remove('is-on');
    const used = new Set(data.tabs.map((t) => t.color));
    mtColor = GPN_COLORS.find((c) => !used.has(c)) || GPN_COLORS[0];
    ui.mtColor.set(mtColor);
    ui.mtColor.close();
  }

  function refreshMarkTab(tab) {
    if (!ui.mtHead || !tab?.mark) return;
    const m = tab.mark, fav = m === GPN_MARK_FAV;
    const n = markedItems(m).length;
    const name = markLabel(m);
    ui.mtHead.replaceChildren(el('span', { class: 'gpn-mt-icon', html: markIcon(m) }), el('span', { text: name }));
    ui.mtStats.textContent = n
      ? `標了「${name}」的提示詞有 ${n} 則。它們本身放在原本的書籤裡，這個書籤只是把它們集中起來看。`
      : `還沒有標「${name}」的提示詞。`;
    const full = data.tabs.length >= GPN_MAX_TABS;
    ui.mtMake.disabled = !n || full;
    ui.mtMakeNote.textContent = full ? `書籤已經有 ${GPN_MAX_TABS} 個（上限），請先刪掉一個再建立`
      : !n ? '沒有提示詞可以複製' : `會建立一個有 ${n} 則提示詞的新書籤，放在書籤列最後面`;
    if (mtArmed !== 'unmark') disarmButton(ui.mtUnmark, `清除全部標記（${n} 則）`);
    if (mtArmed !== 'delete') disarmButton(ui.mtDelete, `刪除這 ${n} 則提示詞`);
    if (mtArmed !== 'remove') disarmButton(ui.mtRemove, `從書籤列拿掉「${name}」`);
    ui.mtUnmark.disabled = ui.mtDelete.disabled = !n;
    ui.mtRemoveBox.hidden = fav;
    ui.mtRemoveNote.textContent = n
      ? `拿掉之後，這 ${n} 則的「${name}」還記著，到 設定 → 星號 加回來就會再出現。`
      : `和 設定 → 星號 把「${name}」移到「沒使用」一樣，之後可以再加回來。`;
  }

  function disarmMarkTab() {
    clearTimeout(mtTimer);
    mtArmed = '';
  }

  /** 建立成新書籤：複製一份（新的 id、不帶符號），放在書籤列最後面，然後切過去 */
  async function onMarkToTab() {
    const tab = tabById(settingsTabId);
    if (!tab?.mark) return;
    const label = ui.mtName.value.trim();
    if (!label) {
      ui.mtName.classList.add('is-bad');
      ui.mtNameHint.classList.add('is-on');
      ui.mtName.focus();
      return;
    }
    if (data.tabs.length >= GPN_MAX_TABS) { toast(`書籤已經有 ${GPN_MAX_TABS} 個（上限），請先刪掉一個`, true); return; }
    const found = markedItems(tab.mark);
    if (!found.length) return;
    const items = found.map(({ it }) => ({ id: gpnNewId(), title: it.title, content: it.content }));
    const fresh = { id: gpnNewId('t'), label, color: mtColor, items };
    data.tabs.push(fresh);
    data.activeId = fresh.id;
    folderId = null;
    sfx('save');
    await persist();
    closeSettings();
    render();
    toast(`已建立書籤「${label}」，放了 ${items.length} 則（「${markLabel(tab.mark)}」書籤還在）`, false, 4200);
  }

  /** 清除全部標記／刪除這些提示詞／從書籤列拿掉：第一次按先變成確認，6 秒內再按一次才做 */
  function onMarkTabDanger(kind) {
    const tab = tabById(settingsTabId);
    if (!tab?.mark) return;
    const m = tab.mark, name = markLabel(m);
    const btn = { unmark: ui.mtUnmark, delete: ui.mtDelete, remove: ui.mtRemove }[kind];
    const found = markedItems(m);
    if (mtArmed !== kind) {
      disarmMarkTab();
      refreshMarkTab(tab);
      mtArmed = kind;
      armButton(btn, kind === 'unmark' ? `確定拿掉 ${found.length} 則的符號？再按一次`
        : kind === 'delete' ? `確定刪除 ${found.length} 則？再按一次`
        : '確定拿掉？再按一次');
      mtTimer = setTimeout(() => { disarmMarkTab(); refreshMarkTab(tabById(settingsTabId)); }, 6000);
      return;
    }
    disarmMarkTab();
    if (kind === 'remove') {
      closeSettings();
      toggleMarkType(m);           // 和 設定 → 星號 移到「沒使用」一樣（會換到我的最愛、說明）
      return;
    }
    if (kind === 'unmark') {
      for (const { it } of found) setMark(it.id, '');
      sfx('unstar');
      persist();
      render();
      refreshSettings();
      toast(`已拿掉 ${found.length} 則的「${name}」，提示詞都還在原本的書籤`);
      return;
    }
    // 刪除：一則一則移到資源回收桶（記著原本在哪，可以還原）
    for (const { it, tab: t, folder } of found) {
      const list = folder || t;
      const idx = list.items.indexOf(it);
      if (idx >= 0) toTrash(list.items.splice(idx, 1)[0], t.id, folder ? folder.id : '');
    }
    sfx('del');
    persist();
    render();
    refreshSettings();
    toast(`已把 ${found.length} 則移到資源回收桶（需要時可以還原）`);
  }

  /** 拖曳換了符號的順序（書籤列上、設定裡都是這個） */
  function setMarkOrder(order) {
    const types = order.filter((m) => (data.markTypes || []).includes(m));
    if (types.join() === (data.markTypes || []).join()) return;
    data.markTypes = types;
    persist();
    renderTabs();
    refreshMarks();
  }

  function toggleMarkType(m) {
    sfx('click');
    const types = data.markTypes || [];
    if (types.includes(m)) {
      const n = markedIds(m).length;
      setMarkTypes(types.filter((x) => x !== m), n
        ? `已移到「沒使用」。標了「${GPN_MARK_LABELS[m]}」的 ${n} 則還記著，加回來就會再出現`
        : `已移到「沒使用」，書籤列的「${GPN_MARK_LABELS[m]}」書籤拿掉了`);
      return;
    }
    if (types.length >= GPN_MAX_MARKS) {
      toast(`黃色星星以外最多用 ${GPN_MAX_MARKS} 種（書籤列才放得下），請先點掉一種`, true);
      return;
    }
    setMarkTypes([...types, m], `已加入「${GPN_MARK_LABELS[m]}」，書籤列多了它的書籤`);
  }

  function setMarkTypes(types, msg) {
    data.markTypes = types;
    // 正在看的符號書籤被拿掉了：改看我的最愛
    const cur = gpnMarkOfTab(data.activeId);
    if (cur && !types.includes(cur)) data.activeId = GPN_FAV_ID;
    persist();
    render();
    refreshMarks();
    toast(msg, false, msg.length > 30 ? 4200 : 0);
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
        '罐頭P 只碰得到它自己建立的那一個檔案，看不到雲端硬碟裡的其他東西。' }),
      el('div', { class: 'gpn-note', text: '要登入才能使用罐頭P。' }));

    /* ---- 已連結 ---- */
    ui.aWho = el('div', { class: 'gpn-account-email' });
    ui.aStatusIcon = el('span', { class: 'gpn-cloud-icon' });
    ui.aStatus = el('span');
    ui.aSyncBtn = el('button', { class: 'gpn-btn2', type: 'button', onclick: onSyncNow }, '⟳　立即同步');
    ui.aFileLink = el('a', { class: 'gpn-link gpn-file-link', target: '_blank', rel: 'noopener' },
      '在 Google 雲端硬碟裡查看這個檔案');
    ui.aSignOut = el('button', { class: 'gpn-btn2', type: 'button', onclick: onSignOut }, '登出');
    ui.aFace = el('span', { class: 'gpn-account-avatar' });
    ui.aPhotoNote = el('div', { class: 'gpn-note', hidden: '', text:
      '想在這裡和筆記本右下角看到 Google 頭像的話，登出再登入一次就有了。' });

    ui.aKind = el('div', { class: 'gpn-note' });
    ui.aWhere = el('div', { class: 'gpn-note' });
    ui.aBack = el('button', { class: 'gpn-btn2 gpn-btn--block', type: 'button', hidden: '', onclick: onLeaveClone });
    ui.aIn = el('div', {},
      el('div', { class: 'gpn-account-card' },
        ui.aFace,
        el('div', { class: 'gpn-account-info' }, ui.aKind, ui.aWho)),
      ui.aPhotoNote,
      el('div', { class: 'gpn-account-status' }, ui.aStatusIcon, ui.aStatus),
      el('div', { class: 'gpn-brow' }, ui.aSyncBtn, ui.aSignOut),
      ui.aBack,
      ui.aWhere,
      ui.aFileLink,
      el('div', { class: 'gpn-note', text:
        '登出後，這台電腦上的提示詞會清掉、要再登入才看得到；雲端硬碟上的都還在，' +
        '在哪一台電腦登入同一個帳號，看到的都是雲端上的那一份。' }));

    return el('section', { class: 'gpn-section', 'data-section': 'account' },
      el('h3', { text: '帳號' }), ui.aOut, ui.aIn,
      el('a', {
        class: 'gpn-link gpn-privacy', href: new URL('privacy.html', GPN_CLOUD.site).href,
        target: '_blank', rel: 'noopener',
      }, '隱私權政策：資料存在哪裡、怎麼刪除'));
  }

  function resetAccount() {
    if (!ui.aOut) return;
    setAccountMsg('');
    disarmWipe();
    leaveArmed = false;
    refreshAccount();
  }

  /* ---- 登入畫面 ----
     一定要登入才能用（4.16.0 起）：沒登入時整本筆記本換成這個畫面，像 LINE 一樣。
     以前不登入也能用，結果「中斷連結 → 在這台亂改 → 再登入」，改壞的會蓋進雲端；
     現在提示詞只在登入時出現，雲端上的那一份才是正本（見 sync.js 的「登入」）。 */

  function buildGate() {
    ui.gateBtn = el('button', {
      class: 'gpn-social-btn gpn-gate-btn', type: 'button', 'data-provider': 'google', onclick: onGateLogin,
    }, el('span', { class: 'gpn-social-icon', html: ICON_GOOGLE }), el('span', { text: '用 Google 帳號登入' }));
    ui.gateMsg = el('div', { class: 'gpn-note gpn-note--status', role: 'status' });
    ui.gateNoConnect = el('div', { class: 'gpn-note gpn-note--status is-bad', hidden: '', text:
      '直接雙擊檔案打開的網頁版沒辦法登入。請改用網址打開網頁版，或用 Chrome 外掛。' });
    // 分身代號：別人建立的分身，不用 Google 帳號也能登入（見 sync.js 的「分身」）
    ui.gateCloneInput = el('input', {
      class: 'gpn-input gpn-clone-input', type: 'text', maxlength: '24', placeholder: 'XXXX-XXXX-XXXX-XXXX',
      autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': '分身代號',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); onGateClone(); } },
    });
    ui.gateCloneBtn = el('button', { class: 'gpn-btn gpn-btn--save', type: 'button', onclick: onGateClone }, '登入');
    // 平常只顯示一行小字，點了才展開（大部分人用 Google 登入，分身代號是少數人用的）
    ui.gateMore = el('button', {
      class: 'gpn-gate-more', type: 'button', hidden: hasClones() ? null : '', 'aria-expanded': 'false',
      onclick: () => {
        ui.gateMore.hidden = true;
        ui.gateMore.setAttribute('aria-expanded', 'true');
        ui.gateClone.hidden = false;
        ui.gateCloneInput.focus();
      },
    }, '選擇其他登入方式');
    ui.gateClone = el('div', { class: 'gpn-gate-clone', hidden: '' },
      el('div', { class: 'gpn-gate-or', text: '或是' }),
      el('div', { class: 'gpn-label', text: '用分身代號登入' }),
      el('div', { class: 'gpn-gate-clone-row' }, ui.gateCloneInput, ui.gateCloneBtn),
      el('div', { class: 'gpn-note gpn-gate-note', text:
        '有人把他建立的分身代號給你的話，輸入那 16 碼就能使用，不用 Google 帳號。' }));
    ui.gate = el('div', { class: 'gpn-gate', hidden: '', role: 'region', 'aria-label': '登入罐頭P' },
      el('div', { class: 'gpn-gate-logo', html: ICON_LOGO }),
      el('h1', { class: 'gpn-gate-title', text: '罐頭P' }),
      el('p', { class: 'gpn-gate-lede', text:
        '請先用 Google 帳號登入。提示詞存在你自己的 Google 雲端硬碟，' +
        '換一台電腦登入同一個帳號，看到的就是同一份。' }),
      ui.gateBtn, ui.gateNoConnect, ui.gateMsg,
      el('div', { class: 'gpn-note gpn-gate-note', text:
        '按下去會到 Google 的畫面：選要用哪個帳號，再按「允許」。' +
        '罐頭P 只碰得到它自己建立的檔案，看不到雲端硬碟裡的其他東西。' }),
      ui.gateMore, ui.gateClone,
      el('a', {
        class: 'gpn-link gpn-gate-privacy', href: new URL('privacy.html', GPN_CLOUD.site).href,
        target: '_blank', rel: 'noopener',
      }, '隱私權政策'));
    ui.overlay.append(ui.gate);
  }

  async function onGateLogin() {
    sfx('click');
    ui.gateBtn.disabled = true;
    ui.gateMsg.textContent = '';
    ui.gateMsg.classList.remove('is-bad', 'is-ok');
    const r = await cloud.connect();
    ui.gateBtn.disabled = false;
    if (!r || !r.ok) {
      ui.gateMsg.textContent = r?.error || '沒辦法開始登入，請稍後再試';
      ui.gateMsg.classList.add('is-bad');
    } else if (r.opened) {
      ui.gateMsg.textContent = '已經開了一個新分頁：請在那裡選 Google 帳號、按「允許」。完成後回到這裡就好。';
      ui.gateMsg.classList.add('is-ok');
    }
  }

  async function onGateClone() {
    const raw = ui.gateCloneInput.value;
    ui.gateMsg.classList.remove('is-bad', 'is-ok');
    if (!gpnIsCloneId(gpnCleanCloneId(raw))) {
      ui.gateMsg.textContent = '分身代號是 16 個英文字母和數字（中間的「-」可打可不打），請再檢查一次';
      ui.gateMsg.classList.add('is-bad');
      ui.gateCloneInput.focus();
      return;
    }
    sfx('click');
    ui.gateCloneBtn.disabled = true;
    ui.gateMsg.textContent = '登入中…';
    const r = await cloud.cloneSignIn(raw);
    ui.gateCloneBtn.disabled = false;
    if (!r || !r.ok) {
      ui.gateMsg.textContent = r?.error || '沒辦法登入，請稍後再試';
      ui.gateMsg.classList.add('is-bad');
      return;
    }
    ui.gateCloneInput.value = '';
    ui.gateMsg.textContent = '';
    refreshCloud(await cloud.getState());
    toast(r.error ? `已登入分身，但同步失敗：${r.error}` : `已登入分身「${r.label}」`, !!r.error);
  }

  /** 沒登入就只顯示登入畫面；登出的那一刻，正在開的對話框、選單一起關掉 */
  function paintGate() {
    if (!ui.gate) return;
    const gated = !!cloud && !!cloudState.configured && cloudState.signedIn === false;
    const was = !ui.gate.hidden;
    ui.gate.hidden = !gated;
    ui.book.hidden = gated;
    ui.overlay.classList.toggle('is-gated', gated);
    if (gated && !was) {
      // 每次回到登入畫面，「其他登入方式」都先收起來
      ui.gateClone.hidden = true;
      ui.gateMore.hidden = !hasClones();
      ui.gateMore.setAttribute('aria-expanded', 'false');
    }
    if (gated && cloudState.cloneHint && hasClones() && !ui.gateCloneInput.value) {
      ui.gateMore.hidden = true;
      ui.gateClone.hidden = false;
      ui.gateCloneInput.value = gpnFormatCloneId(cloudState.cloneHint);
    }
    if (gated) {
      closeCardMenu();
      closeEditor();
      closeNewTab();
      closeFolderEditor();
      closeSettings();
      ui.gateNoConnect.hidden = cloud.canConnect !== false;
      ui.gateBtn.hidden = cloud.canConnect === false;
      if (cloudState.message && !ui.gateMsg.textContent) {
        ui.gateMsg.textContent = cloudState.message;
        ui.gateMsg.classList.add('is-bad');
      }
    } else if (was) {
      // 剛登入：畫一次雲端拉下來的內容
      ui.gateMsg.textContent = '';
      folderId = null;
      render();
      syncLook();
    }
  }

  /** 頭像：有 Google 大頭貼就用，沒有（舊的登入、載不到圖）就用 Email 第一個字 */
  function paintFace(node, st) {
    const letter = () => {
      node.replaceChildren(el('span', { class: 'gpn-face-letter', text: (st.email || '?').charAt(0).toUpperCase() }));
    };
    // 分身沒有 Google 大頭貼：用它選的頭像（avatars.js）
    const art = st.clone?.avatar && hasAvatars() ? gpnAvatarSvg(st.clone.avatar) : '';
    const key = `${st.picture}|${st.email}|${art ? st.clone.avatar : ''}`;
    if (node._face === key) return;
    node._face = key;
    if (art) { node.replaceChildren(el('span', { class: 'gpn-face-art', html: art })); return; }
    if (!st.picture) { letter(); return; }
    const img = el('img', { class: 'gpn-face-img', alt: '', referrerpolicy: 'no-referrer', src: st.picture });
    img.addEventListener('error', letter, { once: true });
    node.replaceChildren(img);
  }

  /**
   * 頭像兼信箱：有還沒看過的分享，頭像換成一封信、右上角是數字；
   * 只剩暫留的，換回頭像、角落一個小信封。有信的時候點頭像打開信箱（帳號設定在信箱最下面）。
   */
  function paintAvatar(st) {
    const on = !!cloud && !!st.configured && !!st.signedIn;
    ui.avatar.hidden = !on;
    if (!on) return;
    const box = inboxOf(st);
    const unread = box.filter((x) => !x.kept).length;
    ui.avatar.classList.toggle('has-mail', unread > 0);
    ui.avatar.classList.toggle('has-kept', !unread && box.length > 0);
    if (unread) {
      if (ui.avatar._face !== 'mail') {
        ui.avatar._face = 'mail';
        ui.avatar.replaceChildren(el('span', { class: 'gpn-mail-icon', html: ICON_MAIL }), el('span', { class: 'gpn-mail-badge' }));
      }
      ui.avatar.querySelector('.gpn-mail-badge').textContent = unread > 99 ? '99+' : String(unread);
      ui.avatar.title = `收到 ${unread} 則新的分享（點一下打開信箱）`;
    } else {
      paintFace(ui.avatar, st);
      ui.avatar.querySelector('.gpn-mail-mini')?.remove();
      if (box.length) ui.avatar.append(el('span', { class: 'gpn-mail-mini', html: ICON_MAIL }));
      ui.avatar.title = box.length
        ? `已登入：${st.email || 'Google 帳號'}。信箱裡有 ${box.length} 則暫留的分享（點一下打開信箱）`
        : `已登入：${st.email || 'Google 帳號'}（點一下看帳號、登出）`;
    }
    ui.avatar.setAttribute('aria-label', ui.avatar.title);
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

  /**
   * 登出：先把還沒送出的送上雲端，再清掉這台的提示詞，回到登入畫面。
   * 送不上去（沒網路）的話，登出會讓那些修改不見，所以先講清楚、要再按一次。
   */
  async function onSignOut() {
    if (!wipeArmed) {
      ui.aSignOut.disabled = true;
      const r = await cloud.syncNow();
      ui.aSignOut.disabled = false;
      if (r?.error) {
        wipeArmed = true;
        armButton(ui.aSignOut, '還有修改沒送上雲端，現在登出會不見。確定登出？再按一次');
        clearTimeout(wipeTimer);
        wipeTimer = setTimeout(disarmWipe, 6000);
        return;
      }
    }
    disarmWipe();
    await cloud.signOut({ wipe: true });
    folderId = null;
    refreshCloud(await cloud.getState());
    toast('已登出。這台電腦上的提示詞清掉了，雲端上的都還在，再登入就回來');
  }

  function disarmWipe() {
    clearTimeout(wipeTimer);
    wipeArmed = false;
    if (ui.aSignOut) disarmButton(ui.aSignOut, '登出');
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
    ui.overlay.classList.remove('is-waiting');
    paintGate();
    paintGear(cloudState);
    paintAvatar(cloudState);
    refreshAccount();
    refreshClones();
    paintInbox();
    noticeInbox();
    if (cloudState.signedIn && cloudState.phase === 'idle') retryWallpaper();
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
    ui.gear.title = alert ? `${d.long}（點一下看帳號）` : label;
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
    const c = st.clone;
    ui.aWho.textContent = st.email || 'Google 帳號';
    ui.aKind.textContent = c ? '已登入分身' : '已登入（提示詞存在 Google 雲端硬碟）';
    ui.aWhere.textContent = c
      ? `這個分身由 ${c.ownerEmail || '建立的人'} 建立和管理，提示詞存在他的 Google 雲端硬碟。` +
        `一改就會自動同步。到期日 ${ymd(c.expiresAt)}，到期後會停用（建立的人可以延長）。`
      : `提示詞存在你的 Google 雲端硬碟，檔名是「${GPN_DRIVE_FILE_NAME}」。一改就會自動同步，平常不用按「立即同步」。`;
    ui.aBack.hidden = !st.owner;
    if (!leaveArmed) ui.aBack.textContent = `回到我的帳號（${st.owner}）`;
    paintFace(ui.aFace, st);
    ui.aPhotoNote.hidden = !!st.picture || !!c;
    ui.aStatusIcon.innerHTML = d.icon;
    ui.aStatus.textContent = d.long;
    ui.aStatus.parentElement.setAttribute('data-kind', d.kind);
    ui.aFileLink.hidden = !st.fileId || !!c;
    if (st.fileId) ui.aFileLink.href = `https://drive.google.com/file/d/${encodeURIComponent(st.fileId)}/view`;
  }

  /* ---- 分身 ----
     建立的人（用自己的 Google 帳號登入時）：建立、列出、複製代號、進入、再推一次、延長期限、銷毀。
     用分身登入時：看這個分身是誰建的、什麼時候到期、換頭像；建立的人自己進來的話，可以回到自己的帳號。
     勾選提示詞是另外一個視窗（不放在會捲動的設定頁裡：按鈕永遠在最下面看得到，不會誤按「完成」離開）。
     資料怎麼存、代號怎麼產生，見 sync.js 的「分身」。 */

  /** 2027/10/13 */
  function ymd(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }
  /** <input type="date"> 用的 2027-10-13 */
  function isoDay(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  const cloneExpired = (c) => !!c.expiresAt && c.expiresAt <= Date.now();

  function buildClonesSection() {
    ui.cMsg = el('div', { class: 'gpn-note gpn-note--status', role: 'status' });
    ui.cNew = el('button', { class: 'gpn-btn gpn-btn--save gpn-btn--block', type: 'button', onclick: () => openPick('create') },
      '＋　建立分身');
    ui.cList = el('div', { class: 'gpn-clone-list' });
    ui.cDone = el('div', { class: 'gpn-clone-done', hidden: '' });

    /* 標題右邊的 i：分身是什麼（點一下打開說明，點別的地方就收起來） */
    ui.cInfo = el('div', { class: 'gpn-info-pop', role: 'note', hidden: '' },
      el('p', { text:
        '分身是一個不用 Google 帳號的小帳號：勾選要給的書籤、資料夾、提示詞，複製一份成分身，' +
        '會拿到一組 16 碼的分身代號。同事在登入畫面輸入代號，就能使用、新增、修改、刪除，就跟一般帳號一樣。' }),
      el('p', { text:
        '分身的提示詞存在你的 Google 雲端硬碟（一個分身一個檔案），你隨時可以「進入分身」幫忙編輯。' +
        '分身和你的筆記本各自獨立，你之後改了自己的，可以按「再推一次」送過去。' }),
      el('p', { text:
        '建立滿一年會停用（同事登入不了，資料都還在）：你可以延長期限、或把它銷毀；停用期間你自己照樣可以進入分身。' }),
      el('p', { text:
        '你和分身、分身和分身之間可以互相分享提示詞：在提示詞右邊的 ⋯ 按「分享」，勾選要給誰。' +
        '收到的人頭像會變成一封信，打開按「採用」（選要放進哪個書籤、資料夾）或「暫留」。' }));
    ui.cInfoBtn = el('button', {
      class: 'gpn-info-btn', type: 'button', html: ICON_INFO, title: '分身是什麼',
      'aria-label': '分身是什麼', 'aria-expanded': 'false', onclick: () => toggleCloneInfo(),
    });

    ui.cOwner = el('div', {}, ui.cNew, ui.cMsg, ui.cDone, ui.cList);

    /* 用分身登入時 */
    ui.cMineName = el('div', { class: 'gpn-account-email' });
    ui.cMineNote = el('div', { class: 'gpn-note' });
    ui.cMineBack = el('button', { class: 'gpn-btn2 gpn-btn--block', type: 'button', hidden: '', onclick: onLeaveClone });
    ui.cMineFace = el('span', { class: 'gpn-account-avatar' });
    ui.cMinePicker = hasAvatars() ? buildAvatarPicker(onMyAvatar) : null;
    ui.cMine = el('div', { hidden: '' },
      el('div', { class: 'gpn-account-card' },
        ui.cMineFace,
        el('div', { class: 'gpn-account-info' }, el('div', { class: 'gpn-note', text: '你現在用的是分身' }), ui.cMineName)),
      ui.cMineNote, ui.cMineBack,
      ui.cMinePicker ? field('頭像', '（每台電腦都會跟著換）', ui.cMinePicker.node) : null);
    if (ui.cMinePicker) ui.cMinePicker.node.parentElement.classList.add('gpn-clone-myavatar');

    buildPickLayer();

    const sec = el('section', { class: 'gpn-section', 'data-section': 'clones' },
      el('div', { class: 'gpn-section-head' }, el('h3', { text: '分身' }), ui.cInfoBtn, ui.cInfo),
      ui.cOwner, ui.cMine);
    // 說明打開時，點說明以外的地方就收起來
    sec.addEventListener('mousedown', (e) => {
      const path = e.composedPath();
      if (!ui.cInfo.hidden && !path.includes(ui.cInfo) && !path.includes(ui.cInfoBtn)) toggleCloneInfo(false);
    });
    return sec;
  }

  function toggleCloneInfo(open = ui.cInfo.hidden) {
    if (!ui.cInfo) return;
    ui.cInfo.hidden = !open;
    ui.cInfoBtn.setAttribute('aria-expanded', String(open));
    ui.cInfoBtn.classList.toggle('is-on', open);
  }

  /** 打開分身頁：建立的人就去雲端硬碟拿最新的清單 */
  function openClones() {
    disarmCloneDelete();
    cAvatarOpen = '';
    cExtendOpen = '';
    ui.cDone.hidden = true;
    refreshClones();
    if (cloudState.signedIn && !cloudState.clone) loadClones();
  }

  async function loadClones() {
    if (clonesBusy) return;
    clonesBusy = true;
    if (!clones) setCloneMsg('讀取中…', 'ok');
    const r = await cloud.listClones();
    clonesBusy = false;
    if (!r || !r.ok) { setCloneMsg(r?.error || '讀不到分身的清單，請稍後再試'); return; }
    clones = r.clones || [];
    setCloneMsg('');
    refreshClones();
  }

  function setCloneMsg(msg, kind = 'bad') {
    if (!ui.cMsg) return;
    ui.cMsg.textContent = msg;
    ui.cMsg.classList.toggle('is-bad', !!msg && kind === 'bad');
    ui.cMsg.classList.toggle('is-ok', !!msg && kind === 'ok');
  }

  function refreshClones() {
    if (!ui.cOwner) return;
    const st = cloudState, c = st.clone;
    ui.cOwner.hidden = !st.signedIn || !!c;
    ui.cMine.hidden = !c;
    if (c) {
      ui.cMineName.textContent = c.label || '分身';
      ui.cMineNote.textContent = `由 ${c.ownerEmail || '建立的人'} 建立和管理，提示詞存在他的 Google 雲端硬碟。` +
        (cloneExpired(c)
          ? `已經在 ${ymd(c.expiresAt)} 到期，停用中（只有建立的人自己進得來）。`
          : `到期日 ${ymd(c.expiresAt)}，到期後會停用（建立的人可以延長），想留一份的話先到「備份」下載。`);
      ui.cMineBack.hidden = !st.owner;
      if (!leaveArmed) ui.cMineBack.textContent = `回到我的帳號（${st.owner}）`;
      paintFace(ui.cMineFace, st);
      ui.cMinePicker?.set(c.avatar);
      return;
    }
    if (!st.signedIn) { clones = null; return; }
    if (!clones) { ui.cList.replaceChildren(); return; }
    ui.cList.replaceChildren(
      el('div', { class: 'gpn-label gpn-clone-head', text: clones.length ? `建立過的分身（${clones.length}）` : '還沒有建立分身' }),
      ...clones.map(cloneCard));
  }

  /** 分身的頭像；沒選過（或認不得）的用兩個人的圖示 */
  function avatarFace(id) {
    const svg = hasAvatars() ? gpnAvatarSvg(id) : '';
    return svg ? el('span', { class: 'gpn-face-art', html: svg }) : el('span', { class: 'gpn-clone-noface', html: ICON_CLONE });
  }

  /** 選頭像的格子（動物、人物各一組）：current 是現在選的；onPick(id) */
  function avatarGrid(current, onPick) {
    const groups = [...new Set(GPN_AVATARS.map((a) => a.group))];
    return el('div', { class: 'gpn-avatar-pick', role: 'radiogroup', 'aria-label': '頭像' },
      ...groups.flatMap((g) => [
        el('div', { class: 'gpn-avatar-group', text: g }),
        el('div', { class: 'gpn-avatar-grid' }, ...GPN_AVATARS.filter((a) => a.group === g).map((a) => el('button', {
          class: 'gpn-avatar-opt' + (a.id === current ? ' is-on' : ''), type: 'button', role: 'radio',
          'aria-checked': String(a.id === current), 'aria-label': a.label, title: a.label,
          onclick: () => onPick(a.id),
        }, el('span', { class: 'gpn-face-art', html: gpnAvatarSvg(a.id) })))),
      ]));
  }

  /**
   * 頭像：和書籤顏色一樣，平常只有一顆小按鈕（頭像＋名稱），點了才展開全部，選好就收起來。
   * 回傳 { node, set(id), get(), close() }；onPick(id)
   */
  function buildAvatarPicker(onPick) {
    const face = el('span', { class: 'gpn-avatar-mini' });
    const name = el('span', { class: 'gpn-color-name' });
    const btn = el('button', {
      class: 'gpn-color-btn gpn-avatar-btn', type: 'button', 'aria-expanded': 'false', onclick: () => toggle(),
    }, face, name, el('span', { class: 'gpn-color-caret', 'aria-hidden': 'true' }));
    const box = el('div', { class: 'gpn-avatar-drop', hidden: '' });
    let current = '';
    function toggle(open = box.hidden) {
      box.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      box.replaceChildren(open ? avatarGrid(current, (id) => { set(id); close(); onPick(id); }) : '');
    }
    const close = () => toggle(false);
    function set(id) {
      current = id || '';
      face.replaceChildren(avatarFace(current));
      name.textContent = GPN_AVATARS.find((a) => a.id === current)?.label || '選一個頭像';
    }
    return { node: el('div', { class: 'gpn-color' }, btn, box), set, get: () => current, close };
  }

  /** 建立的人幫某個分身換頭像：畫面先換，存不進去再換回來 */
  async function onCloneAvatar(c, id) {
    const old = c.avatar;
    c.avatar = id;
    cAvatarOpen = '';
    refreshClones();
    const r = await cloud.setCloneAvatar(c, id);
    if (!r || !r.ok) {
      c.avatar = old;
      refreshClones();
      toast(r?.error || '頭像沒有換成功，請稍後再試', true);
    }
  }

  /** 用分身登入的人換自己的頭像 */
  async function onMyAvatar(id) {
    if (cloudState.clone?.avatar === id) return;
    const r = await cloud.setCloneAvatar(null, id);
    if (!r || !r.ok) { toast(r?.error || '頭像沒有換成功，請稍後再試', true); refreshClones(); return; }
    refreshCloud(await cloud.getState());
  }

  function cloneCard(c) {
    const armed = cDelArmed === c.id;
    const petOpen = cAvatarOpen === c.id && hasAvatars();
    const off = cloneExpired(c);
    const extending = cExtendOpen === c.id;
    let dateInput = null;
    if (extending) {
      // 預設延長一年（從今天或原本的到期日，看哪個比較晚）
      const from = Math.max(Date.now(), c.expiresAt || 0);
      dateInput = el('input', {
        class: 'gpn-input gpn-clone-date', type: 'date', 'aria-label': '新的到期日',
        min: isoDay(Date.now() + 86400000), max: isoDay(Date.now() + 10 * 365 * 86400000),
      });
      dateInput.value = isoDay(from + 365 * 86400000);
    }
    return el('div', { class: 'gpn-clone-card' + (off ? ' is-off' : '') },
      el('div', { class: 'gpn-clone-top' },
        el('button', {
          class: 'gpn-clone-face', type: 'button', title: '換頭像', 'aria-label': `換「${c.label}」的頭像`,
          'aria-expanded': String(petOpen), disabled: hasAvatars() ? null : '',
          onclick: () => { cAvatarOpen = petOpen ? '' : c.id; refreshClones(); },
        }, avatarFace(c.avatar)),
        el('div', { class: 'gpn-clone-name', text: c.label || '分身' }),
        off ? el('span', { class: 'gpn-clone-off', text: '已停用' }) : null),
      petOpen ? avatarGrid(c.avatar, (id) => onCloneAvatar(c, id)) : null,
      el('div', { class: 'gpn-clone-id' },
        el('code', { text: gpnFormatCloneId(c.id) }),
        el('button', { class: 'gpn-link gpn-clone-copy', type: 'button', onclick: () => copyInvite(c) }, '複製代號和網址')),
      el('div', { class: 'gpn-note', text: `建立 ${ymd(c.createdAt)}　・　` +
        (off ? `${ymd(c.expiresAt)} 到期，停用中（同事登入不了，你自己還進得去）` : `到期 ${ymd(c.expiresAt)}`) +
        (c.modifiedAt ? `　・　最後修改 ${ago(c.modifiedAt)}` : '') }),
      extending ? el('div', { class: 'gpn-clone-extend' },
        el('span', { class: 'gpn-note', text: '新的到期日' }), dateInput,
        el('button', { class: 'gpn-btn2', type: 'button', onclick: () => onExtendClone(c, dateInput.value) }, '確定'),
        el('button', { class: 'gpn-btn2', type: 'button', onclick: () => { cExtendOpen = ''; refreshClones(); } }, '取消')) : null,
      el('div', { class: 'gpn-brow' },
        el('button', { class: 'gpn-btn2', type: 'button', onclick: () => onEnterClone(c) }, '進入分身'),
        el('button', { class: 'gpn-btn2', type: 'button', onclick: () => openPick('push', c) }, '再推一次'),
        el('button', {
          class: 'gpn-btn2' + (off ? ' gpn-clone-renew' : ''), type: 'button',
          onclick: () => { cExtendOpen = extending ? '' : c.id; refreshClones(); },
          title: off ? '延長期限，重新啟用這個分身' : '改到期日',
        }, '延長期限'),
        el('button', {
          class: 'gpn-btn2 gpn-clone-del' + (armed ? ' gpn-btn2--danger' : ''), type: 'button', onclick: () => onDestroyClone(c),
        }, armed ? '確定銷毀？再按一次' : '銷毀')));
  }

  /** 延長期限到選的那一天（那天結束才到期） */
  async function onExtendClone(c, day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
    if (!m) { toast('請選一個日期', true); return; }
    const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59).getTime();
    setCloneMsg('延長中…', 'ok');
    const r = await cloud.extendClone(c, at);
    if (!r || !r.ok) { setCloneMsg(r?.error || '沒辦法延長，請稍後再試'); return; }
    setCloneMsg('');
    const was = cloneExpired(c);
    c.expiresAt = r.expiresAt;
    cExtendOpen = '';
    refreshClones();
    toast(was ? `分身「${c.label}」重新啟用了，到期日改成 ${ymd(at)}` : `分身「${c.label}」的到期日改成 ${ymd(at)}`);
  }

  /** 給同事的一段話：網址＋代號，貼到 LINE、Email 就能用 */
  async function copyInvite(c) {
    const text = `罐頭P 分身「${c.label}」\n網址：${GPN_CLOUD.site}\n分身代號：${gpnFormatCloneId(c.id)}\n` +
      '打開網址，在登入畫面按最下面的「選擇其他登入方式」，輸入上面的代號就能使用。';
    toast((await gpnShareCopy(text)) ? '已複製代號和網址，貼給同事就好' : '複製失敗，請手動選取代號', false);
  }

  async function onEnterClone(c) {
    setCloneMsg('切換中…', 'ok');
    const r = await cloud.enterClone(c);
    if (!r || !r.ok) { setCloneMsg(r?.error || '沒辦法進入分身，請稍後再試'); return; }
    setCloneMsg('');
    clones = null;
    closePick();
    folderId = null;
    refreshCloud(await cloud.getState());
    closeSettings();
    render();
    toast(r.error ? `已進入分身，但同步失敗：${r.error}` : `已進入分身「${c.label}」。要回來時到 設定 → 分身，按「回到我的帳號」`, !!r.error);
  }

  /** 回到自己的帳號。分身裡還有修改送不出去的話，先講清楚、要再按一次 */
  async function onLeaveClone() {
    const btns = [ui.aBack, ui.cMineBack].filter(Boolean);
    for (const b of btns) b.disabled = true;
    const r = await cloud.leaveClone({ force: leaveArmed });
    for (const b of btns) b.disabled = false;
    if (r?.unsynced) {
      leaveArmed = true;
      for (const b of btns) armButton(b, '分身還有修改沒送出去，現在離開會不見。確定？再按一次');
      return;
    }
    leaveArmed = false;
    if (!r || !r.ok) { toast(r?.error || '沒辦法回到原本的帳號', true); return; }
    closePick();
    folderId = null;
    refreshCloud(await cloud.getState());
    render();
    syncLook();
    showSection('clones');
    toast(r.error ? `已回到你的帳號，但同步失敗：${r.error}` : '已回到你的帳號');
  }

  function disarmCloneDelete() {
    clearTimeout(cDelTimer);
    cDelArmed = '';
  }

  async function onDestroyClone(c) {
    if (cDelArmed !== c.id) {
      cDelArmed = c.id;
      clearTimeout(cDelTimer);
      cDelTimer = setTimeout(() => { disarmCloneDelete(); refreshClones(); }, 6000);
      refreshClones();
      return;
    }
    disarmCloneDelete();
    setCloneMsg('銷毀中…', 'ok');
    const r = await cloud.destroyClone(c);
    if (!r || !r.ok) { setCloneMsg(r?.error || '沒辦法銷毀，請稍後再試'); refreshClones(); return; }
    clones = (clones || []).filter((x) => x.id !== c.id);
    setCloneMsg('');
    refreshClones();
    toast(`已銷毀分身「${c.label}」，這組代號不能再登入了`);
  }

  /* ==========================================================================
     分享（4.28.0）：主人和分身（們）之間互相傳提示詞。見 sync.js 的「分享」。
       寄的人：卡片「⋯ → 分享」，勾選要給誰（主人、其他分身，可以很多個）。
       收的人：頭像變成一封信、有數字。打開信箱，每一則可以
         採用 → 打開編輯視窗（標題、內容先填好），選「放在哪裡」再按儲存；信箱裡就拿掉
         暫留 → 留在信箱，不算未讀（之後再決定）
         右上角 × → 不要了，從信箱刪掉（要按兩次）
     ========================================================================== */

  const inboxOf = (st = cloudState) => (st.signedIn && Array.isArray(st.inbox) ? st.inbox.filter((x) => x?.item) : []);
  const senderName = (from) => (from?.key === 'owner' ? '主人' : from?.label || '分身');

  /** 寄的人、收件人的頭像：分身用它選的頭像；主人用「主」字 */
  function peerFace(p) {
    return el('span', { class: 'gpn-peer-face' },
      p.key === 'owner' ? el('span', { class: 'gpn-peer-owner', text: '主' }) : avatarFace(p.avatar));
  }

  function buildShareLayer() {
    ui.shWhat = el('div', { class: 'gpn-share-what' });
    ui.shAll = el('button', { class: 'gpn-link', type: 'button', onclick: () => pickAllPeers() }, '全部勾選');
    ui.shList = el('div', { class: 'gpn-share-list', role: 'group', 'aria-label': '分享給誰' });
    ui.shMsg = el('div', { class: 'gpn-note gpn-note--status', role: 'status' });
    ui.shGo = el('button', { class: 'gpn-btn gpn-btn--save', type: 'button', onclick: onShareGo }, '分享');
    ui.shareLayer = el('div', { class: 'gpn-edit-layer' },
      el('div', { class: 'gpn-dialog gpn-dialog--sm gpn-share-dialog', onmousedown: stop },
        el('h2', { text: '分享提示詞' }),
        el('div', { class: 'gpn-dialog-body' },
          ui.shWhat,
          el('div', { class: 'gpn-share-head' }, el('div', { class: 'gpn-label', text: '分享給誰（可以選很多個）' }), ui.shAll),
          ui.shList, ui.shMsg),
        el('div', { class: 'gpn-actions' },
          el('button', { class: 'gpn-btn gpn-btn--cancel', type: 'button', onclick: closeShare }, '取消'), ui.shGo)));
  }

  async function openShare(item) {
    if (!ui.shareLayer || !cloudState.signedIn) {
      toast('要先登入，主人和分身之間才能互相分享', true);
      return;
    }
    const me = { item: { title: item.title, content: item.content }, peers: null, picked: new Set() };
    sharing = me;
    ui.shWhat.replaceChildren(
      el('div', { class: 'gpn-share-ptitle', text: item.title || '（沒有標題）' }),
      el('div', { class: 'gpn-share-pbody', text: item.content }));
    ui.shMsg.textContent = '';
    ui.shAll.hidden = true;
    ui.shList.replaceChildren(el('div', { class: 'gpn-note', text: '讀取可以分享的對象…' }));
    paintShareGo();
    showLayer(ui.shareLayer);
    const r = await cloud.listPeers();
    if (sharing !== me) return;                  // 等的時候關掉了
    if (!r || !r.ok) {
      ui.shList.replaceChildren(el('div', { class: 'gpn-note gpn-note--status is-bad', text: r?.error || '讀不到可以分享的對象，請稍後再試' }));
      return;
    }
    me.peers = r.peers || [];
    if (me.peers.length === 1) me.picked.add(me.peers[0].key);   // 只有一個對象：直接幫他勾好
    paintPeers();
  }

  function paintPeers() {
    const { peers, picked } = sharing;
    ui.shAll.hidden = peers.length < 2;
    ui.shAll.textContent = peers.length && picked.size === peers.length ? '全部不勾' : '全部勾選';
    if (!peers.length) {
      ui.shList.replaceChildren(el('div', { class: 'gpn-share-empty' },
        el('p', { text: cloudState.clone ? '目前沒有可以分享的對象。' : '還沒有分身，所以還沒有可以分享的對象。' }),
        el('p', { class: 'gpn-note', text: '到 設定 → 分身 建立分身之後，主人和分身之間就能互相分享。' }),
        cloudState.clone ? null : el('button', {
          class: 'gpn-btn2', type: 'button', onclick: () => { closeShare(); openSettings(data.activeId, 'clones'); },
        }, '前往分身設定')));
      paintShareGo();
      return;
    }
    ui.shList.replaceChildren(...peers.map((x) => {
      const box = el('input', {
        class: 'gpn-share-check', type: 'checkbox',
        onchange: () => {
          if (box.checked) picked.add(x.key); else picked.delete(x.key);
          row.classList.toggle('is-on', box.checked);
          ui.shAll.textContent = picked.size === peers.length ? '全部不勾' : '全部勾選';
          paintShareGo();
        },
      });
      box.checked = picked.has(x.key);
      const row = el('label', { class: 'gpn-share-row' + (box.checked ? ' is-on' : '') },
        box, peerFace(x),
        el('span', { class: 'gpn-share-name' },
          el('span', { text: x.key === 'owner' ? '主人' : x.label }),
          x.key === 'owner' && x.email ? el('small', { text: x.email }) : null));
      return row;
    }));
    paintShareGo();
  }

  function pickAllPeers() {
    if (!sharing?.peers) return;
    const all = sharing.picked.size < sharing.peers.length;
    sharing.picked = new Set(all ? sharing.peers.map((x) => x.key) : []);
    paintPeers();
  }

  function paintShareGo() {
    const n = sharing?.peers ? sharing.picked.size : 0;
    ui.shGo.disabled = !n || !!sharing?.busy;
    ui.shGo.textContent = n ? `分享給 ${n} 位` : '分享';
  }

  async function onShareGo() {
    const me = sharing;
    if (!me?.peers || !me.picked.size || me.busy) return;
    me.busy = true;
    paintShareGo();
    ui.shMsg.className = 'gpn-note gpn-note--status is-ok';
    ui.shMsg.textContent = '分享中…';
    const keys = [...me.picked];
    const r = await cloud.sharePrompt(me.item, keys);
    me.busy = false;
    if (sharing !== me) return;
    if (!r || !r.ok) {
      ui.shMsg.className = 'gpn-note gpn-note--status is-bad';
      ui.shMsg.textContent = r?.error || '分享失敗，請稍後再試';
      paintShareGo();
      return;
    }
    const names = me.peers.filter((x) => keys.includes(x.key)).map((x) => (x.key === 'owner' ? '主人' : x.label));
    closeShare();
    sfx('save');
    toast(`已分享給 ${names.length > 3 ? `${names.slice(0, 3).join('、')} 等 ${names.length} 位` : names.join('、')}`, false, 3600);
  }

  function closeShare() {
    sharing = null;
    if (ui.shareLayer) hideLayer(ui.shareLayer);
  }

  /* ---- 信箱 ---- */

  function buildInboxLayer() {
    ui.ibCount = el('span', { class: 'gpn-inbox-count' });
    ui.ibList = el('div', { class: 'gpn-inbox-list' });
    ui.inboxLayer = el('div', { class: 'gpn-edit-layer' },
      el('div', { class: 'gpn-dialog gpn-inbox-dialog', onmousedown: stop },
        el('h2', { class: 'gpn-inbox-title' }, el('span', { text: '收到的分享' }), ui.ibCount),
        el('div', { class: 'gpn-dialog-body' }, ui.ibList),
        el('div', { class: 'gpn-actions' },
          el('button', {
            class: 'gpn-btn gpn-btn--cancel gpn-inbox-account', type: 'button',
            onclick: () => { closeInbox(); openSettings(data.activeId, 'account'); },
          }, '帳號與同步'),
          el('button', { class: 'gpn-btn gpn-btn--save gpn-inbox-close', type: 'button', onclick: closeInbox }, '關閉'))));
  }

  function openInbox() {
    if (!ui.inboxLayer) return;
    ui.ibList._key = '';
    paintInbox();
    showLayer(ui.inboxLayer);
    cloud.refreshInbox?.();
  }

  function closeInbox() {
    if (ui.inboxLayer) hideLayer(ui.inboxLayer);
  }

  /** 畫信箱：沒看過的在前面，各自新的在前面。內容沒變就不重畫（按到一半的「確定刪除」才不會被洗掉） */
  function paintInbox() {
    if (!ui.ibList) return;
    const box = inboxOf();
    const key = JSON.stringify(box.map((x) => [x.id, x.kept])) + ago(box[0]?.at || 0);
    if (ui.ibList._key === key) return;
    ui.ibList._key = key;
    const unread = box.filter((x) => !x.kept).length;
    ui.ibCount.textContent = !box.length ? '' : unread ? `${unread} 則未讀` : `${box.length} 則暫留`;
    if (!box.length) {
      ui.ibList.replaceChildren(el('div', { class: 'gpn-inbox-empty' },
        el('span', { class: 'gpn-inbox-empty-icon', html: ICON_MAIL }),
        el('div', { class: 'gpn-inbox-empty-title', text: '信箱是空的' }),
        el('div', { class: 'gpn-note', text: '主人和分身之間可以互相分享提示詞：在提示詞右邊的 ⋯ 按「分享」。' })));
      return;
    }
    const list = [...box].sort((a, b) => (a.kept - b.kept) || (b.at - a.at));
    ui.ibList.replaceChildren(...list.map(inboxCard));
  }

  function inboxCard(x) {
    let armed = false, timer = 0;
    const del = el('button', {
      class: 'gpn-inbox-del', type: 'button', title: '不要了：從信箱刪掉', 'aria-label': '不要了：從信箱刪掉', html: ICON_CLOSE,
      onclick: () => {
        if (!armed) {
          armed = true;
          del.classList.add('is-confirm');
          del.textContent = '確定刪除？';
          timer = setTimeout(() => { armed = false; del.classList.remove('is-confirm'); del.innerHTML = ICON_CLOSE; }, 4000);
          return;
        }
        clearTimeout(timer);
        sfx('del');
        cloud.ackShares([x.id]);
        toast('已從信箱刪掉');
      },
    });
    return el('div', { class: 'gpn-inbox-card' + (x.kept ? ' is-kept' : ''), 'data-id': x.id },
      el('div', { class: 'gpn-inbox-from' },
        peerFace(x.from),
        el('span', { class: 'gpn-inbox-who' }, el('b', { text: senderName(x.from) }), el('span', { text: ' 分享給你' })),
        x.kept ? el('span', { class: 'gpn-inbox-tag', text: '暫留' }) : el('span', { class: 'gpn-inbox-new', text: '未讀' }),
        el('span', { class: 'gpn-inbox-when', text: ago(x.at) }),
        del),
      el('div', { class: 'gpn-inbox-ptitle', text: x.item.title || '（沒有標題）' }),
      el('div', { class: 'gpn-inbox-pbody', text: x.item.content }),
      el('div', { class: 'gpn-inbox-btns' },
        x.kept ? null : el('button', {
          class: 'gpn-btn gpn-btn--cancel', type: 'button', title: '先留在信箱，之後再決定（不算未讀）',
          onclick: () => { sfx('click'); cloud.keepShares([x.id]); toast('已暫留：之後點頭像打開信箱，還找得到'); },
        }, '暫留'),
        el('button', {
          class: 'gpn-btn gpn-btn--save', type: 'button', title: '選要放進哪個書籤、資料夾',
          onclick: () => openAdopt(x),
        }, '採用')));
  }

  /** 採用：打開編輯視窗（先填好），選「放在哪裡」再按儲存（onSave 會把它從信箱拿掉） */
  function openAdopt(x) {
    let to = lastAdopt && listOf(lastAdopt.tabId, lastAdopt.folderId) ? lastAdopt : null;
    if (!to) {
      const t = data.tabs.find((tab) => tab.id === data.activeId) || data.tabs[0];
      if (!t) { toast('還沒有書籤：先新增一個書籤，再來採用', true); return; }
      const f = t.folders ? t.folders.find((ff) => ff.id === folderId) || t.folders[0] : null;
      to = { tabId: t.id, folderId: f ? f.id : null };
    }
    openEditor(to.tabId, to.folderId, null);
    editing.share = x.id;
    editing.orig = { title: x.item.title, content: x.item.content };
    ui.eHead.textContent = `採用「${senderName(x.from)}」分享的提示詞`;
    ui.eWhereField.querySelector('.gpn-label > span').textContent = '　（選要放進哪個書籤、資料夾）';
    ui.eTitle.value = x.item.title;
    ui.eBody.value = x.item.content;
    updateCount();
    setTimeout(() => ui.eWhere.focus(), 60);
  }

  /**
   * 新的分享來了（筆記本開著的時候）：跳一個提示、叮一聲。
   * 提醒過哪些記在這台（prefs），重新整理、換一個分頁不會一直提醒同一則。
   */
  let inboxNoticed = null;
  const INBOX_NOTICED_KEY = 'gpn_inbox_noticed_v1';
  prefs.get(INBOX_NOTICED_KEY).then((v) => { inboxNoticed = new Set(Array.isArray(v) ? v : []); noticeInbox(); });

  function noticeInbox() {
    if (!inboxNoticed || !isOpen()) return;
    const fresh = inboxOf().filter((x) => !x.kept && !inboxNoticed.has(x.id));
    if (!fresh.length) return;
    for (const x of fresh) inboxNoticed.add(x.id);
    prefs.set(INBOX_NOTICED_KEY, [...inboxNoticed].slice(-200));
    sfx('star');
    const x = fresh[fresh.length - 1];
    toast(fresh.length > 1 ? `收到 ${fresh.length} 則新的分享，點下面的信封看看`
      : `「${senderName(x.from)}」分享了「${x.item.title || '提示詞'}」給你，點下面的信封看看`, false, 5200);
  }

  /* ---- 勾選要放進分身的書籤、資料夾、提示詞（另外一個視窗）----
     勾書籤＝裡面全部；勾資料夾＝裡面全部；也可以只勾幾則。一部分有勾的顯示成「—」。
     書籤、資料夾預設都收起來（提示詞很多時才看得完），點左邊的三角形展開。
     只有核取方塊能勾（點文字不會勾到），三角形負責展開。
     右上角可以放大成整個畫面，提示詞很多時比較好找。 */

  function buildPickLayer() {
    ui.cPickTitle = el('h2', { class: 'gpn-clone-dtitle' });
    ui.cZoom = el('button', {
      class: 'gpn-round-btn', type: 'button', html: ICON_EXPAND, title: '放大', 'aria-label': '放大',
      onclick: () => zoomPick(),
    });
    ui.cName = el('input', {
      class: 'gpn-input', type: 'text', maxlength: '30', placeholder: '例如：業務組',
      oninput: () => ui.cName.classList.remove('is-bad'),
      onkeydown: (e) => { if (e.key === 'Enter') e.preventDefault(); },
    });
    ui.cNameField = field('分身名稱', '（同事登入後會看到）', ui.cName);
    ui.cAvatarPicker = hasAvatars() ? buildAvatarPicker((id) => { if (cPick) cPick.avatar = id; }) : null;
    ui.cAvatarField = ui.cAvatarPicker ? field('頭像', '（之後也可以換）', ui.cAvatarPicker.node) : el('div', { hidden: '' });
    ui.cTreeLabel = el('div', { class: 'gpn-label' });
    ui.cTree = el('div', { class: 'gpn-clone-tree', role: 'tree' });
    ui.cCount = el('div', { class: 'gpn-note gpn-clone-count' });
    ui.cPickMsg = el('div', { class: 'gpn-note gpn-note--status is-bad', role: 'status' });
    ui.cGo = el('button', { class: 'gpn-btn gpn-btn--save', type: 'button', onclick: onPickGo });
    ui.cPickDialog = el('div', { class: 'gpn-dialog gpn-clone-dialog', onmousedown: stop },
      el('div', { class: 'gpn-clone-dhead' }, ui.cPickTitle, ui.cZoom),
      el('div', { class: 'gpn-clone-dbody' },
        ui.cNameField, ui.cAvatarField,
        el('div', { class: 'gpn-clone-treehead' }, ui.cTreeLabel,
          el('div', { class: 'gpn-clone-all' },
            el('button', { class: 'gpn-link', type: 'button', onclick: () => pickAll(true) }, '全部勾選'),
            el('button', { class: 'gpn-link', type: 'button', onclick: () => pickAll(false) }, '全部不勾'),
            el('button', { class: 'gpn-link', type: 'button', onclick: () => openAll(true) }, '全部展開'),
            el('button', { class: 'gpn-link', type: 'button', onclick: () => openAll(false) }, '全部收起'))),
        ui.cTree),
      el('div', { class: 'gpn-clone-dfoot' },
        ui.cCount, ui.cPickMsg,
        el('div', { class: 'gpn-clone-dbtns' },
          el('button', { class: 'gpn-btn gpn-btn--cancel', type: 'button', onclick: closePick }, '取消'), ui.cGo)));
    ui.cPickLayer = el('div', { class: 'gpn-edit-layer gpn-clone-layer' }, ui.cPickDialog);
  }

  function zoomPick(on = !ui.cPickDialog.classList.contains('is-zoomed')) {
    ui.cPickDialog.classList.toggle('is-zoomed', on);
    ui.cZoom.innerHTML = on ? ICON_SHRINK : ICON_EXPAND;
    ui.cZoom.title = on ? '縮小' : '放大';
    ui.cZoom.setAttribute('aria-label', ui.cZoom.title);
  }

  async function openPick(mode, clone = null) {
    disarmCloneDelete();
    ui.cDone.hidden = true;
    // diff：分身裡也有、但標題或內容和我的不一樣的（推過去會換成我的，畫面上要標出來）
    const pick = { mode, clone, tabs: new Set(), folders: new Set(), items: new Set(), open: new Set(), diff: new Set() };
    if (mode === 'push') {
      // 分身裡已經有的先勾好（id 一樣就是當初給的那一則）
      setCloneMsg('讀取分身的內容…', 'ok');
      const r = await cloud.readClone(clone.fileId);
      if (!r || !r.ok) { setCloneMsg(r?.error || '讀不到這個分身，請稍後再試'); return; }
      setCloneMsg('');
      const have = gpnNormalize(r.data);
      const theirs = new Map();
      for (const t of have.tabs) {
        pick.tabs.add(t.id);
        for (const l of gpnListsOf(t)) {
          if (l !== t) pick.folders.add(l.id);
          for (const it of l.items) { pick.items.add(it.id); theirs.set(it.id, it); }
        }
      }
      for (const t of data.tabs) {
        for (const l of gpnListsOf(t)) {
          for (const it of l.items) {
            const o = theirs.get(it.id);
            if (o && (o.title !== it.title || o.content !== it.content)) {
              pick.diff.add(it.id);
              // 有不一樣的，就把它所在的書籤、資料夾先展開，看得到是哪幾則
              pick.open.add(t.id);
              if (l !== t) pick.open.add(l.id);
            }
          }
        }
      }
      // 只留我這邊也有的
      const mine = new Set();
      for (const t of data.tabs) { mine.add(t.id); for (const l of gpnListsOf(t)) { mine.add(l.id); for (const it of l.items) mine.add(it.id); } }
      for (const set of [pick.tabs, pick.folders, pick.items]) for (const id of [...set]) if (!mine.has(id)) set.delete(id);
    }
    if (data.tabs.length === 1) pick.open.add(data.tabs[0].id);    // 只有一個書籤就直接展開
    if (hasAvatars()) pick.avatar = gpnRandomAvatar();
    cPick = pick;
    ui.cName.value = '';
    ui.cName.classList.remove('is-bad');
    ui.cNameField.hidden = mode !== 'create';
    ui.cAvatarField.hidden = mode !== 'create' || !hasAvatars();
    if (ui.cAvatarPicker) { ui.cAvatarPicker.set(pick.avatar); ui.cAvatarPicker.close(); }
    ui.cPickTitle.textContent = mode === 'create' ? '建立分身' : `再推一次：分身「${clone.label}」`;
    ui.cTreeLabel.textContent = mode === 'create' ? '要放進分身的提示詞' : '要推過去的提示詞';
    ui.cGo.textContent = mode === 'create' ? '建立分身' : '推過去';
    ui.cGo.disabled = false;
    ui.cPickMsg.textContent = '';
    zoomPick(false);
    paintPick();
    ui.cTree.scrollTop = 0;
    showLayer(ui.cPickLayer);
    if (mode === 'create') setTimeout(() => ui.cName.focus(), 30);
  }

  function closePick() {
    cPick = null;
    if (ui.cPickLayer) hideLayer(ui.cPickLayer);
  }

  /** 這個書籤、資料夾裡的提示詞勾了幾則：'all' | 'some' | 'none'（空的看自己有沒有勾） */
  function pickState(ids, selfId, selfSet) {
    if (!ids.length) return selfSet.has(selfId) ? 'all' : 'none';
    const n = ids.filter((id) => cPick.items.has(id)).length;
    return n === ids.length ? 'all' : n ? 'some' : 'none';
  }

  function pickAll(on) {
    for (const t of data.tabs) {
      for (const l of gpnListsOf(t)) {
        if (l !== t) cPick.folders[on ? 'add' : 'delete'](l.id);
        for (const it of l.items) cPick.items[on ? 'add' : 'delete'](it.id);
      }
      cPick.tabs[on ? 'add' : 'delete'](t.id);
    }
    paintPick();
  }

  function openAll(on) {
    cPick.open = new Set();
    if (on) for (const t of data.tabs) { cPick.open.add(t.id); for (const f of t.folders || []) cPick.open.add(f.id); }
    paintPick();
  }

  function paintPick() {
    if (!cPick) return;
    const keep = ui.cTree.scrollTop;
    const box = (state, onchange, label) => {
      const input = el('input', { type: 'checkbox', class: 'gpn-clone-check', 'aria-label': label, onchange });
      input.checked = state === 'all';
      input.indeterminate = state === 'some';
      return input;
    };
    const toggle = (set, id) => { set[set.has(id) ? 'delete' : 'add'](id); };
    const setMany = (on, tabId, lists) => {
      if (tabId) cPick.tabs[on ? 'add' : 'delete'](tabId);
      for (const l of lists) {
        if (l.id && l.id !== tabId) cPick.folders[on ? 'add' : 'delete'](l.id);
        for (const it of l.items) cPick.items[on ? 'add' : 'delete'](it.id);
      }
      paintPick();
    };
    /** 展開／收起的三角形（裡面是空的就不能按） */
    const caret = (id, label, has) => {
      const open = cPick.open.has(id);
      return el('button', {
        class: 'gpn-clone-caret' + (open ? ' is-open' : ''), type: 'button', 'aria-expanded': String(open),
        'aria-label': open ? `收起「${label}」` : `展開「${label}」`, disabled: has ? null : '',
        onclick: () => { toggle(cPick.open, id); paintPick(); },
      }, '▸');
    };
    const count = (ids) => el('span', { class: 'gpn-clone-n', text: `${ids.filter((id) => cPick.items.has(id)).length}/${ids.length}` });
    const itemRow = (it, deep) => el('div', { class: 'gpn-clone-row gpn-clone-row--item' + (deep ? ' gpn-clone-row--deep' : '') },
      el('span', { class: 'gpn-clone-caret-space' }),
      box(cPick.items.has(it.id) ? 'all' : 'none', () => { toggle(cPick.items, it.id); paintPick(); }, it.title || '提示詞'),
      el('span', { class: 'gpn-clone-text', text: it.title || it.content.slice(0, 40) || '（沒有標題）' }),
      cPick.diff.has(it.id) ? el('span', {
        class: 'gpn-clone-diff', text: '分身裡的不一樣',
        title: '分身裡這一則被改過（或你改過）。勾著推過去，分身裡的會換成你現在的版本',
      }) : null);

    const rows = [];
    for (const t of data.tabs) {
      const lists = gpnListsOf(t);
      const ids = lists.flatMap((l) => l.items.map((i) => i.id));
      const ts = pickState(ids, t.id, cPick.tabs);
      const inside = t.folders ? t.folders.length : t.items.length;
      rows.push(el('div', { class: 'gpn-clone-row gpn-clone-row--tab' },
        caret(t.id, t.label, inside > 0),
        box(ts, () => setMany(ts !== 'all', t.id, lists), t.label),
        el('span', { class: 'gpn-clone-dot', 'data-color': t.color }),
        el('span', { class: 'gpn-clone-text', text: t.label }),
        count(ids)));
      if (!cPick.open.has(t.id)) continue;
      if (!t.folders) {
        for (const it of t.items) rows.push(itemRow(it, false));
        continue;
      }
      for (const f of t.folders) {
        const fids = f.items.map((i) => i.id);
        const fs = pickState(fids, f.id, cPick.folders);
        rows.push(el('div', { class: 'gpn-clone-row gpn-clone-row--folder' },
          caret(f.id, f.label, f.items.length > 0),
          box(fs, () => setMany(fs !== 'all', null, [f]), f.label),
          el('span', { class: 'gpn-clone-text', text: f.label }),
          count(fids)));
        if (cPick.open.has(f.id)) for (const it of f.items) rows.push(itemRow(it, true));
      }
    }
    ui.cTree.replaceChildren(...rows);
    ui.cTree.scrollTop = keep;
    const n = cPick.items.size;
    const over = [...cPick.diff].filter((id) => cPick.items.has(id)).length;
    ui.cCount.textContent = !n ? '還沒有勾選任何提示詞'
      : cPick.mode === 'push'
        ? `勾了 ${n} 則。分身裡已經有的會換成你現在的版本` + (over ? `（其中 ${over} 則分身裡的不一樣，不想蓋掉就取消勾選）` : '') +
          '；分身自己新增的不會動。'
        : `勾了 ${n} 則提示詞`;
  }

  async function onPickGo() {
    if (!cPick) return;
    ui.cPickMsg.textContent = '';
    if (!cPick.items.size && !cPick.tabs.size && !cPick.folders.size) { ui.cPickMsg.textContent = '請先勾選要放進分身的提示詞'; return; }
    const sub = gpnCloneSubset(data, cPick);
    if (cPick.mode === 'create') {
      const label = ui.cName.value.trim();
      if (!label) { ui.cName.classList.add('is-bad'); ui.cName.focus(); ui.cPickMsg.textContent = '請幫分身取個名字'; return; }
      ui.cGo.disabled = true;
      ui.cGo.textContent = '建立中…';
      const r = await cloud.createClone(label, sub, cPick?.avatar || '');
      ui.cGo.disabled = false;
      ui.cGo.textContent = '建立分身';
      if (!r || !r.ok) { ui.cPickMsg.textContent = r?.error || '沒辦法建立分身，請稍後再試'; return; }
      closePick();
      clones = [r.clone, ...(clones || [])];
      refreshClones();
      showCloneDone(r.clone, gpnCountItems(sub));
    } else {
      const c = cPick.clone;
      ui.cGo.disabled = true;
      ui.cGo.textContent = '推送中…';
      const r = await cloud.pushClone(c.fileId, sub);
      ui.cGo.disabled = false;
      ui.cGo.textContent = '推過去';
      if (!r || !r.ok) { ui.cPickMsg.textContent = r?.error || '沒辦法推過去，請稍後再試'; return; }
      closePick();
      toast(r.added || r.updated
        ? `已推進分身「${c.label}」：新增 ${r.added} 則、更新 ${r.updated} 則`
        : `分身「${c.label}」已經是最新的了`);
    }
  }

  /** 剛建立好：大大的代號＋複製按鈕 */
  function showCloneDone(c, n) {
    ui.cDone.replaceChildren(
      el('div', { class: 'gpn-label', text: `分身「${c.label}」建立好了（${n} 則提示詞）` }),
      el('code', { class: 'gpn-clone-big', text: gpnFormatCloneId(c.id) }),
      el('div', { class: 'gpn-brow' },
        el('button', { class: 'gpn-btn2', type: 'button', onclick: () => copyInvite(c) }, '複製代號和網址')),
      el('div', { class: 'gpn-note', text:
        `把代號和網址給同事：打開 ${GPN_CLOUD.site}，在登入畫面按「選擇其他登入方式」，輸入代號就能使用。` +
        '代號就像密碼，拿到的人都能使用、修改這個分身；不想給了就按「銷毀」。下面的清單隨時看得到代號。' }));
    ui.cDone.hidden = false;
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
          onclick: onDownloadBackup,
        }, '⬇　下載（做備份）')),
      ui.bStats,
      ui.bPrelogin = el('div', { class: 'gpn-prelogin', hidden: '' }),
      el('div', { class: 'gpn-sep' }),
      field('匯入', null,
        el('div', { class: 'gpn-brow' }, ui.bPick),
        ui.bFile,
        el('div', { class: 'gpn-seg-row' }, ui.bMerge, ui.bReplace),
        ui.bNote,
        ui.bImport)
    );
  }

  /**
   * 下載備份檔：提示詞，加上我的最愛、星號、使用記錄、這台的背景（換電腦時全部跟著過去）。
   * 有連結 Google 雲端硬碟的話，檔名帶帳號（apple@gmail.com → 罐頭P_apple_日期.json），看得出是誰的。
   */
  async function onDownloadBackup() {
    const look = gpnCleanLook(data.look);
    const wallpaper = look.bg === 'custom' ? await prefs.get(GPN_WALLPAPER_KEY) : null;
    const email = cloudState.signedIn ? cloudState.email || '' : '';
    gpnDownloadExport(data, { email, look: { bg: look.bg, wallpaper: wallpaper || null } });
    toast('備份檔已開始下載');
  }

  /**
   * 備份檔裡的背景：完全取代就照備份換；合併的話，已經自己選了背景就不動。
   * 換了就寫進 data.look（跟著同步），上傳的圖另外送上雲端。回傳有沒有換。
   */
  async function importLook(look, replace) {
    if (!look) return false;
    const cur = gpnCleanLook(data.look);
    if (!replace && cur.bg !== 'default') return false;
    let wid = '';
    if (look.bg === 'custom') {
      if (!look.wallpaper) return false;
      wid = wallpaperId(look.wallpaper);
      if (!(await prefs.set(GPN_WALLPAPER_KEY, look.wallpaper))) return false;   // 存不下就算了
      await prefs.set(GPN_WALLPAPER_ID_KEY, wid);
      hasCustomBg = true;
      uploadWallpaper(wid, look.wallpaper);
    }
    const next = gpnCleanLook({ ...cur, bg: look.bg, wallpaper: wid });
    if (JSON.stringify(next) === JSON.stringify(cur)) return false;
    data.look = next;
    return true;
  }

  /** 登入時被雲端換掉的「這台原本的提示詞」（見 sync.js）：留一個下載的地方，萬一要找回來 */
  async function refreshPrelogin() {
    if (!ui.bPrelogin) return;
    const p = await prefs.get('gpn_prelogin_v1');
    const n = p?.data ? gpnCountItems(gpnNormalize(p.data)) : 0;
    ui.bPrelogin.hidden = !n;
    if (!n) return;
    const d = new Date(p.at);
    ui.bPrelogin.replaceChildren(
      el('div', { class: 'gpn-note', text:
        `${d.getMonth() + 1}/${d.getDate()} 登入時，這台電腦原本的 ${n} 則提示詞換成了雲端上的。原本的另外留了一份：` }),
      el('div', { class: 'gpn-brow' },
        el('button', {
          class: 'gpn-btn2', type: 'button',
          onclick: () => { gpnDownloadExport(gpnNormalize(p.data)); toast('已開始下載登入前的提示詞'); },
        }, '⬇　下載登入前的提示詞'),
        el('button', {
          class: 'gpn-btn2', type: 'button',
          onclick: async () => { await prefs.remove('gpn_prelogin_v1'); refreshPrelogin(); toast('已刪掉這份舊資料'); },
        }, '不需要了，刪掉')));
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
    // 備份裡還有哪些自己的東西（4.15.0 以前的備份沒有）
    const extras = [
      parsed.markedCount ? `${parsed.markedCount} 則我的最愛和星號` : '',
      parsed.recentCount ? `${parsed.recentCount} 筆使用記錄` : '',
      parsed.look && parsed.look.bg !== 'default' ? '背景' : '',
    ].filter(Boolean).join('、');
    if (backupMode === 'merge') {
      const p = gpnPreviewMerge(data, parsed.data);
      ui.bNote.classList.add('is-ok');
      ui.bNote.textContent = (p.added
        ? `會加入 ${p.added} 則新的提示詞` + (p.skipped ? `，${p.skipped} 則已經有了` : '')
        : `${parsed.itemCount} 則都已經有了`) +
        (extras ? `；另外也會合併：${extras}` : (p.added ? '' : '，不會有變化'));
    } else {
      const have = gpnCountItems(data);
      ui.bNote.classList.add('is-bad');
      ui.bNote.textContent = `現有的 ${have} 則會換成備份裡的 ${parsed.itemCount} 則` +
        (extras ? `，${extras}也換成備份裡的` : '');
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
    const keepLook = data.look;

    let msg;
    const replace = backupMode === 'replace';
    if (!replace) {
      const r = gpnMergeData(data, parsed.data);
      data = r.data;
      msg = r.added ? `已加入 ${r.added} 則提示詞` : '沒有新的提示詞';
    } else if (parsed.personal) {
      // 新的備份有我的最愛、星號、使用記錄：一起換成備份裡的
      data = gpnNormalize(parsed.data);
      msg = `已匯入 ${gpnCountItems(data)} 則提示詞`;
    } else {
      // 舊的備份沒有這些：留著這台的（我的最愛、星號只留備份裡還找得到的那幾則）
      data = gpnNormalize({ ...parsed.data, recent: data.recent, favs: data.favs, marks: data.marks, markTypes: data.markTypes });
      msg = `已匯入 ${gpnCountItems(data)} 則提示詞`;
    }
    data.look = keepLook;                       // 背景交給 importLook 決定
    if (await importLook(parsed.look, replace)) msg += '，背景也換好了';
    applyTheme();
    folderId = null;
    await persist();
    syncLook();
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
    refreshPrelogin();
  }

  /* ---- 背景（只有網頁版、工具列小視窗顯示）----
     筆記本是霧面玻璃，背後的圖會模糊地透出來。可以選：
       預設光暈（網頁本身的 page.css）、內建的幾張（backgrounds.js 用 canvas 畫的）、自己上傳的桌布。
     4.16.0 起跟著帳號同步：選了哪一張存在 data.look（見 store.js），換電腦登入背景也一樣。
     上傳的圖太大，不放進筆記本：這台留一份（prefs），雲端硬碟另外存一個檔案（sync.js 的 putWallpaper），
     data.look.wallpaper 只記代號，別台代號對不上才去下載。
       gpn_wallpaper          上傳的圖（先縮成最長邊 1920px 的 JPG）
       gpn_wallpaper_id       這台手上那張圖的代號
       gpn_wallpaper_unsent   上傳失敗（沒網路）的圖的代號，連上了再補傳
       gpn_bg                 4.16.0 以前「這台選了哪一張」，只在第一次升級時搬進 data.look */
  const GPN_BG_KEY = 'gpn_bg';
  const GPN_WALLPAPER_KEY = 'gpn_wallpaper';
  const GPN_WALLPAPER_ID_KEY = 'gpn_wallpaper_id';
  const GPN_WALLPAPER_UNSENT_KEY = 'gpn_wallpaper_unsent';
  const bgPresets = typeof GPN_BACKGROUNDS !== 'undefined' ? GPN_BACKGROUNDS : [];
  let bgChoice = 'default';
  let bgUrl = '';            // 目前套用中的圖（blob: 網址）
  let bgApplied = '';        // 目前畫面上的背景（bg|wallpaper），一樣就不重畫
  let hasCustomBg = false;
  let lookBusy = false;

  /** 圖的代號：內容一樣代號就一樣 */
  function wallpaperId(dataUrl) {
    let h = 0x811c9dc5;
    for (let i = 0; i < dataUrl.length; i++) {
      h ^= dataUrl.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return 'w' + h.toString(36) + dataUrl.length.toString(36);
  }

  /** 上傳的圖送上雲端；沒登入或失敗就記著，連上了再補（retryWallpaper） */
  async function uploadWallpaper(wid, url) {
    const r = cloud?.putWallpaper && cloudState.signedIn ? await cloud.putWallpaper(wid, url) : null;
    if (r?.ok) await prefs.remove(GPN_WALLPAPER_UNSENT_KEY);
    else await prefs.set(GPN_WALLPAPER_UNSENT_KEY, wid);
  }

  async function retryWallpaper() {
    if (lookBusy) return;
    const wid = await prefs.get(GPN_WALLPAPER_UNSENT_KEY);
    if (!wid) return;
    const [mine, url] = await Promise.all([prefs.get(GPN_WALLPAPER_ID_KEY), prefs.get(GPN_WALLPAPER_KEY)]);
    if (mine !== wid || !url) { await prefs.remove(GPN_WALLPAPER_UNSENT_KEY); return; }
    lookBusy = true;
    try { await uploadWallpaper(wid, url); } finally { lookBusy = false; }
  }

  /**
   * 照 data.look 換背景（別台換了、剛登入、匯入了）。
   * 選的是別台上傳的圖、這台還沒有：先去雲端下載，下載到之前維持原本的背景。
   */
  /**
   * 資源回收桶的背景：在回收桶裡不管原本選了什麼，一律換成回收桶的背景（紅色警示，提醒這裡是危險區域）；
   * 離開時換回原本的。外掛在 AI 網站裡的面板也一樣（平常沒有背景，進回收桶才有）。
   */
  /**
   * 資源回收桶的警示（4.22.0）：背景沿用使用者自己選的，只是冒出 4 個大大小小的紅色警示三角形，
   * 大的在後面、比較模糊、比較淡；小的在前面、比較清楚，一個接一個彈出來，之後輕輕漂著。
   * 刻意只放幾個、分散在四周（筆記本在中間），不要像壁紙一樣排滿整面。
   */
  const TRASH_FX = [
    // [左 %, 上 %, 大小（畫面短邊的 %）, 模糊 px, 不透明度, 旋轉 deg, 第幾個出現]
    [-5, 50, 42, 14, 0.32, -8, 0],    // 左下，最大最後面（一半露在畫面外）
    [82, 4, 28, 7, 0.45, 10, 1],      // 右上
    [7, 9, 15, 2, 0.8, 6, 2],         // 左上，小的在前面
    [86, 66, 19, 3.5, 0.62, -12, 3],  // 右下
  ];

  function buildTrashFx() {
    ui.trashFx = el('div', { class: 'gpn-trash-fx', 'aria-hidden': 'true' });
    for (const [x, y, size, blur, alpha, rot, i] of TRASH_FX) {
      const n = el('div', { class: 'gpn-warn', html: ICON_WARN_BIG });
      n.style.cssText = `left:${x}%;top:${y}%;--s:${size}vmin;--blur:${blur}px;--a:${alpha};--rot:${rot}deg;--i:${i}`;
      ui.trashFx.append(n);
    }
  }

  /** 進回收桶時讓三角形重新彈一次（拿掉再放回去，動畫才會重播） */
  function paintTrashFx(on) {
    if (!ui.trashFx) {
      if (!on) return;
      buildTrashFx();
    }
    if (on && !ui.trashFx.isConnected) ui.overlay.prepend(ui.trashFx);
    else if (!on && ui.trashFx.isConnected) ui.trashFx.remove();
  }

  async function syncLook() {
    applyTheme();
    if (!standalone) return;
    const want = gpnCleanLook(data.look);
    if (want.bg === 'custom') {
      const [mine, url] = await Promise.all([prefs.get(GPN_WALLPAPER_ID_KEY), prefs.get(GPN_WALLPAPER_KEY)]);
      if (mine !== want.wallpaper || !url) {
        if (!cloud?.getWallpaper || !cloudState.signedIn || lookBusy) return;
        lookBusy = true;
        let r = null;
        try { r = await cloud.getWallpaper(want.wallpaper); } finally { lookBusy = false; }
        if (!r?.ok || !r.dataUrl) return;
        if (!(await prefs.set(GPN_WALLPAPER_KEY, r.dataUrl))) return;
        await prefs.set(GPN_WALLPAPER_ID_KEY, want.wallpaper);
        hasCustomBg = true;
        renderBgTiles();
      }
    }
    const key = want.bg + '|' + want.wallpaper;
    if (key === bgApplied) return;
    bgApplied = key;
    await applyBackground(want.bg);
  }

  /** 4.16.0 以前背景只記在這台：第一次升級時搬進 data.look，之後就跟著帳號同步 */
  async function migrateLook() {
    if (!standalone || (await prefs.get('gpn_look_migrated'))) return;
    await prefs.set('gpn_look_migrated', true);
    const [bg, url] = await Promise.all([prefs.get(GPN_BG_KEY), prefs.get(GPN_WALLPAPER_KEY)]);
    const old = bg || (url ? 'custom' : 'default');
    if (old === 'default' || gpnCleanLook(data.look).bg !== 'default') return;
    let wid = '';
    if (old === 'custom') {
      if (!url) return;
      wid = wallpaperId(url);
      await prefs.set(GPN_WALLPAPER_ID_KEY, wid);
      uploadWallpaper(wid, url);
    }
    data.look = gpnCleanLook({ ...gpnCleanLook(data.look), bg: old, wallpaper: wid });
    persist();
  }

  /* ---- 深淺主題（設定 → 背景 最上面）----
     平常外掛跟著 AI 網站、網頁版和小視窗跟著系統（各自在 content.js、app.js、popup.js 設 data-theme）。
     選了「淺色」「深色」就蓋過去：記下它們原本要的（natural），它們之後再改也照樣蓋回來；選回「跟著系統」就還給它。 */
  let naturalTheme = root.host?.getAttribute('data-theme') || '';
  let themeGuard = false;
  if (root.host) {
    new MutationObserver(() => {
      if (themeGuard) return;
      naturalTheme = root.host.getAttribute('data-theme') || naturalTheme;
      applyTheme();
    }).observe(root.host, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function applyTheme() {
    if (!root.host) return;
    const want = gpnCleanLook(data.look).theme;
    // 網頁版、工具列小視窗：網頁本身的底色（預設光暈）也要跟著換（page.css、popup.html 看 data-gpn-theme）
    if (standalone) {
      if (want === 'auto') document.documentElement.removeAttribute('data-gpn-theme');
      else document.documentElement.setAttribute('data-gpn-theme', want);
    }
    const t = want === 'auto' ? naturalTheme : want;
    if (!t || root.host.getAttribute('data-theme') === t) return;
    themeGuard = true;
    root.host.setAttribute('data-theme', t);
    Promise.resolve().then(() => { themeGuard = false; });
  }

  function chooseTheme(theme) {
    sfx('click');
    data.look = gpnCleanLook({ ...gpnCleanLook(data.look), theme });
    persist();
    applyTheme();
    markThemeSeg();
  }

  function markThemeSeg() {
    const cur = gpnCleanLook(data.look).theme;
    for (const b of ui.lTheme?.children || []) b.classList.toggle('is-on', b.getAttribute('data-theme-pick') === cur);
  }

  function buildLookSection() {
    ui.lFile = el('input', { type: 'file', accept: 'image/*', class: 'gpn-file', onchange: onPickWallpaper });
    ui.lGrid = el('div', { class: 'gpn-bg-grid', role: 'radiogroup', 'aria-label': '背景' });
    const pick = (key, text) => el('button', {
      class: 'gpn-seg', type: 'button', 'data-theme-pick': key, onclick: () => chooseTheme(key),
    }, text);
    ui.lTheme = el('div', { class: 'gpn-seg-row gpn-seg-row--theme' },
      pick('auto', '跟著系統'), pick('light', '☀ 淺色'), pick('dark', '☾ 深色'));
    return el('section', { class: 'gpn-section', 'data-section': 'look' },
      el('h3', { text: '背景' }),
      field('深淺主題', '（外掛在 AI 網站裡選「跟著系統」時，跟著那個網站）', ui.lTheme),
      el('div', { class: 'gpn-sep' }),
      ui.lGrid,
      ui.lFile,
      el('div', { class: 'gpn-note', text: '背景、深淺主題都跟著帳號同步：換一台電腦登入也一樣（上傳的圖也會存到你的 Google 雲端硬碟）' }));
  }

  /** 背景的縮圖格子：預設光暈、內建的幾張、自己上傳的（有的話），最後一格是「上傳圖片」 */
  function renderBgTiles() {
    if (!ui.lGrid) return;
    const tile = (id, label, thumb) => el('button', {
      class: 'gpn-bg-tile', type: 'button', role: 'radio', 'data-bg': id,
      onclick: () => chooseBackground(id),
    }, thumb, el('span', { class: 'gpn-bg-name', text: label }));

    const tiles = [tile('default', '預設光暈', el('span', { class: 'gpn-bg-thumb gpn-bg-thumb--default' }))];
    for (const b of bgPresets) {
      const c = el('canvas', { width: '240', height: '150' });   // 縮圖用同一個函式畫，長相和大圖一樣
      gpnPaintBackground(c, b.id);
      tiles.push(tile(b.id, b.label, el('span', { class: 'gpn-bg-thumb' }, c,
        b.live ? el('span', { class: 'gpn-bg-badge', text: '動態' }) : null)));
    }
    if (hasCustomBg) {
      const thumb = el('span', { class: 'gpn-bg-thumb' });
      prefs.get(GPN_WALLPAPER_KEY).then((u) => { if (u) thumb.style.backgroundImage = `url("${u}")`; });
      tiles.push(tile('custom', '我的圖片', thumb));
    }
    tiles.push(el('button', {
      class: 'gpn-bg-tile', type: 'button', title: '用自己的圖片當背景', onclick: () => ui.lFile.click(),
    }, el('span', { class: 'gpn-bg-thumb gpn-bg-thumb--add', html: ICON_IMAGE }),
      el('span', { class: 'gpn-bg-name', text: '上傳圖片…' })));
    ui.lGrid.replaceChildren(...tiles);
    markBgTiles();
    markThemeSeg();
  }

  function markBgTiles() {
    for (const t of ui.lGrid?.querySelectorAll('[data-bg]') || []) {
      t.setAttribute('aria-checked', String(t.getAttribute('data-bg') === gpnCleanLook(data.look).bg));
    }
  }

  /** 整張圖偏暗、中間、偏亮（量一張 16 × 10 的縮圖的平均亮度） */
  async function imageTone(blob) {
    const img = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 10;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, 16, 10);
    img.close?.();
    const d = x.getImageData(0, 0, 16, 10).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const avg = sum / (d.length / 4) / 255;
    return avg < 0.4 ? 'dark' : avg > 0.7 ? 'light' : 'mid';
  }

  /**
   * 把背景鋪到整個畫面（遮罩層）。內建的背景當場畫一張 1920 × 1200 的圖。
   * 同時標上圖的明暗（data-tone）：淺色主題配上偏暗的圖，styles.css 會把玻璃調得實一點。
   */
  let liveStop = null;       // 動態背景正在跑的話，停下它的函式

  function stopLive() {
    liveStop?.();
    liveStop = null;
    ui.liveBg?.remove();
  }

  async function applyBackground(id) {
    stopLive();
    // 動態背景：遮罩最底下放一張一直重畫的 canvas（backgrounds.js 的 gpnAnimateBackground）
    const live = bgPresets.find((b) => b.id === id && b.live);
    if (live) {
      if (bgUrl) URL.revokeObjectURL(bgUrl);
      bgUrl = '';
      ui.liveBg = ui.liveBg || el('canvas', { class: 'gpn-bg-live', width: '960', height: '600', 'aria-hidden': 'true' });
      ui.overlay.prepend(ui.liveBg);
      liveStop = gpnAnimateBackground(ui.liveBg, id);
      bgChoice = id;
      ui.overlay.style.backgroundImage = '';
      ui.overlay.classList.add('has-wallpaper');
      ui.overlay.setAttribute('data-tone', live.tone || 'mid');
      markBgTiles();
      return;
    }
    let url = '', tone = '';
    try {
      if (id === 'custom') {
        const d = await prefs.get(GPN_WALLPAPER_KEY);
        if (d) {
          // 換成 blob: 短網址再交給 CSS，比直接塞一整串 base64 輕
          const blob = await (await fetch(d)).blob();
          tone = await imageTone(blob).catch(() => 'mid');
          url = URL.createObjectURL(blob);
        }
      } else if (bgPresets.some((b) => b.id === id)) {
        tone = bgPresets.find((b) => b.id === id).tone || 'mid';
        const c = document.createElement('canvas');
        c.width = 1920;
        c.height = 1200;
        gpnPaintBackground(c, id);
        const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej()), 'image/jpeg', 0.92));
        url = URL.createObjectURL(blob);
      }
    } catch {
      url = '';
    }
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = url;
    bgChoice = url ? id : 'default';
    ui.overlay.style.backgroundImage = url ? `url("${url}")` : '';
    ui.overlay.classList.toggle('has-wallpaper', !!url);
    ui.overlay.setAttribute('data-tone', url ? tone : '');
    markBgTiles();
  }

  async function chooseBackground(id) {
    sfx('click');
    const wallpaper = id === 'custom' ? (await prefs.get(GPN_WALLPAPER_ID_KEY)) || '' : '';
    data.look = gpnCleanLook({ ...gpnCleanLook(data.look), bg: id, wallpaper });
    persist();
    await syncLook();
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
    const wid = wallpaperId(url);
    await prefs.set(GPN_WALLPAPER_ID_KEY, wid);
    hasCustomBg = true;
    bgApplied = '';                     // 同樣是「我的圖片」，但換了一張：要重畫
    await chooseBackground('custom');
    renderBgTiles();
    toast('已換成新的背景');
    uploadWallpaper(wid, url);
  }

  /* ==========================================================================
     九、開關與鍵盤
     ========================================================================== */

  const isOpen = () => ui.overlay.classList.contains('is-open');

  async function open() {
    data = await GpnStore.load();
    await migrateLook();
    render();
    syncLook();
    ui.overlay.classList.add('is-open');
    revealActiveFolder();
    onOpenChange(true);
    // 每次打開都跟雲端對一下：別台剛改的東西，這裡馬上看得到
    cloud?.syncNow();
    if (cloud) noticeInbox();
  }

  function close() {
    if (standalone) return;          // 網頁版、工具列小視窗：面板就是整個畫面，不能關
    closeCardMenu();
    closeEditor();
    closeNewTab();
    closeFolderEditor();
    closeSettings();
    ui.overlay.classList.remove('is-open');
    onOpenChange(false);
  }

  function onKeydown(e) {
    if (!isOpen()) return;
    // 資源回收桶：Ctrl＋A 全選、Delete 永久刪除選取的（按兩次）、Esc 取消選取
    if (activeTab().trash && searchQ === null && !anyLayerOpen() && !menuFor) {
      const inField = /^(INPUT|TEXTAREA)$/.test(root.activeElement?.tagName || '');
      if (!inField && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        trashSel = new Set(trashList().map((r) => r.id));
        paintTrashSelection();
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (!inField && e.key === 'Delete' && trashSel.size) {
        onTrashPurge();
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (e.key === 'Escape') {
        if (trashSel.size) { trashSel = new Set(); paintTrashSelection(); }
        else leaveTrash(true);
        e.preventDefault(); e.stopPropagation();
        return;
      }
    }
    if (e.key !== 'Escape') return;

    if (menuFor) {
      const btn = menuFor;
      closeCardMenu();
      btn.focus();
    } else if (searchQ !== null && !anyLayerOpen()) {
      exitSearch();
    } else if (ui.shareLayer && layerOpen(ui.shareLayer)) {
      closeShare();
    } else if (ui.inboxLayer && layerOpen(ui.inboxLayer) && !layerOpen(ui.editLayer)) {
      closeInbox();
    } else if (ui.cPickLayer && layerOpen(ui.cPickLayer)) {
      if (ui.cAvatarPicker && ui.cAvatarPicker.node.querySelector('[aria-expanded="true"]')) ui.cAvatarPicker.close();
      else closePick();
    } else if (layerOpen(ui.settingsLayer)) {
      if (ui.cInfo && !ui.cInfo.hidden) toggleCloneInfo(false);
      else if (!ui.sConfirm.hidden) hideFolderConfirm();
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
  if (standalone) {
    prefs.get(GPN_WALLPAPER_KEY).then((custom) => {
      hasCustomBg = !!custom;
      renderBgTiles();
    });
  }

  // 其他分頁或雲端改了資料時同步過來；正在編輯就先別動畫面，免得打到一半的字不見
  GpnStore.onExternalChange((fresh) => {
    data = fresh;
    syncLook();                 // 別台換了背景
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
    // 還沒登入時畫面就是登入畫面，不用另外打開設定
    openAccount: () => { if (cloud && cloudState.configured && cloudState.signedIn) openSettings(data.activeId, 'account'); },
  };
}
