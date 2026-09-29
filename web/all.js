/**
 * 特務P · 全部提示詞（all.html）
 *
 * 所有書籤、資料夾的提示詞，完整內容用純文字列在同一頁。
 * 用途：使用者把這個分頁和公文分頁一起分享給瀏覽器的「問問 Gemini」，請它判斷該用哪一則。
 * 所以這一頁是一般網頁（沒有 Shadow DOM）、沒有卡片或收合，所有字都直接攤開；
 * 每一則前面有編號（#1、#2…），Gemini 可以直接說「用 #12」。
 *
 * 上面可以只看某一個書籤（網址 all.html#書籤代號），「全部」就是全部書籤；
 * 編號永遠照「全部」的順序算，只看一個書籤時編號也不會變。
 *
 * 資料就是網頁版那一份（localStorage）。有連結 Google 雲端硬碟的話，打開時先同步一次，
 * 別台剛改的這裡也看得到；網頁版在另一個分頁改了，這裡也會跟著更新。
 *
 * 上面的「另存新檔」把全部提示詞存成一個記事本檔（特務P_全部提示詞_20260929.txt），內容和這一頁一樣。
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  let data = GpnStore.load();

  /**
   * 標了符號的提示詞，標題後面加什麼：我的最愛是 ★，其他照 Gmail 的名稱寫出來（問問 Gemini 讀得懂）。
   * 字的顏色是那個符號的顏色（深一點，白底、黑底都看得清楚）。
   */
  const MARK_COLOR = {
    'yellow-star': '#d99a2b', 'orange-star': '#e8801c', 'red-star': '#d93a3f',
    'purple-star': '#9a55cf', 'blue-star': '#3b7de8', 'green-star': '#2f9e56',
    'red-bang': '#d93a3f', 'orange-guillemet': '#e8801c', 'yellow-bang': '#c9951a',
    'green-check': '#2f9e56', 'blue-info': '#3b7de8', 'purple-question': '#9a55cf',
  };
  const markTag = (m) => (m === GPN_MARK_FAV ? '★' : `〔${GPN_MARK_LABELS[m]}〕`);

  function render() {
    const want = decodeURIComponent(location.hash.slice(1));
    const only = data.tabs.find((t) => t.id === want) || null;
    const total = gpnCountItems(data);
    const marked = Object.keys(data.marks || {}).length;

    /* ---- 依書籤顯示 ---- */
    const link = (hash, text, on) => {
      const a = el('a', null, text);
      a.href = hash;
      if (on) a.setAttribute('aria-current', 'page');
      return a;
    };
    $('nav').replaceChildren(
      link('#', `全部（${total}）`, !only),
      ...data.tabs.map((t) => link('#' + encodeURIComponent(t.id), `${t.label}（${gpnTabItemCount(t)}）`, only === t)));

    $('title').textContent = only ? `特務P：「${only.label}」的提示詞` : '特務P：全部提示詞';
    document.title = only ? `特務P：${only.label}` : '特務P：全部提示詞';
    $('summary').textContent = only
      ? `書籤「${only.label}」共 ${gpnTabItemCount(only)} 則（全部書籤共 ${total} 則）。每一則前面有編號。`
      : `共 ${total} 則提示詞，分在 ${data.tabs.length} 個書籤。依書籤、資料夾分類，每一則前面有編號；★ 是我的最愛` +
        (marked ? '，〔 〕裡是標的其他符號。' : '。');

    /* ---- 清單 ---- */
    const out = document.createDocumentFragment();
    let no = 0;
    for (const t of data.tabs) {
      const show = !only || only === t;
      const sec = el('section');
      sec.append(el('h2', null, `書籤：${t.label}（${gpnTabItemCount(t)} 則）`));
      for (const list of gpnListsOf(t)) {
        if (list !== t && list.items.length) {
          sec.append(el('h3', null, `資料夾：${list.label}（${list.items.length} 則）`));
        }
        for (const it of list.items) {
          no++;
          const h = el('h4');
          h.append(el('span', 'no', `#${no}`), ` ${it.title || '(未命名)'}`);
          const m = gpnMarkOf(data, it.id);
          if (m) {
            const tag = el('span', 'fav', ' ' + markTag(m));
            tag.style.color = MARK_COLOR[m] || '';
            h.append(tag);
          }
          const p = el('div', 'p');
          p.append(h, el('div', 'text', it.content));
          sec.append(p);
        }
      }
      if (!gpnTabItemCount(t)) sec.append(el('p', 'empty', '（這個書籤還沒有提示詞）'));
      if (show) out.append(sec);
    }
    if (!total) out.append(el('p', 'empty', '還沒有任何提示詞。回到筆記本新增之後，這裡就會列出來。'));
    $('list').replaceChildren(out);
  }

  /* ---- 另存新檔：全部提示詞存成記事本檔（.txt） ----
     不管上面選了哪個書籤，一律存全部；編號和這一頁一樣。
     開頭加 BOM、換行用 \r\n：Windows 舊版的記事本才認得是中文（UTF-8），也才會換行。 */
  function buildText() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const total = gpnCountItems(data);
    const out = [
      '特務P：全部提示詞',
      `存檔時間：${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`,
      `共 ${total} 則提示詞，分在 ${data.tabs.length} 個書籤。★ 是我的最愛` +
        (Object.keys(data.marks || {}).length ? '，〔 〕裡是標的其他符號。' : '。'),
    ];
    let no = 0;
    for (const t of data.tabs) {
      out.push('', '', '='.repeat(40), `書籤：${t.label}（${gpnTabItemCount(t)} 則）`, '='.repeat(40));
      if (!gpnTabItemCount(t)) out.push('', '（這個書籤還沒有提示詞）');
      for (const list of gpnListsOf(t)) {
        if (list !== t && list.items.length) out.push('', `【資料夾：${list.label}（${list.items.length} 則）】`);
        for (const it of list.items) {
          no++;
          const m = gpnMarkOf(data, it.id);
          out.push('', `#${no} ${it.title || '(未命名)'}${m ? ' ' + markTag(m) : ''}`, '-'.repeat(24), it.content);
        }
      }
    }
    return out.join('\r\n').replace(/\r?\n/g, '\r\n') + '\r\n';
  }

  function saveText() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const name = `特務P_全部提示詞_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.txt`;
    const blob = new Blob(['\ufeff' + buildText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('save').addEventListener('click', saveText);

  render();
  addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
  // 網頁版在另一個分頁改了、或雲端同步拉下新資料 → 重畫
  GpnStore.onExternalChange((fresh) => { data = fresh; render(); });

  /* ---- 有連結雲端硬碟：打開時、回到這個分頁時，先跟雲端對一下 ---- */
  if (gpnCloudConfigured(GPN_CLOUD)) {
    const kv = {
      get: async (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
      set: async (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 無痕模式 */ } },
      remove: async (k) => { try { localStorage.removeItem(k); } catch { /* 無痕模式 */ } },
    };
    const sync = gpnCreateSync({
      config: GPN_CLOUD,
      kv,
      readLocal: async () => GpnStore.load(),
      writeRemote: async (doc) => GpnStore.applyRemote(doc),
      lock: navigator.locks ? (name, fn) => navigator.locks.request(name, fn) : undefined,
    });
    let last = 0;
    const pull = () => {
      if (Date.now() - last < 15_000) return;
      last = Date.now();
      sync.syncNow();
    };
    pull();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
  }
})();
