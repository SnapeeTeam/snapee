export interface Product {
  item_key: string; name: string; keyword: string; shopee_url: string;
  image_url: string | null; merchant_name: string | null;
  rating: number; review_count: number; price: number; shipping_fee: number;
}
type Row = Record<string, unknown>;
function object(value: unknown): Row { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}; }
function first(row: Row, keys: string[]): unknown { return keys.map(k => row[k]).find(v => v !== undefined && v !== null && v !== ''); }
function identifier(value: unknown): string | null {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return null;
  return typeof value === 'string' || typeof value === 'number' ? (/^[1-9]\d*$/.test(String(value)) ? String(value) : null) : null;
}
export function parseAmount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const cleaned = typeof value === 'string' ? value.trim().replace(/^(NT\$|TWD|\$)\s*/i, '').replaceAll(',', '') : value;
  if (cleaned === '') return null;
  const raw = Number(cleaned);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const price = Math.round(raw >= 100000 ? raw / 100000 : raw);
  return Number.isSafeInteger(price) && price > 0 ? price : null;
}
export function parseShopeeRow(value: unknown, keyword: string): Product | null {
  const root = object(value);
  const row = { ...root, ...object(root.item_basic) };
  const urlValue = first(row, ['shopee_url', 'url', 'productUrl', 'product_url', 'link']);
  const match = typeof urlValue === 'string' ? urlValue.match(/-i\.(\d+)\.(\d+)(?:[/?#]|$)/) ?? urlValue.match(/\/product\/(\d+)\/(\d+)(?:[/?#]|$)/) : null;
  const shop = identifier(first(row, ['shopid', 'shopId', 'shop_id']) ?? match?.[1]);
  const item = identifier(first(row, ['itemid', 'itemId', 'item_id', 'productId', 'product_id']) ?? match?.[2]);
  const name = first(row, ['name', 'title', 'productName', 'product_name']);
  const price = ['price', 'price_min', 'priceMin', 'currentPrice'].map(key => parseAmount(row[key])).find(p => p !== null) ?? null;
  if (!shop || !item || typeof name !== 'string' || !name.trim() || price === null) return null;
  const rawImage = first(row, ['image_url', 'imageUrl', 'image', 'thumbnail']) ?? (Array.isArray(row.images) ? row.images[0] : null);
  let image: string | null = null;
  if (typeof rawImage === 'string') {
    if (/^https:\/\//.test(rawImage)) image = rawImage;
    else if (/^[a-zA-Z0-9_-]+$/.test(rawImage)) image = 'https://cf.shopee.tw/file/' + rawImage;
  }
  const ratingObj = object(row.item_rating);
  const rating = Number(first(row, ['rating', 'ratingStar', 'rating_star']) ?? ratingObj.rating_star ?? 0);
  const reviews = Number(first(row, ['review_count', 'reviewCount', 'rating_count', 'ratingCount']) ?? 0);
  const merchant = first(row, ['merchant_name', 'shopName', 'shop_name', 'sellerName']);
  return { item_key: `${shop}.${item}`, name: name.trim(), keyword,
    shopee_url: `https://shopee.tw/product/${shop}/${item}`, image_url: image,
    merchant_name: typeof merchant === 'string' ? merchant : null,
    rating: Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : 0,
    review_count: Number.isFinite(reviews) ? Math.max(0, Math.floor(reviews)) : 0, price, shipping_fee: 0 };
}
export function parseShopee(rows: unknown, keyword: string): Product[] {
  if (!Array.isArray(rows)) return [];
  const products = new Map<string, Product>();
  for (const row of rows) { const p = parseShopeeRow(row, keyword); if (p) products.set(p.item_key, p); }
  return [...products.values()].sort((a, b) => a.price + a.shipping_fee - b.price - b.shipping_fee);
}
