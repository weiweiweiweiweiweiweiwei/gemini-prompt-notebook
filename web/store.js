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
      console.warn('[常用提示詞] 讀取資料失敗，暫時使用記憶體資料：', err);
    }
    return this.cache;
  },

  save(data) {
    this.cache = gpnNormalize(data);
    try {
      this._mine = JSON.stringify(this.cache);
      localStorage.setItem(GPN_KEY, this._mine);
      return true;
    } catch (err) {
      console.warn('[常用提示詞] 儲存失敗：', err);
      return false;
    }
  },

  /** 同一個瀏覽器開了好幾個分頁時，改了資料要互相跟上 */
  onExternalChange(cb) {
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
