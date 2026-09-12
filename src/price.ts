const DAY = 86_400_000;
export interface PricePoint { price: number; shipping_fee: number; observed_at: number }
export interface PriceStats {
  low: number | null; lowAt: number | null; high: number | null;
  current: number | null; currentAt: number | null;
  sampleCount: number | null; coverageDays: number | null;
}

export function effectivePrice(price: number, shippingFee = 0): number {
  if (![price, shippingFee].every(v => Number.isSafeInteger(v) && v >= 0)) {
    throw new Error('價格與運費必須為非負整數');
  }
  const total = price + shippingFee;
  if (!Number.isSafeInteger(total)) throw new Error('價格超出範圍');
  return total;
}

export function priceStats(points: readonly PricePoint[], now: number, lookbackDays = 180): PriceStats {
  const empty: PriceStats = { low: null, lowAt: null, high: null, current: null, currentAt: null, sampleCount: null, coverageDays: null };
  const valid = points.filter(p => Number.isFinite(p.observed_at) && p.observed_at <= now &&
    p.observed_at >= now - lookbackDays * DAY &&
    Number.isSafeInteger(p.price) && p.price >= 0 && Number.isSafeInteger(p.shipping_fee) && p.shipping_fee >= 0)
    .slice().sort((a, b) => a.observed_at - b.observed_at);
  const first = valid[0];
  const last = valid.at(-1);
  if (!first || !last) return empty;
  const lowPoint = valid.reduce((a, b) => effectivePrice(b.price, b.shipping_fee) < effectivePrice(a.price, a.shipping_fee) ? b : a);
  return {
    low: effectivePrice(lowPoint.price, lowPoint.shipping_fee), lowAt: lowPoint.observed_at,
    high: Math.max(...valid.map(p => effectivePrice(p.price, p.shipping_fee))),
    current: effectivePrice(last.price, last.shipping_fee), currentAt: last.observed_at,
    sampleCount: valid.length, coverageDays: Math.ceil((last.observed_at - first.observed_at) / DAY),
  };
}

export function suggestTarget(stats: PriceStats): number | null {
  if (stats.current === null || stats.low === null || stats.current <= 1) return null;
  return Math.max(1, Math.min(stats.current - 1, Math.round(stats.current > stats.low ? stats.low * 1.02 : stats.current * 0.95)));
}

export function priceCopy(stats: PriceStats): string {
  if (stats.current === null) return '還沒有觀測資料';
  if (stats.sampleCount === 1) return `現在 NT$${stats.current}（第一次觀測，還沒有比較基準）`;
  return `現在 NT$${stats.current}（目前累積的 ${stats.coverageDays} 天，觀測低點 NT$${stats.low}）`;
}

export function validTarget(value: unknown, current: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < current;
}

export function alertKind(current: number, target: number, previousLow: number | null,
  lastAlertAt: number | null, now: number): 'target_hit' | 'new_low' | null {
  if (lastAlertAt !== null && now - lastAlertAt < 20 * 3_600_000) return null;
  if (current <= target) return 'target_hit';
  return previousLow !== null && current < previousLow ? 'new_low' : null;
}
