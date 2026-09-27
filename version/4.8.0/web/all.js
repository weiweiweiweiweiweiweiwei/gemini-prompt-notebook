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

  function render() {
    const want = decodeURIComponent(location.hash.slice(1));
    const only = data.tabs.find((t) => t.id === want) || null;
    const favs = new Set(data.favs || []);
    const total = gpnCountItems(data);

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
      : `共 ${total} 則提示詞，分在 ${data.tabs.length} 個書籤。依書籤、資料夾分類，每一則前面有編號；★ 是我的最愛。`;

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
          if (favs.has(it.id)) h.append(el('span', 'fav', ' ★'));
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
