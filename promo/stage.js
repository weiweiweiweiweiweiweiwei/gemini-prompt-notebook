/**
 * 使用情境影片的「導演」：照時間表移動游標、點按鈕、推鏡頭、換字幕。
 *
 * 面板是真的（../web/panel.js），點下去的反應（打開、Copied、切換書籤、星號）
 * 都是面板自己的程式和動畫，這裡只負責「在什麼時候點哪裡」。
 *
 * 時間：錄影模式（?render）下 setTimeout 等等都是 vtime.js 的假時間，
 * 所以這裡照一般寫法用 sleep()／setTimeout 就好，兩種模式都通用。
 */
(() => {
  'use strict';

  const VT = window.__vt;              // 錄影模式才有
  const $ = (s, r = document) => r.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lerp = (a, b, p) => a + (b - a) * p;
  const clamp01 = (p) => Math.max(0, Math.min(1, p));
  const ease = {
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    linear: (t) => t,
  };

  /* ==========================================================================
     示範資料（只存在這個頁面的 localStorage，不會碰到真正的提示詞）
     ========================================================================== */

  const DAY = 86400000;
  const T0 = Date.now();
  const P = (id, title, content) => ({ id, title, content });
  const DEMO = {
    version: 4,
    activeId: 't_fav',
    tabs: [
      { id: 't_fav', label: '常用', color: 'amber', items: [
        P('p_formal', '改寫得更正式', '請幫我把下面這段文字改寫得更正式、更簡潔，語氣要客氣，並保留原本的意思：\n'),
        P('p_en', '翻譯成英文', '請把下面的內容翻譯成自然流暢的英文，專有名詞保留原文：\n'),
        P('p_sum', '三句話重點摘要', '請用三句話摘要下面內容的重點，每句不超過 30 個字：\n'),
        P('p_typo', '抓錯字和語病', '請檢查下面這段文字的錯字、標點和語病，列出修改前後的對照：\n'),
        P('p_mail', '寫成 Email 回覆', '請根據下面的內容，幫我寫一封有禮貌的 Email 回覆，開頭先謝謝對方：\n'),
        P('p_kid', '解釋給小學生聽', '請用小學生也聽得懂的方式解釋下面的概念，並舉一個生活中的例子：\n'),
      ] },
      { id: 't_work', label: '工作', color: 'blue', folders: [
        { id: 'f_meet', label: '會議', items: [
          P('p_minutes', '整理會議記錄', '請把下面的會議逐字稿整理成會議記錄：議題、結論、待辦（負責人、期限）：\n'),
          P('p_todo', '列出待辦事項', '請從下面的內容找出所有待辦事項，用核取清單列出來：\n'),
          P('p_agenda', '擬會議議程', '請幫我擬一份 30 分鐘的會議議程，主題是：\n'),
        ] },
        { id: 'f_report', label: '報告', items: [
          P('p_slides', '做成簡報大綱', '請把下面的內容整理成 8 頁以內的簡報大綱，每頁一個標題、三個重點：\n'),
          P('p_weekly', '寫成週報', '請把下面這週做的事整理成週報：完成事項、進行中、下週計畫、需要協助：\n'),
          P('p_data', '解讀表格數據', '請解讀下面的表格數據，找出三個最值得注意的趨勢：\n'),
        ] },
        { id: 'f_mail', label: 'Email', items: [
          P('p_decline', '婉拒邀約', '請幫我寫一封客氣的 Email，婉拒下面這個邀約，並表達之後合作的意願：\n'),
          P('p_nudge', '催進度（客氣版）', '請幫我寫一封客氣但明確的 Email，詢問下面這件事的進度：\n'),
        ] },
      ] },
      { id: 't_idea', label: '靈感', color: 'rose', items: [
        P('p_titles', '想 10 個標題', '請幫下面這篇文章想 10 個吸引人的標題，風格要多元：\n'),
        P('p_post', '寫社群貼文', '請把下面的內容寫成一則社群貼文，口語、有溫度，最後加上 3 個 hashtag：\n'),
      ] },
    ],
    favs: ['p_en', 'p_slides'],
    recent: [
      { id: 'p_en', title: '翻譯成英文', content: '請把下面的內容翻譯成自然流暢的英文，專有名詞保留原文：\n', usedAt: T0 - DAY - 3 * 3600e3, tabId: 't_fav', folderId: '' },
      { id: 'p_minutes', title: '整理會議記錄', content: '請把下面的會議逐字稿整理成會議記錄：議題、結論、待辦（負責人、期限）：\n', usedAt: T0 - DAY - 7 * 3600e3, tabId: 't_work', folderId: 'f_meet' },
      { id: 'p_titles', title: '想 10 個標題', content: '請幫下面這篇文章想 10 個吸引人的標題，風格要多元：\n', usedAt: T0 - 2 * DAY - 2 * 3600e3, tabId: 't_idea', folderId: '' },
    ],
  };
  try {
    localStorage.setItem('gpn_data_v1', JSON.stringify(DEMO));
    localStorage.removeItem('gpn_book_width');
  } catch { /* 無痕模式：面板會用空白資料，影片就不對了 */ }

  /* ==========================================================================
     每一格要做的事（鏡頭、游標、背景）
     ========================================================================== */

  const hooks = [];
  const onFrame = (fn) => hooks.push(fn);
  const runHooks = (t) => { for (const h of hooks) h(t); };
  if (VT) VT.onFrame(() => runHooks(performance.now()));
  else {
    const loop = () => { runHooks(performance.now()); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  /** 補間：duration 毫秒內，fn 會收到 0→1（已套用 easing） */
  const tweens = new Set();
  function tween(duration, fn, e = ease.inOut) {
    return new Promise((resolve) => {
      tweens.add({ start: performance.now(), duration, fn, e, resolve });
    });
  }
  onFrame((t) => {
    for (const tw of [...tweens]) {
      const p = clamp01((t - tw.start) / tw.duration);
      tw.fn(tw.e(p));
      if (p >= 1) { tweens.delete(tw); tw.resolve(); }
    }
  });

  /* ---------- 背景色塊慢慢飄 ---------- */
  const blobs = [...document.querySelectorAll('.blob')];
  onFrame((t) => {
    const s = t / 1000;
    blobs.forEach((b, i) => {
      const k = i * 2.1;
      b.style.transform = `translate(${Math.sin(s * 0.35 + k) * 40}px, ${Math.cos(s * 0.28 + k) * 30}px)`;
    });
  });

  /* ---------- 鏡頭 ---------- */
  const world = $('#world');
  const W = 1920, H = 1080;
  const cam = { x: W / 2, y: H / 2, s: 1 };
  const applyCam = () => {
    world.style.transform = `translate(${W / 2 - cam.x * cam.s}px, ${H / 2 - cam.y * cam.s}px) scale(${cam.s})`;
  };
  applyCam();

  /** 元素在「鏡頭沒有縮放時」的位置 */
  function worldRect(el) {
    const r = el.getBoundingClientRect();
    const tx = W / 2 - cam.x * cam.s, ty = H / 2 - cam.y * cam.s;
    const x = (r.left - tx) / cam.s, y = (r.top - ty) / cam.s, w = r.width / cam.s, h = r.height / cam.s;
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  }

  function camTo(x, y, s, duration = 1200) {
    const a = { ...cam };
    return tween(duration, (p) => {
      cam.s = a.s * Math.pow(s / a.s, p);      // 縮放用等比，推近拉遠的速度感才平均
      cam.x = lerp(a.x, x, p);
      cam.y = lerp(a.y, y, p);
      applyCam();
    });
  }
  const focus = (el, s, duration, dy = 0) => {
    const r = worldRect(el);
    return camTo(r.cx, r.cy + dy, s, duration);
  };

  /* ---------- 游標 ---------- */
  const cursorEl = $('#cursor');
  const ringEl = $('#cursor .ring');
  const cur = { x: 1990, y: 1150 };
  window.__mouse = { x: 1919, y: 1079 };
  window.__mouseOps = [];
  const placeCursor = () => {
    cursorEl.style.transform = `translate(${cur.x}px, ${cur.y}px)`;
    // 真的滑鼠（錄影模式由 render.js 移過去）：出了畫面就停在角落
    window.__mouse = { x: Math.min(W - 1, Math.max(0, cur.x)), y: Math.min(H - 1, Math.max(0, cur.y)) };
  };
  placeCursor();

  const pointOf = (target) => {
    if (typeof target === 'function') return target();
    if (target instanceof Element) {
      const r = target.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return target;
  };

  /** 游標移過去：稍微走一點弧線，看起來比較像人手 */
  function moveTo(target, duration = 900) {
    const a = { ...cur };
    return tween(duration, (p) => {
      const b = pointOf(target);
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const arc = Math.sin(Math.PI * p) * Math.min(70, len * 0.14);
      cur.x = lerp(a.x, b.x, p) + (-dy / len) * arc;
      cur.y = lerp(a.y, b.y, p) + (dx / len) * arc;
      placeCursor();
    });
  }

  /** 預覽模式沒有真的滑鼠，用合成事件代替（錄影模式由 render.js 用真的滑鼠點） */
  function deepHit(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }
  function fire(type) {
    const el = deepHit(cur.x, cur.y);
    if (!el) return;
    const init = { bubbles: true, composed: true, cancelable: true, clientX: cur.x, clientY: cur.y, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    if (type === 'down') {
      el.dispatchEvent(new PointerEvent('pointerdown', init));
      el.dispatchEvent(new MouseEvent('mousedown', init));
    } else {
      el.dispatchEvent(new PointerEvent('pointerup', init));
      el.dispatchEvent(new MouseEvent('mouseup', init));
      el.dispatchEvent(new MouseEvent('click', init));
    }
  }
  const press = (type) => { if (VT) window.__mouseOps.push(type); else fire(type); };

  async function click(target, duration) {
    if (target) await moveTo(target, duration);
    cursorEl.classList.add('is-down');
    press('down');
    await sleep(110);
    press('up');
    cursorEl.classList.remove('is-down');
    ringEl.classList.remove('is-go');
    void ringEl.offsetWidth;
    ringEl.classList.add('is-go');
    await sleep(220);
  }

  /* ---------- 字幕 ---------- */
  const capBox = $('#caption');
  const capText = $('#caption span');
  async function caption(text, color = '#4f8ef7') {
    if (capBox.classList.contains('is-on')) {
      capBox.classList.remove('is-on');
      await sleep(320);
    }
    if (!text) return;
    capText.textContent = text;
    capText.style.setProperty('--cap', color);
    capBox.classList.add('is-on');
  }

  /* ---------- 聊天輸入框 ---------- */
  const composer = $('#composer');
  const composerText = $('#composerText');
  let typed = '';
  let caretOn = false;
  let caretSince = 0;
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function paintComposer(extraClass = '') {
    if (!typed && !caretOn) { composerText.innerHTML = '<span class="ph">問問 AI</span>'; return; }
    const body = typed ? `<span class="${extraClass}">${esc(typed)}</span>` : '';
    composerText.innerHTML = body + (caretOn ? '<span class="caret"></span>' : '');
  }
  // 游標閃爍（打字時一直亮著）
  onFrame((t) => {
    const c = $('.caret', composerText);
    if (c) c.style.opacity = (t - caretSince) % 1060 < 530 ? '1' : '0';
  });

  // 固定的亂數，打字的節奏每次錄都一樣
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  async function typeText(str, cps = 13) {
    for (const ch of str) {
      typed += ch;
      caretSince = performance.now();
      paintComposer();
      await sleep(1000 / cps * (0.6 + rand() * 0.8) + (/[，、。：]/.test(ch) ? 160 : 0));
    }
  }

  /* ==========================================================================
     面板（和外掛同一份程式；點提示詞 = 填進上面那個輸入框）
     ========================================================================== */

  const host = $('#panelHost');
  const root = host.attachShadow({ mode: 'open' });
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '../web/styles.css';
  const cssReady = new Promise((r) => { link.onload = r; link.onerror = r; });
  root.append(link);
  VT?.addRoot(root);

  const trigger = $('#trigger');
  const panel = gpnCreatePanel({
    root,
    edition: '外掛',
    onUse: async (item) => {
      typed = item.content.replace(/\n+$/, '');
      caretOn = false;
      paintComposer('fill');
      composer.classList.add('is-filled');
      return { badge: 'Copied' };
    },
    onOpenChange: (open) => trigger.classList.toggle('gpn-is-open', open),
  });
  trigger.addEventListener('click', () => panel.open());

  const q = (s) => root.querySelector(s);
  const tabBtn = (id) => () => pointOf(q(`.gpn-tab[data-id="${id}"] .gpn-tab-main`));
  const folderBtn = (id) => () => pointOf(q(`.gpn-folder[data-id="${id}"] .gpn-folder-main`));
  const cardTitle = (id) => () => {
    const r = q(`.gpn-card[data-id="${id}"] .gpn-title-text`).getBoundingClientRect();
    return { x: r.left + Math.min(r.width, 150) * 0.55, y: r.top + r.height / 2 + 6 };
  };
  const starBtn = (id) => () => pointOf(q(`.gpn-card[data-id="${id}"] .gpn-star`));
  // 面板外面的空白處（點了會關閉面板）
  const outside = () => {
    const r = q('.gpn-book').getBoundingClientRect();
    return { x: r.left - 150, y: r.top + r.height * 0.62 };
  };

  /* ==========================================================================
     時間表
     ========================================================================== */

  const logo = $('#logo');
  const win = $('#win');
  const sites = $('#sites');
  const outro = $('#outro');

  const restart = (el, ...cls) => { el.classList.remove(...cls); void el.offsetWidth; el.classList.add(...cls); };

  async function director() {
    // ── 片頭：圓圓的標誌滾進來 ──
    await sleep(300);
    logo.classList.add('is-in');
    await sleep(3300);
    logo.classList.add('is-out');
    await sleep(500);

    // ── 問題：每次都要重打 ──
    win.classList.add('is-in');
    await sleep(500);
    caption('常用的提示詞，每次都要重打？', '#e0719b');
    await sleep(300);
    await focus(composer, 1.6, 1300, -10);
    caretOn = true; caretSince = performance.now(); paintComposer();
    await sleep(350);
    await typeText('請幫我把下面這段文字改寫得更正式、更簡潔，語氣要');
    await sleep(700);
    // 打到一半放棄：整段選起來刪掉
    paintComposer('sel');
    composerText.querySelector('.sel').style.background = 'rgba(79,142,247,.25)';
    await sleep(450);
    typed = ''; paintComposer();
    await sleep(500);

    // ── 打開特務P ──
    caption('按一下輸入框旁的「書籤」', '#4f8ef7');
    cursorEl.classList.add('is-on');
    trigger.classList.add('is-hint');
    await moveTo(trigger, 1100);
    await sleep(350);
    trigger.classList.remove('is-hint');
    caretOn = false; paintComposer();
    await click();
    await sleep(80);
    focus(q('.gpn-book'), 1.25, 1100, 20);
    await sleep(1200);

    // ── 點一下就填好 ──
    caption('點一下，提示詞就填進輸入框', '#f6b93b');
    await sleep(600);
    await moveTo(cardTitle('p_formal'), 900);
    await sleep(350);
    await click();
    await sleep(1300);
    await click(outside, 800);            // 點面板外面，面板關起來
    cursorEl.classList.remove('is-on');
    await focus(composer, 1.55, 1100, -10);
    caption('不會自動送出，看過再按 Enter 就好', '#34a853');
    await sleep(2800);

    // ── 分類：書籤、資料夾、我的最愛 ──
    caption('用書籤分類，還能再分資料夾', '#4f8ef7');
    cursorEl.classList.add('is-on');
    await click(trigger, 900);
    await sleep(80);
    focus(q('.gpn-book'), 1.25, 1000, 20);
    await sleep(1100);
    await click(tabBtn('t_work'), 850);
    await sleep(900);
    await click(folderBtn('f_report'), 750);
    await sleep(900);

    caption('最常用的按 ☆，收進「我的最愛」', '#f6b93b');
    await sleep(400);
    await moveTo(starBtn('p_weekly'), 850);
    await sleep(250);
    await click();
    await sleep(900);
    await click(tabBtn('t_star'), 900);
    await sleep(1500);

    // ── 最近使用 ──
    caption('用過的，自動記在「最近使用」', '#9a6cf0');
    await sleep(300);
    await click(tabBtn('t_recent'), 800);
    await sleep(2400);

    // ── 收尾：支援的網站、雲端同步 ──
    await click(outside, 900);
    cursorEl.classList.remove('is-on');
    caption('');
    camTo(W / 2, H / 2, 1, 900);
    await sleep(700);
    win.classList.add('is-away');
    await sleep(400);
    sites.classList.add('is-in');
    caption('三個 AI 網站，共用同一份提示詞', '#4f8ef7');
    await sleep(2300);
    sites.classList.add('is-cloud');
    caption('');
    await sleep(2600);
    sites.classList.add('is-out');
    await sleep(500);

    // ── 片尾 ──
    logo.classList.remove('is-out');
    logo.classList.add('is-end');
    restart(logo, 'is-in');
    await sleep(1500);
    outro.classList.add('is-in');
    await sleep(3200);
    window.__done = true;
  }

  /* ==========================================================================
     開始：字型、樣式表都好了才開始（否則第一格會閃一下沒有樣式的畫面）
     ========================================================================== */

  function glyphText() {
    const ui = '新增提示詞 我的最愛 最近使用 今天 昨天 星期一二三四五六日 上午下午 0123456789:：月日 Copied ' +
      '資料夾 新增資料夾 清除全部使用記錄 ＋ › ☆★ 還沒有任何提示詞 點下面的開始建立 從哪個書籤來的 ' +
      '常用的提示詞，每次都要重打？按一下輸入框旁的「書籤」點一下，提示詞就填進輸入框 不會自動送出，看過再按 Enter 就好 ' +
      '用書籤分類，還能再分資料夾 最常用的按 ☆，收進「我的最愛」用過的，自動記在「最近使用」三個 AI 網站，共用同一份提示詞 ' +
      document.getElementById('stage').textContent;
    return ui + JSON.stringify(DEMO);
  }

  async function boot() {
    const text = glyphText();
    const g = document.getElementById('glyphs');
    g.innerHTML = `<span></span><b></b><i></i><em></em>`;
    for (const n of g.children) n.textContent = text;
    await cssReady;
    try {
      await Promise.all(['400', '500', '700', '900'].map((w) => document.fonts.load(`${w} 40px "Noto Sans TC"`, text)));
      await document.fonts.ready;
    } catch { /* 沒網路就用系統字型 */ }
    g.remove();
    window.__ready = true;
    if (VT) {
      // 錄影模式：等 render.js 開始推進時間
      window.__start = () => { director(); };
    } else {
      director();
    }
  }
  boot();
})();
