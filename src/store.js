/**
 * 資料存取層：負責和 chrome.storage.local 溝通。
 *
 * v2 資料長相（書籤改成陣列，才能自由新增／刪除／排序）：
 * {
 *   version: 2,
 *   activeId: 't_fav',
 *   tabs: [
 *     { id, label, color, items: [ { id, title, content } ] },
 *     ...
 *   ]
 * }
 *
 * v1 是 { tabs: { favorite:{items}, other:{items} } }，
 * 載入時會自動轉成 v2，使用者原本存的提示詞不會不見。
 */

const GPN_KEY = 'gpn_data_v1';          // 沿用同一個 key，才能讀到舊資料
const GPN_MAX_TABS = 8;                  // 太多書籤會擠不下，設一個上限
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
    version: 2,
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

/** 把任何來源的資料修成合法的 v2 結構（含 v1 → v2 遷移） */
function gpnNormalize(raw) {
  if (!raw || typeof raw !== 'object') return gpnDefaultData();

  let tabs;

  if (Array.isArray(raw.tabs)) {
    // 已經是 v2
    tabs = raw.tabs
      .filter((t) => t && typeof t === 'object')
      .map((t) => ({
        id: typeof t.id === 'string' && t.id ? t.id : gpnNewId('t'),
        label: String(t.label ?? '未命名').slice(0, 12) || '未命名',
        color: GPN_COLORS.includes(t.color) ? t.color : 'amber',
        items: gpnCleanItems(t.items),
      }))
      .slice(0, GPN_MAX_TABS);
  } else if (raw.tabs && typeof raw.tabs === 'object') {
    // v1 → v2：把 favorite / other 轉成陣列，資料原封不動搬過去
    tabs = [
      { id: 't_fav', label: '常用', color: 'amber', items: gpnCleanItems(raw.tabs.favorite?.items) },
      { id: 't_oth', label: '其他', color: 'green', items: gpnCleanItems(raw.tabs.other?.items) },
    ];
  } else {
    tabs = gpnDefaultData().tabs;
  }

  if (!tabs.length) tabs = gpnDefaultData().tabs;

  // id 不可重複（重複會讓切換書籤選錯）
  const seen = new Set();
  for (const t of tabs) {
    while (seen.has(t.id)) t.id = gpnNewId('t');
    seen.add(t.id);
  }

  // activeId：v2 直接用；v1 的 active 是 'favorite' / 'other'
  let activeId = raw.activeId;
  if (!activeId && raw.active) activeId = raw.active === 'other' ? 't_oth' : 't_fav';
  if (!tabs.some((t) => t.id === activeId)) activeId = tabs[0].id;

  return { version: 2, activeId, tabs };
}

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
