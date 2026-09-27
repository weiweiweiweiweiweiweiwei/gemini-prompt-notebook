/**
 * 外掛裡的面板、工具列小視窗用的「雲端」：自己不連線，全部請背景程式（background.js）做。
 * 提供給 panel.js 的介面和網頁版一樣：getState / onState / connect / signOut / syncNow
 */
function gpnExtensionCloud() {
  'use strict';

  const STATE_KEY = 'gpn_cloud_state';
  const listeners = [];

  function send(op, args = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'gpn-cloud', op, ...args }, (r) => {
          // 背景程式沒回應（例如外掛剛更新、這個分頁還是舊的）
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: '外掛剛更新過，請重新整理這個網頁再試一次' });
          } else {
            resolve(r || {});
          }
        });
      } catch {
        resolve({ ok: false, error: '外掛剛更新過，請重新整理這個網頁再試一次' });
      }
    });
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[STATE_KEY]) return;
      for (const cb of listeners) cb(changes[STATE_KEY].newValue || {});
    });
  } catch { /* 外掛環境失效時不影響面板 */ }

  return {
    async getState() {
      const r = await send('state');
      if (r && 'configured' in r) return r;
      // 背景程式叫不醒時，至少顯示上次記下的狀態
      try {
        return (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] ||
               { configured: gpnCloudConfigured(GPN_CLOUD) };
      } catch {
        return { configured: gpnCloudConfigured(GPN_CLOUD) };
      }
    },
    onState: (cb) => { listeners.push(cb); },
    /** 背景程式會開一個新分頁去 Google 連結雲端硬碟，完成後那個分頁會自己關掉 */
    connect: () => send('connect'),
    signOut: (opts = {}) => send('signOut', { wipe: !!opts.wipe }),
    syncNow: () => send('syncNow'),
  };
}
