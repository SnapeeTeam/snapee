import type { Env } from './env';
import { serviceJson } from './http';
export interface ActorRun { id: string; status: string; defaultDatasetId?: string; statusMessage?: string }
export function shopeeInput(keyword: string) {
  return { mode: 'keyword', country: 'tw', keyword, sort: 'relevancy', maxProducts: 10, fetchDetail: false };
}
function endpoint(path: string, env: Env): string {
  const url = new URL('https://api.apify.com/v2/' + path);
  url.searchParams.set('token', env.APIFY_TOKEN);
  return url.href;
}
export async function startRun(keyword: string, env: Env): Promise<ActorRun> {
  const actor = (env.APIFY_SHOPEE_ACTOR || 'xtracto/shopee-scraper').replace('/', '~');
  const result = await serviceJson<{ data: ActorRun }>('Apify', endpoint(`acts/${encodeURIComponent(actor)}/runs`, env),
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(shopeeInput(keyword)) }, env);
  if (!result.data?.id) throw new Error('Apify 未回傳 run ID');
  return result.data;
}
export async function getRun(id: string, env: Env): Promise<ActorRun> {
  const result = await serviceJson<{ data: ActorRun }>('Apify', endpoint(`actor-runs/${encodeURIComponent(id)}`, env), {}, env);
  if (!result.data?.id) throw new Error('Apify 未回傳 run 狀態');
  return result.data;
}
export async function getDataset(id: string, env: Env): Promise<unknown[]> {
  const url = endpoint(`datasets/${encodeURIComponent(id)}/items`, env) + '&clean=true&limit=100';
  const data = await serviceJson<unknown>('Apify', url, {}, env);
  if (!Array.isArray(data)) throw new Error('Apify dataset 格式錯誤');
  return data;
}
export function failedRun(status: string): boolean { return ['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status); }
