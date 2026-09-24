/**
 * 雲端同步的連線設定（Supabase）。src/ 和 web/ 這份必須一模一樣。
 *
 * url：專案網址，例如 https://abcdefghijkl.supabase.co
 * key：公開金鑰（publishable key，sb_publishable_ 開頭；舊專案叫 anon key）
 *
 * 這兩個本來就會出現在每個使用者的瀏覽器裡，放在公開的網站上是正常的——
 * 資料安全靠資料庫的權限規則（supabase/schema.sql：每個人只能讀寫自己的那一列）。
 * 千萬不要把 secret key／service_role key 放在這裡，那把鑰匙可以讀寫所有人的資料。
 *
 * 兩個都留空 = 沒有雲端功能，只存在這台電腦（和以前一樣）。
 *
 * google：Supabase 的 Google 登入設定好之後改成 true，畫面上才會出現「用 Google 帳號登入」。
 * site：網頁版的網址。外掛用 Google 登入時，登入完會先回到這個網站的 ext-login.html，
 *       再由外掛接手（見 src/ext-login.js）。這個網址要加進 Supabase 的 Redirect URLs。
 */
const GPN_CLOUD = {
  url: '',
  key: '',
  google: false,
  site: 'https://weiweiweiweiweiweiweiwei.github.io/gemini-prompt-notebook/',
};

/** 設定有沒有填好（沒填就當作沒有雲端功能） */
function gpnCloudConfigured(cfg) {
  return !!(cfg && cfg.key &&
    /^(https:\/\/[^/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)\/?$/.test(String(cfg.url || '')));
}
