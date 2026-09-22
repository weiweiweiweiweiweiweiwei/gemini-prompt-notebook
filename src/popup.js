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
    $('foot').replaceChildren(el('button', {
      class: 'gpn-popup-link', type: 'button',
      onclick: () => {
        chrome.tabs.create({ url: 'https://gemini.google.com/app' });
        window.close();
      },
    }, '在 Gemini 開啟完整面板（新增／編輯／排序）'));
  }

  (async () => {
    data = await GpnStore.load();
    render();
    renderFoot();
  })();
})();
