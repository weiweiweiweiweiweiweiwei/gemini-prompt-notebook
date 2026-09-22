/**
 * Gemini 常用提示詞筆記本 — 主程式 (v3)
 *
 * 架構：
 *   觸發按鈕 → Light DOM，注入 Gemini 工具列，複製原生 icon button 的 class
 *              （尺寸／圓角／hover 由 Gemini 自己的 CSS 負責，才會完全看不出是外掛）
 *   面板本體 → Shadow DOM，掛在 <html> 底下，Angular 重繪時不會被清掉
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

  const ICON_PENCIL =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41' +
    'l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

  /** 齒輪：書籤設定（改名／換色／刪除）
      注意：path 一定要寫成「單一字串」。之前用字串相接，接點漏掉一個空格
      （`.06-.94` + `0-.32` → `.06-.940-.32`），整段路徑語法就壞掉、畫不出來。 */
  const ICON_GEAR =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>';

  const ICON_GRIP =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="9" cy="5" r="1.7"/><circle cx="15" cy="5" r="1.7"/>' +
    '<circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/>' +
    '<circle cx="9" cy="19" r="1.7"/><circle cx="15" cy="19" r="1.7"/></svg>';

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

  /* ========== 主題：跟著 Gemini 的 body.dark-theme 走 ========== */

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

  /* ========== Gemini 輸入框 ========== */

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

  async function copyText(text) {
    try {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 800)),
      ]);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('style', 'position:fixed;top:-2000px;left:0;opacity:0');
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* 放棄複製 */ }
      ta.remove();
      return ok;
    }
  }

  /* ========== 狀態 ========== */

  let data = gpnDefaultData();
  let editing = null;        // 提示詞編輯中 { tabId, id | null }
  let tabEditing = null;     // 書籤編輯中 { id | null, color }
  let delArmed = false, delTimer = 0;
  let tabDelArmed = false, tabDelTimer = 0;
  let backupMode = 'merge';  // 'merge' | 'replace'，預設挑不會弄丟東西的那個
  let impArmed = false, impTimer = 0;
  const ui = {};

  const tabById = (id) => data.tabs.find((t) => t.id === id);
  const activeTab = () => tabById(data.activeId) || data.tabs[0];
  const persist = () => GpnStore.save(data);

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
    fabHost = host;
  }

  /* ==========================================================================
     二、面板
     ========================================================================== */

  function buildPanel() {
    const host = el('div', { class: 'gpn-modal-host', 'data-gpn': '' });
    const root = host.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [sheet];
    document.documentElement.append(host);
    hosts.push(host);

    ui.host = host;
    ui.list = el('div', { class: 'gpn-list', role: 'list' });
    ui.tabs = el('div', { class: 'gpn-tabs', role: 'tablist' });
    ui.tabEls = new Map();        // id → 書籤元素（切換時要重複使用才有動畫）
    ui.hintText = el('span', { class: 'gpn-hint-text' });
    ui.tabEdit = el('button', {
      class: 'gpn-tab-edit', type: 'button', title: '書籤設定（改名／換色／刪除）',
      html: ICON_GEAR,
      onclick: () => openTabEditor(data.activeId),
    });
    ui.hint = el('div', { class: 'gpn-paper-head' }, ui.hintText, ui.tabEdit);

    ui.book = el('div', { class: 'gpn-book' },
      ui.tabs,
      el('div', { class: 'gpn-paper' },
        ui.hint,
        ui.list,
        el('div', { class: 'gpn-foot' },
          el('button', {
            class: 'gpn-add', type: 'button',
            onclick: () => openEditor(data.activeId, null),
          }, '＋ 新增提示詞'),
          el('button', {
            class: 'gpn-backup-btn', type: 'button',
            title: '把提示詞帶去另一台電腦，或從網頁版帶回來',
            onclick: openBackup,
          }, '備份／同步')
        )
      )
    );

    ui.overlay = el('div', {
      class: 'gpn-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': '常用提示詞',
      onmousedown: (e) => { if (e.target === ui.overlay) closeModal(); },
    }, ui.book);

    ui.toast = el('div', { class: 'gpn-toast', role: 'status' });

    buildEditLayer();
    buildTabLayer();
    buildBackupLayer();
    root.append(ui.overlay, ui.editLayer, ui.tabLayer, ui.backupLayer, ui.toast);
    applyTheme();
  }

  /* ---- 書籤寬度規則 ----
     書籤數量越少就讓它們佔越寬，不要在右邊留一大片空白。
     注意：所有書籤「等寬」，作用中與否不影響寬度——
     改用高度來表現選取狀態，按起來才不會一直位移。 */
  const GPN_TAB_SHARE = { 1: 0.40, 2: 0.60, 3: 0.75, 4: 0.86, 5: 0.90, 6: 0.93, 7: 0.95, 8: 0.96 };

  function layoutTabs() {
    const n = data.tabs.length;
    if (!n) return;
    const each = ((GPN_TAB_SHARE[n] ?? 0.96) / n) * 100;
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

  function switchTab(id) {
    if (id === data.activeId) return;
    data.activeId = id;
    persist();
    updateTabStates(true);   // 下沉 → 升起
    renderList();            // 只換下面的卡片
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
        onclick: () => { if (t.id !== data.activeId) switchTab(t.id); },
      }, t.label);

      // 鉛筆不放在書籤上——它會佔掉空間，害書籤上的字無法置中。
      // 改放到下方 paper-head 的右側（見 buildPanel 的 ui.tabEdit）。
      const node = el('div', {
        class: 'gpn-tab' + (isActive ? ' is-active' : ''),
        'data-color': t.color, 'data-id': t.id,
        onanimationend: () => node.classList.remove('is-popping'),
      }, main);

      attachTabDrag(node, main, t.id);
      ui.tabEls.set(t.id, node);
      ui.tabs.append(node);
    }

    ui.addTabBtn = data.tabs.length < GPN_MAX_TABS
      ? el('button', {
          class: 'gpn-tab-add', type: 'button',
          'aria-label': '新增書籤', title: '新增一個書籤分類',
          onclick: () => openTabEditor(null),
        }, '＋')
      : null;
    if (ui.addTabBtn) ui.tabs.append(ui.addTabBtn);

    ui.book.setAttribute('data-color', tab.color);
    layoutTabs();
  }

  function render() {
    renderTabs();
    renderList();
  }

  function renderList() {
    const tab = activeTab();
    if (!tab) return;

    /* ---- 卡片 ---- */
    ui.hintText.textContent = tab.items.length
      ? '點標題填入輸入框並複製　•　拖曳左側可排序'
      : '這個書籤還沒有提示詞';
    ui.tabEdit.setAttribute('aria-label', `編輯書籤「${tab.label}」`);

    ui.list.replaceChildren();
    if (!tab.items.length) {
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
    for (const item of tab.items) ui.list.append(buildCard(item, tab.id));
  }

  function buildCard(item, tabId) {
    const grip = el('div', {
      class: 'gpn-grip', title: '按住拖曳可調整順序', 'aria-label': '拖曳排序', html: ICON_GRIP,
    });

    const titleBtn = el('button', {
      class: 'gpn-title', type: 'button', title: '點一下：填入輸入框並複製',
      onclick: () => usePrompt(item, card),
    },
      el('div', { class: 'gpn-title-text', text: item.title || '(未命名)' }),
      el('div', { class: 'gpn-title-sub', text: preview(item.content) })
    );

    const editBtn = el('button', {
      class: 'gpn-edit', type: 'button', title: '編輯', 'aria-label': `編輯 ${item.title}`,
      html: ICON_PENCIL,
      onclick: (e) => { e.stopPropagation(); openEditor(tabId, item.id); },
    });

    const card = el('div', { class: 'gpn-card', role: 'listitem', 'data-id': item.id },
      grip, titleBtn, editBtn);
    attachDrag(grip, card, tabId);
    return card;
  }

  const preview = (c) => {
    const one = String(c).replace(/\s+/g, ' ').trim();
    return one.length > 42 ? one.slice(0, 42) + '…' : one;
  };

  /* ========== 一鍵輸入：不關面板，改在卡片上播複製動畫 ========== */

  async function usePrompt(item, card) {
    const copied = await copyText(item.content);
    const filled = fillPrompt(item.content);

    if (!filled) { toast('找不到輸入框，內容已複製，請手動貼上', true); return; }
    flashCopied(card, copied ? 'Copied' : 'Inserted');
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

  /* ========== 拖曳排序 ========== */

  function attachDrag(handle, card, tabId) {
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
        if (moved) saveOrder(tabId);
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

  function saveOrder(tabId) {
    const tab = tabById(tabId);
    if (!tab) return;
    const order = [...ui.list.querySelectorAll('.gpn-card')].map((n) => n.getAttribute('data-id'));
    const byId = new Map(tab.items.map((it) => [it.id, it]));
    const next = order.map((id) => byId.get(id)).filter(Boolean);
    for (const it of tab.items) if (!order.includes(it.id)) next.push(it);
    tab.items = next;
    persist();
  }

  /* ==========================================================================
     書籤左右拖曳排序
     刻意設計成「長按 450ms 才進入拖曳」，一般點選不會誤觸。
     按住期間只要移動超過 8px 就取消（視為想點擊或捲動）。
     ========================================================================== */

  const GPN_TAB_HOLD_MS = 450;   // 要按多久才進入拖曳
  const GPN_TAB_SLOP = 8;        // 按住期間允許的手抖範圍(px)

  function attachTabDrag(node, main, tabId) {
    main.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (data.tabs.length < 2) return;           // 只有一個書籤不用排序

      const startX = e.clientX, startY = e.clientY;
      let dragging = false;
      let holdTimer = setTimeout(startDrag, GPN_TAB_HOLD_MS);

      function startDrag() {
        dragging = true;
        node.classList.add('is-drag');
        ui.tabs.classList.add('is-reordering');
        try { main.setPointerCapture(e.pointerId); } catch { /* 沒抓到也能拖 */ }
      }

      const onMove = (ev) => {
        if (!dragging) {
          // 還沒進入拖曳：動太多就視為一般點擊／捲動，取消長按
          if (Math.abs(ev.clientX - startX) > GPN_TAB_SLOP ||
              Math.abs(ev.clientY - startY) > GPN_TAB_SLOP) {
            clearTimeout(holdTimer);
            cleanup();
          }
          return;
        }
        ev.preventDefault();
        const after = tabAfter(ev.clientX);
        if (after === null) {
          // 放到最後，但要排在「＋」按鈕前面
          const anchor = ui.addTabBtn || null;
          if (node.nextElementSibling !== anchor) ui.tabs.insertBefore(node, anchor);
        } else if (after !== node && after !== node.nextElementSibling) {
          ui.tabs.insertBefore(node, after);
        }
      };

      const onUp = () => {
        clearTimeout(holdTimer);
        if (dragging) {
          node.classList.remove('is-drag');
          ui.tabs.classList.remove('is-reordering');
          saveTabOrder();
          // 擋掉這次放開後的 click，避免拖完又切換書籤
          main.addEventListener('click', swallow, { capture: true, once: true });
          setTimeout(() => main.removeEventListener('click', swallow, true), 300);
        }
        cleanup();
      };

      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };

      function cleanup() {
        main.removeEventListener('pointermove', onMove);
        main.removeEventListener('pointerup', onUp);
        main.removeEventListener('pointercancel', onUp);
      }

      main.addEventListener('pointermove', onMove);
      main.addEventListener('pointerup', onUp);
      main.addEventListener('pointercancel', onUp);
    });
  }

  /** 依游標 X 找出該插在哪個書籤前面（null = 放到最後） */
  function tabAfter(x) {
    for (const n of ui.tabs.querySelectorAll('.gpn-tab:not(.is-drag)')) {
      const b = n.getBoundingClientRect();
      if (x < b.left + b.width / 2) return n;
    }
    return null;
  }

  function saveTabOrder() {
    const order = [...ui.tabs.querySelectorAll('.gpn-tab')].map((n) => n.getAttribute('data-id'));
    const byId = new Map(data.tabs.map((t) => [t.id, t]));
    const next = order.map((id) => byId.get(id)).filter(Boolean);
    for (const t of data.tabs) if (!order.includes(t.id)) next.push(t);
    data.tabs = next;
    persist();
  }

  /* ==========================================================================
     三、第二層：提示詞編輯
     ========================================================================== */

  function buildEditLayer() {
    ui.eTitle = el('input', {
      class: 'gpn-input', type: 'text', maxlength: '40', placeholder: '例如：翻譯成英文',
      oninput: () => { ui.eTitle.classList.remove('is-bad'); ui.eTitleHint.classList.remove('is-on'); },
    });
    ui.eTitleHint = el('div', { class: 'gpn-hint', text: '請先輸入按鈕顯示標題' });

    ui.eBody = el('textarea', {
      class: 'gpn-textarea', placeholder: '這裡貼上真正要送給 Gemini 的完整指令內容…',
      oninput: () => { ui.eBody.classList.remove('is-bad'); ui.eBodyHint.classList.remove('is-on'); },
    });
    ui.eBodyHint = el('div', { class: 'gpn-hint', text: '請先輸入提示詞內容' });

    ui.eHead = el('h2');
    ui.eDel = el('button', { class: 'gpn-btn gpn-btn--del', type: 'button', onclick: onDelete }, '刪除');

    ui.editLayer = el('div', { class: 'gpn-edit-layer' },
      el('div', { class: 'gpn-dialog', onmousedown: (e) => e.stopPropagation() },
        ui.eHead,
        el('div', { class: 'gpn-dialog-body' },
          el('div', { class: 'gpn-field' },
            el('label', { class: 'gpn-label' }, '按鈕顯示標題　', el('span', { text: '（卡片上看到的字）' })),
            ui.eTitle, ui.eTitleHint),
          el('div', { class: 'gpn-field' },
            el('label', { class: 'gpn-label' }, '實際的 Prompt 內容　', el('span', { text: '（會填進 Gemini 的文字）' })),
            ui.eBody, ui.eBodyHint)
        ),
        el('div', { class: 'gpn-actions' },
          ui.eDel,
          el('button', { class: 'gpn-btn gpn-btn--cancel', type: 'button', onclick: closeEditor }, '取消'),
          el('button', { class: 'gpn-btn gpn-btn--save', type: 'button', onclick: onSave }, '儲存')
        )
      )
    );
  }

  function openEditor(tabId, id) {
    const tab = tabById(tabId);
    if (!tab) return;
    const item = id ? tab.items.find((it) => it.id === id) : null;
    editing = { tabId, id: item ? id : null };

    ui.eHead.textContent = item ? '編輯提示詞' : `在「${tab.label}」新增提示詞`;
    ui.eTitle.value = item ? item.title : '';
    ui.eBody.value = item ? item.content : '';
    ui.eDel.style.display = item ? '' : 'none';
    disarmDelete();

    for (const n of [ui.eTitle, ui.eBody]) n.classList.remove('is-bad');
    for (const n of [ui.eTitleHint, ui.eBodyHint]) n.classList.remove('is-on');

    ui.editLayer.classList.add('is-open');
    ui.overlay.classList.add('is-editing');
    setTimeout(() => ui.eTitle.focus(), 40);
  }

  function closeEditor() {
    ui.editLayer.classList.remove('is-open');
    if (!isTabEditing() && !isBackupOpen()) ui.overlay.classList.remove('is-editing');
    editing = null;
    disarmDelete();
  }

  const isEditing = () => ui.editLayer.classList.contains('is-open');

  async function onSave() {
    if (!editing) return;
    const title = ui.eTitle.value.trim();
    const content = ui.eBody.value.trim();

    let bad = false;
    if (!title) { ui.eTitle.classList.add('is-bad'); ui.eTitleHint.classList.add('is-on'); bad = true; }
    if (!content) { ui.eBody.classList.add('is-bad'); ui.eBodyHint.classList.add('is-on'); bad = true; }
    if (bad) { (title ? ui.eBody : ui.eTitle).focus(); return; }

    const tab = tabById(editing.tabId);
    if (!tab) return;
    if (editing.id) {
      const item = tab.items.find((it) => it.id === editing.id);
      if (item) { item.title = title; item.content = content; }
      toast('已儲存修改');
    } else {
      tab.items.push({ id: gpnNewId(), title, content });
      toast('已新增提示詞');
    }

    await persist();
    closeEditor();
    render();
  }

  function onDelete() {
    if (!editing || !editing.id) return;
    if (!delArmed) {
      delArmed = true;
      ui.eDel.classList.add('is-confirm');
      ui.eDel.textContent = '確定刪除？再按一次';
      clearTimeout(delTimer);
      delTimer = setTimeout(disarmDelete, 4000);
      return;
    }
    const tab = tabById(editing.tabId);
    if (tab) {
      const idx = tab.items.findIndex((it) => it.id === editing.id);
      if (idx >= 0) tab.items.splice(idx, 1);
    }
    persist();
    closeEditor();
    render();
    toast('已刪除');
  }

  function disarmDelete() {
    clearTimeout(delTimer);
    delArmed = false;
    ui.eDel.classList.remove('is-confirm');
    ui.eDel.textContent = '刪除';
  }

  /* ==========================================================================
     四、第二層：書籤（分類）編輯
     ========================================================================== */

  function buildTabLayer() {
    ui.tName = el('input', {
      class: 'gpn-input', type: 'text', maxlength: '8', placeholder: '例如：工作',
      oninput: () => { ui.tName.classList.remove('is-bad'); ui.tNameHint.classList.remove('is-on'); },
    });
    ui.tNameHint = el('div', { class: 'gpn-hint', text: '請輸入書籤名稱' });

    // 顏色色票
    ui.tSwatches = el('div', { class: 'gpn-swatches' });
    for (const c of GPN_COLORS) {
      ui.tSwatches.append(el('button', {
        class: 'gpn-swatch', type: 'button', 'data-color': c,
        'aria-label': GPN_COLOR_LABELS[c], title: GPN_COLOR_LABELS[c],
        onclick: () => setSwatch(c),
      }));
    }

    ui.tHead = el('h2');
    ui.tDel = el('button', { class: 'gpn-btn gpn-btn--del', type: 'button', onclick: onTabDelete }, '刪除');

    ui.tabLayer = el('div', { class: 'gpn-edit-layer gpn-tab-layer' },
      el('div', { class: 'gpn-dialog gpn-dialog--sm', onmousedown: (e) => e.stopPropagation() },
        ui.tHead,
        el('div', { class: 'gpn-dialog-body' },
          el('div', { class: 'gpn-field' },
            el('label', { class: 'gpn-label' }, '書籤名稱　', el('span', { text: '（最多 8 個字）' })),
            ui.tName, ui.tNameHint),
          el('div', { class: 'gpn-field' },
            el('label', { class: 'gpn-label' }, '書籤顏色'),
            ui.tSwatches)
        ),
        el('div', { class: 'gpn-actions' },
          ui.tDel,
          el('button', { class: 'gpn-btn gpn-btn--cancel', type: 'button', onclick: closeTabEditor }, '取消'),
          el('button', { class: 'gpn-btn gpn-btn--save', type: 'button', onclick: onTabSave }, '儲存')
        )
      )
    );
  }

  function setSwatch(color) {
    if (!tabEditing) return;
    tabEditing.color = color;
    for (const s of ui.tSwatches.children) {
      s.classList.toggle('is-on', s.getAttribute('data-color') === color);
    }
  }

  function openTabEditor(id) {
    const tab = id ? tabById(id) : null;
    // 新書籤預設挑一個還沒用過的顏色
    const used = new Set(data.tabs.map((t) => t.color));
    const fresh = GPN_COLORS.find((c) => !used.has(c)) || GPN_COLORS[0];
    tabEditing = { id: tab ? id : null, color: tab ? tab.color : fresh };

    ui.tHead.textContent = tab ? '編輯書籤' : '新增書籤';
    ui.tName.value = tab ? tab.label : '';
    ui.tName.classList.remove('is-bad');
    ui.tNameHint.classList.remove('is-on');

    // 最後一個書籤不給刪，否則會沒有任何分類
    ui.tDel.style.display = (tab && data.tabs.length > 1) ? '' : 'none';
    disarmTabDelete();
    setSwatch(tabEditing.color);

    ui.tabLayer.classList.add('is-open');
    ui.overlay.classList.add('is-editing');
    setTimeout(() => ui.tName.focus(), 40);
  }

  function closeTabEditor() {
    ui.tabLayer.classList.remove('is-open');
    if (!isEditing() && !isBackupOpen()) ui.overlay.classList.remove('is-editing');
    tabEditing = null;
    disarmTabDelete();
  }

  const isTabEditing = () => ui.tabLayer.classList.contains('is-open');

  async function onTabSave() {
    if (!tabEditing) return;
    const label = ui.tName.value.trim();
    if (!label) {
      ui.tName.classList.add('is-bad');
      ui.tNameHint.classList.add('is-on');
      ui.tName.focus();
      return;
    }

    if (tabEditing.id) {
      const tab = tabById(tabEditing.id);
      if (tab) { tab.label = label; tab.color = tabEditing.color; }
      toast('已更新書籤');
    } else {
      const tab = { id: gpnNewId('t'), label, color: tabEditing.color, items: [] };
      data.tabs.push(tab);
      data.activeId = tab.id;          // 新增後直接切過去
      toast('已新增書籤');
    }

    await persist();
    closeTabEditor();
    render();
  }

  /** 刪除書籤：會連裡面的提示詞一起刪，所以訊息要講清楚 + 二段式確認 */
  function onTabDelete() {
    if (!tabEditing || !tabEditing.id || data.tabs.length <= 1) return;
    const tab = tabById(tabEditing.id);
    if (!tab) return;

    if (!tabDelArmed) {
      tabDelArmed = true;
      ui.tDel.classList.add('is-confirm');
      ui.tDel.textContent = tab.items.length
        ? `連同 ${tab.items.length} 個提示詞一起刪除？再按一次`
        : '確定刪除？再按一次';
      clearTimeout(tabDelTimer);
      tabDelTimer = setTimeout(disarmTabDelete, 5000);
      return;
    }

    const idx = data.tabs.findIndex((t) => t.id === tabEditing.id);
    if (idx >= 0) data.tabs.splice(idx, 1);
    if (!tabById(data.activeId)) data.activeId = data.tabs[0].id;

    persist();
    closeTabEditor();
    render();
    toast(`已刪除書籤「${tab.label}」`);
  }

  function disarmTabDelete() {
    clearTimeout(tabDelTimer);
    tabDelArmed = false;
    ui.tDel.classList.remove('is-confirm');
    ui.tDel.textContent = '刪除';
  }

  /* ==========================================================================
     五、第二層：備份與同步（匯出／匯入）

     為什麼需要這個：公家機關的電腦不能裝擴充功能，所以另外做了網頁版。
     兩邊是各自獨立的儲存空間，靠這裡的「代碼／備份檔」手動搬資料。
     ========================================================================== */

  function buildBackupLayer() {
    /* ---- ① 帶出去 ---- */
    ui.bStats = el('div', { class: 'gpn-note' });

    const outRow = el('div', { class: 'gpn-brow' },
      el('button', {
        class: 'gpn-btn2', type: 'button',
        onclick: () => { gpnDownloadExport(data); toast('備份檔已開始下載'); },
      }, '⬇　下載備份檔'),
      el('button', {
        class: 'gpn-btn2', type: 'button',
        onclick: async (e) => {
          const ok = await gpnShareCopy(gpnExportCode(data));
          toast(ok ? '代碼已複製，貼到另一台就好' : '複製失敗，請改用下載備份檔', !ok);
          if (ok) {
            e.currentTarget.classList.add('is-done');
            setTimeout(() => e.currentTarget.classList.remove('is-done'), 1400);
          }
        },
      }, '⧉　複製代碼')
    );

    /* ---- ② 帶回來 ---- */
    ui.bCode = el('textarea', {
      class: 'gpn-textarea gpn-textarea--code', spellcheck: 'false',
      placeholder: '在這裡貼上另一台複製的代碼…',
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
      class: 'gpn-btn gpn-btn--save', type: 'button', onclick: onImport,
    }, '匯入');

    ui.backupLayer = el('div', { class: 'gpn-edit-layer gpn-backup-layer' },
      el('div', { class: 'gpn-dialog', onmousedown: (e) => e.stopPropagation() },
        el('h2', {}, '備份與同步'),
        el('div', { class: 'gpn-dialog-body' },
          el('div', { class: 'gpn-field' },
            el('label', { class: 'gpn-label' },
              '① 把資料帶出去　', el('span', { text: '（給另一台電腦或網頁版用）' })),
            outRow, ui.bStats),

          el('div', { class: 'gpn-sep' }),

          el('div', { class: 'gpn-field' },
            el('label', { class: 'gpn-label' },
              '② 把資料帶回來　', el('span', { text: '（貼上代碼，或選一個備份檔）' })),
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
            ui.bNote)
        ),
        el('div', { class: 'gpn-actions' },
          el('button', { class: 'gpn-btn gpn-btn--cancel', type: 'button', onclick: closeBackup }, '關閉'),
          ui.bImport
        )
      )
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
      ui.bNote.textContent = p.added
        ? `讀到 ${parsed.itemCount} 則提示詞，其中 ${p.added} 則是新的，會加進來` +
          (p.skipped ? `（${p.skipped} 則重複的會跳過）` : '')
        : `讀到 ${parsed.itemCount} 則提示詞，但你這台都已經有了，不會有變化`;
    } else {
      ui.bNote.textContent =
        `讀到 ${parsed.tabCount} 個書籤、${parsed.itemCount} 則提示詞，會取代現在的全部內容`;
    }
    return parsed;
  }

  /** 匯入會動到既有資料，所以一律二段式確認（和刪除同一套做法） */
  async function onImport() {
    const parsed = refreshBackupPreview();
    if (!parsed) { ui.bCode.focus(); return; }

    if (!impArmed) {
      impArmed = true;
      ui.bImport.classList.add('is-confirm');
      const have = countItems(data);
      ui.bImport.textContent = backupMode === 'merge'
        ? '確定合併？再按一次'
        : have ? `確定取代？現有 ${have} 則會不見，再按一次` : '確定取代？再按一次';
      clearTimeout(impTimer);
      impTimer = setTimeout(disarmImport, 6000);
      return;
    }

    if (backupMode === 'merge') {
      const r = gpnMergeData(data, parsed.data);
      data = r.data;
      await persist();
      render();
      closeBackup();
      toast(r.added ? `已加入 ${r.added} 則提示詞` : '沒有新的提示詞，資料維持原樣');
    } else {
      data = gpnNormalize(parsed.data);
      await persist();
      render();
      closeBackup();
      toast(`已匯入 ${countItems(data)} 則提示詞`);
    }
  }

  const countItems = (d) => d.tabs.reduce((n, t) => n + t.items.length, 0);

  function disarmImport() {
    clearTimeout(impTimer);
    impArmed = false;
    ui.bImport.classList.remove('is-confirm');
    ui.bImport.textContent = '匯入';
  }

  function openBackup() {
    ui.bCode.value = '';
    setBackupMode('merge');          // 每次都從最安全的選項開始
    ui.bStats.textContent =
      `這台目前有 ${data.tabs.length} 個書籤、${countItems(data)} 則提示詞`;
    ui.backupLayer.classList.add('is-open');
    ui.overlay.classList.add('is-editing');
  }

  function closeBackup() {
    ui.backupLayer.classList.remove('is-open');
    if (!isEditing() && !isTabEditing()) ui.overlay.classList.remove('is-editing');
    disarmImport();
  }

  const isBackupOpen = () => ui.backupLayer.classList.contains('is-open');

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

  /* ========== 開 / 關主視窗 ========== */

  const isOpen = () => ui.overlay?.classList.contains('is-open');

  async function openModal() {
    ensureHosts();          // 保險：面板若被網頁的框架清掉，先掛回來再開
    data = await GpnStore.load();
    render();
    ui.overlay.classList.add('is-open');
    triggerBtn?.classList.add('gpn-is-open');
    fabHost?.classList.add('is-hidden');      // 開面板時圓鈕先收起來，不要透出遮罩
  }

  function closeModal() {
    closeEditor();
    closeTabEditor();
    closeBackup();
    ui.overlay.classList.remove('is-open');
    triggerBtn?.classList.remove('gpn-is-open');
    fabHost?.classList.remove('is-hidden');
  }

  function onKeydown(e) {
    if (e.key !== 'Escape' || !isOpen()) return;

    if (isBackupOpen()) {
      closeBackup();
    } else if (isTabEditing()) {
      closeTabEditor();
    } else if (isEditing()) {
      const tab = editing?.tabId ? tabById(editing.tabId) : null;
      const item = editing?.id ? tab?.items.find((it) => it.id === editing.id) : null;
      const dirty = ui.eTitle.value.trim() !== (item?.title ?? '') ||
                    ui.eBody.value.trim() !== (item?.content ?? '');
      if (dirty) toast('還沒儲存喔，請按「儲存」或「取消」');
      else closeEditor();
    } else {
      closeModal();
    }
    e.stopPropagation();
    e.preventDefault();
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
    data = await GpnStore.load();
    render();
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
    document.addEventListener('keydown', onKeydown, true);

    GpnStore.onExternalChange((fresh) => {
      data = fresh;
      if (isOpen() && !isEditing() && !isTabEditing() && !isBackupOpen()) render();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
