/**
 * 雲端同步的連線設定（Supabase）。src/ 和 web/ 這份必須一模一樣。
 *
 * url：專案網址
 * key：公開金鑰（publishable key，sb_publishable_ 開頭）
 *   這兩個本來就會出現在每個使用者的瀏覽器裡，放在公開的網站上是正常的——
 *   資料安全靠資料庫的權限規則（supabase/schema.sql：每個人只能讀寫自己的那一列）。
 *   千萬不要把 secret key／service_role key 放在這裡，那把鑰匙可以讀寫所有人的資料。
 *
 * open：帳號功能要不要對所有人打開。
 *   Supabase 後台的寄信、網址、社群登入都設定好之前先關著（false），使用者看不到任何帳號畫面。
 *   管理員想先自己試：在網頁版網址後面加 ?try-cloud=1（這個瀏覽器會記住；?try-cloud=0 取消）。
 *
 * providers：在 Supabase 後台開好的社群登入，畫面上會照這個順序出現按鈕。
 *   'google'、'custom:line'（LINE 是自訂的 OIDC 登入）、'facebook'、'apple'
 *   Email＋密碼是內建的，不用寫在這裡。
 *
 * site：網頁版的網址。驗證信、重設密碼信的連結會回到這裡；
 *   外掛用社群登入時，登入完也會先回到這個網站的 ext-login.html，再由外掛接手（見 src/ext-login.js）。
 */
const GPN_CLOUD = {
  url: 'https://jsgvyxbkvszvhkrpbvjy.supabase.co',
  key: 'sb_publishable_XA_Zi2ePU4c_om7G1q3inw_8Sw14GbN',
  open: true,
  providers: ['google'],
  site: 'https://weiweiweiweiweiweiweiwei.github.io/gemini-prompt-notebook/',
};

/** 雲端功能現在能不能用：設定要填好，而且已經對所有人打開（或管理員在這個瀏覽器開了試用） */
function gpnCloudConfigured(cfg) {
  if (!cfg || !cfg.key ||
      !/^(https:\/\/[^/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)\/?$/.test(String(cfg.url || ''))) {
    return false;
  }
  if (cfg.open) return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('gpn_try_cloud') === '1';
  } catch {
    return false;
  }
}
