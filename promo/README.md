# 特務P 使用情境影片

一支約 50 秒的示範影片（1920×1080、60fps、無聲），讓人第一眼就看懂特務P 怎麼用：

片頭標誌 → 每次重打提示詞很累 → 按輸入框旁的書籤 → 點一下就填進輸入框（Copied）→
書籤、資料夾 → ☆ 收進我的最愛 → 最近使用 → 支援 Gemini／ChatGPT／Claude、雲端同步 → 片尾網址

畫面裡的面板是 **真的**（直接載入 `../web/panel.js` 和 `../web/styles.css`），
所以面板改版後重錄一次，影片就會跟著更新。旁邊的 AI 聊天視窗是簡化的示意畫面，不是任何一家的真實介面。

## 檔案

| 檔案 | 做什麼 |
|---|---|
| `stage.html` / `stage.css` | 1920×1080 的畫面：背景、聊天視窗、標誌、字幕、游標 |
| `stage.js` | 時間表（什麼時候點哪裡、鏡頭推到哪、字幕寫什麼）和示範用的提示詞 |
| `vtime.js` | 錄影模式的假時間，讓每一格的動畫時間都精準 |
| `render.js` | 用電腦上的 Chrome 無頭模式一格一格截圖，再用 ffmpeg 接成 mp4 |

## 重錄

第一次先裝套件（只要一次）：

```bash
cd promo
npm install
```

```bash
node render.js --fps 60      # → out/特務P-使用情境.mp4，約 7 分鐘
node render.js               # 30fps，約 3 分鐘
node render.js --stills 5,15.8,30   # 只截那幾秒的畫面檢查，幾秒鐘就好
```

需要電腦上有 Google Chrome（或用環境變數 `CHROME_PATH` 指定），字型會從 Google Fonts 下載（Noto Sans TC），所以錄的時候要有網路。

## 想改內容

- **字幕、節奏**：`stage.js` 最下面的 `director()`，照順序一段一段寫，`sleep(毫秒)` 就是停多久。
- **示範的提示詞**：`stage.js` 上面的 `DEMO`（只存在錄影用的瀏覽器裡，不會動到真正的資料）。
- **片尾網址、標語**：`stage.html` 的 `#outro`。
- **預覽**：直接用 Chrome 打開 `stage.html` 會即時播放（沒有滑鼠 hover 效果，錄出來的才有）。

## 注意

`stage.js` 裡有一段「影片專用的修正」：外掛在 AI 網站裡的面板，遮罩自己有 `backdrop-filter`，
在 Chrome 裡會讓紙張的霧面玻璃失效（後面網頁的字會直接透過來）。影片裡先把遮罩的模糊搬到 `::before`，
外掛本身修好之後就可以把那段拿掉。
