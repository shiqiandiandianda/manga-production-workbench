import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalAssetNaming,canonicalVariantName,canonicalAssetFileName,sceneIdentityName} from '../public/asset-naming.js';
test('known work and subject prefixes are removed repeatedly without deleting location qualifiers',()=>{
 const r=canonicalAssetNaming({role:'scene',workName:'大周玄衣卫',objectName:'明州·五羊城千户所',variantName:'大周玄衣卫-明州·五羊城千户所-书房',name:'大周玄衣卫-明州·五羊城千户所-大周玄衣卫-明州·五羊城千户所-书房'});
 assert.equal(r.displayName,'明州·五羊城千户所__书房');assert.equal(r.identityName,'明州·五羊城千户所·书房');
 assert.equal(canonicalAssetNaming({role:'character',workName:'大周玄衣卫',objectName:'花满楼',variantName:'大周玄衣卫-花满楼-玄衣卫官服'}).variantName,'玄衣卫官服');
});
test('canonical names are idempotent and preserve different identities, states and regions',()=>{
 for(const role of ['character','scene','prop']){const r=canonicalAssetNaming({role,workName:'作品甲',objectName:'西城·书房',variantName:'作品甲-西城·书房-夜景'});assert.deepEqual(canonicalAssetNaming({role,workName:'作品甲',objectName:r.subjectName,variantName:r.variantName}).displayName,r.displayName);}
 assert.notEqual(sceneIdentityName('县衙','书房'),sceneIdentityName('县衙','大堂'));
 assert.equal(canonicalVariantName('总旗袍服',{subjectName:'金九龄'}),'总旗袍服');
 assert.equal(canonicalVariantName('他人-官服',{subjectName:'花满楼',workName:'大周玄衣卫'}),'他人-官服');
});
test('pending text and technical labels never become a named costume',()=>{
 for(const variantName of ['未知（待确认）','大周玄衣卫-薛冰-未知（待确认）','具体款式待绑定'])assert.equal(canonicalVariantName(variantName,{workName:'大周玄衣卫',subjectName:'薛冰'}),'');
 assert.equal(canonicalVariantName('玄衣卫袍服_标准卡_v2'),'玄衣卫袍服');
 assert.equal(canonicalVariantName('生成版（75d3a2b6）'),'');
 assert.equal(canonicalVariantName('生成版（75d3a2b6·a491b7c2）'),'');
 assert.equal(canonicalVariantName('夜景_生成版（75d3a2b6·a491b7c2）'),'夜景');
 assert.equal(canonicalAssetFileName({role:'character',workName:'大周玄衣卫',objectName:'陆小凤',variantName:'玄衣卫袍服'}),'陆小凤__玄衣卫袍服.png');
});
test('legacy pinned images derive a work prefix only from a confirmed subject in their display name',()=>{
 assert.equal(canonicalVariantName('大周玄衣卫-花满楼-官服',{subjectName:'花满楼',sourceName:'大周玄衣卫-花满楼-大周玄衣卫-花满楼-官服'}),'官服');
 assert.equal(canonicalVariantName('他人-花满楼-官服',{subjectName:'花满楼',sourceName:'另一个名称'}),'他人-花满楼-官服');
});
