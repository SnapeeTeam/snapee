# 架構與 API

> 目前一般帳號 API 未驗證 Email 所有權；請先閱讀 [安全說明](../SECURITY.md)。

## 商品分析與監控

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


## Snapee Adapt 與分析額度

Snapee Adapt 以同一 Email 目前保留的監控設定為個人偏好樣本，包含已停止但未刪除的監控；不使用其他帳號或商品價格觀測筆數。每筆降幅為 `(base_price - target_price) / base_price`。總有效樣本少於 10 筆，或同類別少於 2 筆（含只有 1 筆的情況）時預設 5%；否則使用同類別各筆降幅的等權平均。建議門檻依當前價格換算、四捨五入至整數，且至少 NT$1、低於現價。介面允許百分比與理想入手價互相換算，最後儲存使用者確認的金額。

白名單由選用的 `ANALYZE_ALLOWLIST` Worker secret 設定，以逗號分隔 Email，正規化後完整比對；不要把帳號名單寫入版本控制。白名單立即免除每小時 5 次分析上限，歷史 jobs 保留，`GET /api/quota?email=` 回傳 `unlimited:true, used:0`；一般帳號仍使用原本的原子 SQL 額度檢查。這項設定不調整監控數量上限。
