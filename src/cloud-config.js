/**
 * 雲端同步的連線設定（Google 雲端硬碟）。src/ 和 web/ 這份必須一模一樣。
 *
 * clientId：Google Cloud 的 OAuth 用戶端 ID（「網頁應用程式」類型）。
 *   它本來就會出現在每個人登入時的網址上，放在公開的網站上是正常的。
 *   千萬不要把「用戶端密鑰」（client secret）放在這裡——它放在 tokenUrl 那個中繼的後台設定裡。
 *
 * tokenUrl：換 token 用的中繼（supabase/functions/google-token）。
 *   Google 規定換 token 要附用戶端密鑰，網頁和外掛藏不住密鑰，所以由它代換。
 *   它只轉交 token，提示詞不會經過它（提示詞直接在瀏覽器和 Google 雲端硬碟之間傳）。
 *
 * open：雲端同步要不要對所有人打開。
 *   Google Cloud、中繼都設定好之前先關著（false），使用者看不到任何同步畫面。
 *   管理員想先自己試：在網頁版網址後面加 ?try-cloud=1（這個瀏覽器會記住；?try-cloud=0 取消）。
 *
 * site：網頁版的網址。外掛連結雲端硬碟時，Google 會先把人帶回這個網站的 ext-login.html，
 *   再由外掛接手（見 src/ext-login.js）。
 *
 * Google Cloud 那邊要設定的東西，見 README「雲端同步（Google 雲端硬碟）的設定」。
 */
const GPN_CLOUD = {
  clientId: '179560802326-nrdhcrs4r84dltajila7er82ae9nqn67.apps.googleusercontent.com',
  tokenUrl: 'https://jsgvyxbkvszvhkrpbvjy.supabase.co/functions/v1/google-token',
  open: false,
  site: 'https://weiweiweiweiweiweiweiwei.github.io/gemini-prompt-notebook/',
};

/** 雲端硬碟上的檔名（使用者可以改名，改了也找得到，見 sync.js 的 findFile） */
const GPN_DRIVE_FILE_NAME = '特務P 提示詞筆記本.json';

/** 雲端功能現在能不能用：設定要填好，而且已經對所有人打開（或管理員在這個瀏覽器開了試用） */
function gpnCloudConfigured(cfg) {
  if (!cfg || !/\.apps\.googleusercontent\.com$/.test(String(cfg.clientId || '')) ||
      !/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/)/.test(String(cfg.tokenUrl || ''))) {
    return false;
  }
  if (cfg.open) return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('gpn_try_cloud') === '1';
  } catch {
    return false;
  }
}
