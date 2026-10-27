import test from 'node:test';
import assert from 'node:assert/strict';
import {assetWorkflowKind,initializeProductionAsset,mergeProductionAssets,validateProductionAssets,prepareAssetGeneration,applyAssetResult,applyAssetProductionAction,assetProductionView,collectProductionAssetImageIds,remapProductionAssets} from '../lib/asset-production.mjs';

const imageId=n=>'asset_00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const images=Array.from({length:12},(_,i)=>({id:imageId(i+1),name:'参考'+(i+1),filePath:'D:/synthetic-tests/image-'+(i+1)+'.png',width:2048,height:1024}));
const asset=(fields={})=>({id:'C001',name:'角色甲',type:'character',aliases:[],description:'青年男子，黑色长发束起，沉稳坚定。',prompt:'古风青年角色，原创新脸。',episodeNumbers:[11,12,13],appearanceScopeStatus:'production-observed',sourceRefs:[],...fields});
const project=(fields={})=>({id:'project_00000000-0000-4000-8000-000000000001',title:'角色工作流测试',revision:4,style:'二维古风漫画，清晰墨线和赛璐璐阴影',references:[{assetId:imageId(12),role:'style',name:'已确认画风'}],productionAssets:[asset()],...fields});
const action=(p,type,stageId,imageAssetId,extra={})=>applyAssetProductionAction(p,{revision:p.revision,assetId:'C001',type,stageId,imageAssetId,...extra},images);
function confirm(p,stageId,id){return action(action(p,'bind-candidate',stageId,id),'confirm',stageId,id);}
function ready(){let p=project();p=confirm(p,'face',imageId(1));p=confirm(p,'body',imageId(2));p=confirm(p,'hands',imageId(3));return action(p,'configure',null,null,{outfitDescription:'黑色交领长袍，银色腰带，黑色布靴',propDescription:'右手持普通短刀'});}

test('实际出现三话才自动走主要人物流程，甲方估计与S优先级不冒充真实参演',()=>{
 assert.equal(assetWorkflowKind(asset()),'major');assert.equal(assetWorkflowKind(asset({episodeNumbers:[1,2,2]})),'simple');assert.equal(assetWorkflowKind(asset({appearanceScopeStatus:'client-estimate',priority:'S'})),'simple');assert.equal(assetWorkflowKind(asset({appearanceScopeStatus:'client-estimate',roleClass:'major'})),'major');
 assert.deepEqual(initializeProductionAsset(asset()).stages.map(s=>s.id),['face','body','hands','role-card']);
});
test('主要人物的三张基础图按依赖锁定，结果必须显式确认后才能下游生成',()=>{
 let p=project();assert.throws(()=>prepareAssetGeneration(p,{revision:4,assetId:'C001',stageId:'body',provider:'codex'},images),/先确认/);
 const request=prepareAssetGeneration(p,{revision:4,assetId:'C001',stageId:'face',provider:'codex'},images);p=applyAssetResult(p,request,{assetId:imageId(1),jobId:'job-real'}).project;
 assert.equal(p.productionAssets[0].stages[0].status,'candidate');assert.equal(p.productionAssets[0].stages[0].confirmedAssetId,null);assert.throws(()=>prepareAssetGeneration(p,{revision:4,assetId:'C001',stageId:'body',provider:'codex'},images),/先确认/);
 p=action(p,'confirm','face',imageId(1));const body=prepareAssetGeneration(p,{revision:4,assetId:'C001',stageId:'body',provider:'jimeng'},images);assert.deepEqual(body.referenceIds,[imageId(1),imageId(12)]);assert.match(body.prompt,/普通白衣/);assert.match(body.prompt,/正面、侧面、背面/);
});
test('剧情角色卡显式使用三张确认基础图和画风，不凭资产名字猜路径',()=>{
 const p=ready(),request=prepareAssetGeneration(p,{revision:4,assetId:'C001',stageId:'role-card',provider:'codex'},images);assert.deepEqual(request.referenceIds,[imageId(1),imageId(2),imageId(3),imageId(12)]);assert.deepEqual(request.referencePaths,request.referenceIds.map(id=>images.find(a=>a.id===id).filePath));assert.equal(request.bridgeInput.kind,'asset-production');assert.equal(request.bridgeInput.shot.assetProductionContract.allowLayoutDividers,true);assert.match(request.prompt,/左侧约25%/);assert.match(request.prompt,/黑色交领长袍/);assert.match(request.prompt,/手势/);
 assert.throws(()=>prepareAssetGeneration(p,{revision:4,assetId:'C001',stageId:'role-card',provider:'codex'},images.filter(a=>a.id!==imageId(2))),/参考图片不存在/);
});
test('身份基础图换成新确认候选后，下游确认状态和旧候选全部过期',()=>{
 let p=ready(),request=prepareAssetGeneration(p,{revision:4,assetId:'C001',stageId:'role-card',provider:'codex'},images);p=applyAssetResult(p,request,{assetId:imageId(4)}).project;p=action(p,'confirm','role-card',imageId(4));p=confirm(p,'face',imageId(5));
 const a=p.productionAssets[0];assert.equal(a.stages[0].status,'confirmed');assert.equal(a.stages[0].version,2);for(const id of ['body','hands','role-card'])assert.equal(a.stages.find(s=>s.id===id).status,'stale');assert.equal(a.stages.find(s=>s.id==='role-card').candidates[0].status,'stale');assert.throws(()=>prepareAssetGeneration(p,{revision:4,assetId:'C001',stageId:'role-card',provider:'codex'},images),/先确认/);
});
test('源设定改变、画风改变或身份版本改变时返回的旧生成结果只保留过期候选',()=>{
 const p=ready(),request=prepareAssetGeneration(p,{revision:4,assetId:'C001',stageId:'role-card',provider:'codex'},images);const changed=structuredClone(p);changed.style='另一个画风';assert.equal(applyAssetResult(changed,request,{assetId:imageId(4)}).stale,true);assert.equal(assetProductionView(changed,images)[0].stages[0].status,'stale');
 const changedIdentity=confirm(p,'face',imageId(5));assert.equal(applyAssetResult(changedIdentity,request,{assetId:imageId(6)}).stale,true);
 const unrelated=structuredClone(p);unrelated.revision++;unrelated.title+='（更名）';assert.equal(applyAssetResult(unrelated,request,{assetId:imageId(4)}).stale,false);
});
test('修改剧情服装仅让角色卡过期，三张已确认基础图继续有效',()=>{
 let p=ready(),r=prepareAssetGeneration(p,{revision:4,assetId:'C001',stageId:'role-card',provider:'codex'},images);p=action(applyAssetResult(p,r,{assetId:imageId(4)}).project,'confirm','role-card',imageId(4));p=action(p,'configure',null,null,{outfitDescription:'灰色便装'});
 const view=assetProductionView(p,images)[0];for(const id of ['face','body','hands'])assert.equal(view.stages.find(s=>s.id===id).status,'confirmed');assert.equal(view.stages.find(s=>s.id==='role-card').status,'stale');
});
test('同一人物能新增不同剧情服装卡，仍依赖同三张基础图',()=>{
 let p=ready();p=action(p,'add-outfit',null,null,{label:'夜行服',outfitDescription:'黑色夜行便服和软底靴',propDescription:'不携带武器'});const s=p.productionAssets[0].stages.at(-1);assert.ok(s.id.startsWith('role-card-'));assert.deepEqual(s.dependencies,['face','body','hands']);const r=prepareAssetGeneration(p,{revision:4,assetId:'C001',stageId:s.id,provider:'codex'},images);assert.match(r.prompt,/黑色夜行便服/);assert.deepEqual(r.referenceIds.slice(0,3),[imageId(1),imageId(2),imageId(3)]);
});
test('普通临时人物直接生成卡，群像包含差异九宫格与无头含手脚鞋的编号映射',()=>{
 const simple=project({productionAssets:[asset({episodeNumbers:[1]})]}),r=prepareAssetGeneration(simple,{revision:4,assetId:'C001',stageId:'role-card',provider:'codex'},images);assert.match(r.prompt,/普通人物角色卡/);assert.deepEqual(r.stageSnapshot.dependencySnapshot,[]);
 const crowd=project({productionAssets:[asset({type:'crowd',name:'县衙差役群像',description:'古代县衙差役，青灰布衣'})]}),group=prepareAssetGeneration(crowd,{revision:4,assetId:'C001',stageId:'crowd-card',provider:'jimeng'},images);assert.match(group.prompt,/严格3×3/);assert.match(group.prompt,/A01对应B01/);assert.match(group.prompt,/必须包含双手、双脚与鞋/);assert.match(group.prompt,/不能出现头部或面部/);assert.match(group.prompt,/明确限定同龄/);assert.equal(group.bridgeInput.shot.assetProductionContract.allowAssetCodes,true);
});
test('同步拆解资料保留资产生产记录，实质设定变化失效，不因来源hash变化误失效',()=>{
 const p=ready(),first=p.productionAssets[0];let merged=mergeProductionAssets([first],[asset({sourceVersion:'new-file-hash'})]);assert.equal(merged[0].stages[0].status,'confirmed');assert.equal(merged[0].workflow.outfitDescription,first.workflow.outfitDescription);merged=mergeProductionAssets([first],[asset({description:'老年男子，白发'})]);assert.equal(merged[0].stages[0].status,'stale');assert.equal(merged[0].stages[0].confirmedAssetId,imageId(1));assert.equal(first.stages[0].status,'confirmed');
});
test('所有人工写入和生成请求都有工程revision guard，不接受未知渠道或伪造图片',()=>{
 const p=project();assert.throws(()=>applyAssetProductionAction(p,{type:'configure',assetId:'C001',revision:3},images),e=>e.status===409);assert.throws(()=>prepareAssetGeneration(p,{revision:3,assetId:'C001',stageId:'face',provider:'codex'},images),e=>e.status===409);assert.throws(()=>prepareAssetGeneration(p,{revision:4,assetId:'C001',stageId:'face',provider:'unknown'},images),/Codex/);assert.throws(()=>action(p,'bind-candidate','face','made-up'),/已登记/);assert.throws(()=>applyAssetResult(p,{}, {assetId:'path.png'}),/真实图片/);
});
test('过期候选不能直接确认，明确重新登记核验后才能确认',()=>{
 const p=ready(),r=prepareAssetGeneration(p,{revision:4,assetId:'C001',stageId:'body',provider:'codex'},images),changed=confirm(p,'face',imageId(5));let result=applyAssetResult(changed,r,{assetId:imageId(6)});assert.equal(result.stale,true);assert.throws(()=>action(result.project,'confirm','body',imageId(6)),/过期/);result.project=confirm(result.project,'body',imageId(6));assert.equal(result.project.productionAssets[0].stages.find(s=>s.id==='body').status,'confirmed');
});
test('验证器拒绝循环依赖，人工改分类保留已生成的基础图历史',()=>{
 const a=initializeProductionAsset(asset());a.stages[0].dependencies=['hands'];assert.throws(()=>validateProductionAssets([a]),/循环/);const p=action(ready(),'configure',null,null,{kind:'simple'}),x=p.productionAssets[0];assert.equal(x.workflow.kind,'simple');assert.equal(x.stages.length,1);assert.equal(x.productionHistory[0].stages[0].confirmedAssetId,imageId(1));
});
test('确认后的正式角色卡可显式加入本话参考，基础图不自动入格且不改锁定或手动画格',()=>{
 let p=ready();p.pages=[{panels:[{id:'panel-test',locked:true,referenceIds:[imageId(8)]}]}];const before=structuredClone(p.pages);assert.throws(()=>action(p,'use-reference','face'),/基础图/);assert.throws(()=>action(p,'use-reference','role-card'),/先确认/);
 const request=prepareAssetGeneration(p,{revision:4,assetId:'C001',stageId:'role-card',provider:'codex'},images);p=action(applyAssetResult(p,request,{assetId:imageId(4)}).project,'confirm','role-card',imageId(4));p=action(p,'use-reference','role-card');assert.deepEqual(p.pages,before);assert.equal(p.references.at(-1).assetId,imageId(4));assert.equal(p.references.at(-1).sourceAssetId,'C001');assert.equal(p.references.at(-1).role,'character');assert.equal(p.references.some(r=>r.assetId===imageId(1)),false);const count=p.references.length;p=action(p,'use-reference','role-card');assert.equal(p.references.length,count);
});
test('工程导出列出基础/候选/历史的全部图片，导入重映射保留有效确认且不会将过期图变有效',()=>{
 const p=ready(),ids=collectProductionAssetImageIds(p);assert.deepEqual(ids.sort(),[imageId(1),imageId(2),imageId(3)].sort());const mapping=new Map(images.map((a,i)=>[a.id,imageId(i+101)])),imported=structuredClone(p);imported.references=imported.references.map(r=>({...r,assetId:mapping.get(r.assetId)}));const remapped=remapProductionAssets(p,imported,mapping);assert.equal(remapped.productionAssets[0].stages[0].confirmedAssetId,imageId(101));const newImages=images.map(a=>({...a,id:mapping.get(a.id)}));assert.equal(assetProductionView(remapped,newImages)[0].stages.find(s=>s.id==='hands').status,'confirmed');assert.throws(()=>remapProductionAssets(p,imported,new Map()),/不能完整恢复/);
 const changed=structuredClone(p);changed.style='不兼容新画风';const importedChanged=structuredClone(changed);importedChanged.references=imported.references;const stale=remapProductionAssets(changed,importedChanged,mapping);assert.equal(assetProductionView(stale,newImages)[0].stages[0].status,'stale');
});
test('群像自动使用已确认主要人物作为避免相似的身份对照，不混淆成群像身份锚点',()=>{
 let p=ready();p.productionAssets.push(asset({id:'G001',type:'crowd',name:'差役九人',description:'不同年龄的县衙差役'}));const request=prepareAssetGeneration(p,{revision:4,assetId:'G001',stageId:'crowd-card',provider:'codex'},images);assert.deepEqual(request.referenceIds,[imageId(1),imageId(12)]);assert.match(request.referenceRoles[0].name,/仅用于避免/);assert.match(request.referenceRoles[0].name,/不要复制/);
 p=confirm(p,'face',imageId(5));assert.equal(applyAssetResult(p,request,{assetId:imageId(6)}).stale,true);
});

test('普通人物可手动切主要人物并从脸图开始，已有普通角色卡保留在历史，资料同步不降回普通',()=>{
 let p=project({productionAssets:[asset({name:'小白',episodeNumbers:[],appearanceScopeStatus:'client-estimate'})]});p=confirm(p,'role-card',imageId(1));const original=structuredClone(p.productionAssets[0]);assert.equal(original.workflow.kind,'simple');
 p=action(p,'configure',null,null,{kind:'major'});const selected=p.productionAssets[0];assert.equal(selected.workflow.selection,'manual');assert.equal(selected.workflow.kind,'major');assert.equal(selected.stages[0].id,'face');assert.equal(selected.stages[0].status,'pending');assert.equal(selected.productionHistory[0].stages[0].confirmedAssetId,imageId(1));assert.deepEqual(selected.productionHistory[0].stages[0].candidates,original.stages[0].candidates);
 p.productionAssets=mergeProductionAssets(p.productionAssets,[asset({name:'小白',episodeNumbers:[1],appearanceScopeStatus:'client-estimate',sourceVersion:'重新同步'})]);const refreshed=assetProductionView(p,images)[0];assert.equal(refreshed.workflow.kind,'major');assert.equal(refreshed.workflow.selection,'manual');assert.deepEqual(refreshed.stages.map(s=>s.id),['face','body','hands','role-card']);assert.equal(refreshed.productionHistory[0].stages[0].confirmedAssetId,imageId(1));assert.ok(collectProductionAssetImageIds(p).includes(imageId(1)));
});

test('手动选普通或群像以后，实际参演话数更新也保持用户选择',()=>{
 for(const kind of ['simple','crowd']){let p=action(ready(),'configure',null,null,{kind});p.productionAssets=mergeProductionAssets(p.productionAssets,[asset({episodeNumbers:[11,12,13,14,15],appearanceScopeStatus:'production-observed'})]);const current=assetProductionView(p,images)[0];assert.equal(current.workflow.kind,kind);assert.equal(current.workflow.selection,'manual');assert.equal(current.stages[0].id,kind==='crowd'?'crowd-card':'role-card');assert.ok(current.productionHistory[0].stages.some(s=>s.confirmedAssetId===imageId(1)));}
});
