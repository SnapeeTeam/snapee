import { missingSecrets, type Env } from './env';
import { fetchThreads } from './threads';
import { ui } from './ui';
import { normalizeThreadsUrl } from './threads';
import { extractKeyword } from './llm';
import { failedRun, getDataset, getRun, startRun } from './apify';
import { parseShopee } from './shopee';
import { all, dashboard, productStatements, productView, type Alert, type Job, type StoredProduct, type Sweep, type Watch } from './db';
import { alertKind, priceStats, validTarget, type PricePoint } from './price';
import { emailStatus, sendEmail, sendWatchMail } from './email';
import { normalizeEmail, readText, redact, ServiceError } from './http';

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }); }
function email(value: unknown): string { const result = normalizeEmail(value); if (!result) throw new HttpError(400,'Email 格式不正確'); return result; }
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415,'請使用 application/json');
  const text = await readText(request, 8000);
  try { const value: unknown = JSON.parse(text); if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string,unknown>; } catch { /* Return a client error for malformed JSON. */ }
  throw new HttpError(400,'JSON 格式不正確');
}
async function requireAdmin(request: Request, env: Env) {
  if (!env.DIAG_TOKEN) throw new HttpError(503,'診斷權限尚未設定');
  const input = request.headers.get('authorization') ?? '';
  const encoder = new TextEncoder();
  const a = await crypto.subtle.digest('SHA-256',encoder.encode(input));
  const b = await crypto.subtle.digest('SHA-256',encoder.encode('Bearer '+env.DIAG_TOKEN));
  if (!crypto.subtle.timingSafeEqual(a,b)) throw new HttpError(401,'需要診斷權限');
}

async function analyze(request: Request, env: Env) {
  const data = await body(request); const owner = email(data.email);
  const url = typeof data.url === 'string' ? normalizeThreadsUrl(data.url) : null;
  if (!url) throw new HttpError(400,'請貼上有效的 Threads 貼文網址');
  const missing = missingSecrets(env); if (missing.length) throw new HttpError(503,'服務尚未設定：'+missing.join(', '));
  const now = Date.now(); const id = crypto.randomUUID();
  const created = await env.DB.prepare(`INSERT INTO jobs (id,email,threads_url,stage,created_at,updated_at)
    SELECT ?,?,?,'threads_running',?,? WHERE (SELECT COUNT(*) FROM jobs WHERE email=? AND created_at>?)<5`)
    .bind(id,owner,url,now,now,owner,now-3600000).run();
  if (!created.meta.changes) throw new HttpError(429,'每小時最多分析 5 則，請稍後再試');
  try {
    const post = await fetchThreads(url);
    if (!post.ok || !post.text) throw new HttpError(422,`讀不到這則貼文（${post.reason}）`);
    await env.DB.prepare('UPDATE jobs SET post_text=?,post_author=?,updated_at=? WHERE id=?').bind(post.text,post.author,Date.now(),id).run();
    const intent = await extractKeyword(post.text,env);
    if (!intent.isShoppingRelated || !intent.keyword) throw new HttpError(422,'這則貼文沒有明確的購物商品，請換一則試試');
    const run = await startRun(intent.keyword,env);
    await env.DB.prepare(`UPDATE jobs SET stage='shopee_running',keyword=?,reasoning=?,shopee_run_id=?,updated_at=? WHERE id=?`)
      .bind(intent.keyword,JSON.stringify(intent),run.id,Date.now(),id).run();
    return json({ jobId:id,stage:'shopee_running',keyword:intent.keyword },202);
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : '分析失敗',env);
    await env.DB.prepare(`UPDATE jobs SET stage='failed',error=?,updated_at=? WHERE id=?`).bind(message,Date.now(),id).run();
    if (error instanceof ServiceError) return json({ jobId:id,stage:'failed',error:message,upstream:{service:error.service,status:error.status,raw:error.raw} },502);
    return json({ jobId:id,stage:'failed',error:message },error instanceof HttpError ? error.status : 502);
  }
}

async function jobResult(id: string, env: Env) {
  let job = await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first<Job>();
  if (!job) throw new HttpError(404,'找不到分析工作');
  if (job.stage === 'threads_running' && Date.now()-job.updated_at>120000) {
    await env.DB.prepare(`UPDATE jobs SET stage='failed',error='分析逾時，請重試',updated_at=? WHERE id=? AND stage='threads_running'`).bind(Date.now(),id).run();
    job = {...job,stage:'failed',error:'分析逾時，請重試'};
  }
  if (job.stage === 'shopee_running' && job.shopee_run_id) {
    const run = await getRun(job.shopee_run_id,env);
    if (failedRun(run.status)) {
      await env.DB.prepare(`UPDATE jobs SET stage='failed',error=?,updated_at=? WHERE id=? AND stage='shopee_running'`)
        .bind(redact('Apify '+run.status+': '+(run.statusMessage??''),env),Date.now(),id).run();
    } else if (run.status === 'SUCCEEDED' && run.defaultDatasetId) {
      const now=Date.now(); const lease=crypto.randomUUID();
      const claim=await env.DB.prepare(`UPDATE jobs SET error=?,updated_at=? WHERE id=? AND stage='shopee_running' AND (error IS NULL OR updated_at<?)`)
        .bind(lease,now,id,now-120000).run();
      if (claim.meta.changes) {
        try {
          const raw = await getDataset(run.defaultDatasetId,env);
          const products = parseShopee(raw,job.keyword ?? '');
          if (!products.length) {
            const detail = redact(JSON.stringify(raw),env);
            console.error(JSON.stringify({service:'Apify',status:200,raw:detail}));
            throw new Error('蝦皮未回傳可辨識商品，請稍後再試；診斷資料：'+detail);
          }
          // D1 batch is transactional: samples and terminal stage commit together.
          await env.DB.batch([...productStatements(env.DB,products,now),
            env.DB.prepare(`UPDATE jobs SET stage='done',error=NULL,updated_at=? WHERE id=? AND error=?`).bind(now,id,lease)]);
        } catch (error) {
          await env.DB.prepare(`UPDATE jobs SET stage='failed',error=?,updated_at=? WHERE id=? AND error=?`)
            .bind(redact(error instanceof Error ? error.message : '商品解析失敗',env),Date.now(),id,lease).run();
        }
      }
    }
    job = (await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first<Job>())!;
  }
  const products=[];
  if (job.stage === 'done') {
    const rows=await all<StoredProduct>(env.DB,`SELECT DISTINCT p.* FROM products p JOIN price_points pp ON pp.item_key=p.item_key
      WHERE pp.observed_at=? ORDER BY pp.effective_price LIMIT 20`,job.updated_at);
    for(const p of rows) products.push(await productView(env.DB,{...p,keyword:job.keyword ?? p.keyword}));
    products.sort((a,b)=>(a.stats.current??Infinity)-(b.stats.current??Infinity));
  }
  return json({jobId:job.id,stage:job.stage,postText:job.post_text,postAuthor:job.post_author,threadsUrl:job.threads_url,
    keyword:job.keyword,reasoning:job.reasoning,error:job.stage==='failed'?job.error:null,products});
}

async function createWatch(request: Request, env: Env) {
  const data=await body(request); const owner=email(data.email);
  if(typeof data.itemKey!=='string') throw new HttpError(400,'商品代碼不正確');
  const product=await env.DB.prepare('SELECT * FROM products WHERE item_key=?').bind(data.itemKey).first<StoredProduct>();
  if(!product) throw new HttpError(404,'找不到商品');
  const view=await productView(env.DB,product); const current=view.stats.current;
  if(current===null || !validTarget(data.targetPrice,current)) throw new HttpError(400,'門檻必須是正整數且低於現價');
  const watch:Watch={id:crypto.randomUUID(),email:owner,item_key:product.item_key,keyword:product.keyword,
    base_price:current,target_price:data.targetPrice,status:'active',created_at:Date.now(),last_checked_at:null,last_alert_at:null};
  const added=await env.DB.prepare(`INSERT INTO watches (id,email,item_key,keyword,base_price,target_price,status,created_at)
    SELECT ?,?,?,?,?,?,'active',? WHERE NOT EXISTS(SELECT 1 FROM watches WHERE email=? AND item_key=? AND status!='cancelled')
    AND (SELECT COUNT(*) FROM watches WHERE email=? AND status!='cancelled')<50`)
    .bind(watch.id,owner,watch.item_key,watch.keyword,current,watch.target_price,watch.created_at,owner,watch.item_key,owner).run();
  if(!added.meta.changes) throw new HttpError(409,'此商品已在監控中，或已達 50 件上限');
  const mail=await sendWatchMail(env,watch,product,current,'watch_created','watch-'+watch.id);
  return json({watchId:watch.id,mail:{ok:mail.ok,status:mail.status},message:mail.ok?'監控已啟動，確認信已寄出':'監控已啟動，但確認信寄送失敗；下一輪掃價會重試'},201);
}
async function deleteWatch(request: Request, env: Env) {
  const data=await body(request);const owner=email(data.email);
  if(typeof data.watchId!=='string' || !['cancel','delete'].includes(String(data.mode))) throw new HttpError(400,'操作格式不正確');
  const result=data.mode==='cancel' ? await env.DB.prepare(`UPDATE watches SET status='cancelled' WHERE id=? AND email=?`).bind(data.watchId,owner).run()
    : await env.DB.prepare('DELETE FROM watches WHERE id=? AND email=?').bind(data.watchId,owner).run();
  if(!result.meta.changes) throw new HttpError(404,'找不到屬於此 Email 的監控');
  return json({ok:true});
}

async function evaluateWatches(env: Env, owner?: string) {
  const watches=await all<Watch>(env.DB,`SELECT * FROM watches WHERE status!='cancelled' ${owner?'AND email=?':''} ORDER BY created_at LIMIT 100`,...(owner?[owner]:[]));
  let sent=0;
  for(const watch of watches) {
    const now=Date.now();
    const product=await env.DB.prepare('SELECT * FROM products WHERE item_key=?').bind(watch.item_key).first<StoredProduct>();
    if(!product) continue;
    const points=await all<PricePoint & {id:number;effective_price:number}>(env.DB,
      'SELECT * FROM price_points WHERE item_key=? AND observed_at>=? ORDER BY observed_at DESC,id DESC',watch.item_key,now-180*86400000);
    const current=points[0]; if(!current || now-current.observed_at>12*3600000) continue;
    const claim=await env.DB.prepare(`UPDATE watches SET last_checked_at=? WHERE id=? AND status!='cancelled' AND (last_checked_at IS NULL OR last_checked_at<?)`)
      .bind(now,watch.id,now-120000).run();
    if(!claim.meta.changes) continue;
    const confirmation=await env.DB.prepare(`SELECT id FROM alerts WHERE watch_id=? AND kind='watch_created' AND sent_ok=1 LIMIT 1`).bind(watch.id).first();
    if(!confirmation) await sendWatchMail(env,watch,product,watch.base_price,'watch_created','watch-'+watch.id);
    const previous=priceStats(points.filter(p=>p.id!==current.id),now);
    const kind=alertKind(current.effective_price,watch.target_price,previous.low,watch.last_alert_at,now);
    if(!kind || (watch.last_alert_at!==null && current.observed_at<=watch.last_alert_at)) continue;
    const mail=await sendWatchMail(env,watch,product,current.effective_price,kind,`alert-${watch.id}-${current.id}-${kind}`);
    if(mail.ok) {
      await env.DB.prepare(`UPDATE watches SET last_alert_at=?,status=CASE WHEN status='cancelled' THEN status ELSE 'triggered' END WHERE id=?`).bind(now,watch.id).run();sent++;
    }
  }
  return sent;
}
async function sweep(env: Env, owner?: string) {
  const pending=await all<Sweep>(env.DB,`SELECT * FROM sweeps WHERE status='running' ORDER BY created_at LIMIT 30`);
  let collected=0; const errors: string[]=[];
  for(const row of pending) {
    if(row.run_id==='pending') {
      if(Date.now()-row.created_at>120000) await env.DB.prepare(`UPDATE sweeps SET status='failed',note='啟動逾時' WHERE id=? AND run_id='pending'`).bind(row.id).run();
      continue;
    }
    try {
      const run=await getRun(row.run_id,env);
      if(failedRun(run.status)) { await env.DB.prepare(`UPDATE sweeps SET status='failed',note=? WHERE id=?`).bind(run.status,row.id).run();continue; }
      if(run.status!=='SUCCEEDED' || !run.defaultDatasetId) continue;
      const now=Date.now();const lease=crypto.randomUUID();
      const claim=await env.DB.prepare(`UPDATE sweeps SET note=?,collected_at=? WHERE id=? AND status='running' AND (note IS NULL OR collected_at<?)`)
        .bind(lease,now,row.id,now-120000).run();
      if(!claim.meta.changes) continue;
      const raw=await getDataset(run.defaultDatasetId,env);const products=parseShopee(raw,row.keyword);
      if(!products.length) throw new Error('蝦皮掃價沒有可辨識商品：'+redact(JSON.stringify(raw),env));
      await env.DB.batch([...productStatements(env.DB,products,now),env.DB.prepare(`UPDATE sweeps SET status='collected',collected_at=?,note=NULL WHERE id=? AND note=?`).bind(now,row.id,lease)]);
      collected++;
    } catch(error) {
      const message=redact(error instanceof Error?error.message:'掃價失敗',env);errors.push(message);
      await env.DB.prepare(`UPDATE sweeps SET status='failed',note=? WHERE id=?`).bind(message,row.id).run();
    }
  }
  const sent=await evaluateWatches(env,owner);
  const keywords=await all<{keyword:string}>(env.DB,`SELECT DISTINCT keyword FROM watches WHERE status!='cancelled' ${owner?'AND email=?':''} LIMIT 30`,...(owner?[owner]:[]));
  let started=0;
  for(const {keyword} of keywords) {
    const id=crypto.randomUUID(); const now=Date.now();
    const claim=await env.DB.prepare(`INSERT INTO sweeps (id,keyword,run_id,status,created_at) SELECT ?,?,'pending','running',?
      WHERE NOT EXISTS (SELECT 1 FROM sweeps WHERE keyword=? AND (status='running' OR created_at>?))`)
      .bind(id,keyword,now,keyword,now-60000).run();
    if(!claim.meta.changes) continue;
    try {
      const run=await startRun(keyword,env);
      await env.DB.prepare('UPDATE sweeps SET run_id=? WHERE id=?').bind(run.id,id).run();started++;
    }catch(error){const message=redact(error instanceof Error?error.message:'啟動失敗',env);errors.push(message);await env.DB.prepare(`UPDATE sweeps SET status='failed',note=? WHERE id=?`).bind(message,id).run();}
  }
  return {ok:errors.length===0,collected,started,sent,errors};
}

async function diagnostics(request: Request, url: URL, env: Env) {
  await requireAdmin(request,env);
  if(url.pathname==='/api/diag/threads') return json(await fetchThreads(url.searchParams.get('url')??'',url.searchParams.get('ua')||undefined));
  if(url.pathname==='/api/diag/email') {
    const to=email(url.searchParams.get('to'));
    const result=await sendEmail(env,to,'Snapee｜寄信診斷','<p>Snapee 寄信通道測試。</p>','Snapee 寄信通道測試。','diag-'+crypto.randomUUID());
    await env.DB.prepare(`INSERT INTO alerts (watch_id,email,item_key,price,target_price,saved_ntd,kind,sent_ok,detail,created_at) VALUES (?,?,?,0,0,0,'watch_created',?,?,?)`)
      .bind('diagnostic',to,'diagnostic',result.ok?1:0,JSON.stringify({...result,diagnostic:true}),Date.now()).run();
    return json(result,result.ok?200:502);
  }
  if(url.pathname==='/api/diag/emails') {
    const owner=url.searchParams.get('email');
    const alerts=await all<Alert>(env.DB,`SELECT * FROM alerts ${owner?'WHERE email=?':''} ORDER BY created_at DESC LIMIT 30`,...(owner?[email(owner)]:[]));
    const live=[];
    if(url.searchParams.get('live')==='1') for(const alert of alerts.slice(0,5)) {
      let id: string|undefined;try{id=(JSON.parse(alert.detail??'{}') as {id?:string}).id;}catch{/* Older records may contain plain text. */}
      if(id) { try{live.push({alertId:alert.id,status:await emailStatus(env,id)});}catch(error){live.push({alertId:alert.id,error:redact(error instanceof Error?error.message:'查詢失敗',env)});} await new Promise(resolve=>setTimeout(resolve,600)); }
    }
    return json({alerts,live});
  }
  if(url.pathname==='/api/diag/alert-preview') {
    const owner=email(url.searchParams.get('email'));
    const watch=await env.DB.prepare('SELECT * FROM watches WHERE id=? AND email=?').bind(url.searchParams.get('watchId'),owner).first<Watch>();
    if(!watch) throw new HttpError(404,'找不到監控');
    const product=await env.DB.prepare('SELECT * FROM products WHERE item_key=?').bind(watch.item_key).first<StoredProduct>();
    if(!product) throw new HttpError(404,'找不到商品');
    const view=await productView(env.DB,product);if(view.stats.current===null)throw new HttpError(409,'尚無觀測價格');
    const result=await sendWatchMail(env,watch,product,view.stats.current,'target_hit','preview-'+crypto.randomUUID(),true);
    return json(result,result.ok?200:502);
  }
  throw new HttpError(404,'not_found');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
    if(!['GET','HEAD'].includes(request.method)) {
      const origin=request.headers.get('origin');
      if(origin && origin!==url.origin) throw new HttpError(403,'跨來源操作不允許');
    }
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(ui, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    }
    if (request.method === 'GET' && url.pathname === '/api/health') {
      const missing = missingSecrets(env);
      return Response.json({ ok: missing.length === 0, missingSecrets: missing,
        version: env.CF_VERSION_METADATA?.id ?? 'local', deployedAt: env.CF_VERSION_METADATA?.timestamp ?? null,
        sourceCommit: env.CF_VERSION_METADATA?.tag ?? null, mailFrom: env.MAIL_FROM }, { headers: { 'cache-control': 'no-store' } });
    }
    if(request.method==='GET' && url.pathname.startsWith('/api/diag/')) return await diagnostics(request,url,env);
    if(request.method==='POST' && url.pathname==='/api/analyze') return await analyze(request,env);
    if(request.method==='GET' && url.pathname.startsWith('/api/job/')) return await jobResult(url.pathname.slice(9),env);
    if(request.method==='POST' && url.pathname==='/api/watch') return await createWatch(request,env);
    if(request.method==='DELETE' && url.pathname==='/api/watch') return await deleteWatch(request,env);
    if(request.method==='GET' && url.pathname==='/api/dashboard') return json(await dashboard(env.DB,email(url.searchParams.get('email'))));
    if(request.method==='POST' && url.pathname==='/api/sweep') {
      const data=await body(request);
      if(!data.email) { await requireAdmin(request,env);return json(await sweep(env)); }
      return json(await sweep(env,email(data.email)));
    }
    if(request.method==='GET' && url.pathname==='/favicon.ico') return new Response(null,{status:204});
    return json({ error: 'not_found' },404);
    } catch(error) {
      const message=redact(error instanceof Error?error.message:'內部錯誤',env);
      if(error instanceof ServiceError) return json({error:message,upstream:{service:error.service,status:error.status,raw:error.raw}},502);
      return json({error:message},error instanceof HttpError?error.status:500);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    if (env.SWEEP_ENABLED !== 'true') return;
    await sweep(env);
  },
} satisfies ExportedHandler<Env>;
