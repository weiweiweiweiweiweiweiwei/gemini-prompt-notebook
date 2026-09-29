/**
 * 網頁版和外掛之間的小橋（只在網頁版的網址上執行）。
 *
 * 網頁版「⋮ → 開啟 Gemini／ChatGPT」本來做不到自動填入：網頁碰不到別的網站（同源政策），
 * 也碰不到外掛的 chrome.storage。但這台電腦如果也裝了特務P 外掛，就可以借外掛的手：
 *   1. 網頁版用 window.postMessage 把提示詞交給這裡（panel.js 的 handOffToExtension）
 *   2. 這裡放進 chrome.storage（和外掛面板用的是同一個 key：panel.js 的 GPN_PENDING_FILL）
 *   3. 新分頁的 content.js 拿走、填進輸入框（不會送出）
 * 沒裝外掛就沒有這個檔案，網頁版照舊請他自己貼上。
 */
(() => {
  'use strict';

  const PENDING = 'gpn_pending_fill';     // 要和 panel.js 的 GPN_PENDING_FILL 一樣
  const SITES = ['gemini', 'chatgpt'];

  // 讓網頁版知道「這台有外掛可以代填」（面板是按「⋮」時才看這個標記，早就標好了）
  const mark = () => document.documentElement?.setAttribute('data-gpn-ext', '1');
  if (document.documentElement) mark();
  else document.addEventListener('DOMContentLoaded', mark, { once: true });

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || m.type !== 'gpn-pending-fill' || !SITES.includes(m.site) || typeof m.text !== 'string') return;
    let ok = false;
    try {
      await chrome.storage.local.set({ [PENDING]: { site: m.site, text: m.text, at: Date.now() } });
      ok = true;
    } catch { /* 外掛剛更新過、這一頁還是舊的：網頁版會退回請他自己貼上 */ }
    window.postMessage({ type: 'gpn-pending-fill-ok', id: m.id, ok }, location.origin);
  });
})();
