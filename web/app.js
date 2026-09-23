/**
 * 常用提示詞 · 網頁版
 *
 * 畫面就是外掛在 Gemini 裡點開的那個面板（panel.js 是同一份程式），
 * 只是不用點按鈕打開，直接放在網頁正中間。
 *
 * 和外掛唯一的功能差異：外掛可以「直接把提示詞填進 AI 的輸入框」，網頁版做不到——
 * 瀏覽器不允許一個網頁去操作另一個網站的內容（同源政策），這是安全機制，
 * 沒有任何繞過方法。所以這裡一律是「點一下複製，再自己貼上」。
 *
 * 資料存在 localStorage，格式和外掛完全相同，靠「備份／同步」互相搬運。
 */
(() => {
  'use strict';

  const host = document.createElement('div');
  host.className = 'gpn-modal-host gpn-standalone';
  // 樣式表載完之前先藏起來，否則會先閃一下沒有樣式的畫面
  host.style.visibility = 'hidden';
  const root = host.attachShadow({ mode: 'open' });

  // 外掛是用 fetch 讀樣式表再塞進 Shadow DOM；但網頁版常常是直接雙擊 index.html
  // 用 file:// 開的，那種情況 fetch 會被瀏覽器擋掉，<link> 則不會。
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'styles.css';
  const show = () => { host.style.visibility = ''; };
  link.addEventListener('load', show);
  link.addEventListener('error', show);
  root.append(link);
  document.body.append(host);

  // 外掛跟著 AI 網站的深淺色走；網頁版沒有網站可以跟，就跟著系統
  const media = matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => host.setAttribute('data-theme', media.matches ? 'dark' : 'light');
  applyTheme();
  media.addEventListener('change', applyTheme);

  const panel = gpnCreatePanel({
    root,
    standalone: true,
    notice: GpnStore.available() ? '' :
      '這個瀏覽器不能儲存資料（可能是無痕視窗，或設定擋掉了網站儲存空間）。' +
      '現在新增的提示詞，關掉分頁就會不見。請改用一般視窗開啟，或先用「備份／同步」存成檔案。',
    onUse: async (item) => (await gpnShareCopy(item.content))
      ? { badge: 'Copied' }
      : { toast: '複製失敗，請點右邊的鉛筆打開，再手動選取文字', bad: true },
  });
  panel.open();
})();
