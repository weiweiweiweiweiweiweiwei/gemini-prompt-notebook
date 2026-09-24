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
 * 資料存在這個瀏覽器（localStorage）；登入帳號後，由 sync.js 和雲端自動同步。
 * 社群登入、驗證信、重設密碼信，最後都會回到這一頁，由最下面那段接手。
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

  /* ========== 雲端同步 ========== */

  // 管理員試用開關：網址加 ?try-cloud=1 → 這個瀏覽器先打開帳號功能（cloud-config.js 的 open 還沒打開時用）
  const params = new URLSearchParams(location.search);
  if (params.has('try-cloud')) {
    try {
      if (params.get('try-cloud') === '0') localStorage.removeItem('gpn_try_cloud');
      else localStorage.setItem('gpn_try_cloud', '1');
    } catch { /* 無痕模式 */ }
  }

  const kv = {
    get: async (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set: async (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 無痕模式 */ } },
    remove: async (k) => { try { localStorage.removeItem(k); } catch { /* 無痕模式 */ } },
  };

  const stateListeners = [];
  const sync = gpnCreateSync({
    config: GPN_CLOUD,
    kv,
    readLocal: async () => GpnStore.load(),
    writeRemote: async (doc) => GpnStore.applyRemote(doc),
    onState: (s) => { for (const cb of stateListeners) cb(s); },
    // 同一個瀏覽器開了好幾個網頁版分頁時，讓同步一次只跑一個
    lock: navigator.locks ? (name, fn) => navigator.locks.request(name, fn) : undefined,
  });
  GpnStore.onLocalSave(() => sync.markDirty());

  // 回到這個分頁、或網路恢復時，跟雲端對一下（最多 15 秒一次）
  let lastPull = 0;
  const pull = () => {
    if (Date.now() - lastPull < 15_000) return;
    lastPull = Date.now();
    sync.syncNow();
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
  window.addEventListener('focus', pull);
  window.addEventListener('online', () => { lastPull = 0; pull(); });

  /* ---- 登入完、點了信裡的連結之後，都會回到「這一頁」 ----
     社群登入：換到那一家的登入頁，回來時網址帶著 ?code=…
     驗證信、重設密碼信：回來時網址帶著 #access_token=…&type=signup／recovery
     直接雙擊開檔案（file://）時沒辦法被帶回來，所以那時候不顯示社群登入按鈕。 */
  const here = location.origin + location.pathname;
  const canSocial = location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  const panel = gpnCreatePanel({
    root,
    standalone: true,
    edition: '網頁版',
    notice: GpnStore.available() ? '' :
      '這個瀏覽器不能儲存資料（可能是無痕視窗，或設定擋掉了網站儲存空間）。' +
      '現在新增的提示詞，關掉分頁就會不見。請改用一般視窗開啟，或登入帳號讓它存到雲端。',
    cloud: {
      ...sync,
      canSocial,
      onState: (cb) => { stateListeners.push(cb); },
      signInWithProvider: async (provider) => {
        location.assign(await sync.oauthUrl(provider, here));
        return { ok: true, leaving: true };
      },
      // 信裡的連結要回到這一頁
      signUp: (email, password) => sync.signUp(email, password, here),
      resendConfirm: (email) => sync.resendConfirm(email, here),
      resetPassword: (email) => sync.resetPassword(email, here),
    },
    onUse: async (item) => (await gpnShareCopy(item.content))
      ? { badge: 'Copied' }
      : { toast: '複製失敗，請點右邊的鉛筆打開，再手動選取文字', bad: true },
  });
  panel.open();

  const signedIn = (r) => (r.error ? `已登入，但同步失敗：${r.error}`
    : r.merged ? `已登入。這台原本的 ${r.merged} 則已經合併到雲端`
    : r.pulled ? `已登入，從雲端載入了 ${r.pulled} 則提示詞`
    : r.uploaded ? `已登入，這台的 ${r.uploaded} 則已經存到雲端`
    : '已登入，之後會自動同步');

  // 社群登入回來
  if (params.has('code') || params.has('error')) {
    history.replaceState(null, '', here);          // 網址上的 code 用完就拿掉
    const err = params.get('error_description') || params.get('error');
    if (params.get('error') === 'access_denied') {
      panel.toast('登入沒有完成（按了取消，或沒有同意授權）。想登入時再按一次就好', true);
    } else if (err) {
      panel.toast('登入沒有完成：' + err, true);
    } else {
      sync.finishOAuth(params.get('code')).then((r) => panel.toast(r.ok ? signedIn(r) : r.error, !r.ok));
    }
  }

  // 點了驗證信、重設密碼信的連結回來
  const hash = location.hash.slice(1);
  if (/(^|&)(access_token|error|error_code)=/.test(hash)) {
    history.replaceState(null, '', here);          // token 不要留在網址上
    sync.adoptFromUrl(hash).then((r) => {
      if (!r) return;
      if (!r.ok) { panel.toast(r.error, true); return; }
      if (r.type === 'recovery') {
        panel.openAccount();                       // 帳號頁會請他設新密碼
        panel.toast('已經登入了，請設定新的密碼');
      } else if (r.type === 'signup') {
        panel.toast('信箱驗證完成！' + signedIn(r));
      } else {
        panel.toast(signedIn(r));
      }
    });
  }
})();
