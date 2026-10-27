/** A location named 废弃庭院 is usable; an explicit 废弃 status marker is not. */
export function assetUnavailable(asset){
 if(!asset||asset.deletedAt||asset.trashedAt||['candidate','stale'].includes(asset.productionStatus))return true;
 const name=String(asset.name||'').normalize('NFKC');
 return /不能使用|作废|禁用/u.test(name)||/(?:^|[\s_·|｜\-—\[\]【】()])(?:已)?废弃(?:版本?)?(?=$|[\s_·|｜\-—\[\]【】().:：])/u.test(name);
}
