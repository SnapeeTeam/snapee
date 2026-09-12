# 貢獻指南

請先閱讀 [開發指南](docs/development.md) 與 [安全說明](SECURITY.md)。

1. 從最新 `main` 建立 `codex/feat/<description>` 或 `codex/fix/<description>` 分支。
2. 保持修改小而清楚，沿用 TypeScript、npm lockfile 與既有目錄。
3. 使用合成帳號與測試資料；密鑰只放環境檔或 secret 管理服務。
4. 推送前通過 `npm run typecheck`、`npm test`，並檢查 `git diff --cached`。
5. 建立 PR，說明問題、變更、驗證與風險；不要直接推送 `main`。

Commit 使用 Conventional Commits，例如 `fix: validate target prices`。請勿提交 `.env`、`.dev.vars`、追蹤日誌、資料庫快照、真實 API 回應、內部對話或臨時簡報。

安全漏洞請勿附真實帳號或憑證到一般 Issue；透過已建立的私密管道聯絡維護者。
