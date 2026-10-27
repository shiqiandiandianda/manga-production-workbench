// Matches the launcher and the documented default; COMIC_MAX_CONCURRENT can raise it up to MAX_CONCURRENCY.
export const DEFAULT_CONCURRENCY=6;
export const DEFAULT_MAIN_CONCURRENCY=6;
export const DEFAULT_REPAIR_CONCURRENCY=2;
export const MAX_CONCURRENCY=20;
export function normalizeConcurrency(value=DEFAULT_CONCURRENCY){
  const numeric=Number(value);
  return Number.isFinite(numeric)?Math.max(1,Math.min(MAX_CONCURRENCY,Math.floor(numeric))):DEFAULT_CONCURRENCY;
}
export function validatePlatformConcurrency(value){
  const platforms={main:Number(value?.main),repair:Number(value?.repair)};
  for(const [name,count] of Object.entries(platforms))if(!['number','string'].includes(typeof value?.[name])||String(value[name]).trim()===''||!Number.isInteger(count)||count<0||count>MAX_CONCURRENCY)throw Object.assign(new Error('每个平台的并发数量须为 0–20 的整数'),{statusCode:400});
  if(platforms.main<1||platforms.repair>platforms.main)throw Object.assign(new Error('主平台总额度须为 1–20，补图优先额度不能超过总额度'),{statusCode:400});
  return platforms;
}
