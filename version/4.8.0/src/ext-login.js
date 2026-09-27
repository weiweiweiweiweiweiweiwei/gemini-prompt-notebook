/**
 * 外掛連結 Google 雲端硬碟的最後一步
 * （content script，只在網頁版的 ext-login.html 上執行）。
 *
 * 在 Google 按完「允許」，網址會變成 ext-login.html?code=…&state=…，這裡把它交給外掛的背景程式，
 * 由它換成連結（它手上有出發前產生的密語，code 單獨拿到也沒用，見 sync.js）。
 * 頁面本身在 web/ext-login.html；沒裝外掛的人打開那一頁，只會看到說明文字。
 */
(() => {
  'use strict';

  const root = document.documentElement;
  root.dataset.gpnExt = 'on';              // 告訴頁面：外掛在
  const say = (text, kind) => {
    const msg = document.getElementById('msg');
    if (msg) msg.textContent = text;
    root.dataset.gpnState = kind;
  };

  const q = new URLSearchParams(location.search);
  const err = q.get('error_description') || q.get('error');
  const code = q.get('code');
  const state = q.get('state') || '';
  // 網址上的 code 用完就拿掉，不要留在瀏覽紀錄裡
  history.replaceState(null, '', location.pathname);

  if (q.get('error') === 'access_denied') {
    say('連結沒有完成（按了取消，或沒有按「允許」）。這個分頁可以關掉，想連結時再從面板按一次。', 'bad');
    return;
  }
  if (err) { say('連結沒有完成：' + err + '。請回到面板再試一次。', 'bad'); return; }
  if (!code) { say('請從外掛面板的「設定 → 雲端同步」開始連結。', 'bad'); return; }

  say('正在連結 Google 雲端硬碟…', 'busy');
  chrome.runtime.sendMessage({ type: 'gpn-cloud', op: 'connectFinish', code, state }, (r) => {
    if (chrome.runtime.lastError || !r) {
      say('外掛沒有回應，請到 chrome://extensions 重新載入外掛後再試一次。', 'bad');
    } else if (r.ok) {
      say('連結完成！這個分頁會自動關掉，回到原本的網頁就可以用了。', 'ok');
    } else {
      say('連結沒有完成：' + (r.error || '請再試一次'), 'bad');
    }
  });
})();
