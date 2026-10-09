/**
 * 特務P · 網頁版
 *
 * 畫面就是外掛在 Gemini 裡點開的那個面板（panel.js 是同一份程式），
 * 只是不用點按鈕打開，直接放在網頁正中間。
 *
 * 和外掛唯一的功能差異：外掛可以「直接把提示詞填進 AI 的輸入框」，網頁版做不到——
 * 瀏覽器不允許一個網頁去操作另一個網站的內容（同源政策），這是安全機制，
 * 沒有任何繞過方法。所以這裡一律是「點一下複製，再自己貼上」。
 *
 * 資料一律先存在這個瀏覽器（localStorage，存好才算數）；連結 Google 雲端硬碟後，再由 sync.js 送上雲端。
 * 連結時會整頁換到 Google，按完「允許」回到這一頁，由最下面那段接手。
 *
 * 筆記本左下角外面的「全部提示詞」會換到 all.html：所有提示詞用純文字列在同一頁（見 all.js）。
 */
(() => {
  'use strict';

  const host = document.createElement('div');
  host.className = 'gpn-modal-host gpn-standalone';
  // 樣式表載完之前先藏起來，否則會先閃一下沒有樣式的畫面
  host.style.visibility = 'hidden';
  // 網頁版整個放大 140%：使用者原本都要自己把瀏覽器放大到 125%～140% 才看得舒服。
  // 想調大小改這個數字就好；styles.css 會用 --gpn-zoom 把「跟視窗大小有關的上限」除回去，放大後才不會超出視窗
  const GPN_WEB_ZOOM = 1.4;
  host.style.zoom = String(GPN_WEB_ZOOM);
  host.style.setProperty('--gpn-zoom', String(GPN_WEB_ZOOM));
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

  // 管理員試用開關：網址加 ?try-cloud=1 → 這個瀏覽器先打開雲端同步（cloud-config.js 的 open 還沒打開時用）
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
  // 只換了書籤這種不算改內容的，markDirty 自己會略過
  GpnStore.onLocalSave((doc) => sync.markDirty(doc));

  // 回到這個分頁、或網路恢復時，跟雲端對一下（最多 15 秒一次）
  let lastPull = 0;
  const pull = () => {
    if (Date.now() - lastPull < 15_000) return;
    lastPull = Date.now();
    sync.syncNow();
  };
  // 切到別的分頁、或要關掉了：還沒送出的馬上送，不等那 0.8 秒。
  // 真的關掉的話瀏覽器可能來不及送完，但資料已經存在這個瀏覽器，下次打開會接著送。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sync.flush();
    else pull();
  });
  window.addEventListener('pagehide', () => sync.flush());
  window.addEventListener('focus', pull);
  window.addEventListener('online', () => { lastPull = 0; pull(); });

  /* ---- 連結 Google 雲端硬碟：換到 Google，按完「允許」回到這一頁（網址帶著 ?code=…&state=…）----
     回來的網址要和 Google Cloud 裡登記的一模一樣，所以一律用資料夾網址（不帶 index.html）。
     直接雙擊開檔案（file://）時 Google 沒辦法帶回來，所以那時候不顯示連結按鈕。 */
  const here = location.origin + location.pathname.replace(/index\.html$/, '');
  const canConnect = location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  const panel = gpnCreatePanel({
    root,
    standalone: true,
    edition: '網頁版',
    allPageUrl: 'all.html',
    notice: GpnStore.available() ? '' :
      '這個瀏覽器不能儲存資料（可能是無痕視窗，或設定擋掉了網站儲存空間）。' +
      '現在新增的提示詞，關掉分頁就會不見。請改用一般視窗開啟，或連結 Google 雲端硬碟讓它存到雲端。',
    cloud: {
      ...sync,
      canConnect,
      onState: (cb) => { stateListeners.push(cb); },
      connect: async () => {
        location.assign(await sync.authUrl(here));
        return { ok: true, leaving: true };
      },
    },
    onUse: async (item) => (await gpnShareCopy(item.content))
      ? { badge: 'Copied' }
      : { toast: '複製失敗，請點右邊的鉛筆打開，再手動選取文字', bad: true },
  });
  panel.open();

  const connected = (r) => (r.error ? `已登入，但同步失敗：${r.error}`
    : r.replaced ? `已登入，換成雲端上的提示詞（這台原本的 ${r.replaced} 則另外留了一份，在 設定 → 備份 下載得到）`
    : r.merged ? `已連結。這台原本的 ${r.merged} 則已經合併到雲端硬碟`
    : r.pulled ? `已登入，從雲端硬碟載入了 ${r.pulled} 則提示詞`
    : r.uploaded ? `已登入，這台的 ${r.uploaded} 則已經存到雲端硬碟`
    : '已登入，之後會自動同步');

  // 從 Google 回來
  if (params.has('code') || params.has('error')) {
    history.replaceState(null, '', here + location.hash);    // 網址上的 code 用完就拿掉
    const err = params.get('error_description') || params.get('error');
    const fail = (msg) => { panel.openAccount(); panel.toast(msg, true); };
    if (params.get('error') === 'access_denied') {
      fail('登入沒有完成（按了取消，或沒有按「允許」）。想登入時再按一次就好');
    } else if (err) {
      fail('登入沒有完成：' + err);
    } else {
      sync.finishAuth(params.get('code'), params.get('state') || '')
        .then((r) => (r.ok ? panel.toast(connected(r), !!r.error) : fail(r.error)));
    }
  }
})();
