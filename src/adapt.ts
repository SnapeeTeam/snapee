export interface AdaptSample { category: string; basePrice: number; targetPrice: number }
export interface AdaptProfile { totalCount: number; categories: Record<string, { count: number; averageDiscount: number }> }
export function buildAdaptProfile(samples: readonly AdaptSample[]): AdaptProfile {
  const categories: AdaptProfile['categories'] = Object.create(null);
  let totalCount=0;
  for(const sample of samples) {
    if(!sample.category || !Number.isSafeInteger(sample.basePrice) || !Number.isSafeInteger(sample.targetPrice) || sample.basePrice<=1 || sample.targetPrice<=0 || sample.targetPrice>=sample.basePrice) continue;
    totalCount++;
    const entry=categories[sample.category]??{count:0,averageDiscount:0};
    const discount=(sample.basePrice-sample.targetPrice)/sample.basePrice;
    entry.count++;
    entry.averageDiscount+=(discount-entry.averageDiscount)/entry.count;
    categories[sample.category]=entry;
  }
  return {totalCount,categories};
}
export function adaptDefault(profile: AdaptProfile, category: string, current: number|null) {
  const entry=profile.categories[category];
  const learned=profile.totalCount>=10 && (entry?.count??0)>=2;
  const discount=learned?entry!.averageDiscount:0.05;
  const target=current!==null && Number.isSafeInteger(current) && current>1
    ? Math.max(1,Math.min(current-1,Math.round(current*(1-discount)))) : null;
  return {target,discountPercent:discount*100,source:learned?'category_average' as const:'default' as const,totalCount:profile.totalCount,categoryCount:entry?.count??0};
}
