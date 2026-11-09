# 使用統計的後端（Google Apps Script）

晚安瑜伽、SlowJog 網頁版與 SlowJog Android App 在使用者「完成一次」時，會把一筆匿名紀錄送到這裡；[/stats/](../stats/index.html) 再從同一個網址讀回統計。

## 收什麼、不收什麼

每一筆只有四個欄位：時間、作品、課程代號、完成當下的小時（使用者手機的當地時間）。沒有帳號、沒有裝置編號、沒有 IP。

「完成」的定義：

- 晚安瑜伽：整組課程走完，而且實際練習時間至少是課程總長的一半（連按「下一個」跳到最後不算）。單獨的呼吸練習、中途離開都不算。
- SlowJog 網頁版、SlowJog Android App（作品代號 `slowjog-android`，與網頁版分開統計）：達成當次目標（課表走完，或時間／距離目標到了）並按「儲存並結束」。選「放棄這次紀錄」、中途結束都不算。Android 在「設定」可以關閉回報。

## 晚安瑜伽新增課程時

晚安瑜伽的課程代號就是 `night-yoga-src` 裡 `data/routines.json` 的課程 id。`Code.gs` 接受兩種：

- **固定列出**：`quick`、`standard`、`deep`（`ALLOWED`）。統計頁一定會列出，沒人做過就顯示 0。
- **格式規則**：「躺著做」系列 `lying-01` 到 `lying-07`（`ALLOWED_PATTERNS`）。這些課程**不預先列出**，有人完成過才會出現在統計裡。

所以：

- 「躺著做」系列新增一堂（`lying-01` 到 `lying-07`）：**不用改 `Code.gs`、不用重新部署 Apps Script**。只要在 [`assets/js/stats.js`](../assets/js/stats.js) 的 `COURSE_NAME` 補上中文名稱（七堂的名稱已經先寫好；沒寫的話，統計頁會直接顯示原始代號），網站更新就好。
- 系列超過 7 堂、或有別的新系列：改 `Code.gs` 的 `ALLOWED_PATTERNS`，跑 `node apps-script/Code.test.js`，再照下面「重新部署」的最後一段更新（版本選新版本，網址不變）。

為什麼不預先把 7 個代號都列進 `ALLOWED`：統計頁會把 `ALLOWED` 裡的每個代號都畫成一列，預先列出還沒上線的課程，會出現永遠是 0 的假課程。如果課程代號不在這兩種規則內，使用者不受影響（app 的統計送出失敗會靜靜放棄），只是不會被統計。

## 診斷紀錄（測試頁專用，預設關閉）

SlowJog 的聲音測試頁（`audio-test.html`、`bg-audio-test.html`）有一個「回傳測試紀錄」開關，**使用者自己打開才會送**，重新整理頁面就回到關閉。目的是讓開發者直接看到測試結果（例如鎖屏後節拍有沒有斷、AudioContext 狀態），不用請使用者複製貼上。

- **送什麼**：頁面上看得到的那些紀錄行、瀏覽器的 userAgent、一個隨機的 8 碼測試代號。**不送**帳號、位置、IP，也不記任何能識別個人的資料。
- **存在哪**：同一份試算表最後面的「診斷紀錄」分頁（第一個分頁的統計完全不受影響）。欄位：時間、測試代號、頁面、內容。
- **防護**：全站每分鐘最多收 60 批、分頁最多 3000 列、每批最多 4000 字；內容前面固定加「> 」，避免有人送 `=IMPORTXML(...)` 這類試算表公式把資料送到外面；測試代號與頁面名稱只留英數字。
- **驗證**：`node apps-script/Code.test.js` 用模擬的 Apps Script 環境測統計路徑、診斷路徑、防公式與防灌水。
- 診斷用完可以直接刪掉「診斷紀錄」分頁；下次有人打開開關會自動重建。

## 檔案

- [`Code.gs`](Code.gs)：貼進試算表的 Apps Script。完成統計只接受已知的作品與課程代號、小時 0 到 23，全站每分鐘最多收 30 筆；診斷紀錄見上一節。
- [`Code.test.js`](Code.test.js)：`Code.gs` 的單元測試（Node，模擬 Apps Script 環境）。
- 資料存在一份 Google 試算表的第一個分頁，欄位順序：時間、作品、課程、小時。

## 重新部署

1. 開試算表，選「擴充功能 → Apps Script」，把 `Code.gs` 整份貼進去存檔。
2. 「部署 → 新增部署作業 → 網頁應用程式」，執行身分選「我」，誰可以存取選「所有人」。
3. 複製 `/exec` 結尾的網址，更新三個地方：
   - [`_config.yml`](../_config.yml) 的 `stats_endpoint`
   - 晚安瑜伽 `src/web.rs` 的 `STATS_URL`
   - SlowJog 網頁版 `web/src/web.rs` 的 `STATS_URL`
   - SlowJog Android App `app/src/main/java/com/cornming/slowjog/stats/CompletionStats.kt` 的 `ENDPOINT`

之後如果只是修改 `Code.gs`，要用「部署 → 管理部署作業 → 編輯 → 版本選新版本」，網址不會變；單純存檔不會讓線上版更新。

## 限制

收集網址是公開的、沒有登入驗證，所以數字只是約略值，不能當成嚴謹的使用人數。
