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

  /* ---- 用 Google 帳號登入 ----
     出發：換到 Google 的登入頁；登入完 Supabase 會帶著 ?code=… 回到這一頁，再由 sync.js 換成登入。
     直接雙擊開檔案（file://）時 Google 沒辦法把人帶回來，所以那時候不顯示這顆按鈕。 */
  const here = location.origin + location.pathname;
  const canGoogle = location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const signInWithGoogle = async () => {
    location.assign(await sync.googleUrl(here));
    return { ok: true, leaving: true };
  };

  const panel = gpnCreatePanel({
    root,
    standalone: true,
    edition: '網頁版',
    notice: GpnStore.available() ? '' :
      '這個瀏覽器不能儲存資料（可能是無痕視窗，或設定擋掉了網站儲存空間）。' +
      '現在新增的提示詞，關掉分頁就會不見。請改用一般視窗開啟，或登入帳號讓它存到雲端。',
    cloud: {
      ...sync, signInWithGoogle, canGoogle,
      onState: (cb) => { stateListeners.push(cb); },
    },
    onUse: async (item) => (await gpnShareCopy(item.content))
      ? { badge: 'Copied' }
      : { toast: '複製失敗，請點右邊的鉛筆打開，再手動選取文字', bad: true },
  });
  panel.open();

  // 從 Google 登入回來
  const back = new URLSearchParams(location.search);
  if (back.has('code') || back.has('error')) {
    history.replaceState(null, '', here);          // 網址上的 code 用完就拿掉
    const err = back.get('error_description') || back.get('error');
    if (err) {
      panel.toast('Google 登入沒有完成：' + err, true);
    } else {
      sync.finishGoogle(back.get('code')).then((r) => {
        panel.toast(!r.ok ? r.error
          : r.merged ? `已登入。這台原本的 ${r.merged} 則已經合併到雲端`
          : r.pulled ? `已登入，從雲端載入了 ${r.pulled} 則提示詞`
          : r.uploaded ? `已登入，這台的 ${r.uploaded} 則已經存到雲端`
          : '已登入，之後會自動同步', !r.ok);
      });
    }
  }
})();
