/**
 * 常用提示詞筆記本 — 外掛主程式 (v4)
 *
 * 架構：
 *   觸發按鈕 → Light DOM，注入各站輸入框工具列，複製原生 icon button 的 class
 *              （尺寸／圓角／hover 由網站自己的 CSS 負責，才會完全看不出是外掛）
 *   面板本體 → Shadow DOM，掛在 <html> 底下，SPA 重繪時不會被清掉。
 *              面板的內容和操作都在 panel.js（和網頁版共用同一份），
 *              這裡只負責「外掛才做得到的事」：找到輸入框、把提示詞填進去。
 */
(() => {
  'use strict';

  if (window.__gpnLoaded) return;
  window.__gpnLoaded = true;

  /* ==========================================================================
     三個網站的 DOM 差異全部集中在這裡。
     哪一家改版就只要動對應那一段，其他程式碼不用碰。

       editor    輸入框本體（由上往下試）
       anchor()  要把按鈕塞進去的工具列
       nativeBtn 拿來複製樣式的原生按鈕
       keepClass 要保留哪些 class（null = 整串照抄）
       iconSize  圖示大小，配合各站原生按鈕
     ========================================================================== */
  const SITES = [
    {
      id: 'gemini',
      host: /(^|\.)gemini\.google\.com$/,
      editor: [
        'rich-textarea .ql-editor[contenteditable="true"]',
        'div.ql-editor[contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]',
      ],
      anchor: () => document.querySelector('.simplified-input-menu-container')
                 || document.querySelector('.leading-actions-wrapper')
                 || document.querySelector('input-area-v2 .text-input-field'),
      nativeBtn: 'input-area-v2 button.mat-mdc-icon-button, button.mat-mdc-icon-button',
      keepClass: /^(mdc-icon-button|mat-mdc-icon-button|mat-mdc-button-base|mat-unthemed)$/,
      fallbackClass: 'mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-unthemed',
      iconSize: 24,
    },
    {
      id: 'chatgpt',
      host: /(^|\.)(chatgpt\.com|chat\.openai\.com)$/,
      editor: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]'],
      anchor: () => {
        const plus = document.querySelector('[data-testid="composer-plus-btn"]');
        // 要放進「+」所在的那層 span.flex；
        // 再外面那層是 display:block，塞進去會變成上下排列而不是並排。
        if (plus?.parentElement) return plus.parentElement;
        return document.querySelector('div[class*="grid-area:leading"]');
      },
      nativeBtn: '[data-testid="composer-plus-btn"]',
      keepClass: /^composer-btn$/,
      fallbackClass: 'composer-btn',
      wrap: false,               // 原生「+」就是 flex row 的直接子元素，不要多包一層
      iconSize: 20,
    },
    {
      id: 'claude',
      host: /(^|\.)claude\.ai$/,
      editor: [
        'div.ProseMirror[contenteditable="true"]',
        'div.tiptap[contenteditable="true"]',
        '[contenteditable="true"]',
      ],
      anchor: () => {
        const att = document.querySelector('[data-testid="chat-input-attach"]');
        // 迴紋針外面包了一層 div，要放進再外面的 .flex.items-center
        return att?.parentElement?.parentElement || null;
      },
      nativeBtn: '[data-testid="chat-input-attach"]',
      keepClass: null,           // Claude 的樣式是一整組 class，整串照抄才會一模一樣
      fallbackClass: '',
      iconSize: 20,
    },
  ];

  const pick = (list) => {
    for (const s of list) {
      const n = document.querySelector(s);
      if (n) return n;
    }
    return null;
  };

  let SITE = SITES.find((s) => s.host.test(location.hostname)) || null;

  /**
   * 網域對不上時，改用「結構特徵」判斷是哪一站
   * （例如 Google 之後換網域，或在本機測試頁執行）。
   */
  function resolveSite() {
    if (SITE) return SITE;
    SITE = SITES.find((s) => {
      try { return !!(pick(s.editor) && s.anchor()); } catch { return false; }
    }) || null;
    return SITE;
  }

  /* ========== 圖示（SVG，不依賴 Gemini 的專有圖示字體） ========== */

  const ICON_BOOKMARK =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2zm0 15l-5-2.18L7 18V5h10v13z"/></svg>';

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

  /* ========== 樣式表 ========== */

  let sheet = null;
  async function loadSheet() {
    if (sheet) return sheet;
    const css = await fetch(chrome.runtime.getURL('src/styles.css')).then((r) => r.text());
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return sheet;
  }

  /* ========== 主題：跟著各站自己的深淺色走 ========== */

  const hosts = [];
  function currentTheme() {
    // 各站自己的主題開關優先（使用者可能系統深色但網站設成淺色）
    if (document.body?.classList.contains('dark-theme')) return 'dark';    // Gemini
    if (document.body?.classList.contains('light-theme')) return 'light';  // Gemini
    const htmlCls = document.documentElement.classList;
    if (htmlCls.contains('dark')) return 'dark';                           // ChatGPT
    if (htmlCls.contains('light')) return 'light';

    // 通用備援：直接看頁面底色的亮度，任何網站都適用
    const bg = getComputedStyle(document.body || document.documentElement).backgroundColor;
    const m = bg && bg.match(/[\d.]+/g);
    if (m && m.length >= 3 && !(m.length > 3 && +m[3] === 0)) {
      const lum = 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2];
      return lum < 128 ? 'dark' : 'light';
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme() {
    const t = currentTheme();
    for (const h of hosts) h.setAttribute('data-theme', t);
  }

  /* ========== AI 網站的輸入框 ========== */

  const findEditor = () => pick(SITE.editor);

  function fillPrompt(text) {
    const editor = findEditor();
    if (!editor) return false;

    if (editor.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(editor, text);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { /* 走備援 */ }

    if (!ok || !editor.textContent.trim()) {
      editor.innerHTML = '';
      for (const line of text.split('\n')) {
        const p = document.createElement('p');
        if (line) p.textContent = line;
        else p.append(document.createElement('br'));
        editor.append(p);
      }
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true, inputType: 'insertText', data: text,
      }));
    }

    editor.classList.remove('ql-blank');
    const end = document.createRange();
    end.selectNodeContents(editor);
    end.collapse(false);
    sel.removeAllRanges();
    sel.addRange(end);
    return true;
  }

  /** 點提示詞：先複製（保險），再填進輸入框。面板不關，方便連續挑。 */
  async function usePrompt(item) {
    const copied = await gpnShareCopy(item.content);
    if (!fillPrompt(item.content)) {
      return { toast: '找不到輸入框，內容已複製，請手動貼上', bad: true };
    }
    return { badge: copied ? 'Copied' : 'Inserted' };
  }

  /* ==========================================================================
     一、觸發按鈕
     ========================================================================== */

  let triggerBtn = null;

  /**
   * 從該站原生按鈕身上取樣式 class，讓我們的按鈕長得一模一樣。
   * 回傳 { cls, bare }：bare=true 代表沒抄到任何原生樣式，
   * 這時才由我們自己的備援 CSS 接手（平常絕不能干擾各站原生樣式）。
   */
  function nativeBtnClass() {
    const native = document.querySelector(SITE.nativeBtn);
    if (native) {
      if (!SITE.keepClass) return { cls: native.className, bare: false };   // 整串照抄
      const keep = [...native.classList].filter((c) => SITE.keepClass.test(c));
      if (keep.length) return { cls: keep.join(' '), bare: false };
    }
    return { cls: SITE.fallbackClass, bare: !SITE.fallbackClass };
  }

  /** 三站都是 SPA，重繪會把節點清掉 → 這個函式要能重複呼叫 */
  function mountTrigger() {
    const row = SITE.anchor();
    if (!row) return false;
    if (triggerBtn && triggerBtn.isConnected && row.contains(triggerBtn)) return true;

    const { cls, bare } = nativeBtnClass();
    const btn = el('button', {
      class: 'gpn-trigger-btn ' + (bare ? 'gpn-bare ' : '') + cls,
      type: 'button',
      'aria-label': '常用提示詞',
      'aria-haspopup': 'dialog',
      title: '常用提示詞',
      html: ICON_BOOKMARK,
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); openModal(); },
    });
    btn.style.setProperty('--gpn-icon', SITE.iconSize + 'px');

    row.append(SITE.wrap === false ? btn : el('span', { class: 'gpn-trigger-wrap' }, btn));
    triggerBtn = btn;
    matchNativeBox(btn);
    return true;
  }

  /**
   * 光靠複製 class 還不夠：各站工具列的 flex 細節不同，
   * 實測 ChatGPT 會被壓成 36x32（原生是 36x36）。
   * 所以直接把原生按鈕「量出來」的尺寸抄過來，確保像素級一致。
   */
  function matchNativeBox(btn) {
    const native = document.querySelector(SITE.nativeBtn);
    if (!native || native === btn) return;
    const c = getComputedStyle(native);
    if (parseFloat(c.height) > 0) {
      btn.style.width = c.width;
      btn.style.height = c.height;
      btn.style.borderRadius = c.borderRadius;
      btn.style.flex = '0 0 auto';
      btn.style.alignSelf = 'center';
    }
  }

  /* ---------- 右下角浮動圓鈕 ---------- */

  let fabHost = null;

  /**
   * 圓鈕只是「保險」：正常情況下三站都會把按鈕注入輸入框工具列，
   * 這時圓鈕不出現（依需求）。只有在該站改版、找不到工具列而注入失敗時，
   * 才讓圓鈕現身，確保功能永遠有辦法打開。
   */
  function syncFab() {
    const injected = !!(triggerBtn && triggerBtn.isConnected);
    if (!injected) mountFab();
    fabHost?.classList.toggle('is-off', injected);
  }

  function mountFab() {
    if (fabHost) return;
    const host = el('div', { class: 'gpn-fab-host', 'data-gpn': '' });
    const root = host.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [sheet];
    root.append(el('button', {
      class: 'gpn-fab', type: 'button',
      'aria-label': '常用提示詞', 'aria-haspopup': 'dialog', title: '常用提示詞',
      html: ICON_BOOKMARK,
      onclick: (e) => { e.preventDefault(); openModal(); },
    }));
    document.documentElement.append(host);
    hosts.push(host);
    applyTheme();
    fabHost = host;
  }

  /* ==========================================================================
     二、面板（內容在 panel.js）
     ========================================================================== */

  let panel = null;

  function buildPanel() {
    const host = el('div', { class: 'gpn-modal-host', 'data-gpn': '' });
    const root = host.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [sheet];
    document.documentElement.append(host);
    hosts.push(host);
    applyTheme();

    panel = gpnCreatePanel({
      root,
      edition: '外掛',
      onUse: usePrompt,
      onOpenChange: (open) => {
        triggerBtn?.classList.toggle('gpn-is-open', open);
        // 開面板時圓鈕先收起來，不要透出遮罩
        fabHost?.classList.toggle('is-hidden', open);
      },
    });
  }

  /**
   * 確保面板／圓鈕的 host 還掛在頁面上。
   *
   * ChatGPT 是 React SSR + hydration：hydration 時 React 會把它沒有渲染過、
   * 卻出現在 <html> 底下的節點移除（console 會看到 React error #418）。
   * 我們的 host 剛好在那個時間點插入，所以會被清掉——按鈕因為每 2 秒會重新注入
   * 所以看起來正常，面板卻永遠打不開。
   *
   * 這裡重新掛回「同一個」host 元素，shadow root 和裡面的狀態都會保留。
   */
  function ensureHosts() {
    for (const h of hosts) {
      if (h && !h.isConnected) document.documentElement.append(h);
    }
  }

  function openModal() {
    ensureHosts();          // 保險：面板若被網頁的框架清掉，先掛回來再開
    panel.open();
  }

  /* ========== 啟動 ========== */

  async function init() {
    // 先確認是哪一站。網域對得上就立刻有結果；
    // 靠結構特徵判斷的情況要等 SPA 把輸入框畫出來，所以給它一點時間。
    if (!resolveSite()) {
      const until = Date.now() + 15000;
      while (!resolveSite() && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 400));
      }
      if (!SITE) return;      // 真的認不出來就安靜退場，不干擾網頁
    }

    try {
      await loadSheet();
    } catch (err) {
      console.error('[常用提示詞] 樣式載入失敗，面板不會顯示：', err);
      return;
    }

    buildPanel();
    mountTrigger();
    syncFab();

    let t = 0;
    new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => { ensureHosts(); mountTrigger(); syncFab(); applyTheme(); }, 200);
    }).observe(document.body, { childList: true, subtree: true });

    // 也盯著 <html> 本身：host 是掛在這一層，被移除時 body 的 observer 看不到
    new MutationObserver(() => { ensureHosts(); })
      .observe(document.documentElement, { childList: true });

    // 主題開關：Gemini 改 body 的 class，ChatGPT 改 html 的 class
    const themeObs = new MutationObserver(applyTheme);
    themeObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    setInterval(() => { ensureHosts(); mountTrigger(); syncFab(); }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
