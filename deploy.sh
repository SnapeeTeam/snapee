#!/usr/bin/env bash
set -euo pipefail
set +x
cd "$(dirname "$0")"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
export WRANGLER_SEND_METRICS=false
export WRANGLER_LOG_PATH=work/wrangler.log

npm ci
npx tsc --noEmit
npx vitest run
mkdir -p work
npx wrangler d1 list --json > work/databases.json
database_id=$(node --input-type=module -e 'import fs from "node:fs"; const rows=JSON.parse(fs.readFileSync("work/databases.json","utf8")); process.stdout.write(rows.find(row=>row.name==="snapee")?.uuid ?? "");')
if [ -z "${database_id}" ]; then
  npx wrangler d1 create snapee
  npx wrangler d1 list --json > work/databases.json
  database_id=$(node --input-type=module -e 'import fs from "node:fs"; const rows=JSON.parse(fs.readFileSync("work/databases.json","utf8")); process.stdout.write(rows.find(row=>row.name==="snapee")?.uuid ?? "");')
fi
if [ -z "${database_id}" ]; then
  printf '%s\n' 'D1 database was not found after creation' >&2
  exit 1
fi
SNAPEE_DATABASE_ID="${database_id}" node --input-type=module <<'JS'
import fs from 'node:fs';
const config = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
config.d1_databases[0].database_id = process.env.SNAPEE_DATABASE_ID;
fs.writeFileSync('wrangler.jsonc', JSON.stringify(config, null, 2) + '\n');
JS
# Send the small, idempotent schema directly; avoid the file-import lock/session.
npx wrangler d1 execute snapee --remote --command "$(<schema.sql)" -y
source_commit=$(git rev-parse --short=12 HEAD)
if [ -n "$(git status --porcelain)" ]; then source_commit="${source_commit}-dirty"; fi
npx wrangler deploy --tag "${source_commit}"
npx wrangler secret list --format json > work/secret-names.json
for secret_name in OPENAI_API_KEY APIFY_TOKEN RESEND_API_KEY DIAG_TOKEN; do
  if SNAPEE_SECRET_NAME="${secret_name}" node --input-type=module -e 'import fs from "node:fs";const secrets=JSON.parse(fs.readFileSync("work/secret-names.json","utf8"));process.exit(secrets.some(secret=>secret.name===process.env.SNAPEE_SECRET_NAME)?0:1);'; then
    printf 'Secret already configured: %s\n' "${secret_name}"
  else
    if [ "${secret_name}" = 'DIAG_TOKEN' ] && [ -z "${DIAG_TOKEN:-}" ]; then
      DIAG_TOKEN=$(node --input-type=module -e 'import {randomBytes} from "node:crypto";process.stdout.write(randomBytes(40).toString("base64url"));')
      export DIAG_TOKEN
      # Keep this operator credential only in an ignored local environment file.
      umask 077
      printf 'DIAG_TOKEN=%s\n' "${DIAG_TOKEN}" >> .dev.vars
    fi
    if [ -z "${!secret_name:-}" ]; then
      printf 'Missing environment variable: %s\n' "${secret_name}" >&2
      exit 1
    fi
    printf '%s' "${!secret_name}" | npx wrangler secret put "${secret_name}"
  fi
done
curl -sS --retry 4 --retry-delay 5 --max-time 30 https://snapee.fyi/api/health -o work/deployed-health.json
node --input-type=module <<'JS'
import fs from 'node:fs';
const raw = fs.readFileSync('work/deployed-health.json', 'utf8');
console.log(raw);
const health = JSON.parse(raw);
if (!health.ok || health.missingSecrets?.length || !health.version || !health.mailFrom) process.exit(1);
JS
