/**
 * 網頁版的資料存取層：存在瀏覽器的 localStorage。
 *
 * 和外掛版（src/store.js）最大的差別只有「存在哪裡」：
 *   外掛   → chrome.storage.local（跟著 Chrome 帳號，換頁面也還在）
 *   網頁版 → localStorage（跟著這台電腦的這個瀏覽器、這個網址）
 *
 * 資料「長相」則完全一樣，見下面的共用資料契約。
 */

/* ==== 共用資料契約 開始 ====================================================
   以下到「共用資料契約 結束」為止，src/store.js 和 web/store.js 必須一字不差。
   網頁版和外掛靠匯出／匯入交換資料，格式一旦分岔就同步不了。
   tools/checksync.py 會比對這一段，不一樣就會報錯。
   ========================================================================== */

const GPN_KEY = 'gpn_data_v1';          // 沿用同一個 key，才能讀到舊資料
const GPN_VERSION = 4;
const GPN_MAX_TABS = 8;                  // 太多書籤會擠不下，設一個上限
const GPN_MAX_FOLDERS = 12;              // 每個書籤最多幾個資料夾
const GPN_MAX_LABEL = 100;               // 書籤名稱的上限只是防呆（不限字數，太長的畫面上用「…」）
const GPN_DEFAULT_FOLDER = '一般';        // 書籤剛開啟資料夾時，原本的提示詞放在這裡
const GPN_RECENT_ID = 't_recent';        // 「最近使用」書籤的 id（固定、不能刪）
const GPN_RECENT_MAX = 50;               // 最近使用最多記幾筆
const GPN_FAV_ID = 't_star';             // 「我的最愛」書籤的 id（固定、不能刪；注意不是預設書籤「常用」的 t_fav）
const GPN_COLORS = ['amber', 'green', 'blue', 'rose', 'purple', 'teal'];
const GPN_COLOR_LABELS = {
  amber: '牛皮黃', green: '森林綠', blue: '天空藍',
  rose: '玫瑰粉', purple: '薰衣草', teal: '湖水綠',
};

/**
 * 星號的種類，和 Gmail 的「星號」設定一樣（id 沿用 Gmail 的英文名）。
 * 黃色星星就是「我的最愛」（存在 favs），固定排第一個；其他的在 marks，
 * 設定裡「使用中」的（markTypes）連續點星號時會照順序輪流換，每一種在書籤列都有自己的書籤。
 */
const GPN_MARKS = [
  'yellow-star', 'orange-star', 'red-star', 'purple-star', 'blue-star', 'green-star',
  'red-bang', 'orange-guillemet', 'yellow-bang', 'green-check', 'blue-info', 'purple-question',
];
const GPN_MARK_FAV = 'yellow-star';
const GPN_MARK_LABELS = {
  'yellow-star': '黃色星星', 'orange-star': '橘色星星', 'red-star': '紅色星星',
  'purple-star': '紫色星星', 'blue-star': '藍色星星', 'green-star': '綠色星星',
  'red-bang': '紅色驚嘆號', 'orange-guillemet': '橘色雙箭頭', 'yellow-bang': '黃色驚嘆號',
  'green-check': '綠色勾勾', 'blue-info': '藍色資訊', 'purple-question': '紫色問號',
};
const GPN_MAX_MARKS = 4;                 // 黃色星星以外最多再用幾種（每種在書籤列多一個書籤，太多會擠不下）
const GPN_MARK_TAB = 't_mark_';          // 符號書籤的 id：t_mark_ 加上種類，例如 t_mark_purple-question
const gpnMarkOfTab = (id) => (typeof id === 'string' && id.startsWith(GPN_MARK_TAB) ? id.slice(GPN_MARK_TAB.length) : '');

function gpnNewId(prefix = 'p') {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function gpnDefaultData() {
  return {
    version: GPN_VERSION,
    activeId: 't_fav',
    tabs: [
      { id: 't_fav', label: '常用', color: 'amber', items: [] },
      { id: 't_oth', label: '其他', color: 'green', items: [] },
    ],
    recent: [],
    favs: [],
    marks: {},
    markTypes: [],
    look: { bg: 'default', wallpaper: '' },
  };
}

/**
 * 背景（設定 → 背景）：跟著帳號同步，換電腦登入背景也一樣。
 *   bg         'default'、內建背景的 id（backgrounds.js）、或 'custom'（自己上傳的圖）
 *   wallpaper  上傳的圖的代號（圖很大，不放在這裡：存在雲端硬碟另一個檔案，見 sync.js 的 putWallpaper）
 */
function gpnCleanLook(l) {
  const bg = typeof l?.bg === 'string' && l.bg ? l.bg.slice(0, 40) : 'default';
  const wallpaper = bg === 'custom' && typeof l?.wallpaper === 'string' ? l.wallpaper.slice(0, 40) : '';
  return { bg, wallpaper };
}

/** 整理最近使用記錄：新的在前、同一則只留最新那次、最多 GPN_RECENT_MAX 筆 */
function gpnCleanRecent(arr) {
  const seen = new Set();
  return (Array.isArray(arr) ? arr : [])
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({
      id: typeof r.id === 'string' && r.id ? r.id : gpnNewId(),
      title: String(r.title ?? '').slice(0, 60),
      content: String(r.content ?? ''),
      usedAt: Number(r.usedAt) || 0,
      tabId: typeof r.tabId === 'string' ? r.tabId : '',
      folderId: typeof r.folderId === 'string' ? r.folderId : '',
    }))
    .sort((a, b) => b.usedAt - a.usedAt)
    .filter((r) => !seen.has(r.id) && seen.add(r.id))
    .slice(0, GPN_RECENT_MAX);
}

function gpnCleanItems(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter((it) => it && typeof it === 'object')
    .map((it) => ({
      id: typeof it.id === 'string' && it.id ? it.id : gpnNewId(),
      title: String(it.title ?? '').slice(0, 60),
      content: String(it.content ?? ''),
    }));
}

/**
 * 整理一個書籤：決定它是「不分資料夾」還是「有資料夾」，並把內容修乾淨。
 * version 是整份資料的版本號，只用來辨認 v3（見檔頭說明）。
 */
function gpnCleanTab(t, version) {
  const id = typeof t.id === 'string' && t.id ? t.id : gpnNewId('t');
  const base = {
    id,
    label: String(t.label ?? '未命名').slice(0, GPN_MAX_LABEL) || '未命名',
    color: GPN_COLORS.includes(t.color) ? t.color : 'amber',
  };

  let folders = (Array.isArray(t.folders) ? t.folders : [])
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      id: typeof f.id === 'string' && f.id ? f.id : gpnNewId('f'),
      label: String(f.label ?? '未命名').slice(0, 16) || '未命名',
      items: gpnCleanItems(f.items),
    }))
    .slice(0, GPN_MAX_FOLDERS);
  let loose = gpnCleanItems(t.items);

  // v3 替每個書籤都硬加了資料夾；只有一個「一般」的，其實沒在分類 → 還原成不分資料夾
  if (version === 3 && folders.length === 1 && folders[0].label === GPN_DEFAULT_FOLDER) {
    loose = [...folders[0].items, ...loose];
    folders = [];
  }

  if (!folders.length) return { ...base, items: loose };
  // 兩種都有（正常不會發生）：散落的提示詞收進第一個資料夾，一則都不丟
  folders[0].items.push(...loose);
  return { ...base, folders };
}

/** 把任何來源的資料修成合法的 v4 結構（含 v1、v2、v3 → v4 升級） */
function gpnNormalize(raw) {
  if (!raw || typeof raw !== 'object') return gpnDefaultData();

  let tabs;

  if (Array.isArray(raw.tabs)) {
    tabs = raw.tabs
      .filter((t) => t && typeof t === 'object')
      .slice(0, GPN_MAX_TABS)
      .map((t) => gpnCleanTab(t, raw.version));
  } else if (raw.tabs && typeof raw.tabs === 'object') {
    // v1：把 favorite / other 轉成陣列，資料原封不動搬過去
    tabs = [
      { id: 't_fav', label: '常用', color: 'amber', items: gpnCleanItems(raw.tabs.favorite?.items) },
      { id: 't_oth', label: '其他', color: 'green', items: gpnCleanItems(raw.tabs.other?.items) },
    ];
  } else {
    tabs = gpnDefaultData().tabs;
  }

  if (!tabs.length) tabs = gpnDefaultData().tabs;

  // id 全部不可重複（重複會讓切換、拖曳、移動選錯對象）
  const seen = new Set();
  const itemIds = new Set();
  const uniq = (obj, prefix) => {
    while (seen.has(obj.id)) obj.id = gpnNewId(prefix);
    seen.add(obj.id);
  };
  for (const t of tabs) {
    uniq(t, 't');
    for (const list of gpnListsOf(t)) {
      if (list !== t) uniq(list, 'f');
      for (const it of list.items) { uniq(it, 'p'); itemIds.add(it.id); }
    }
  }

  // activeId：v2 以後直接用；v1 的 active 是 'favorite' / 'other'
  // 星號：使用中的種類（黃色星星以外），照使用者排的順序
  const markTypes = (Array.isArray(raw.markTypes) ? raw.markTypes : [])
    .filter((m, i, arr) => GPN_MARKS.includes(m) && m !== GPN_MARK_FAV && arr.indexOf(m) === i)
    .slice(0, GPN_MAX_MARKS);

  let activeId = raw.activeId;
  if (!activeId && raw.active) activeId = raw.active === 'other' ? 't_oth' : 't_fav';
  const fixed = activeId === GPN_RECENT_ID || activeId === GPN_FAV_ID ||
                markTypes.includes(gpnMarkOfTab(activeId));
  if (!fixed && !tabs.some((t) => t.id === activeId)) activeId = tabs[0].id;

  // 我的最愛：只留還存在的提示詞，同一則只留一次
  const favs = (Array.isArray(raw.favs) ? raw.favs : [])
    .filter((id, i, arr) => typeof id === 'string' && itemIds.has(id) && arr.indexOf(id) === i);

  // 其他符號：一則提示詞只會有一種（和 Gmail 一樣），重複的以我的最愛、再來照 GPN_MARKS 的順序為準。
  // 沒在使用中的種類也留著：只是暫時不顯示那個書籤，加回來就會再出現
  const taken = new Set(favs);
  const marks = {};
  for (const m of GPN_MARKS) {
    if (m === GPN_MARK_FAV || !Array.isArray(raw.marks?.[m])) continue;
    const ids = raw.marks[m].filter((id) => typeof id === 'string' && itemIds.has(id) && !taken.has(id) && taken.add(id));
    if (ids.length) marks[m] = ids;
  }

  // 最近使用、我的最愛、符號的 id 指向提示詞，本來就會和提示詞的 id 重複，所以不參加上面的「不可重複」檢查
  return {
    version: GPN_VERSION, activeId, tabs, recent: gpnCleanRecent(raw.recent), favs, marks, markTypes,
    look: gpnCleanLook(raw.look),
  };
}

/** 這則提示詞標了哪種符號（黃色星星＝我的最愛），沒有就是空字串 */
function gpnMarkOf(d, id) {
  if ((d.favs || []).includes(id)) return GPN_MARK_FAV;
  for (const [m, ids] of Object.entries(d.marks || {})) if (ids.includes(id)) return m;
  return '';
}

/** 書籤裡所有「裝提示詞的清單」：有資料夾就是各個資料夾，沒有就是書籤自己 */
const gpnListsOf = (t) => (t.folders ? t.folders : [t]);

const gpnTabItemCount = (t) => gpnListsOf(t).reduce((n, l) => n + l.items.length, 0);
const gpnCountItems = (d) => d.tabs.reduce((n, t) => n + gpnTabItemCount(t), 0);
const gpnCountFolders = (d) => d.tabs.reduce((n, t) => n + (t.folders ? t.folders.length : 0), 0);

/**
 * 書籤開啟資料夾：原本的提示詞先放進「一般」資料夾。
 * 資料夾 id 由書籤 id 推出來，兩台電腦各自開啟後，合併時才認得是同一個。
 */
function gpnEnableFolders(t) {
  if (t.folders) return t;
  t.folders = [{ id: 'f_' + t.id, label: GPN_DEFAULT_FOLDER, items: t.items || [] }];
  delete t.items;
  return t;
}

/** 書籤關閉資料夾：所有資料夾依順序合併成一個清單，提示詞一則都不刪 */
function gpnDisableFolders(t) {
  if (!t.folders) return t;
  t.items = t.folders.flatMap((f) => f.items);
  delete t.folders;
  return t;
}

/* ==== 共用資料契約 結束 ================================================== */

const GpnStore = {
  cache: gpnDefaultData(),

  /** 自己寫進去的內容指紋，用來分辨 storage 事件是不是自己觸發的 */
  _mine: '',

  /**
   * 無痕模式、或公司把 localStorage 關掉時，寫入會直接丟例外。
   * 先實際試寫一次才算數——光看 window.localStorage 存不存在會誤判。
   */
  available() {
    try {
      const probe = '__gpn_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(GPN_KEY);
      this.cache = gpnNormalize(raw ? JSON.parse(raw) : null);
    } catch (err) {
      console.warn('[特務P] 讀取資料失敗，暫時使用記憶體資料：', err);
    }
    return this.cache;
  },

  save(data) {
    this.cache = gpnNormalize(data);
    try {
      this._mine = JSON.stringify(this.cache);
      localStorage.setItem(GPN_KEY, this._mine);
    } catch (err) {
      console.warn('[特務P] 儲存失敗：', err);
      return false;
    }
    for (const cb of this._onSave) cb(this.cache);
    return true;
  },

  /** 使用者在這個分頁改了資料（雲端同步靠這個知道要推上去） */
  _onSave: [],
  onLocalSave(cb) { this._onSave.push(cb); },

  /** 雲端來的新資料：寫進來，並讓面板更新（這不算使用者改的，不會觸發 onLocalSave） */
  _onExternal: [],
  applyRemote(data) {
    this.cache = gpnNormalize(data);
    try {
      this._mine = JSON.stringify(this.cache);
      localStorage.setItem(GPN_KEY, this._mine);
    } catch (err) {
      console.warn('[特務P] 儲存失敗：', err);
    }
    for (const cb of this._onExternal) cb(this.cache);
  },

  /** 同一個瀏覽器開了好幾個分頁時，改了資料要互相跟上；雲端來的新資料也走這裡 */
  onExternalChange(cb) {
    this._onExternal.push(cb);
    window.addEventListener('storage', (e) => {
      if (e.key !== GPN_KEY) return;
      if (e.newValue === this._mine) return;      // 自己剛寫的就別再重畫
      try {
        this.cache = gpnNormalize(e.newValue ? JSON.parse(e.newValue) : null);
        cb(this.cache);
      } catch { /* 壞掉的值忽略，保留目前畫面 */ }
    });
  },
};
