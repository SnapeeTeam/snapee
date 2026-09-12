import type { Env } from './env';
import type { Watch, StoredProduct } from './db';
import { escapeHtml, readText, redact, serviceJson } from './http';
export type AlertKind = 'watch_created' | 'target_hit' | 'new_low';
export interface MailResult { ok: boolean; status: number; raw: string; id: string | null; attempts: {status: number; raw: string}[] }
export function mailTemplate(watch: Watch, product: Pick<StoredProduct, 'name' | 'shopee_url'>, price: number, kind: AlertKind, preview = false) {
  const title = kind === 'watch_created' ? '監控已啟動' : kind === 'target_hit' ? '好價到了！已達到你的門檻' : '發現新的觀測低點';
  const subject = `${preview ? '【預覽】' : ''}Snapee｜${title} — ${product.name}`;
  const saved = Math.max(0, watch.base_price - price);
  const note = preview ? '這是使用真實觀測數字的預覽信，並不代表已觸發降價。' : kind === 'watch_created' ? '我們會在掃價後達標或創觀測新低時提醒你。' : '以下為最近一次觀測的商品價格，請到蝦皮確認結帳金額。';
  const text = `${title}\n${product.name}\n現在 NT$${price}\n設定門檻 NT$${watch.target_price}\n建立監控時 NT$${watch.base_price}\n與基準相比少 NT$${saved}\n${note}\n${product.shopee_url}\nhttps://snapee.fyi\n運費暫以 0 估算；價格以蝦皮站上為準。`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;color:#29251f"><h2 style="color:#ee4d2d">snapee.</h2><h1>${escapeHtml(title)}</h1><p>${escapeHtml(product.name)}</p><p style="font-size:32px;font-weight:bold">NT$${price}</p><p>設定門檻 NT$${watch.target_price} · 建立時 NT$${watch.base_price}</p><p style="color:#008e40">與基準相比少 NT$${saved}</p><p>${escapeHtml(note)}</p><p><a style="background:#ee4d2d;color:white;padding:14px 24px;display:inline-block;border-radius:10px;text-decoration:none" href="${escapeHtml(product.shopee_url)}">到蝦皮看看</a></p><p><a href="https://snapee.fyi">管理監控</a></p><small>連結丟上來，AI好價喊你來<br>運費暫以 NT$0 估算，價格以蝦皮站上為準。</small></div>`;
  return { subject, html, text };
}
export async function sendEmail(env: Env, to: string, subject: string, html: string, text: string, idempotencyKey: string): Promise<MailResult> {
  const attempts: MailResult['attempts'] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try { response = await fetch('https://api.resend.com/emails', { method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text }), signal: AbortSignal.timeout(15000) });
    } catch { return { ok: false, status: 0, raw: 'fetch_failed', id: null, attempts }; }
    const raw = redact(await readText(response), env);
    attempts.push({ status: response.status, raw });
    if (!response.ok) console.error(JSON.stringify({ service: 'Resend', status: response.status, raw }));
    if (response.status === 429 && attempt === 0) { await new Promise(resolve => setTimeout(resolve,1100)); continue; }
    let id: string | null = null;
    try { const parsed = JSON.parse(raw) as {id?: string}; id = parsed.id ?? null; } catch { /* Raw response is preserved for diagnosis. */ }
    return { ok: response.ok && !!id, status: response.status, raw, id, attempts };
  }
  return { ok: false, status: 429, raw: attempts.at(-1)?.raw ?? '', id: null, attempts };
}
export async function sendWatchMail(env: Env, watch: Watch, product: StoredProduct, price: number, kind: AlertKind, key: string, preview = false): Promise<MailResult> {
  const content = mailTemplate(watch, product, price, kind, preview);
  const result = await sendEmail(env, watch.email, content.subject,content.html,content.text,key);
  await env.DB.prepare(`INSERT INTO alerts (watch_id,email,item_key,price,target_price,saved_ntd,kind,sent_ok,detail,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(watch.id,watch.email,watch.item_key,price,watch.target_price,kind === 'watch_created' || preview ? 0 : Math.max(0,watch.base_price-price),kind,result.ok?1:0,JSON.stringify({...result,preview}),Date.now()).run();
  return result;
}
export async function emailStatus(env: Env, id: string): Promise<unknown> {
  return serviceJson('Resend', 'https://api.resend.com/emails/'+encodeURIComponent(id), { headers: {authorization:`Bearer ${env.RESEND_API_KEY}`} }, env);
}
