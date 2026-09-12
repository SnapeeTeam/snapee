# 開發與部署

## 本機啟動

使用 Node.js 22.12+、npm 與現有 `package-lock.json`。

```sh
npm ci
cp .env.example .dev.vars
# 在 .dev.vars 填入服務密鑰；不要提交此檔
npx wrangler d1 execute snapee --local --file=./schema.sql -y
npm run dev
```

正式服務密鑰與測試密鑰應分開。本機也可能產生含第三方請求的追蹤紀錄；不要分享 `.wrangler/` 或 `work/`。

## 設定

| 變數 | 用途 | 儲存位置 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 意圖分析與市價估計 | Worker secret |
| `APIFY_TOKEN` | 蝦皮商品擷取 | Worker secret |
| `RESEND_API_KEY` | Email 通知 | Worker secret |
| `DIAG_TOKEN` | 操作者診斷權限 | Worker secret |
| `ANALYZE_ALLOWLIST` | 選用，逗號分隔的免額度 Email | Worker secret |
| `CLOUDFLARE_API_TOKEN` | 部署授權 | 本機環境或 CI secret |
| `CLOUDFLARE_ACCOUNT_ID` | 部署帳號識別值，非密鑰 | 本機環境或 CI 設定 |

模型、寄件者、路由及 D1 binding 設於 `wrangler.jsonc`。自行部署時請先換成自己的網域、D1 ID 與已驗證寄件者；不要沿用正式站的資源。範例檔的空值必須補齊，勿直接部署。

## 驗證

```sh
npm run typecheck
npm test
npm audit
```

沒有前端建置步驟；TypeScript 與 Worker 由 Wrangler 處理。Vitest 放純函式測試，整合測試使用隔離資料庫與合成資料。

## 部署

在環境中設定 Cloudflare 與服務憑證後執行 `npm run deploy`。`deploy.sh` 會安裝鎖定版本依賴、執行型別檢查與測試、沿用或建立同名 D1、套用冪等 schema，再部署 Worker；只補上缺少的 secret，不覆寫既有 secret。`ANALYZE_ALLOWLIST` 需另以 `wrangler secret put` 設定。

Cloudflare token 需要 Workers Scripts Edit、D1 Edit、Workers Routes Edit、Zone Read，限於自己的帳號與網域。不要將 token 放進指令參數、PR 或日誌。

`SWEEP_ENABLED=false` 預設停用排程掃價；cron 雖每三小時觸發，停用時不會呼叫上游。手動掃價仍可使用。

## 目錄

```text
src/              Worker、資料存取、AI 與原生網頁
test/             Vitest 純函式測試
docs/             技術文件與資料處理說明
schema.sql        D1 schema
wrangler.jsonc    Cloudflare 設定（不含密鑰）
deploy.sh         驗證與部署
```

`work/`、`outputs/`、`.wrangler/` 與環境檔僅供本機使用，不納入 Git。診斷回應、真實帳號、測試寄信紀錄及內部討論不應成為公開範例。
