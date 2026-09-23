/**
 * 面板本體：書籤 ＞（資料夾）＞ 提示詞
 *
 * 外掛（src/content.js）和網頁版（web/app.js）用的是「同一份」面板，
 * 所以兩邊的長相、操作一模一樣。src/panel.js 和 web/panel.js 必須一字不差，
 * tools/checksync.py 會檢查。
 *
 * 資料夾是每個書籤各自決定要不要用的（齒輪 → 資料夾）：
 *   沒開 → 紙張裡只有卡片，和最早的版本一樣
 *   有開 → 左邊多一欄資料夾，點書籤一律先顯示第一個資料夾
 *
 * 兩邊的差別只由呼叫端決定：
 *   onUse       點提示詞時要做什麼
 *               外掛：填進 AI 的輸入框＋複製；網頁版：只能複製（同源政策）
 *   standalone  網頁版＝true：面板一直開著、沒有遮罩、點外面或按 Esc 都不會關
 *
 * 依賴 store.js（資料格式、GpnStore）和 share.js（匯出／匯入），載入順序要在它們之後。
 */

/**
 * @param {object}   opts
 * @param {ShadowRoot} opts.root         面板要畫在哪裡（樣式表由呼叫端掛好）
 * @param {boolean}  [opts.standalone]   網頁版
 * @param {Function} opts.onUse          async (item) => ({ badge?, toast?, bad? })
 * @param {Function} [opts.onOpenChange] (open) => void，外掛用來同步觸發按鈕的狀態
 * @param {string}   [opts.notice]       紙張最上方的紅色提醒（例如網頁版不能存檔）
 */
function gpnCreatePanel(opts) {
  'use strict';

  const {
    root,
    standalone = false,
    onUse,
    onOpenChange = () => {},
    notice = '',
  } = opts;

  /* ========== 圖示（SVG，不依賴任何網站的圖示字體） ========== */

  const ICON_PENCIL =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41' +
    'l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

  /** 齒輪：設定（名稱、顏色、資料夾、備份）
      注意：path 一定要寫成「單一字串」。之前用字串相接，接點漏掉一個空格
      （`.06-.94` + `0-.32` → `.06-.940-.32`），整段路徑語法就壞掉、畫不出來。 */
  const ICON_GEAR =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>';

  const ICON_GRIP =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="9" cy="5" r="1.7"/><circle cx="15" cy="5" r="1.7"/>' +
    '<circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/>' +
    '<circle cx="9" cy="19" r="1.7"/><circle cx="15" cy="19" r="1.7"/></svg>';

  const ICON_FOLDER =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>';

  const ICON_TAB =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2zm0 15l-5-2.18L7 18V5h10v13z"/></svg>';

  const ICON_SYNC =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>';

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
  let impArmed = false, impTimer = 0;
  const ui = {};

  const tabById = (id) => data.tabs.find((t) => t.id === id);
  const activeTab = () => tabById(data.activeId) || data.tabs[0];
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

  /* ==========================================================================
     一、骨架
     ========================================================================== */

  function build() {
    ui.list = el('div', { class: 'gpn-list', role: 'list' });
    ui.tabs = el('div', { class: 'gpn-tabs', role: 'tablist' });
    ui.tabEls = new Map();        // id → 書籤元素（切換時要重複使用才有動畫）
    ui.hintText = el('span', { class: 'gpn-hint-text' });
    ui.gear = el('button', {
      class: 'gpn-tab-edit', type: 'button', title: '設定（名稱、顏色、資料夾、備份）',
      html: ICON_GEAR,
      onclick: () => openSettings(data.activeId),
    });
    ui.hint = el('div', { class: 'gpn-paper-head' },
      // 左邊這格剛好對齊下方的資料夾欄，當作那一欄的標題（沒開資料夾時隱藏）
      el('span', { class: 'gpn-head-folders', html: ICON_FOLDER + '<span>資料夾</span>' }),
      ui.hintText, ui.gear);

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

    ui.book = el('div', { class: 'gpn-book' },
      ui.tabs,
      el('div', { class: 'gpn-paper' },
        ui.hint,
        notice ? el('div', { class: 'gpn-notice', role: 'alert', text: notice }) : null,
        el('div', { class: 'gpn-body' },
          el('nav', { class: 'gpn-folders' }, ui.folderList),
          ui.list),
        el('div', { class: 'gpn-foot' },
          el('button', {
            class: 'gpn-add', type: 'button',
            onclick: () => openEditor(data.activeId, activeFolder()?.id ?? null, null),
          }, '＋ 新增提示詞')
        )
      )
    );

    ui.overlay = el('div', {
      class: 'gpn-overlay', role: 'dialog', 'aria-modal': standalone ? null : 'true',
      'aria-label': '常用提示詞',
      onmousedown: (e) => { if (!standalone && e.target === ui.overlay) close(); },
    }, ui.book);

    ui.toast = el('div', { class: 'gpn-toast', role: 'status' });

    buildEditLayer();
    buildNewTabLayer();
    buildFolderLayer();
    buildSettingsLayer();
    root.append(ui.overlay, ui.editLayer, ui.newTabLayer, ui.folderLayer, ui.settingsLayer, ui.toast);
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

  /** 點書籤：有資料夾的話，一律顯示該書籤的「第一個資料夾」 */
  function switchTab(id) {
    if (id === data.activeId) return;
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
        onclick: () => { if (t.id !== data.activeId) switchTab(t.id); },
      }, t.label);

      // 設定鈕不放在書籤上——它會佔掉空間，害書籤上的字無法置中。
      // 改放到下方 paper-head 的右側（見 build 的 ui.gear）。
      const node = el('div', {
        class: 'gpn-tab' + (isActive ? ' is-active' : ''),
        'data-color': t.color, 'data-id': t.id,
        onanimationend: () => node.classList.remove('is-popping'),
      }, main);

      attachHoldDrag({
        handle: main, node, box: ui.tabs, selector: '.gpn-tab',
        anchor: () => ui.addTabBtn || null,
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

    ui.book.setAttribute('data-color', tab.color);
    layoutTabs();
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
        // 選中的那一格把位置讓給鉛筆，數量改在上方提示列看
        on ? null : el('span', { class: 'gpn-folder-count', text: String(f.items.length) })
      );

      const row = el('div', { class: 'gpn-folder' + (on ? ' is-active' : ''), 'data-id': f.id },
        main,
        on ? el('button', {
          class: 'gpn-folder-edit', type: 'button',
          title: '資料夾設定（改名／刪除）', 'aria-label': `資料夾「${f.label}」設定`,
          html: ICON_PENCIL,
          onclick: () => openFolderEditor(f.id),
        }) : null
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
    const folder = activeFolder();
    const list = folder || tab;

    const n = list.items.length;
    ui.hintText.textContent = n
      ? `${n} 則　•　` + (standalone ? '點標題複製，再貼到 AI' : '點標題填入輸入框並複製') +
        '　•　拖曳左側可排序'
      : folder ? '這個資料夾還沒有提示詞' : '這個書籤還沒有提示詞';
    ui.gear.setAttribute('aria-label', `「${tab.label}」的設定`);

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

  function buildCard(item, tabId, fid) {
    const grip = el('div', {
      class: 'gpn-grip', title: '按住拖曳可調整順序', 'aria-label': '拖曳排序', html: ICON_GRIP,
    });

    const titleBtn = el('button', {
      class: 'gpn-title', type: 'button',
      title: standalone ? '點一下：複製這段提示詞' : '點一下：填入輸入框並複製',
      onclick: () => usePrompt(item, card),
    },
      el('div', { class: 'gpn-title-text', text: item.title || '(未命名)' }),
      el('div', { class: 'gpn-title-sub', text: preview(item.content) })
    );

    const editBtn = el('button', {
      class: 'gpn-edit', type: 'button', title: '編輯', 'aria-label': `編輯 ${item.title}`,
      html: ICON_PENCIL,
      onclick: (e) => { e.stopPropagation(); openEditor(tabId, fid, item.id); },
    });

    const card = el('div', { class: 'gpn-card', role: 'listitem', 'data-id': item.id },
      grip, titleBtn, editBtn);
    attachDrag(grip, card, tabId, fid);
    return card;
  }

  const preview = (c) => {
    const one = String(c).replace(/\s+/g, ' ').trim();
    return one.length > 42 ? one.slice(0, 42) + '…' : one;
  };

  /* ========== 一鍵使用：不關面板，改在卡片上播動畫 ========== */

  async function usePrompt(item, card) {
    const r = (await onUse(item)) || {};
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
  function toast(msg, bad = false) {
    ui.toast.textContent = msg;
    ui.toast.classList.toggle('is-bad', bad);
    ui.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('is-on'), bad ? 4200 : 2200);
  }

  /* ========== 卡片上下拖曳排序（按住左邊把手，馬上就能拖） ========== */

  function attachDrag(handle, card, tabId, fid) {
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
        if (moved) saveOrder(tabId, fid);
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

  function saveOrder(tabId, fid) {
    const list = listOf(tabId, fid);
    if (!list) return;
    const order = [...ui.list.querySelectorAll('.gpn-card')].map((n) => n.getAttribute('data-id'));
    list.items = reorder(list.items, order);
    persist();
  }

  /* ==========================================================================
     長按後拖曳排序：書籤（左右）、資料夾（上下）共用
     刻意設計成「長按 450ms 才進入拖曳」，一般點選不會誤觸。
     按住期間只要移動超過 8px 就取消（視為想點擊或捲動）。
     ========================================================================== */

  const GPN_HOLD_MS = 450;   // 要按多久才進入拖曳
  const GPN_HOLD_SLOP = 8;   // 按住期間允許的手抖範圍(px)

  /**
   * @param {object} o
   * @param {Element}  o.handle    按下去的地方
   * @param {Element}  o.node      要搬動的元素
   * @param {Element}  o.box       容器（能捲動的話，拖到邊緣會自動捲）
   * @param {string}   o.selector  容器裡「可以排序的兄弟」
   * @param {Function} o.anchor    () => 永遠要排在最後的元素（「＋」按鈕），沒有就回 null
   * @param {Function} o.vertical  () => 是否上下排列
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
        node.classList.add('is-drag');
        box.classList.add('is-reordering');
        try { handle.setPointerCapture(e.pointerId); } catch { /* 沒抓到也能拖 */ }
      }

      const onMove = (ev) => {
        if (!dragging) {
          // 還沒進入拖曳：動太多就視為一般點擊／捲動，取消長按
          if (Math.abs(ev.clientX - startX) > GPN_HOLD_SLOP ||
              Math.abs(ev.clientY - startY) > GPN_HOLD_SLOP) {
            clearTimeout(holdTimer);
            cleanup();
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
          if (pos < (v ? b.top + b.height / 2 : b.left + b.width / 2)) { after = n; break; }
        }
        // 拖到最後面時，要排在「＋」按鈕前面
        const target = after || o.anchor();
        if (target !== node && target !== node.nextElementSibling) box.insertBefore(node, target);
      };

      const onUp = () => {
        clearTimeout(holdTimer);
        if (dragging) {
          node.classList.remove('is-drag');
          box.classList.remove('is-reordering');
          o.onDrop([...box.querySelectorAll(selector)].map((n) => n.getAttribute('data-id')));
          // 擋掉這次放開後的 click，避免拖完又觸發切換
          handle.addEventListener('click', swallow, { capture: true, once: true });
          setTimeout(() => handle.removeEventListener('click', swallow, true), 300);
        }
        cleanup();
      };

      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };

      function cleanup() {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      }

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  /* ==========================================================================
     四、對話框共用：打開任何一層時，筆記本退到後面
     ========================================================================== */

  const layerOpen = (layer) => layer.classList.contains('is-open');
  const anyLayerOpen = () =>
    [ui.editLayer, ui.newTabLayer, ui.folderLayer, ui.settingsLayer].some(layerOpen);

  function showLayer(layer) {
    layer.classList.add('is-open');
    ui.overlay.classList.add('is-editing');
  }

  function hideLayer(layer) {
    layer.classList.remove('is-open');
    ui.overlay.classList.toggle('is-editing', anyLayerOpen());
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

  /** 六色色票；onPick(顏色) */
  function buildSwatches(onPick) {
    const box = el('div', { class: 'gpn-swatches' });
    for (const c of GPN_COLORS) {
      box.append(el('button', {
        class: 'gpn-swatch', type: 'button', 'data-color': c,
        'aria-label': GPN_COLOR_LABELS[c], title: GPN_COLOR_LABELS[c],
        onclick: () => onPick(c),
      }));
    }
    return box;
  }
  function markSwatch(box, color) {
    for (const s of box.children) s.classList.toggle('is-on', s.getAttribute('data-color') === color);
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
      oninput: () => { ui.eBody.classList.remove('is-bad'); ui.eBodyHint.classList.remove('is-on'); },
    });
    ui.eBodyHint = el('div', { class: 'gpn-hint', text: '請先輸入提示詞內容' });

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
          field('實際的 Prompt 內容', '（點標題時用的文字）', ui.eBody, ui.eBodyHint),
          field('放在哪裡', '（改這裡就能搬到別的書籤或資料夾）',
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
    ui.eTitle.value = item ? item.title : '';
    ui.eBody.value = item ? item.content : '';
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
      toast(moved ? `已新增到「${whereLabel(to.tabId, to.folderId)}」` : '已新增提示詞');
    }

    await persist();
    closeEditor();
    render();
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
    const list = listOf(editing.tabId, editing.folderId);
    if (list) {
      const idx = list.items.findIndex((it) => it.id === editing.id);
      if (idx >= 0) list.items.splice(idx, 1);
    }
    persist();
    closeEditor();
    render();
    toast('已刪除');
  }

  function disarmDelete() {
    clearTimeout(delTimer);
    delArmed = false;
    disarmButton(ui.eDel, '刪除');
  }

  /** 編輯到一半按 Esc：有改過就不關，避免打好的字不見 */
  function editorDirty() {
    const item = editing?.id
      ? listOf(editing.tabId, editing.folderId)?.items.find((it) => it.id === editing.id)
      : null;
    return ui.eTitle.value.trim() !== (item?.title ?? '') ||
           ui.eBody.value.trim() !== (item?.content ?? '') ||
           ui.eWhere.value !== ui.eWhere.dataset.start;
  }

  /* ==========================================================================
     六、新增書籤（書籤列最右邊的「＋」）
     已經存在的書籤要改名、換色、刪除，都在齒輪的設定裡。
     ========================================================================== */

  function buildNewTabLayer() {
    ui.nName = el('input', {
      class: 'gpn-input', type: 'text', maxlength: '8', placeholder: '例如：工作',
      oninput: () => { ui.nName.classList.remove('is-bad'); ui.nNameHint.classList.remove('is-on'); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); onNewTabSave(); } },
    });
    ui.nNameHint = el('div', { class: 'gpn-hint', text: '請輸入書籤名稱' });
    ui.nSwatches = buildSwatches((c) => { newTabColor = c; markSwatch(ui.nSwatches, c); });

    ui.newTabLayer = el('div', { class: 'gpn-edit-layer' },
      el('div', { class: 'gpn-dialog gpn-dialog--sm', onmousedown: stop },
        el('h2', { text: '新增書籤' }),
        el('div', { class: 'gpn-dialog-body' },
          field('書籤名稱', '（最多 8 個字）', ui.nName, ui.nNameHint),
          field('書籤顏色', null, ui.nSwatches),
          el('div', { class: 'gpn-note', text: '新書籤一開始不分資料夾。之後需要的話，可以在齒輪的設定裡開啟。' })
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
    markSwatch(ui.nSwatches, newTabColor);
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
        ? '這是最後一個資料夾，不能刪除。不想分資料夾的話，可以到齒輪 → 資料夾 把它關掉。'
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

    tab.folders.splice(tab.folders.indexOf(folder), 1);
    if (folderId === folder.id) folderId = null;

    persist();
    closeFolderEditor();
    render();
    toast(`已刪除資料夾「${folder.label}」`);
  }

  function disarmFolderDelete() {
    clearTimeout(folderDelTimer);
    folderDelArmed = false;
    disarmButton(ui.fDel, '刪除');
  }

  /* ==========================================================================
     八、設定（紙張右上角的齒輪）
     左邊選單、右邊內容。前兩頁是「這個書籤」的設定，最後一頁是全部資料的備份。
     改名、換色、開關資料夾都是「改了就存」，不必按儲存，也就不會有改了卻忘記存的狀況。
     ========================================================================== */

  function buildSettingsLayer() {
    /* ---- 左邊選單 ---- */
    ui.sNavGroup = el('div', { class: 'gpn-nav-group' });
    ui.sNavBadge = el('span', { class: 'gpn-nav-badge' });
    const navItem = (key, icon, text, extra) => el('button', {
      class: 'gpn-nav-item', type: 'button', role: 'tab', 'data-section': key,
      onclick: () => showSection(key),
    }, el('span', { class: 'gpn-nav-icon', html: icon }), el('span', { class: 'gpn-nav-text', text }), extra);
    ui.sNavItems = [
      navItem('tab', ICON_TAB, '名稱與顏色'),
      navItem('folders', ICON_FOLDER, '資料夾', ui.sNavBadge),
      navItem('backup', ICON_SYNC, '備份與同步'),
    ];
    const nav = el('nav', { class: 'gpn-settings-nav', role: 'tablist', 'aria-orientation': 'vertical' },
      el('h2', { text: '設定' }),
      ui.sNavGroup, ui.sNavItems[0], ui.sNavItems[1],
      el('div', { class: 'gpn-nav-group', text: '所有書籤' }), ui.sNavItems[2]);

    /* ---- 名稱與顏色 ---- */
    ui.sName = el('input', {
      class: 'gpn-input', type: 'text', maxlength: '8', placeholder: '例如：工作',
      oninput: onSettingsName,
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); ui.sName.blur(); } },
    });
    ui.sNameHint = el('div', { class: 'gpn-hint', text: '名稱不能空白；留空的話會保留原本的名稱' });
    ui.sSwatches = buildSwatches(onSettingsColor);
    ui.sDelNote = el('div', { class: 'gpn-note' });
    ui.sDel = el('button', { class: 'gpn-btn gpn-btn--del', type: 'button', onclick: onTabDelete }, '刪除這個書籤');
    ui.sDanger = el('div', { class: 'gpn-danger' },
      el('div', { class: 'gpn-label', text: '刪除書籤' }), ui.sDelNote, ui.sDel);

    const secTab = el('section', { class: 'gpn-section', 'data-section': 'tab' },
      el('h3', { text: '名稱與顏色' }),
      field('書籤名稱', '（最多 8 個字）', ui.sName, ui.sNameHint),
      field('書籤顏色', null, ui.sSwatches),
      el('div', { class: 'gpn-note', text: '改好會自動儲存。' }),
      ui.sDanger);

    /* ---- 資料夾 ---- */
    ui.sSwitchTitle = el('b');
    ui.sSwitchState = el('span');
    ui.sSwitch = el('button', {
      class: 'gpn-switch-row', type: 'button', role: 'switch', 'aria-checked': 'false',
      onclick: onFolderSwitch,
    },
      el('span', { class: 'gpn-switch', 'aria-hidden': 'true' }),
      el('span', { class: 'gpn-switch-text' }, ui.sSwitchTitle, ui.sSwitchState));
    ui.sFolderNote = el('div', { class: 'gpn-note gpn-note--roomy' });

    // 關閉資料夾會把分類攤平，所以先講清楚會發生什麼事，再讓他決定
    ui.sConfirmText = el('div');
    ui.sConfirm = el('div', { class: 'gpn-confirm', role: 'alert' },
      ui.sConfirmText,
      el('div', { class: 'gpn-brow' },
        el('button', { class: 'gpn-btn2 gpn-btn2--danger', type: 'button', onclick: disableFolders }, '確定關閉'),
        el('button', { class: 'gpn-btn2', type: 'button', onclick: hideFolderConfirm }, '先不要')));
    ui.sConfirm.hidden = true;

    const secFolders = el('section', { class: 'gpn-section', 'data-section': 'folders' },
      el('h3', { text: '資料夾' }),
      el('p', {
        class: 'gpn-lede',
        text: '提示詞很多的書籤，可以再分成幾個資料夾，左邊會多一欄讓你切換。' +
              '提示詞不多的書籤（例如「常用」）不開也沒關係。',
      }),
      ui.sSwitch, ui.sConfirm, ui.sFolderNote);

    /* ---- 備份與同步 ---- */
    const secBackup = buildBackupSection();

    ui.sSections = [secTab, secFolders, secBackup];
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
    settingsTabId = tabId;
    ui.sName.value = tab.label;
    ui.sName.classList.remove('is-bad');
    ui.sNameHint.classList.remove('is-on');
    disarmTabDelete();
    resetBackup();
    refreshSettings();
    showSection(section);
    showLayer(ui.settingsLayer);
  }

  function closeSettings() {
    hideLayer(ui.settingsLayer);
    settingsTabId = null;
    disarmTabDelete();
    disarmImport();
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
  }

  /** 設定視窗裡所有「跟著資料變」的文字，一次更新 */
  function refreshSettings() {
    const tab = tabById(settingsTabId);
    if (!tab) return;
    const n = gpnTabItemCount(tab);

    ui.settings.setAttribute('data-color', tab.color);
    ui.sNavGroup.textContent = `「${tab.label}」這個書籤`;
    markSwatch(ui.sSwatches, tab.color);

    const on = !!tab.folders;
    ui.sSwitch.setAttribute('aria-checked', String(on));
    ui.sSwitchTitle.textContent = `「${tab.label}」使用資料夾`;
    ui.sSwitchState.textContent = on ? '開啟中' : '關閉中';
    ui.sNavBadge.textContent = on ? '開' : '關';
    ui.sNavBadge.classList.toggle('is-on', on);
    ui.sFolderNote.textContent = on
      ? `目前有 ${tab.folders.length} 個資料夾、${n} 則提示詞。` +
        '新增、改名、刪除資料夾，都在主畫面左邊那一欄；在資料夾上「長按」可以上下拖曳排序。'
      : n
        ? `開啟後，現在的 ${n} 則提示詞會先放進「${GPN_DEFAULT_FOLDER}」資料夾，` +
          '之後可以再新增資料夾，用鉛筆把提示詞搬過去。'
        : `開啟後，會先建立一個「${GPN_DEFAULT_FOLDER}」資料夾。`;

    ui.sDanger.hidden = data.tabs.length <= 1;        // 最後一個書籤不給刪
    ui.sDelNote.textContent = n
      ? `書籤裡的 ${n} 則提示詞會一起刪除，刪了就找不回來。刪之前可以先到「備份與同步」下載備份。`
      : '這個書籤裡沒有提示詞。';

    ui.bStats.textContent =
      `這台目前有 ${data.tabs.length} 個書籤、${gpnCountFolders(data)} 個資料夾、` +
      `${gpnCountItems(data)} 則提示詞`;
  }

  function onSettingsName() {
    const tab = tabById(settingsTabId);
    if (!tab) return;
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
    if (!tab || tab.color === color) return;
    tab.color = color;
    persist();
    renderTabs();
    refreshSettings();
  }

  function onFolderSwitch() {
    const tab = tabById(settingsTabId);
    if (!tab) return;

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
        `關閉後，${tab.folders.length} 個資料夾裡的 ${gpnTabItemCount(tab)} 則提示詞，` +
        '會依資料夾的順序合併成一個清單。提示詞一則都不會刪除，但資料夾的分類就沒有了。';
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
    if (!tab || data.tabs.length <= 1) return;

    if (!tabDelArmed) {
      tabDelArmed = true;
      const n = gpnTabItemCount(tab);
      armButton(ui.sDel, n ? `連同 ${n} 則提示詞一起刪除？再按一次` : '確定刪除？再按一次');
      clearTimeout(tabDelTimer);
      tabDelTimer = setTimeout(disarmTabDelete, 5000);
      return;
    }

    data.tabs.splice(data.tabs.indexOf(tab), 1);
    if (!tabById(data.activeId)) { data.activeId = data.tabs[0].id; folderId = null; }

    persist();
    closeSettings();
    render();
    toast(`已刪除書籤「${tab.label}」`);
  }

  function disarmTabDelete() {
    clearTimeout(tabDelTimer);
    tabDelArmed = false;
    if (ui.sDel) disarmButton(ui.sDel, '刪除這個書籤');
  }

  /* ---- 備份與同步 ----
     為什麼需要這個：公家機關的電腦不能裝擴充功能，所以另外做了網頁版。
     兩邊是各自獨立的儲存空間，靠這裡的「代碼／備份檔」手動搬資料。 */

  function buildBackupSection() {
    /* ① 帶出去 */
    ui.bStats = el('div', { class: 'gpn-note' });

    const outRow = el('div', { class: 'gpn-brow' },
      el('button', {
        class: 'gpn-btn2', type: 'button',
        onclick: () => { gpnDownloadExport(data); toast('備份檔已開始下載'); },
      }, '⬇　下載備份檔'),
      el('button', {
        class: 'gpn-btn2', type: 'button',
        onclick: async (e) => {
          const btn = e.currentTarget;
          const ok = await gpnShareCopy(gpnExportCode(data));
          toast(ok ? '代碼已複製，貼到另一台就好' : '複製失敗，請改用下載備份檔', !ok);
          if (ok) {
            btn.classList.add('is-done');
            setTimeout(() => btn.classList.remove('is-done'), 1400);
          }
        },
      }, '⧉　複製代碼')
    );

    /* ② 帶回來 */
    ui.bCode = el('textarea', {
      class: 'gpn-textarea gpn-textarea--code', spellcheck: 'false',
      placeholder: '在這裡貼上另一台複製的代碼，或整份 .json 內容…',
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
      class: 'gpn-btn gpn-btn--save gpn-btn--block', type: 'button', onclick: onImport,
    }, '匯入');

    return el('section', { class: 'gpn-section', 'data-section': 'backup' },
      el('h3', { text: '備份與同步' }),
      el('p', { class: 'gpn-lede', text: '所有書籤一起備份。用來搬到另一台電腦，或在外掛和網頁版之間互相搬。' }),
      field('① 把資料帶出去', '（給另一台電腦、外掛或網頁版用）', outRow, ui.bStats),
      el('div', { class: 'gpn-sep' }),
      field('② 把資料帶回來', '（貼上代碼，或選一個備份檔）',
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
        ui.bNote,
        ui.bImport)
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
      const extra = [
        p.newTabs ? `${p.newTabs} 個新書籤` : '',
        p.newFolders ? `${p.newFolders} 個新資料夾` : '',
      ].filter(Boolean).join('、');
      ui.bNote.textContent = p.added
        ? `讀到 ${parsed.itemCount} 則提示詞，其中 ${p.added} 則是新的，會加進來` +
          (extra ? `（含 ${extra}）` : '') +
          (p.skipped ? `；${p.skipped} 則重複的會跳過` : '')
        : `讀到 ${parsed.itemCount} 則提示詞，但你這台都已經有了，不會有變化`;
    } else {
      ui.bNote.textContent =
        `讀到 ${parsed.tabCount} 個書籤、${parsed.folderCount} 個資料夾、` +
        `${parsed.itemCount} 則提示詞，會取代現在的全部內容`;
    }
    return parsed;
  }

  /** 匯入會動到既有資料，所以一律二段式確認（和刪除同一套做法） */
  async function onImport() {
    const parsed = refreshBackupPreview();
    if (!parsed) { ui.bCode.focus(); return; }

    if (!impArmed) {
      impArmed = true;
      const have = gpnCountItems(data);
      armButton(ui.bImport, backupMode === 'merge'
        ? '確定合併？再按一次'
        : have ? `確定取代？現有 ${have} 則會不見，再按一次` : '確定取代？再按一次');
      clearTimeout(impTimer);
      impTimer = setTimeout(disarmImport, 6000);
      return;
    }

    let msg;
    if (backupMode === 'merge') {
      const r = gpnMergeData(data, parsed.data);
      data = r.data;
      msg = r.added ? `已加入 ${r.added} 則提示詞` : '沒有新的提示詞，資料維持原樣';
    } else {
      data = gpnNormalize(parsed.data);
      msg = `已匯入 ${gpnCountItems(data)} 則提示詞`;
    }
    folderId = null;
    await persist();
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
    ui.bCode.value = '';
    setBackupMode('merge');          // 每次都從最安全的選項開始
  }

  /* ==========================================================================
     九、開關與鍵盤
     ========================================================================== */

  const isOpen = () => ui.overlay.classList.contains('is-open');

  async function open() {
    data = await GpnStore.load();
    render();
    ui.overlay.classList.add('is-open');
    revealActiveFolder();
    onOpenChange(true);
  }

  function close() {
    if (standalone) return;          // 網頁版的面板就是整個網頁，不能關
    closeEditor();
    closeNewTab();
    closeFolderEditor();
    closeSettings();
    ui.overlay.classList.remove('is-open');
    onOpenChange(false);
  }

  function onKeydown(e) {
    if (e.key !== 'Escape' || !isOpen()) return;

    if (layerOpen(ui.settingsLayer)) {
      if (!ui.sConfirm.hidden) hideFolderConfirm();
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

  // 其他分頁改了資料時同步過來；正在編輯就先別動畫面，免得打到一半的字不見
  GpnStore.onExternalChange((fresh) => {
    data = fresh;
    if (isOpen() && !anyLayerOpen()) render();
  });

  return { open, close, isOpen };
}
