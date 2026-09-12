import type { Env } from './env';

export function redact(value: string, env: Partial<Env>): string {
  let result = value;
  for (const secret of [env.OPENAI_API_KEY, env.APIFY_TOKEN, env.RESEND_API_KEY, env.DIAG_TOKEN]) {
    if (secret) result = result.replaceAll(secret, '[REDACTED]');
  }
  const credentialPattern = new RegExp(['s'+'k-', 'apify'+'_api_', 'r'+'e_', 'c'+'fut_'].map(prefix => prefix+'[\\w-]{20,}').join('|'), 'g');
  return result.replace(credentialPattern, '[REDACTED]');
}
export class ServiceError extends Error {
  constructor(public service: string, public status: number, public raw: string) {
    super(`${service} HTTP ${status}: ${raw}`);
  }
}
export async function readText(response: { body: ReadableStream<Uint8Array> | null }, limit = 2_500_000): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  let bytes = 0; let text = ''; const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > limit) { await reader.cancel(); throw new Error('upstream_response_too_large'); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}
export async function serviceJson<T>(service: string, url: string, init: RequestInit, env: Env): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(35000) });
  const raw = redact(await readText(response), env);
  if (!response.ok) {
    console.error(JSON.stringify({ service, status: response.status, raw }));
    throw new ServiceError(service, response.status, raw);
  }
  try { return JSON.parse(raw) as T; }
  catch { throw new ServiceError(service, response.status, raw); }
}
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}
