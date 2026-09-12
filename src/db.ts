import { classify } from './category';
import { effectivePrice, priceCopy, priceStats, suggestTarget, type PricePoint } from './price';
import type { Product } from './shopee';
import { assessmentView, type MarketEstimate, type StoredAssessment } from './assessment';

export interface Job {
  id: string; email: string; threads_url: string; stage: string;
  threads_run_id: string | null; shopee_run_id: string | null;
  post_text: string | null; post_author: string | null; keyword: string | null;
  reasoning: string | null; error: string | null; created_at: number; updated_at: number;
}
export interface StoredProduct extends Omit<Product, 'price' | 'shipping_fee'> { first_seen_at: number; last_seen_at: number }
export interface Watch {
  id: string; email: string; item_key: string; keyword: string; base_price: number; target_price: number;
  status: string; created_at: number; last_checked_at: number | null; last_alert_at: number | null;
}
export interface Alert {
  id: number; watch_id: string; email: string; item_key: string; price: number;
  target_price: number; saved_ntd: number; kind: string; sent_ok: number; detail: string | null; created_at: number;
}
export interface Sweep { id: string; keyword: string; run_id: string; status: string; created_at: number; collected_at: number | null; note: string | null }
export async function all<T>(db: D1Database, sql: string, ...params: (string | number | null)[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...params).all<T>()).results;
}
export function pointStatement(db: D1Database, product: Product, at: number): D1PreparedStatement {
  return db.prepare('INSERT INTO price_points (item_key,price,shipping_fee,effective_price,observed_at) VALUES (?,?,?,?,?)')
    .bind(product.item_key, product.price, product.shipping_fee, effectivePrice(product.price, product.shipping_fee), at);
}
export function productStatements(db: D1Database, products: Product[], at: number): D1PreparedStatement[] {
  return products.flatMap(p => [db.prepare(`INSERT INTO products (item_key,name,keyword,shopee_url,image_url,merchant_name,rating,review_count,first_seen_at,last_seen_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(item_key) DO UPDATE SET name=excluded.name,keyword=excluded.keyword,shopee_url=excluded.shopee_url,
    image_url=excluded.image_url,merchant_name=excluded.merchant_name,rating=excluded.rating,review_count=excluded.review_count,last_seen_at=excluded.last_seen_at`)
    .bind(p.item_key,p.name,p.keyword,p.shopee_url,p.image_url,p.merchant_name,p.rating,p.review_count,at,at), pointStatement(db,p,at)]);
}
export async function productView(db: D1Database, product: StoredProduct, now = Date.now()) {
  const points = await all<PricePoint & { id: number; effective_price: number }>(db,
    'SELECT id,price,shipping_fee,effective_price,observed_at FROM price_points WHERE item_key=? AND observed_at>=? ORDER BY observed_at,id', product.item_key,now-180*86400000);
  const stats = priceStats(points, now);
  const assessment=await db.prepare('SELECT * FROM price_assessments WHERE item_key=? AND observed_at=?').bind(product.item_key,stats.currentAt).first<StoredAssessment>();
  return { ...product, points, stats, priceAssessment:assessmentView(stats.current,stats.currentAt,assessment), category: classify(product.keyword, product.name), suggestedTarget: suggestTarget(stats), priceCopy: priceCopy(stats) };
}
export function assessmentStatements(db:D1Database,products:Product[],estimates:MarketEstimate[],at:number,model:string):D1PreparedStatement[] {
  return estimates.map(estimate=>{
    const p=products.find(p=>p.item_key===estimate.item_key)!;
    return db.prepare(`INSERT INTO price_assessments (item_key,observed_at,assessed_price,market_price,reasoning,model,estimated_at) VALUES (?,?,?,?,?,?,?)`)
      .bind(p.item_key,at,effectivePrice(p.price,p.shipping_fee),estimate.market_price,estimate.reasoning,model,Date.now());
  });
}
export async function dashboard(db: D1Database, email: string) {
  const watches = await all<Watch>(db, 'SELECT * FROM watches WHERE email=? ORDER BY created_at DESC LIMIT 100', email);
  const cards = [];
  for (const watch of watches) {
    const product = await db.prepare('SELECT * FROM products WHERE item_key=?').bind(watch.item_key).first<StoredProduct>();
    if (product) cards.push({ ...watch, product: await productView(db, product) });
  }
  const alerts = await all<Alert>(db, `SELECT * FROM alerts WHERE email=? AND kind!='watch_created' AND (detail IS NULL OR detail NOT LIKE '%"preview":true%') ORDER BY created_at DESC LIMIT 100`, email);
  const totals = await db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(saved),0) AS saved FROM
    (SELECT watch_id,MAX(saved_ntd) AS saved FROM alerts WHERE email=? AND sent_ok=1 AND kind!='watch_created'
      AND (detail IS NULL OR detail NOT LIKE '%"preview":true%') GROUP BY watch_id)`).bind(email).first<{count:number;saved:number}>();
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM alerts WHERE email=? AND sent_ok=1 AND kind!='watch_created'
    AND (detail IS NULL OR detail NOT LIKE '%"preview":true%')`).bind(email).first<{ count:number }>();
  return { watches: cards, alerts: alerts.map(a => ({ ...a, detail: undefined })),
    kpis: { active: watches.filter(w => w.status !== 'cancelled').length, saved: totals?.saved ?? 0, alerts: count?.count ?? 0 } };
}
