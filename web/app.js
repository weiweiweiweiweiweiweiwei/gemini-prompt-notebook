/**
 * 常用提示詞 · 網頁版
 *
 * 和 Chrome 外掛最大的功能差異：
 *   外掛可以「直接把提示詞填進 Gemini 的輸入框」，網頁版做不到——
 *   瀏覽器不允許一個網頁去操作另一個網站的內容（同源政策），這是安全機制，
 *   沒有任何繞過方法。所以這裡一律是「點一下複製，再自己貼上」。
 *
 * 資料存在 localStorage，格式和外掛完全相同，靠「備份／同步」互相搬運。
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const kid of kids) if (kid) node.append(kid);
    return node;
  }

  /* ========== 狀態 ========== */

  let data = gpnDefaultData();
  let query = '';
  let editingItem = null;    // { id | null }
  let editingTab = null;     // { id | null, color, index }

  const tabById = (id) => data.tabs.find((t) => t.id === id);
  const activeTab = () => tabById(data.activeId) || data.tabs[0];
  const countItems = (d) => d.tabs.reduce((n, t) => n + t.items.length, 0);
  const persist = () => GpnStore.save(data);

  /* ========== Toast ========== */

  let toastTimer = 0;
  function toast(msg, bad = false) {
    const n = $('toast');
    n.textContent = msg;
    n.classList.toggle('is-bad', bad);
    n.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => n.classList.remove('is-on'), bad ? 4200 : 2000);
  }

  /* ========== 外觀（自動 / 淺色 / 深色） ========== */

  const THEME_KEY = 'gpn_theme';
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_LABEL = { auto: '外觀：自動', light: '外觀：淺色', dark: '外觀：深色' };
  let themePref = 'auto';

  function applyTheme() {
    const dark = themePref === 'dark' ||
      (themePref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    for (const n of $$('[data-theme-label]')) n.textContent = THEME_LABEL[themePref];
  }

  function cycleTheme() {
    themePref = THEMES[(THEMES.indexOf(themePref) + 1) % THEMES.length];
    try { localStorage.setItem(THEME_KEY, themePref); } catch { /* 無痕模式 */ }
    applyTheme();
    toast(THEME_LABEL[themePref]);
  }

  /* ========== 書籤 ========== */

  function renderTabs() {
    const tab = activeTab();
    $('viewTitle').textContent = tab.label;

    /* 寬螢幕：左側直列 */
    $('railtabs').replaceChildren(...data.tabs.map((t) => el('button', {
      class: 'railtab' + (t.id === tab.id ? ' is-on' : ''),
      type: 'button', 'data-color': t.color,
      'aria-current': t.id === tab.id ? 'true' : null,
      onclick: () => switchTab(t.id),
    },
      el('span', { class: 'dot' }),
      el('span', { class: 'name', text: t.label }),
      el('span', { class: 'count', text: String(t.items.length) })
    )));

    /* 窄螢幕：上方膠囊 */
    const pills = data.tabs.map((t) => el('button', {
      class: 'pill' + (t.id === tab.id ? ' is-on' : ''),
      type: 'button', role: 'tab', 'data-color': t.color,
      'aria-selected': String(t.id === tab.id),
      onclick: () => switchTab(t.id),
    }, t.label));
    if (data.tabs.length < GPN_MAX_TABS) {
      pills.push(el('button', {
        class: 'pill-add', type: 'button', 'aria-label': '新增書籤',
        onclick: () => openTabDialog(null),
      }, '＋'));
    }
    $('pills').replaceChildren(...pills);

    // 書籤滿了就把「新增書籤」關掉，按了也沒用只會困惑
    const add = document.querySelector('.rail-add');
    if (add) add.hidden = data.tabs.length >= GPN_MAX_TABS;
  }

  function switchTab(id) {
    if (id === data.activeId) return;
    data.activeId = id;
    persist();
    render();
    $('scroller').scrollTop = 0;
  }

  /* ========== 卡片 ========== */

  const preview = (s) => String(s).replace(/\s+/g, ' ').trim();

  function matches(item, q) {
    if (!q) return true;
    const hay = (item.title + ' ' + item.content).toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }

  function renderList() {
    const tab = activeTab();
    const q = query.trim();
    const items = tab.items.filter((it) => matches(it, q));
    const grid = $('grid');

    if (!items.length) {
      grid.replaceChildren(el('div', { class: 'empty' },
        el('div', { class: 'empty-emoji', text: q ? '🔍' : '📋' }),
        el('div', { class: 'empty-title', text: q ? '找不到符合的提示詞' : '這個書籤還沒有提示詞' }),
        el('div', { class: 'empty-desc', text: q
          ? `「${q}」在「${tab.label}」裡沒有結果，換個關鍵字試試`
          : '點下面的「＋ 新增提示詞」開始建立' })
      ));
      return;
    }

    grid.replaceChildren(...items.map((item) => buildCard(item, tab)));
  }

  function buildCard(item, tab) {
    const card = el('div', { class: 'card', role: 'listitem', 'data-color': tab.color, 'data-id': item.id });

    const grip = el('div', {
      class: 'card-grip', title: '按住上下拖曳可以排序',
      'aria-hidden': 'true',
    }, '⠿');
    // 搜尋中順序是過濾後的，拖曳會對不上，所以只在沒搜尋時開放
    if (query.trim()) grip.style.visibility = 'hidden';
    else attachDrag(grip, card, item.id);

    card.append(
      grip,
      el('button', {
        class: 'card-main', type: 'button', title: '點一下複製這段提示詞',
        onclick: () => copyItem(item, card),
      },
        el('div', { class: 'card-title', text: item.title || '(未命名)' }),
        el('div', { class: 'card-sub', text: preview(item.content) })
      ),
      el('button', {
        class: 'card-edit', type: 'button',
        'aria-label': `編輯「${item.title}」`, title: '編輯／刪除',
        onclick: () => openItemDialog(item.id),
      }, '✏️')
    );
    return card;
  }

  const COPY_MS = 1300;

  async function copyItem(item, card) {
    const ok = await gpnShareCopy(item.content);
    card.querySelector('.card-copied')?.remove();
    clearTimeout(card._t);
    card.append(el('div', { class: 'card-copied' }, ok ? '✓　已複製' : '複製失敗'));
    card._t = setTimeout(() => card.querySelector('.card-copied')?.remove(), COPY_MS);
    if (!ok) toast('複製失敗，請改用編輯視窗手動選取文字', true);
  }

  /* ========== 拖曳排序 ========== */

  function attachDrag(handle, card, itemId) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();

      const grid = $('grid');
      const tab = activeTab();
      card.classList.add('is-drag');
      try { handle.setPointerCapture(e.pointerId); } catch { /* 沒抓到也能拖 */ }

      const onMove = (ev) => {
        const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.card');
        if (!under || under === card || under.parentElement !== grid) return;
        const r = under.getBoundingClientRect();
        // 兩欄以上時要同時看水平位置，不然左右欄之間會亂跳
        const after = grid.clientWidth > r.width * 1.5
          ? ev.clientX > r.left + r.width / 2
          : ev.clientY > r.top + r.height / 2;
        grid.insertBefore(card, after ? under.nextSibling : under);
      };

      const onUp = () => {
        card.classList.remove('is-drag');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);

        const order = [...grid.children].map((n) => n.getAttribute('data-id'));
        const moved = order.indexOf(itemId) !== tab.items.findIndex((i) => i.id === itemId);
        if (!moved) return;
        tab.items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        persist();
        toast('已調整順序');
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  /* ========== 提示詞編輯對話框 ========== */

  let itemDelArmed = false, itemDelTimer = 0;

  function openItemDialog(id) {
    const tab = activeTab();
    const item = id ? tab.items.find((it) => it.id === id) : null;
    editingItem = { id: item ? id : null };

    $('itemHead').textContent = item ? '編輯提示詞' : `在「${tab.label}」新增提示詞`;
    $('itemTitle').value = item ? item.title : '';
    $('itemBody').value = item ? item.content : '';
    $('itemDel').hidden = !item;
    for (const n of [$('itemTitle'), $('itemBody')]) n.classList.remove('is-bad');
    disarmItemDel();

    $('dlgItem').showModal();
    setTimeout(() => $('itemTitle').focus(), 30);
  }

  function saveItem() {
    const title = $('itemTitle').value.trim();
    const content = $('itemBody').value.trim();

    let bad = false;
    for (const [node, val] of [[$('itemTitle'), title], [$('itemBody'), content]]) {
      node.classList.toggle('is-bad', !val);
      if (!val) bad = true;
    }
    if (bad) {
      toast(title ? '請輸入提示詞內容' : '請先輸入按鈕顯示標題', true);
      (title ? $('itemBody') : $('itemTitle')).focus();
      return;
    }

    const tab = activeTab();
    if (editingItem.id) {
      const item = tab.items.find((it) => it.id === editingItem.id);
      if (item) { item.title = title; item.content = content; }
      toast('已儲存修改');
    } else {
      tab.items.push({ id: gpnNewId(), title, content });
      toast('已新增提示詞');
    }
    persist();
    $('dlgItem').close();
    render();
  }

  function deleteItem() {
    if (!editingItem?.id) return;
    if (!itemDelArmed) {
      itemDelArmed = true;
      $('itemDel').classList.add('is-confirm');
      $('itemDel').textContent = '確定刪除？再按一次';
      clearTimeout(itemDelTimer);
      itemDelTimer = setTimeout(disarmItemDel, 4000);
      return;
    }
    const tab = activeTab();
    const idx = tab.items.findIndex((it) => it.id === editingItem.id);
    if (idx >= 0) tab.items.splice(idx, 1);
    persist();
    $('dlgItem').close();
    render();
    toast('已刪除');
  }

  function disarmItemDel() {
    clearTimeout(itemDelTimer);
    itemDelArmed = false;
    $('itemDel').classList.remove('is-confirm');
    $('itemDel').textContent = '刪除';
  }

  /* ========== 書籤編輯對話框 ========== */

  let tabDelArmed = false, tabDelTimer = 0;

  function buildSwatches() {
    $('tabSwatches').replaceChildren(...GPN_COLORS.map((c) => el('button', {
      class: 'swatch', type: 'button', 'data-color': c,
      'aria-label': GPN_COLOR_LABELS[c], title: GPN_COLOR_LABELS[c],
      onclick: () => setSwatch(c),
    })));
  }

  function setSwatch(color) {
    if (!editingTab) return;
    editingTab.color = color;
    for (const s of $('tabSwatches').children) {
      s.classList.toggle('is-on', s.getAttribute('data-color') === color);
    }
  }

  function openTabDialog(id) {
    const tab = id ? tabById(id) : null;
    const used = new Set(data.tabs.map((t) => t.color));
    const fresh = GPN_COLORS.find((c) => !used.has(c)) || GPN_COLORS[0];
    editingTab = {
      id: tab ? id : null,
      color: tab ? tab.color : fresh,
      index: tab ? data.tabs.indexOf(tab) : data.tabs.length,
    };

    $('tabHead').textContent = tab ? '書籤設定' : '新增書籤';
    $('tabName').value = tab ? tab.label : '';
    $('tabName').classList.remove('is-bad');
    $('tabDel').hidden = !(tab && data.tabs.length > 1);   // 最後一個書籤不給刪
    $('tabOrderField').hidden = !tab || data.tabs.length < 2;
    setSwatch(editingTab.color);
    refreshOrder();
    disarmTabDel();

    $('dlgTab').showModal();
    setTimeout(() => $('tabName').focus(), 30);
  }

  function refreshOrder() {
    if (!editingTab) return;
    $('tabPos').textContent = `第 ${editingTab.index + 1} / ${data.tabs.length} 個`;
    $('tabUp').disabled = editingTab.index <= 0;
    $('tabDown').disabled = editingTab.index >= data.tabs.length - 1;
  }

  function moveTab(delta) {
    if (!editingTab?.id) return;
    const to = editingTab.index + delta;
    if (to < 0 || to >= data.tabs.length) return;
    const [t] = data.tabs.splice(editingTab.index, 1);
    data.tabs.splice(to, 0, t);
    editingTab.index = to;
    persist();
    refreshOrder();
    render();
  }

  function saveTab() {
    const label = $('tabName').value.trim();
    if (!label) {
      $('tabName').classList.add('is-bad');
      $('tabName').focus();
      toast('請輸入書籤名稱', true);
      return;
    }
    if (editingTab.id) {
      const tab = tabById(editingTab.id);
      if (tab) { tab.label = label; tab.color = editingTab.color; }
      toast('已更新書籤');
    } else {
      const tab = { id: gpnNewId('t'), label, color: editingTab.color, items: [] };
      data.tabs.push(tab);
      data.activeId = tab.id;
      toast('已新增書籤');
    }
    persist();
    $('dlgTab').close();
    render();
  }

  function deleteTab() {
    if (!editingTab?.id || data.tabs.length <= 1) return;
    const tab = tabById(editingTab.id);
    if (!tab) return;

    if (!tabDelArmed) {
      tabDelArmed = true;
      $('tabDel').classList.add('is-confirm');
      $('tabDel').textContent = tab.items.length
        ? `連同 ${tab.items.length} 則一起刪？再按一次`
        : '確定刪除？再按一次';
      clearTimeout(tabDelTimer);
      tabDelTimer = setTimeout(disarmTabDel, 5000);
      return;
    }

    data.tabs.splice(data.tabs.indexOf(tab), 1);
    if (!tabById(data.activeId)) data.activeId = data.tabs[0].id;
    persist();
    $('dlgTab').close();
    render();
    toast(`已刪除書籤「${tab.label}」`);
  }

  function disarmTabDel() {
    clearTimeout(tabDelTimer);
    tabDelArmed = false;
    $('tabDel').classList.remove('is-confirm');
    $('tabDel').textContent = '刪除';
  }

  /* ========== 備份與同步 ========== */

  let backupMode = 'merge';
  let impArmed = false, impTimer = 0;

  function setStatus(msg, kind) {
    const n = $('bStatus');
    n.textContent = msg;
    n.classList.toggle('is-bad', kind === 'bad');
    n.classList.toggle('is-ok', kind === 'ok');
  }

  function setBackupMode(mode) {
    backupMode = mode;
    for (const s of $$('.seg')) s.classList.toggle('is-on', s.dataset.mode === mode);
    disarmImport();
    refreshBackupPreview();
  }

  function refreshBackupPreview() {
    $('bModeNote').textContent = backupMode === 'merge'
      ? '保留你現在的提示詞，只把還沒有的加進來。'
      : '這台的提示詞會被整個蓋掉，換成備份裡的內容。';

    const raw = $('bCode').value.trim();
    if (!raw) { setStatus('', ''); $('bImport').disabled = true; return null; }

    const parsed = gpnParseImport(raw);
    if (!parsed.ok) { setStatus(parsed.error, 'bad'); $('bImport').disabled = true; return null; }

    $('bImport').disabled = false;
    if (backupMode === 'merge') {
      const p = gpnPreviewMerge(data, parsed.data);
      setStatus(p.added
        ? `讀到 ${parsed.itemCount} 則，其中 ${p.added} 則是新的，會加進來` +
          (p.skipped ? `（${p.skipped} 則重複的會跳過）` : '')
        : `讀到 ${parsed.itemCount} 則，但你這台都已經有了，不會有變化`, 'ok');
    } else {
      setStatus(`讀到 ${parsed.tabCount} 個書籤、${parsed.itemCount} 則，會取代現在的全部內容`, 'ok');
    }
    return parsed;
  }

  function doImport() {
    const parsed = refreshBackupPreview();
    if (!parsed) { $('bCode').focus(); return; }

    if (!impArmed) {
      impArmed = true;
      const have = countItems(data);
      $('bImport').classList.add('is-confirm');
      $('bImport').textContent = backupMode === 'merge'
        ? '確定合併？再按一次'
        : have ? `確定取代？現有 ${have} 則會不見` : '確定取代？再按一次';
      clearTimeout(impTimer);
      impTimer = setTimeout(disarmImport, 6000);
      return;
    }

    if (backupMode === 'merge') {
      const r = gpnMergeData(data, parsed.data);
      data = r.data;
      persist();
      $('dlgBackup').close();
      render();
      toast(r.added ? `已加入 ${r.added} 則提示詞` : '沒有新的提示詞，資料維持原樣');
    } else {
      data = gpnNormalize(parsed.data);
      persist();
      $('dlgBackup').close();
      render();
      toast(`已匯入 ${countItems(data)} 則提示詞`);
    }
  }

  function disarmImport() {
    clearTimeout(impTimer);
    impArmed = false;
    $('bImport').classList.remove('is-confirm');
    $('bImport').textContent = '匯入';
  }

  function openBackup() {
    $('bCode').value = '';
    setBackupMode('merge');           // 每次都從最安全的選項開始
    $('bStats').textContent =
      `這台目前有 ${data.tabs.length} 個書籤、${countItems(data)} 則提示詞`;
    $('dlgBackup').showModal();
  }

  /* ========== 啟動 ========== */

  function render() {
    renderTabs();
    renderList();
  }

  function wire() {
    /* 共用動作：rail 和窄螢幕工具列各有一顆，用 data-act 一次綁完 */
    const acts = {
      'add-tab': () => openTabDialog(null),
      'edit-tab': () => openTabDialog(data.activeId),
      'add-item': () => openItemDialog(null),
      'backup': openBackup,
      'theme': cycleTheme,
    };
    for (const n of $$('[data-act]')) n.addEventListener('click', () => acts[n.dataset.act]());
    for (const n of $$('[data-close]')) n.addEventListener('click', () => n.closest('dialog').close());

    /* 搜尋 */
    $('q').addEventListener('input', (e) => {
      query = e.target.value;
      $('qClear').hidden = !query;
      renderList();
    });
    $('qClear').addEventListener('click', () => {
      query = '';
      $('q').value = '';
      $('qClear').hidden = true;
      renderList();
      $('q').focus();
    });

    /* 提示詞對話框 */
    $('itemSave').addEventListener('click', saveItem);
    $('itemDel').addEventListener('click', deleteItem);
    for (const n of [$('itemTitle'), $('itemBody')]) {
      n.addEventListener('input', () => n.classList.remove('is-bad'));
    }
    // 標題按 Enter 直接跳到內容，不要送出表單
    $('itemTitle').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('itemBody').focus(); }
    });
    $('dlgItem').addEventListener('close', disarmItemDel);

    /* 書籤對話框 */
    $('tabSave').addEventListener('click', saveTab);
    $('tabDel').addEventListener('click', deleteTab);
    $('tabUp').addEventListener('click', () => moveTab(-1));
    $('tabDown').addEventListener('click', () => moveTab(1));
    $('tabName').addEventListener('input', () => $('tabName').classList.remove('is-bad'));
    $('tabName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveTab(); } });
    $('dlgTab').addEventListener('close', disarmTabDel);

    /* 備份對話框 */
    $('bDownload').addEventListener('click', () => { gpnDownloadExport(data); setStatus('備份檔已開始下載', 'ok'); });
    $('bCopy').addEventListener('click', async (e) => {
      const ok = await gpnShareCopy(gpnExportCode(data));
      setStatus(ok ? '代碼已複製，貼到另一台就好' : '複製失敗，請改用下載備份檔', ok ? 'ok' : 'bad');
      if (ok) {
        e.currentTarget.classList.add('is-done');
        setTimeout(() => e.currentTarget.classList.remove('is-done'), 1400);
      }
    });
    $('bPick').addEventListener('click', () => $('bFile').click());
    $('bClear').addEventListener('click', () => { $('bCode').value = ''; disarmImport(); refreshBackupPreview(); });
    $('bFile').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';                  // 選同一個檔案兩次也要觸發
      if (!file) return;
      try { $('bCode').value = await gpnReadFile(file); }
      catch { setStatus('這個檔案讀不起來', 'bad'); return; }
      disarmImport();
      refreshBackupPreview();
    });
    $('bCode').addEventListener('input', () => { disarmImport(); refreshBackupPreview(); });
    for (const s of $$('.seg')) s.addEventListener('click', () => setBackupMode(s.dataset.mode));
    $('bImport').addEventListener('click', doImport);
    $('dlgBackup').addEventListener('close', disarmImport);

    /* 鍵盤：/ 跳到搜尋，Ctrl+N 新增 */
    document.addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]')) return;
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); $('q').focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); openItemDialog(null); }
    });

    /* 系統主題變了，'自動' 要跟著走 */
    matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => { if (themePref === 'auto') applyTheme(); });

    /* 同一個瀏覽器開了好幾個分頁 */
    GpnStore.onExternalChange((fresh) => {
      if (document.querySelector('dialog[open]')) return;   // 正在編輯就先不要動畫面
      data = fresh;
      render();
    });
  }

  function warnNoStorage() {
    $('app').querySelector('.main').insertBefore(
      el('div', { class: 'warn' },
        el('strong', { text: '這個瀏覽器不能儲存資料' }),
        el('div', { text:
          '可能是無痕視窗，或瀏覽器設定擋掉了網站儲存空間。你現在新增的提示詞，' +
          '關掉分頁就會不見。請改用一般視窗開啟，或先用「備份／同步」把資料存成檔案。' })
      ),
      $('app').querySelector('.topbar').nextSibling
    );
  }

  function init() {
    try { themePref = THEMES.includes(localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : 'auto'; }
    catch { themePref = 'auto'; }
    applyTheme();

    buildSwatches();
    if (!GpnStore.available()) warnNoStorage();
    data = GpnStore.load();
    wire();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
