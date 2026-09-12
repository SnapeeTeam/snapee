import { expect, it } from 'vitest';
import { categories, classify } from '../src/category';
it('provides all 24 categories', () => expect(categories).toHaveLength(24));
it.each([
  ['衛生紙', '居家生活'], ['尿布 清潔', '嬰幼童與母親'], ['貓砂', '寵物'], ['手機殼', '手機平板與周邊'],
  ['筆電', '3C與筆電'], ['面膜', '美妝保養'], ['跑鞋', '男女鞋'], ['PS5', '電玩遊戲'],
  ['魚油', '保健護理'], ['行李箱', '戶外/旅行'], ['公仔', '娛樂收藏'], ['零食', '美食伴手禮'],
  ['安全帽', '汽機車零件百貨'], ['洋裝', '女生衣著'], ['男襯衫', '男生衣著'], ['手錶', '男生包包與配件'],
  ['女包', '女生包包/精品'], ['黃金', '女生配件/黃金'], ['瑜伽墊', '運動/健身'], ['冰箱', '家電影音'],
  ['小說', '書籍及雜誌期刊'], ['餐券', '服務票券'], ['明信片', '文創商品'], ['神祕商品', '其他類別'],
])('classifies %s', (keyword, category) => expect(classify(keyword)).toBe(category));
it('prioritizes keyword over promotional product name', () => expect(classify('衛生紙', '買一送一手機殼')).toBe('居家生活'));
it('falls back to product name', () => expect(classify('特價', '尿布')).toBe('嬰幼童與母親'));
it('never returns null for empty strings', () => expect(classify('')).toBe('其他類別'));
