# 常用提示詞

把常用的 AI 指令存起來，點一下就填進輸入框（或複製）。
提示詞用 **書籤** 分類；提示詞很多的書籤，還可以在裡面再分 **資料夾**
（例如「ChatGPT」書籤 ＞「1. 寫作與改寫」資料夾 ＞「縮短文字」）。
資料夾是每個書籤自己決定要不要開的，像「常用」這種只放十來則的書籤，不開也沒關係。

一共有 **兩個版本**，資料格式相同，可以互相搬運：

| 版本 | 位置 | 適合 |
|---|---|---|
| **Chrome 外掛** | 專案根目錄 | 自己的電腦，能安裝擴充功能 |
| **網頁版** | `web/` | 公司／公家機關的電腦，不能裝外掛，開網址就能用 |

兩邊的畫面和操作 **一模一樣**（用的是同一份面板程式 `panel.js`）：
網頁版就是外掛在 Gemini 裡點開的那個筆記本，只是不用點按鈕，直接放在網頁正中間。

---

## 一、Chrome 外掛

### 安裝（第一次才要做）

1. 打開 Chrome，網址列輸入 `chrome://extensions` 後按 Enter
2. 把右上角的 **「開發人員模式」** 打開
3. 點左上角 **「載入未封裝項目」**
4. 選擇這個資料夾（有 `manifest.json` 的那一層）
5. 回到下面任一網站並 **重新整理**（按 F5）

支援三個網站，提示詞三邊共用：

| 網站 | 按鈕位置 |
|---|---|
| <https://gemini.google.com> | 輸入框「＋」旁邊 |
| <https://chatgpt.com> | 輸入框「＋」旁邊 |
| <https://claude.ai> | 輸入框迴紋針旁邊 |

按鈕會自動套用各站原生樣式（大小、圓角、顏色都一致），看起來像內建功能。

> 點 Chrome 右上角的擴充功能圖示會開啟 **小視窗**，裡面是同一個筆記本、功能全部一樣，
> 只是點提示詞改成「複製」。在任何網站（包含側邊欄的「問問 Gemini」）都能用。

> 電腦重開機、Chrome 關掉再開，外掛都會自動在，不用重裝。

### 更新外掛（改過程式之後一定要做）

外掛是從資料夾載入的，**檔案改了 Chrome 不會自動更新**：

1. 到 `chrome://extensions`，找到這個外掛，按 **重新整理 ⟳**
2. 回到 Gemini／ChatGPT／Claude 的分頁，按 **F5** 重新整理

確認有沒有更新成功：打開面板 → **齒輪** → 設定視窗 **左下角的版本號**，
要和網頁版（同一個位置）顯示的數字一樣。不一樣就代表外掛還是舊版。

### 怎麼用

| 想做的事 | 怎麼操作 |
|---|---|
| 打開面板 | 點輸入框工具列的 **書籤圖示** |
| 關閉面板 | 點面板 **外面** 的地方（或按 Esc） |
| 換書籤 | 點上面的書籤標籤（有資料夾的書籤，一律先顯示 **第一個資料夾**） |
| 找剛剛用過的 | 最左邊的 **最近使用**（見下面） |
| 使用提示詞 | 點卡片中間的 **標題** → 填進輸入框 + 複製，卡片顯示 **Copied**（面板不會關） |
| 調整順序 | 按住卡片最左邊的 **⣿** 上下拖曳 |
| 書籤換位置 | **長按** 書籤約半秒，再左右拖曳（故意設計成不好觸發，避免點選時誤拖） |
| 修改內容 | 點卡片右邊的 **鉛筆** 圖示 |
| 把提示詞搬到別的書籤／資料夾 | 鉛筆 → 最下面的「**放在哪裡**」選別的 → 儲存 |
| 新增提示詞 | 點面板最下面的 **＋ 新增提示詞**（會放進目前的書籤／資料夾） |
| 刪除提示詞 | 進入編輯畫面 → 左下角 **刪除** → 再按一次確認 |
| 新增書籤 | 點書籤列最右邊的 **＋**（可取名 + 選 6 種顏色，最多 8 個；一開始不分資料夾） |
| **設定** | 點紙張右上角的 **齒輪**，見下面「設定裡有什麼」 |

### 最近使用

書籤列最左邊固定有一個 **最近使用**（不能刪除、不能改名），像 YouTube 的觀看記錄：

- 點過的提示詞會自動記下來，**最新的在最上面**，依日期分成「今天」「昨天」「星期三（9/17）」「9月10日」。
- 最多 **50 則**，超過就把最舊的拿掉；同一則用了好幾次只會出現一次（在最新那次的位置）。
- 每一則左邊是使用時間、標題下面有「從哪個書籤來的」；原本那則被改過的話，顯示改過後的樣子。
- 右邊的 **×** 可以把單一則從記錄移除；最下面有 **清除全部使用記錄**（按兩次）。
  清除記錄不會動到提示詞本身。
- 登入帳號的話，記錄也會跟著同步（外掛用過的，網頁版的「最近使用」也看得到）。
  備份檔不含記錄——那是自己的使用習慣，分享給別人時不會帶過去。

**有開資料夾的書籤**，左邊會多一欄資料夾：

| 想做的事 | 怎麼操作 |
|---|---|
| 換資料夾 | 點左邊資料夾欄的名稱 |
| 資料夾換位置 | **長按** 資料夾約半秒，再上下拖曳（和書籤同一套） |
| 新增資料夾 | 資料夾欄最下面的 **＋ 新增資料夾**（每個書籤最多 12 個） |
| 資料夾改名／刪除 | 點目前選中那個資料夾右邊的 **鉛筆** |

### 設定裡有什麼（齒輪）

左邊選單、右邊內容。改名、換色、開關資料夾都是 **改了就自動存**，最後按「完成」離開。

| 左邊選單 | 內容 |
|---|---|
| 名稱與顏色 | 這個書籤的名稱、顏色；最下面可以刪除這個書籤（按兩次） |
| 資料夾 | 這個書籤要不要用資料夾的開關 |
| 帳號與同步 | 登入／註冊、同步狀態、登出（見第三節） |
| 備份與同步 | 所有書籤一起匯出／匯入成檔案或代碼（見第三節） |

- **開啟** 資料夾：原本的提示詞會先放進「一般」資料夾，之後再新增資料夾、用鉛筆把提示詞搬過去。
- **關閉** 資料夾：所有資料夾依順序合併成一個清單，**提示詞一則都不會刪**。
  有兩個以上資料夾時，會先說明後果、再按一次「確定關閉」才執行。

填入之後 **不會自動送出**，也 **不會關閉面板**；
可以連續點好幾個提示詞，看完內容再自己按 Enter。

---

## 二、網頁版

### 怎麼開

`web/` 資料夾就是完整的網頁，不用裝外掛。
兩種方式擇一：

**A. 開網址（推薦，也可以直接把網址傳給別人用）**

<https://weiweiweiweiweiweiweiwei.github.io/gemini-prompt-notebook/>

網站放在 GitHub Pages，免費。`main` 上的 `web/` 一有改動就會自動重新發布
（`.github/workflows/pages.yml`），約一分鐘後生效。只有 `web/` 會被放上網站。

**B. 直接開檔案（公司擋網站、或完全沒網路時）**
把整個 `web` 資料夾複製到隨身碟或桌面，double-click `index.html` 就能用。

> 少數電腦會擋掉「本機檔案的儲存空間」。真的被擋到時，紙張最上方會出現紅色警告，
> 這時請改用 A。

### 資料存在哪？（傳網址給別人時要知道的）

- **沒登入**：提示詞只存在他自己的這個瀏覽器，不會上傳到任何地方。
  換電腦、換瀏覽器、清除瀏覽資料、用無痕視窗，都會看不到原本的資料。
- **登入帳號**：另外存一份在雲端，外掛、網頁版、每一台電腦自動同步（見第三節）。
  每個帳號只看得到自己的提示詞，你看不到別人的，別人也看不到你的。
- 別人第一次打開是空的。想分享提示詞，用 **齒輪 → 備份與同步** 把代碼或備份檔傳給對方匯入。

### 網頁版和外掛的差別

外掛在 AI 網站裡的面板、外掛的工具列小視窗、網頁版，三個地方用的是同一份面板程式，
書籤、資料夾、編輯、拖曳排序、設定、備份與同步全部一樣。只有下面這些是瀏覽器本身的限制造成的：

| | 外掛（AI 網站裡） | 外掛小視窗 | 網頁版 |
|---|---|---|---|
| 點提示詞 | **直接填進** 輸入框 + 複製 | 只能複製 | 只能複製 |
| 怎麼關 | 點外面或按 Esc | 點小視窗外面 | 不用關，它就是整個網頁 |
| 深色／淺色 | 跟著 AI 網站 | 跟著系統 | 跟著系統 |
| 資料存在哪 | 這台電腦的 Chrome | 同左（和外掛共用） | 這台電腦的這個瀏覽器 |
| 登入帳號後 | 自動同步 | 自動同步（和外掛共用登入） | 自動同步 |

按 `Esc` 會先關掉打開的對話框。

> 網頁版為什麼不能自動填？
> 瀏覽器不允許一個網頁去操作另一個網站的內容（同源政策），這是安全機制，
> 沒有任何繞過方法。所以網頁版一律是「點一下複製，再自己貼上」。

---

## 三、兩邊怎麼同步

### 方法一：登入帳號，自動同步（推薦）

**齒輪 → 帳號與同步**（或紙張右上角的「**登入同步**」），選一種方式登入：

| 方式 | 過程 | 備註 |
|---|---|---|
| **用 Google 帳號登入** | 選好帳號就回來 | 不用另外記密碼，最推薦 |
| **用 LINE 帳號登入** | 在 LINE 的頁面確認（掃 QR Code 或輸入 LINE 密碼） | LINE 可能不提供 Email，帳號頁會顯示「LINE 帳號」 |
| **用 Facebook 帳號登入** | 在 Facebook 的頁面確認 | |
| **Email ＋ 密碼** | 註冊後要到信箱點驗證信 | 不想用社群帳號的人 |

（只會出現管理員有打開的方式，見下面的「帳號系統的設定」。）

外掛、網頁版、每一台電腦登入 **同一個帳號**，之後就不用管了。
**每一台都用同一種方式登入** 最不會搞混——用 LINE 登入和用 Email 註冊，是兩個不同的帳號。

**用 Email 註冊的過程：**

1. 按 **註冊新帳號** → 輸入 Email、密碼（至少 6 個字）、再輸入一次密碼 → 按 **註冊**。
2. 到信箱找「請確認你的信箱｜常用提示詞」（找不到就看垃圾郵件），按 **確認我的信箱**。
3. 會打開網頁版並自動登入。在外掛裡註冊的，驗證完回到外掛輸入密碼按 **登入**。

- 還沒點驗證信就按登入：會提醒你，並出現 **重新寄驗證信**。
- **忘記密碼？**：先在上面填 Email 再按它 → 收信按 **設定新密碼** → 網頁版會直接跳出「請設定新的密碼」。
- 信裡的連結有時間限制、只能用一次；過期了就重新寄一封。

**社群登入的過程：** 網頁版會換到那一家的登入頁，登入完就回來；外掛會另開一個分頁，登入完那個分頁會自己關掉。
（直接雙擊開檔案的網頁版沒有社群登入按鈕——那一家沒辦法把人帶回電腦裡的檔案。）

登入之後：

- 改了提示詞，大約一秒內就存到雲端；打開面板、回到網頁版的分頁時，會先把別台改的拉下來。
- 紙張右上角看得到狀態：**已同步**（綠）／**待同步**／**同步中**／**未連線**（黃，恢復網路後會自己補上）。
- 第一次在某台電腦登入時，這台原本的提示詞會 **和雲端合併**，不會被蓋掉。
- 兩台同時改（例如一台沒網路時改了）：以雲端為底，把這台多出來的加進去，寧可多、不會少。
- **登出**：這台的提示詞留著，只是不再同步。
  在別人的電腦上用完，請按 **登出並清除這台電腦上的提示詞**（雲端的不會刪，下次登入就回來）。
- 同一台電腦換別人登入，不會把前一個人的提示詞帶進新帳號。
- **刪除我的帳號**（按兩次）：帳號和雲端上的提示詞永久刪除，這台電腦上的留著。

> 沒登入也能照常使用，只是資料只存在那一台。
> 存了什麼、誰看得到、怎麼刪除，寫在 [隱私權政策](https://weiweiweiweiweiweiweiwei.github.io/gemini-prompt-notebook/privacy.html)。

### 方法二：手動匯出／匯入（不想用帳號、或要分享給別人時）

在 **齒輪 → 備份與同步**。

### 把家裡的提示詞帶到公司

1. 家裡的 Chrome：打開面板 → **齒輪 → 備份與同步** → **複製代碼**
2. 把那串代碼用任何方式帶到公司（貼在 Email 給自己、記事本、隨身碟都行）
3. 公司的網頁版：**齒輪 → 備份與同步** → 貼進「②把資料帶回來」→ 按 **匯入**

> 代碼很長是正常的，一定要 **從頭到尾整段** 複製，少一個字就讀不出來。
> 嫌麻煩的話改按 **下載備份檔**，得到一個 `.json` 檔，到另一邊選檔案就好。

### 合併 vs 完全取代

| 選項 | 做什麼 | 什麼時候用 |
|---|---|---|
| **合併**（預設） | 保留現有的，只把沒有的加進來 | 平常都用這個 |
| **完全取代** | 現有的整個刪掉，換成備份裡的 | 想讓兩台一模一樣時 |

兩種都要 **按兩次** 才會真的執行，按下去前會先告訴你會發生什麼事。

合併時每一層都是「先比 id、再比名稱」：同名的書籤、同名的資料夾會併在一起，
同一個清單裡標題＋內容完全相同的提示詞會跳過，所以同一份備份匯入兩次也不會重複。

兩邊「有沒有開資料夾」不一樣時，以不弄丟分類為原則：
備份裡的書籤有資料夾、這台同名的書籤沒有 → 這台的書籤會自動開啟資料夾，原本的提示詞放進「一般」。

> 舊版匯出的備份一樣可以匯入。外掛裡既有的資料也會自動升級，不會不見。

### 匯入現成的 99 個 ChatGPT 提示詞

`presets/chatgpt-99-prompts.json` 是一份整理好的備份檔：
一個「ChatGPT」書籤、9 個資料夾（1. 寫作與改寫 … 9. 效率、自動化與品質檢查），每個資料夾 11 則。

**齒輪 → 備份與同步** → **📁 改用備份檔…** → 選這個檔案 → **合併** → 按兩次 **匯入**。
（也可以用記事本打開，全選複製後貼進「②把資料帶回來」的框框。）

分類和標題參考 [aiposthub 的 ChatGPT 99 個提示詞](https://www.aiposthub.com/chatgpt-99-prompts-guide/)，
提示詞內文是另外重寫的。每則開頭的 `/shorten` 之類只是方便辨認的標籤，不是 ChatGPT 的指令，
中括號 `[字數]`、`[貼上內容]` 是要自己換掉的地方。

---

### 帳號系統的設定（管理員做一次就好）

整個過程長這樣，每一步做完都可以先停下來：

```
① 資料庫  →  ② 網址設定  →  ③ 寄信（SMTP）和信件範本  →  ④ 社群登入（Google／LINE／Facebook 各自申請）
                                                                  ↓
                                ⑥ 正式打開（open: true） ←  ⑤ 自己先試（?try-cloud=1）
```

目前的 Supabase 專案：**gemini-prompt-notebook**（東京機房，免費方案），網址 `https://jsgvyxbkvszvhkrpbvjy.supabase.co`。
下面「Callback URL」都是：`https://jsgvyxbkvszvhkrpbvjy.supabase.co/auth/v1/callback`

#### ① 資料庫（已完成）

**SQL Editor** → 貼上 `supabase/schema.sql` 的全部內容 → **Run**。
建立資料表、權限規則（每個帳號只能讀寫自己的那一列）和「刪除我的帳號」要用的函式。重複執行也沒關係。

`src/cloud-config.js` 裡的 `url`、`key` 已經填好。`key` 是 **Publishable key**，本來就是公開的；
**絕對不要** 把 secret key／service_role key 放進程式——那把可以讀寫所有人的資料。

#### ② 網址設定

**Authentication → URL Configuration**：

- **Site URL**：`https://weiweiweiweiweiweiweiwei.github.io/gemini-prompt-notebook/`
- **Redirect URLs** 加一條：`https://weiweiweiweiweiweiweiwei.github.io/gemini-prompt-notebook/**`
  （社群登入、驗證信、重設密碼信，最後都會回到這個網站；外掛是回到其中的 `ext-login.html` 再交給外掛）

#### ③ 寄信（SMTP）和信件範本

Supabase 內建的寄信服務 **只會寄給專案團隊成員**，一般人收不到驗證信，所以要接自己的寄信服務。
最簡單的是用一個 Gmail 帳號寄（建議另外開一個專用的 Gmail）：

1. 那個 Google 帳號 → **安全性** → 開啟 **兩步驟驗證**。
2. 同一頁搜尋「**應用程式密碼**」→ 建立一組（名稱隨便，例如 Supabase）→ 會得到一組 16 個字母的密碼。
   這組密碼只貼在 Supabase 後台，不要放進程式、不要傳給別人。
3. Supabase → **Authentication → Emails → SMTP Settings** → 打開 **Enable custom SMTP**：
   - Sender email：那個 Gmail　／　Sender name：`常用提示詞`
   - Host：`smtp.gmail.com`　／　Port：`587`
   - Username：那個 Gmail　／　Password：剛剛的 16 個字母
4. **Authentication → Emails → Templates**：
   - **Confirm sign up**：主旨 `請確認你的信箱｜常用提示詞`，內容貼 `supabase/templates/confirm-signup.html`
   - **Reset password**：主旨 `重設密碼｜常用提示詞`，內容貼 `supabase/templates/reset-password.html`
5. **Authentication → Sign In / Providers → Email**：確認 **Confirm email** 是 **開著** 的。
6. （選用）**Authentication → Rate Limits** 可以調整每小時最多寄幾封信。個人 Gmail 一天大約能寄 500 封，家用綽綽有餘。

設好之後，用自己的另一個信箱註冊一次試試看。

#### ④-1 Google 登入

1. [Google Cloud Console](https://console.cloud.google.com/) 建一個專案。
2. **APIs & Services → OAuth consent screen**：User type 選 **External**，App name 填「常用提示詞」，
   填支援用的 Email；隱私權政策網址填 `https://weiweiweiweiweiweiweiwei.github.io/gemini-prompt-notebook/privacy.html`。建好後按 **Publish app**
   （沒發布的話，只有加進 Test users 的人能登入）。
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**：
   - Application type：**Web application**
   - Authorized redirect URIs：上面的 Callback URL
4. 把 **Client ID** 和 **Client secret** 貼到 Supabase 的 **Authentication → Sign In / Providers → Google**，打開 **Enable**。

#### ④-2 LINE 登入

Supabase 沒有內建 LINE，但 LINE 支援 OpenID Connect，可以用「自訂登入方式」接上（免費方案最多 3 個）。

1. [LINE Developers Console](https://developers.line.biz/console/) 用自己的 LINE 帳號登入 → 建立一個 **Provider**（名稱：常用提示詞）。
2. 在 Provider 裡 **Create a new channel** → 選 **LINE Login** → 地區選台灣、App types 勾 **Web app**，其他照填。
3. 這個 channel 的 **LINE Login** 分頁 → **Callback URL** 填上面的 Callback URL。
4. （選用）**Basic settings → OpenID Connect → Email address permission → Apply**：
   要上傳一張「會怎麼使用 Email」的截圖（可以用隱私權政策頁的截圖）。
   沒申請也能登入，只是拿不到 Email，帳號頁會顯示「LINE 帳號」。
5. 把 channel 從 **Developing** 改成 **Published**（沒發布的話只有自己能登入）。
6. **Basic settings** 抄下 **Channel ID** 和 **Channel secret**。
7. Supabase → **Authentication → Sign In / Providers → New Provider** → 選 **Auto-discovery (OIDC)**：
   - Identifier：`custom:line`
   - Client ID：Channel ID　／　Client Secret：Channel secret
   - Issuer URL：`https://access.line.me`
   - Scopes：有申請 Email 權限就用 `openid profile email`，沒申請就用 `openid profile`
   - 按 **Create and enable provider**。

#### ④-3 Facebook 登入

1. [Meta for Developers](https://developers.facebook.com/) → **我的應用程式 → 建立應用程式** →
   用途選「**使用 Facebook 登入驗證用戶身分並要求取得資料**」，名稱填「常用提示詞」。
2. **使用案例 → Facebook 登入 → 自訂**：權限加上 **email**；設定裡的
   **有效的 OAuth 重新導向 URI** 填上面的 Callback URL。
3. **應用程式設定 → 基本資料**：
   - 隱私政策網址：`https://weiweiweiweiweiweiweiwei.github.io/gemini-prompt-notebook/privacy.html`
   - 用戶資料刪除 → 資料刪除說明網址：`https://weiweiweiweiweiweiweiwei.github.io/gemini-prompt-notebook/privacy.html#delete`
   - 填好應用程式圖示和類別。
4. 抄下 **應用程式編號** 和 **應用程式密鑰**，貼到 Supabase 的 **Sign In / Providers → Facebook**，打開 **Enable**。
5. 把應用程式切換成 **上線（Live）**（開發模式下只有自己能登入）。

#### ④-4 Apple 登入（先不做）

要付費的 Apple Developer Program（每年 US$99）才能申請。程式已經支援，之後要加的話在 `providers` 加 `'apple'`。

#### ⑤ 自己先試

`cloud-config.js` 的 `open` 還是 `false` 時，所有人都看不到帳號功能（和以前一樣）。
管理員想先試用，在網頁版網址後面加 **`?try-cloud=1`**：

```
https://weiweiweiweiweiweiweiwei.github.io/gemini-prompt-notebook/?try-cloud=1
```

只有「這個瀏覽器」會打開帳號功能，而且會記住；加 `?try-cloud=0` 就關回去。
（外掛不吃這個開關，要等 ⑥ 打開後才會出現帳號功能。）

`providers` 要先填上已經設好的登入方式，試用時才會出現那幾顆按鈕：

```js
providers: ['google', 'custom:line', 'facebook'],   // 只放已經在 Supabase 打開的
```

#### ⑥ 正式打開

1. `src/cloud-config.js`：`open` 改成 `true`，`providers` 確認只放已經設好的。
2. 調高 `manifest.json` 的 `version` 和 `src/panel.js` 的 `GPN_APP_VERSION`。
3. 跑 `python tools/checksync.py --fix`，推上 GitHub（網頁版會自動重新發布）。
4. 外掛到 `chrome://extensions` 按 ⟳ 重新載入。

#### 管理員在後台看得到什麼？

| 在哪裡 | 看得到 | 看不到 |
|---|---|---|
| **Authentication → Users** | Email、用哪種方式登入、註冊時間、最後登入時間 | **密碼**。Email 註冊的密碼只存「雜湊」（無法還原）；用 Google／LINE／Facebook 登入的人，密碼是在那一家輸入的，這邊根本拿不到 |
| **Table Editor → notebooks** | 每個人的提示詞內容（後台是管理員權限，不受「只能看自己」的規則限制） | |

後台可以幫忙：刪除某個使用者（他的提示詞會一起刪掉）、寄重設密碼信給他。

---

## 四、貼心設計（給長輩用的考量）

- 提示詞標題 **19～20px** 大字，按鈕高度 46～56px，好按不易點錯
- 刪除、匯入這種「會弄不見東西」的動作，一律 **按兩次** 才執行
- 編輯視窗 **不會** 因為點到旁邊就關掉，打到一半的字不會不見
- 設定改了就自動存，不會有「改了卻忘記按儲存」的狀況
- 關掉資料夾、刪除資料夾這類會改變分類的動作，都會先講清楚後果
- 匯入預設是「合併」，不會有一按就把舊資料洗掉的狀況
- 深色／淺色自動切換（外掛跟著 AI 網站，網頁版跟著系統）

---

## 五、資料格式（v4）

書籤有兩種長相：沒開資料夾的直接放 `items`，有開資料夾的放 `folders`（兩者只會有一個）。

```jsonc
{
  "version": 4,
  "activeId": "t_fav",                     // 目前選的書籤
  "tabs": [
    { "id": "t_fav", "label": "常用", "color": "amber",          // 不分資料夾
      "items": [ { "id": "p1", "title": "翻譯成英文", "content": "…" } ] },

    { "id": "t_chatgpt", "label": "ChatGPT", "color": "teal",    // 有資料夾
      "folders": [
        { "id": "f_chatgpt_1", "label": "1. 寫作與改寫",
          "items": [ { "id": "p_chatgpt_001", "title": "縮短文字", "content": "/shorten 請把下面的文字…" } ] }
      ] }
  ]
}
```

- 有開資料夾的書籤至少有一個資料夾（最後一個不能刪，不想分就到設定關掉）。
- 「目前看哪個資料夾」刻意不存檔：點書籤一律從第一個資料夾開始。
- 另外還有 `"recent": [ { id, title, content, usedAt, tabId, folderId } ]`：最近使用記錄，
  `id` 指向原本那則提示詞。畫面上是最左邊的「最近使用」書籤（`activeId` 可以是 `"t_recent"`）。
- 匯出檔多了 `"app": "gpn"` 和 `"exportedAt"`，其他和上面一樣。
- 舊格式的升級規則寫在 `src/store.js` 最上面。

---

## 六、檔案結構

```
manifest.json          外掛設定
src/
  store.js             資料格式 + chrome.storage 存取
  share.js             匯出／匯入
  panel.js             面板本體：書籤、資料夾、卡片、設定和所有對話框（外掛和網頁版共用）
  content.js           外掛專屬：注入按鈕、找到輸入框、把提示詞填進去
  styles.css           面板的全部樣式（毛玻璃）
  popup.html / .js     工具列小視窗
  sync.js              雲端同步（登入、換 token、拉下來、推上去、合併）
  cloud-config.js      雲端的連線設定（Supabase 網址和公開金鑰）
  background.js        外掛的背景程式：整個外掛只有它一個在跟雲端溝通
  cloud-ext.js         外掛的面板和小視窗用來請背景程式做事
  ext-login.js         外掛用社群帳號登入的最後一步（只在網頁版的 ext-login.html 上執行）
web/
  index.html           網頁版
  app.js               網頁版專屬：把面板放在網頁正中間、點提示詞改成只複製
  page.css             網頁本身的背景
  ext-login.html       外掛用社群帳號登入時的回程頁（沒裝外掛的人打開只會看到說明）
  privacy.html         隱私權政策（Google、Facebook 申請登入時要填這個網址）
  store.js             同樣的資料格式 + localStorage 存取
  share.js / panel.js / styles.css / sync.js / cloud-config.js   和 src/ 同一份
presets/
  chatgpt-99-prompts.json            可以直接匯入的 99 個提示詞
supabase/
  schema.sql           雲端資料庫的資料表、權限規則、刪除帳號的函式
  templates/           驗證信、重設密碼信的範本（貼到 Supabase 後台）
tools/
  checksync.py         檢查 src/ 和 web/ 的共用程式碼有沒有分岔
.github/workflows/
  pages.yml            把 web/ 發布到 GitHub Pages（發布前也會跑 checksync，有分岔就不發布）
```

**重要：** `share.js`、`panel.js`、`styles.css`、`sync.js`、`cloud-config.js` 整個檔案，以及 `store.js` 裡標了
「共用資料契約」的那一段，兩邊必須一字不差，否則網頁版就會和外掛長得不一樣、匯出匯入也會壞掉。
一律改 `src/` 那份，改完跑一下：

```
python tools/checksync.py          # 檢查
python tools/checksync.py --fix    # 用 src/ 的內容覆蓋 web/
```

改了功能的話，記得把 `manifest.json` 的 `version` 和 `src/panel.js` 的 `GPN_APP_VERSION`
一起調高（兩個要一樣，checksync 也會檢查），這樣從設定視窗左下角就看得出外掛有沒有更新。

---

## 七、想改外觀的話

外掛和網頁版共用同一份樣式，改 `src/styles.css` 再跑 `checksync.py --fix`，兩邊會一起變。

| 想改什麼 | 改哪裡 |
|---|---|
| 顏色、字級 | `src/styles.css` 最上面的 `:host` / `:host([data-theme="dark"])` 色票 |
| 面板尺寸、資料夾欄寬度 | `src/styles.css` 的 `.gpn-book`（`width`、`height`、`--folders-w`） |
| 書籤顏色 | `--c-amber-accent` … `--c-teal-accent` |
| 網頁版的背景 | `web/page.css` |
| 按鈕圖示 | `src/content.js` 的 `ICON_BOOKMARK`、`src/panel.js` 的 `ICON_*` |
| **AI 網站改版後按鈕不見了** | `src/content.js` 最上面的 `SITES` 陣列，各站的選擇器都集中在那裡 |

改完之後回到 `chrome://extensions`，按這個外掛的 **重新整理 ⟳**，再重整網頁。

---

## 八、疑難排解

**按鈕沒出現？**
先重新整理網頁。還是沒有的話，到 `chrome://extensions` 確認外掛是開啟狀態，再按 ⟳ 重新載入。
若輸入框旁真的插不進去，右下角會自動出現一顆 **圓形浮動按鈕** 當備援。

**點了標題但輸入框沒字？**
內容仍然已經複製到剪貼簿，直接在輸入框按 `Ctrl + V` 貼上即可。

**網頁版重開之後資料不見了？**
沒登入時，網頁版的資料只存在「這個瀏覽器」裡。清除瀏覽資料、換瀏覽器、換電腦、用無痕視窗，
都會看不到。登入帳號就會存到雲端；不想登入的話，請定期 **下載備份檔**。

**右上角一直顯示「未連線」或「同步失敗」？**
提示詞還是有存在這台電腦，恢復網路後會自己補同步。一直不好的話，到 **齒輪 → 帳號與同步** 看錯誤訊息，
或按「立即同步」再試一次。外掛剛更新過的話，先重新整理 AI 網站的分頁。

**收不到驗證信／重設密碼信？**
先看垃圾郵件。還是沒有的話，回到登入畫面按「重新寄驗證信」（或再按一次「忘記密碼？」）。
一直都收不到，請管理員確認 ③ 的 SMTP 設定。

**點信裡的連結說「已經過期或用過了」？**
連結只能用一次、而且有時間限制。回到登入畫面重新寄一封，點最新的那封。

**登入說「登入已過期」？**
很久沒用、或在別處改了密碼時會這樣，重新登入就好，提示詞不會不見。

**代碼貼上去說「看不懂這段內容」？**
多半是沒複製完整。改用「下載備份檔 → 選檔案」最不會出錯。
