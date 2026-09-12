import { expect, it } from 'vitest';
import { parseAmount, parseShopee, parseShopeeRow } from '../src/shopee';
import { normalizeThreadsUrl } from '../src/threads';
it.each([
  [12200000, 122], [122, 122], ['NT$1,222', 1222], ['122', 122], [100000, 1],
  [0, null], [-1, null], ['', null], [null, null], [Infinity, null], ['122-200', null],
])('parses amount %s', (input, expected) => expect(parseAmount(input)).toBe(expected));
const row = { shopid: 12, itemid: 34, name: '衛生紙', price: 122 };
it('builds canonical product id and URL', () => expect(parseShopeeRow(row, '紙')).toMatchObject({ item_key: '12.34', shopee_url: 'https://shopee.tw/product/12/34', shipping_fee: 0 }));
it.each(['price_min', 'priceMin', 'currentPrice'])('handles alias %s', key => expect(parseShopeeRow({ ...row, price: undefined, [key]: 199 }, '紙')?.price).toBe(199));
it('extracts ids from URL', () => expect(parseShopeeRow({ name: '紙', price: 10, url: 'https://shopee.tw/紙-i.12.34?x=1' }, '紙')?.item_key).toBe('12.34'));
it('skips missing ids', () => expect(parseShopeeRow({ name: '紙', price: 10 }, '紙')).toBeNull());
it('skips missing price', () => expect(parseShopeeRow({ ...row, price: undefined }, '紙')).toBeNull());
it('deduplicates products', () => expect(parseShopee([row, row], '紙')).toHaveLength(1));
it('sorts cheapest first', () => expect(parseShopee([row, { ...row, itemid: 35, price: 100 }], '紙')[0]?.price).toBe(100));
it('does not trust supplied product URL host', () => expect(parseShopeeRow({ ...row, url: 'javascript:alert(1)' }, '紙')?.shopee_url).toBe('https://shopee.tw/product/12/34'));
it('rejects executable image URL', () => expect(parseShopeeRow({ ...row, image: 'javascript:alert(1)' }, '紙')?.image_url).toBeNull());
it('rejects unsafe numeric ids', () => expect(parseShopeeRow({ ...row, itemid: Number.MAX_SAFE_INTEGER + 1 }, '紙')).toBeNull());
it.each(['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'])('normalizes %s', host => expect(normalizeThreadsUrl(`https://${host}/@wei898/post/DJMreSlSVpB/標題?hl=zh-tw`)).toBe('https://www.threads.com/@wei898/post/DJMreSlSVpB'));
it.each(['https://evil.com/@a/post/b', 'https://threads.com.evil.com/@a/post/b', 'http://threads.com/@a/post/b', 'https://user@threads.com/@a/post/b', 'https://threads.com:8080/@a/post/b', 'https://threads.com/', 'oops'])('rejects invalid URL %s', url => expect(normalizeThreadsUrl(url)).toBeNull());
it.each(['threads.net','www.threads.net','threads.com','www.threads.com'])('accepts mobile share links on %s',host=>expect(normalizeThreadsUrl(`https://${host}/share/BAaSPPgkYJ/?hl=zh-tw`)).toBe('https://www.threads.com/share/BAaSPPgkYJ/'));
it('accepts share URL without trailing slash',()=>expect(normalizeThreadsUrl(' https://www.threads.com/share/BAaSPPgkYJ ')).toBe('https://www.threads.com/share/BAaSPPgkYJ/'));
it.each(['https://www.threads.com/share/','https://www.threads.com/share/id/extra','https://www.threads.com/share/%2Fexample','https://threads.com.evil.com/share/abc/','https://threads.com@evil.com/share/abc/','http://www.threads.com/share/abc/'])('rejects malformed share URL %s',url=>expect(normalizeThreadsUrl(url)).toBeNull());
