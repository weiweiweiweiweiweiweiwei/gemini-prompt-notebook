/**
 * 資料存取層：負責和 chrome.storage.local 溝通。
 *
 * v4 資料長相：書籤 ＞（資料夾）＞ 提示詞
 * 資料夾是「每個書籤自己決定要不要用」的，所以書籤有兩種長相：
 * {
 *   version: 4,
 *   activeId: 't_fav',                                  // 目前選的書籤
 *   tabs: [
 *     { id, label, color, items: [ {id,title,content} ] },  // 不分資料夾（預設）
 *     { id, label, color, folders: [                         // 有開資料夾
 *         { id, label, items: [ {id,title,content} ] } ] },
 *   ]
 * }
 * 一個書籤只會有 items 或 folders 其中一個；有 folders 就代表開了資料夾，
 * 而且至少有一個資料夾。
 *
 * 舊資料載入時會自動升級，使用者原本存的提示詞不會不見：
 *   v1 { tabs: { favorite:{items}, other:{items} } }  → 兩個不分資料夾的書籤
 *   v2 { tabs: [ { id, label, color, items } ] }       → 長相本來就一樣，直接沿用
 *   v3 每個書籤都強制有資料夾；只有一個「一般」資料夾的，其實沒在分類 → 還原成不分資料夾
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
const GPN_DEFAULT_FOLDER = '一般';        // 書籤剛開啟資料夾時，原本的提示詞放在這裡
const GPN_COLORS = ['amber', 'green', 'blue', 'rose', 'purple', 'teal'];
const GPN_COLOR_LABELS = {
  amber: '牛皮黃', green: '森林綠', blue: '天空藍',
  rose: '玫瑰粉', purple: '薰衣草', teal: '湖水綠',
};

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
  };
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
    label: String(t.label ?? '未命名').slice(0, 12) || '未命名',
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
  const uniq = (obj, prefix) => {
    while (seen.has(obj.id)) obj.id = gpnNewId(prefix);
    seen.add(obj.id);
  };
  for (const t of tabs) {
    uniq(t, 't');
    for (const list of gpnListsOf(t)) {
      if (list !== t) uniq(list, 'f');
      for (const it of list.items) uniq(it, 'p');
    }
  }

  // activeId：v2 以後直接用；v1 的 active 是 'favorite' / 'other'
  let activeId = raw.activeId;
  if (!activeId && raw.active) activeId = raw.active === 'other' ? 't_oth' : 't_fav';
  if (!tabs.some((t) => t.id === activeId)) activeId = tabs[0].id;

  return { version: GPN_VERSION, activeId, tabs };
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
  /** 記憶體副本：萬一 storage 掛掉（例如擴充功能剛重新載入）至少當下還能用 */
  cache: gpnDefaultData(),

  /** 自己寫進去的內容指紋，用來分辨 onChanged 是不是自己觸發的 */
  _mine: '',

  available() {
    try {
      return !!(chrome && chrome.storage && chrome.storage.local && chrome.runtime?.id);
    } catch {
      return false;
    }
  },

  async load() {
    if (!this.available()) return this.cache;
    try {
      const got = await chrome.storage.local.get(GPN_KEY);
      this.cache = gpnNormalize(got[GPN_KEY]);
    } catch (err) {
      console.warn('[常用提示詞] 讀取資料失敗，暫時使用記憶體資料：', err);
    }
    return this.cache;
  },

  async save(data) {
    this.cache = gpnNormalize(data);
    if (!this.available()) return false;
    try {
      this._mine = JSON.stringify(this.cache);
      await chrome.storage.local.set({ [GPN_KEY]: this.cache });
      return true;
    } catch (err) {
      console.warn('[常用提示詞] 儲存失敗：', err);
      return false;
    }
  },

  /** 其他分頁改了資料時同步過來（多開 Gemini 分頁的情況） */
  onExternalChange(cb) {
    if (!this.available()) return;
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[GPN_KEY]) return;
        // 自己剛寫的就別再重畫一次，不然拖曳完畫面會閃一下
        if (JSON.stringify(changes[GPN_KEY].newValue) === this._mine) return;
        this.cache = gpnNormalize(changes[GPN_KEY].newValue);
        cb(this.cache);
      });
    } catch { /* 忽略：擴充功能環境失效時不影響主要功能 */ }
  },
};
