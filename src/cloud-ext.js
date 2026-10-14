/**
 * 外掛裡的面板、工具列小視窗用的「雲端」：自己不連線，全部請背景程式（background.js）做。
 * 提供給 panel.js 的介面和網頁版一樣：getState / onState / connect / signOut / syncNow / putWallpaper / getWallpaper，
 * 還有分身的 cloneSignIn / enterClone / leaveClone / listClones / createClone / extendClone / disableClone / destroyClone / readClone / pushClone / setCloneAvatar，
 * 分享的 listPeers / sharePrompt / ackShares / keepShares / refreshInbox
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
    /** 背景圖另外存在雲端硬碟的一個檔案（見 sync.js） */
    putWallpaper: (id, dataUrl) => send('putWallpaper', { id, dataUrl }),
    getWallpaper: (id) => send('getWallpaper', { id }),
    /* 分身（見 sync.js 的「分身」） */
    cloneSignIn: (id) => send('cloneSignIn', { id }),
    enterClone: (c) => send('enterClone', { clone: c }),
    leaveClone: (opts = {}) => send('leaveClone', { force: !!opts.force }),
    listClones: () => send('listClones'),
    createClone: (label, doc, avatar) => send('createClone', { label, doc, avatar }),
    setCloneAvatar: (c, avatar) => send('setCloneAvatar', { clone: c, avatar }),
    extendClone: (c, expiresAt) => send('extendClone', { clone: c, expiresAt }),
    disableClone: (c) => send('disableClone', { clone: c }),
    destroyClone: (c) => send('destroyClone', { clone: c }),
    readClone: (fileId) => send('readClone', { fileId }),
    pushClone: (fileId, doc) => send('pushClone', { fileId, doc }),
    /* 分享（見 sync.js 的「分享」） */
    listPeers: () => send('listPeers'),
    sharePrompt: (item, to) => send('sharePrompt', { item, to }),
    ackShares: (ids) => send('ackShares', { ids }),
    keepShares: (ids) => send('keepShares', { ids }),
    refreshInbox: () => send('refreshInbox'),
  };
}
