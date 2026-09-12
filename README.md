# Snapee

連結丟上來，AI好價喊你來。

Cloudflare Workers + D1、strict TypeScript、原生 HTML/CSS/JavaScript，純函式使用 Vitest 測試。無前端框架、ORM 或額外打包工具。

## 開發

```sh
npm ci
npx wrangler d1 execute snapee --local --file=./schema.sql -y
npm run dev
```

本機密鑰放在已忽略的 `.dev.vars`；變數名稱為 `OPENAI_API_KEY`、`APIFY_TOKEN`、`RESEND_API_KEY`。不得提交或輸出值。

## 驗證

```sh
npx tsc --noEmit
npx vitest run
```

## 部署

設定 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 與三把服務密鑰環境變數後，執行 `bash deploy.sh`。腳本先執行型別與單元測試，沿用同名 D1、套用冪等 schema、部署 Worker，再以 stdin 設定尚未存在的密鑰。D1 ID 是公開識別值，已記錄於設定檔。

Cloudflare token 需 Workers Scripts Edit、D1 Edit、Workers Routes Edit、Zone Read，Zone Resources 涵蓋 `snapee.fyi`。不使用互動式 OAuth。

排程保留每三小時觸發，但 `SWEEP_ENABLED=false` 預設停用，避免不必要的 Apify 花費。

## 流程與 API

每次依關鍵字從蝦皮最多抓取 10 件商品（`maxProducts: 10`），適用於貼文分析與掃價。

`POST /api/analyze` 接收 `{url,email}`，建立 job、抓 Threads OG、由 `gpt-6-astra` 擷取一個搜尋字詞，再啟動 `xtracto/shopee-scraper`。`GET /api/job/:id` 每 3 秒輪詢；run 成功時以 `gpt-5-mini` 估計市價，再以 D1 transaction 一次寫入商品、價格點、估價與完成狀態。actor 僅使用 `country:tw`、`fetchDetail:false`，不抓 Threads。

### AI 價格合理性

- `OPENAI_MODEL=gpt-6-astra`：意圖分析；`OPENAI_PRICE_MODEL=gpt-5-mini`：最多 10 件商品的一批市價估計，共用既有 OpenAI secret。
- 估價輸入包含商品名稱、關鍵字與 item key；不提供實際售價，以減少估價被待判斷售價牽引。模型依品牌、規格、容量、包裝數量與相同販售單位估計整數新台幣市價 M。
- 程式以整數運算比較售價 P：`0.9M ≤ P ≤ 1.1M` 標示「合理」；低於範圍為「偏低」、高於為「偏高」。兩端都包含在合理範圍內。模型不負責算百分比或覆蓋真實商品價格。
- 規格或市價資訊不足時 M 為 null，標示「無法判斷」；估價服務失敗也會如此顯示，不阻止商品結果與監控。所有估值都標為「AI 估計值，非即時市價」，不代表實際市場調查。
- 分析清單、監控卡片與詳情顯示估計市價、合理區間、判定與理由；舊觀測沒有估價時明確顯示尚未估計。
- 新增 `price_assessments` 表，與觀測時間、當時價格、模型及估價時間一起留存；套用 schema 僅新增資料表，不刪改既有資料。讀取舊 job 不會重新呼叫模型，後續掃價對新觀測重新估價，不把舊估值套在新價格上。

`POST /api/watch` 接收 `{email,itemKey,targetPrice}`，拒絕非正整數、等於或高於現價的門檻。`DELETE /api/watch` 接收 `{email,watchId,mode}`，mode 為 `cancel` 或 `delete`，SQL 同時比對 watch ID 與 email。

`GET /api/dashboard?email=` 回傳監控、180 天內真實價格點與提醒。首次觀測不宣稱歷史低點，確認信與預覽信均不算降價提醒；累積省下是與建立監控價相比的觀測差額，並非已完成交易的節省。

`POST /api/sweep` 接收 `{email}`，先收割已完成 runs，再依被監控關鍵字去重啟動。每個關鍵字 60 秒內不重啟；短時間可再呼叫以收回結果。無 email 時需診斷權限，處理全體監控。價格不變也留觀測點；達標或創新低會寄信，20 小時冷卻。寄信失敗不更新冷卻時間。狀態為 `triggered` 的監控仍繼續掃價，只有 `cancelled` 停止。

## 診斷

`/api/health` 公開回傳服務設定狀態、版本時間、`sourceCommit` 與寄件者。部署腳本以 Git commit 標記 Worker 版本；未提交的工作樹會加上 `-dirty`。以下端點須 `Authorization: Bearer` 帶入 `DIAG_TOKEN`，避免任意寄信及公開使用者寄信紀錄：

- `GET /api/diag/threads?url=&ua=`：Worker 實際抓取的正文、作者、HTTP status、final URL、HTML 長度、登入牆資訊。
- `GET /api/diag/email?to=`：寄測試信並回傳 Resend 原始回應。
- `GET /api/diag/emails?email=&live=1`：留底紀錄及最多 5 封即時投遞狀態。
- `GET /api/diag/alert-preview?email=&watchId=`：以真實現價寄出明確標示的預覽信。

首次部署會自動產生缺少的診斷密鑰，保存在忽略版控的 `.dev.vars` 並送到 Wrangler secret。不可印出密鑰；既有設定會沿用。每封信均寫入 alerts，含 HTTP 回應及 429 一次重試紀錄；原始錯誤會先移除密鑰再記錄。

## 驗收紀錄（2026-09-12）

- `npx tsc --noEmit`、136 個純函式測試通過；`npm install` 稽核 0 vulnerabilities。
- 正式 health：`ok:true`、`missingSecrets:[]`，具有 version、deployedAt、mailFrom。
- 指定 `@wei898` 貼文成功擷取正文；AI 關鍵字「衛生紙 整箱」，Apify 20 件真實商品寫入 D1。
- 確認信與預覽信均已由 Resend 回報 `delivered`。
- 無頭 Chrome 實測 390px、1080px 各深淺模式：0 console errors、無橫向捲動，卡牌收展、走勢、關閉與分類皆可操作；20 件商品各有圖片與名稱蝦皮連結。
- 真實 API 拒絕 1.5、0、高於現價的門檻；他人 Email 刪除回 404；確認／預覽不增加提醒 KPI。UI 停止與刪除已以本次新建的測試監控驗證，既有監控保持不變。
- 手動掃價啟動 2 個關鍵字 runs，後續成功收割 2 組、38 筆價格點，其中 27 筆價格持平仍有留底，無外部錯誤。

Email 登入依規格為 localStorage 偏好設定，並不驗證信箱所有權；知道他人 email 的人可冒用該帳號。此黑客松版本不適合存放敏感帳戶資料；正式商用應加入 Email OTP 或 magic link。一般使用者的資料操作僅以 email 做範圍比對，診斷端點另有 operator token。

蝦皮 actor 未提供運費，估算為零並在 UI 揭露。既有 D1 價格歷史與監控已沿用，未刪除。cron 預設關閉；只有手動掃價會更新，開啟 `SWEEP_ENABLED=true` 後才會每三小時自動執行。依賴均鎖在 package-lock.json，沒有前端建置步驟。

商品價格以蝦皮站上為準。單一觀測點不得宣稱歷史最低價。
