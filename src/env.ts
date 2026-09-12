export interface Env {
  DB: D1Database;
  CF_VERSION_METADATA?: { id: string; timestamp: string; tag?: string };
  OPENAI_API_KEY: string;
  APIFY_TOKEN: string;
  RESEND_API_KEY: string;
  SWEEP_ENABLED: string;
  APIFY_SHOPEE_ACTOR: string;
  APIFY_THREADS_ACTOR: string;
  OPENAI_MODEL: string;
  OPENAI_PRICE_MODEL: string;
  MAIL_FROM: string;
  DIAG_TOKEN?: string;
  ANALYZE_ALLOWLIST?: string;
}

export function missingSecrets(env: Partial<Env>): string[] {
  return (['OPENAI_API_KEY', 'APIFY_TOKEN', 'RESEND_API_KEY'] as const)
    .filter(key => !env[key]?.trim());
}
