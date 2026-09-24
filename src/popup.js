/**
 * 工具列小視窗：點 Chrome 右上角的擴充功能圖示就會開。
 *
 * 裡面就是和 AI 網站、網頁版同一個面板（panel.js），功能完全一樣。
 * 唯一的差別：這裡點提示詞只能「複製」，再自己貼上——
 * 小視窗和網頁是分開的，不像 AI 網站裡的面板可以直接填進輸入框。
 * 好處是任何網站都能用，包含側邊欄的「問問 Gemini」。
 */
(() => {
  'use strict';

  const host = document.createElement('div');
  host.className = 'gpn-modal-host gpn-standalone gpn-popup-host';
  // 樣式表載完之前先藏起來，否則會先閃一下沒有樣式的畫面
  host.style.visibility = 'hidden';
  const root = host.attachShadow({ mode: 'open' });

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'styles.css';
  const show = () => { host.style.visibility = ''; };
  link.addEventListener('load', show);
  link.addEventListener('error', show);
  root.append(link);
  document.body.append(host);

  // 小視窗看不到網頁的深淺色，跟著系統走
  const media = matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => host.setAttribute('data-theme', media.matches ? 'dark' : 'light');
  applyTheme();
  media.addEventListener('change', applyTheme);

  const panel = gpnCreatePanel({
    root,
    standalone: true,
    edition: '外掛小視窗',
    cloud: gpnExtensionCloud(),       // 和 AI 網站裡的面板共用背景程式的登入狀態
    onUse: async (item) => (await gpnShareCopy(item.content))
      ? { badge: 'Copied' }
      : { toast: '複製失敗，請點右邊的鉛筆打開，再手動選取文字', bad: true },
  });
  panel.open();
})();
