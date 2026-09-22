/**
 * 工具列 Popup：點 Chrome 右上角的擴充功能圖示就會開。
 *
 * 用途是「快速複製」——因為在「問問 Gemini」側邊欄或任何其他網站，
 * 我們沒辦法直接填進對方的輸入框，只能複製後由使用者貼上。
 * 完整的新增／編輯／排序仍然在 gemini.google.com 的面板裡做。
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const root = $('root');

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

  // Popup 看不到 Gemini 的 body.dark-theme，所以跟系統主題走
  root.setAttribute('data-theme',
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  let data = gpnDefaultData();
  const activeTab = () => data.tabs.find((t) => t.id === data.activeId) || data.tabs[0];

  const COPY_MS = 1200;

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('style', 'position:fixed;top:-2000px;opacity:0');
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* 放棄 */ }
      ta.remove();
      return ok;
    }
  }

  async function onPick(item, card) {
    const ok = await copyText(item.content);
    card.querySelector('.gpn-copied')?.remove();
    clearTimeout(card._t);
    const badge = el('div', { class: 'gpn-copied' },
      el('span', { text: ok ? 'Copied' : 'Copy failed' }));
    card.append(badge);
    card.classList.add('is-copied');
    card._t = setTimeout(() => {
      badge.remove();
      card.classList.remove('is-copied');
    }, COPY_MS);
  }

  function render() {
    const tab = activeTab();

    /* 書籤列 */
    const tabs = $('tabs');
    tabs.replaceChildren();
    for (const t of data.tabs) {
      tabs.append(el('button', {
        class: 'gpn-popup-tab' + (t.id === tab.id ? ' is-active' : ''),
        type: 'button', role: 'tab', 'data-color': t.color,
        'aria-selected': String(t.id === tab.id),
        title: t.label,
        onclick: async () => {
          data.activeId = t.id;
          await GpnStore.save(data);       // 記住上次看的書籤，和網頁面板同步
          render();
        },
      }, t.label));
    }

    /* 卡片 */
    const list = $('list');
    list.replaceChildren();

    if (!tab.items.length) {
      list.append(el('div', { class: 'gpn-popup-empty' },
        el('div', { class: 'gpn-empty-emoji', text: '📒' }),
        el('div', { class: 'gpn-empty-title', text: '這個書籤還沒有提示詞' }),
        el('div', { class: 'gpn-empty-desc', text: '請到 Gemini 網頁的面板新增' })
      ));
      return;
    }

    for (const item of tab.items) {
      const card = el('div', { class: 'gpn-card gpn-popup-card', role: 'listitem' });
      card.append(el('button', {
        class: 'gpn-title', type: 'button', title: '點一下複製這段 Prompt',
        onclick: () => onPick(item, card),
      },
        el('div', { class: 'gpn-title-text', text: item.title || '(未命名)' }),
        el('div', { class: 'gpn-title-sub',
          text: String(item.content).replace(/\s+/g, ' ').trim().slice(0, 40) })
      ));
      list.append(card);
    }
  }

  function renderFoot() {
    $('foot').replaceChildren(
      el('button', {
        class: 'gpn-popup-link', type: 'button',
        title: '新增／編輯／排序都在那裡做',
        onclick: () => {
          chrome.tabs.create({ url: 'https://gemini.google.com/app' });
          window.close();
        },
      }, '開啟完整面板'),
      el('button', {
        class: 'gpn-popup-link', type: 'button',
        title: '把提示詞帶去另一台電腦，或從網頁版帶回來',
        onclick: openBackup,
      }, '備份／同步')
    );
  }

  /* ==========================================================================
     備份與同步

     和 Gemini 面板裡的那一份是同樣的行為（share.js 提供），只是這裡畫面窄，
     排版改成單欄。放在 Popup 的好處是：任何網站都按得到，不用先開 Gemini。
     ========================================================================== */

  let backupMode = 'merge';
  let impArmed = false, impTimer = 0;
  const bui = {};

  const countItems = (d) => d.tabs.reduce((n, t) => n + t.items.length, 0);

  function buildBackupView() {
    bui.stats = el('div', { class: 'gpn-note' });

    bui.code = el('textarea', {
      class: 'gpn-textarea gpn-textarea--code', spellcheck: 'false',
      placeholder: '在這裡貼上另一台複製的代碼…',
      oninput: () => { disarmImport(); refreshPreview(); },
    });

    bui.file = el('input', {
      type: 'file', accept: '.json,application/json', class: 'gpn-file',
      onchange: async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try { bui.code.value = await gpnReadFile(f); }
        catch { setStatus('這個檔案讀不起來', 'bad'); return; }
        disarmImport();
        refreshPreview();
      },
    });

    bui.merge = el('button', {
      class: 'gpn-seg is-on', type: 'button', onclick: () => setMode('merge'),
    }, '合併', el('span', { text: '推薦' }));
    bui.replace = el('button', {
      class: 'gpn-seg', type: 'button', onclick: () => setMode('replace'),
    }, '完全取代');

    bui.modeNote = el('div', { class: 'gpn-note' });
    bui.status = el('div', { class: 'gpn-note gpn-note--status' });

    bui.import = el('button', {
      class: 'gpn-btn gpn-btn--save', type: 'button', onclick: onImport,
    }, '匯入');

    $('backupView').replaceChildren(
      el('div', { class: 'gpn-popup-head gpn-popup-head--back' },
        el('button', {
          class: 'gpn-back', type: 'button', 'aria-label': '返回',
          onclick: closeBackup,
        }, '←'),
        el('span', { class: 'gpn-popup-title', text: '備份與同步' })
      ),

      el('div', { class: 'gpn-popup-body' },
        el('div', { class: 'gpn-field' },
          el('label', { class: 'gpn-label' },
            '① 把資料帶出去　', el('span', { text: '（給網頁版或另一台用）' })),
          el('div', { class: 'gpn-brow' },
            el('button', {
              class: 'gpn-btn2', type: 'button',
              onclick: () => { gpnDownloadExport(data); setStatus('備份檔已開始下載', 'ok'); },
            }, '⬇　下載備份檔'),
            el('button', {
              class: 'gpn-btn2', type: 'button',
              onclick: async (e) => {
                const ok = await gpnShareCopy(gpnExportCode(data));
                setStatus(ok ? '代碼已複製，貼到另一台就好' : '複製失敗，請改用下載備份檔',
                  ok ? 'ok' : 'bad');
                if (ok) {
                  e.currentTarget.classList.add('is-done');
                  setTimeout(() => e.currentTarget.classList.remove('is-done'), 1400);
                }
              },
            }, '⧉　複製代碼')
          ),
          bui.stats),

        el('div', { class: 'gpn-sep' }),

        el('div', { class: 'gpn-field' },
          el('label', { class: 'gpn-label' },
            '② 把資料帶回來　', el('span', { text: '（貼上代碼或選備份檔）' })),
          bui.code,
          el('div', { class: 'gpn-brow' },
            el('button', {
              class: 'gpn-btn2', type: 'button', onclick: () => bui.file.click(),
            }, '📁　改用備份檔…'),
            el('button', {
              class: 'gpn-btn2', type: 'button',
              onclick: () => { bui.code.value = ''; disarmImport(); refreshPreview(); },
            }, '清空')
          ),
          bui.file,
          el('div', { class: 'gpn-seg-row' }, bui.merge, bui.replace),
          bui.modeNote,
          bui.status)
      ),

      el('div', { class: 'gpn-popup-foot' }, bui.import)
    );
  }

  function setStatus(msg, kind) {
    bui.status.textContent = msg;
    bui.status.classList.toggle('is-bad', kind === 'bad');
    bui.status.classList.toggle('is-ok', kind === 'ok');
  }

  function setMode(mode) {
    backupMode = mode;
    bui.merge.classList.toggle('is-on', mode === 'merge');
    bui.replace.classList.toggle('is-on', mode === 'replace');
    disarmImport();
    refreshPreview();
  }

  function refreshPreview() {
    bui.modeNote.textContent = backupMode === 'merge'
      ? '保留你現在的提示詞，只把還沒有的加進來。'
      : '現在這台的提示詞會被整個蓋掉，換成備份裡的內容。';

    const raw = bui.code.value.trim();
    if (!raw) { setStatus('', ''); bui.import.disabled = true; return null; }

    const parsed = gpnParseImport(raw);
    if (!parsed.ok) { setStatus(parsed.error, 'bad'); bui.import.disabled = true; return null; }

    bui.import.disabled = false;
    if (backupMode === 'merge') {
      const p = gpnPreviewMerge(data, parsed.data);
      setStatus(p.added
        ? `讀到 ${parsed.itemCount} 則，其中 ${p.added} 則是新的` +
          (p.skipped ? `（${p.skipped} 則重複會跳過）` : '')
        : `讀到 ${parsed.itemCount} 則，但你這台都已經有了`, 'ok');
    } else {
      setStatus(`讀到 ${parsed.tabCount} 個書籤、${parsed.itemCount} 則，會取代全部內容`, 'ok');
    }
    return parsed;
  }

  /** 匯入會動到既有資料，所以一律二段式確認 */
  async function onImport() {
    const parsed = refreshPreview();
    if (!parsed) { bui.code.focus(); return; }

    if (!impArmed) {
      impArmed = true;
      bui.import.classList.add('is-confirm');
      const have = countItems(data);
      bui.import.textContent = backupMode === 'merge'
        ? '確定合併？再按一次'
        : have ? `確定取代？現有 ${have} 則會不見` : '確定取代？再按一次';
      clearTimeout(impTimer);
      impTimer = setTimeout(disarmImport, 6000);
      return;
    }

    if (backupMode === 'merge') {
      const r = gpnMergeData(data, parsed.data);
      data = r.data;
      await GpnStore.save(data);
      closeBackup();
      render();
      setStatus('', '');
    } else {
      data = gpnNormalize(parsed.data);
      await GpnStore.save(data);
      closeBackup();
      render();
      setStatus('', '');
    }
  }

  function disarmImport() {
    clearTimeout(impTimer);
    impArmed = false;
    bui.import.classList.remove('is-confirm');
    bui.import.textContent = '匯入';
  }

  function openBackup() {
    if (!bui.code) buildBackupView();
    bui.code.value = '';
    setMode('merge');                 // 每次都從最安全的選項開始
    bui.stats.textContent =
      `這台目前有 ${data.tabs.length} 個書籤、${countItems(data)} 則提示詞`;
    $('mainView').hidden = true;
    $('backupView').hidden = false;
  }

  function closeBackup() {
    disarmImport();
    $('backupView').hidden = true;
    $('mainView').hidden = false;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('backupView').hidden) { closeBackup(); e.preventDefault(); }
  });

  (async () => {
    data = await GpnStore.load();
    render();
    renderFoot();
  })();
})();
