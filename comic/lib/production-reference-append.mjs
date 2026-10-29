// Append already adopted fixed-version cards; never modify an existing slot.
const fail=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{status:409});};
export function appendAdoptedProductionReferences(project,segment,choices,{episode,assets,makeBinding,isUnavailable=()=>false}){
 fail(Number.isInteger(episode)&&segment.episode===episode,'追加参考的话数不符');
 fail(Array.isArray(choices)&&choices.length>0&&choices.length<=60,'追加参考清单无效');
 const segments=project.productionPackage.episodes.flatMap(e=>e.segments);
 const plans=[];
 for(const choice of choices){
  const source=segments.find(s=>s.id===choice.sourceSegmentId);
  let ref=source?.references.find(r=>r.slot===choice.sourceSlot);
  if(choice.sourcePanelId){
   const panel=project.pages?.flatMap(p=>p.panels).find(p=>p.id===choice.sourcePanelId);
   fail(panel?.productionGrid?.segmentId===segment.id&&panel.referenceIds?.includes(choice.assetId),'来源必须是本屏已经选用的单格参考');
   const role=panel.generation?.referenceRoles?.find(r=>r.assetId===choice.assetId);
   fail(role&&['character','scene','prop'].includes(role.role),'来源单格参考缺少明确类型');
   const selected=Object.values(panel.referenceNeedBindings||{}).find(b=>b.assetId===choice.assetId);
   const name=String(selected?.name||role.name||'').replace(/身份参考\d+$/u,'');
   const binding=makeBinding(choice.assetId);
   if(selected)fail((!selected.revisionId||selected.revisionId===binding.revisionId)&&(!selected.sha256||selected.sha256===binding.sha256),'单格采用版本已改变');
   ref={slot:-1,'类型':role.role==='character'?'设定卡':role.role==='scene'?'场景':'道具','人物':role.role==='character'?name:'','名称':name,'服装':selected?.state||'','必须':true,binding,skipped:false};
  }else fail(source&&source.id!==segment.id,'来源屏段无效');
  fail(ref&&!ref.skipped&&ref.binding,'来源必须是工程内已采用的图片槽位');
  fail(['设定卡','场景','道具'].includes(ref['类型']),'仅支持追加人物、场景或道具');
  const b=ref.binding,asset=assets.find(a=>a.id===b.assetId);
  fail(asset&&!['rejected','pending'].includes(asset.inspection)&&!isUnavailable(asset),'来源图片不可用或未确认');
  fail(asset.library?.revisionId===b.revisionId&&asset.library?.sha256===b.sha256,'来源固定版本已改变');
  fail(choice.assetId===b.assetId&&choice.revisionId===b.revisionId&&choice.sha256===b.sha256,'追加请求的固定版本不符');
  fail(ref['类型']!=='设定卡'||String(ref['人物']||'').trim(),'人物缺少明确身份');
  const name=ref['人物']||ref['名称'];
  fail(name,'参考缺少明确名称');
  const same=segment.references.find(r=>r.binding?.assetId===b.assetId);
  if(same){fail((same['人物']||same['名称'])===name,'同图对应的资产身份不一致');continue;}
  fail(!segment.references.some(r=>(r['人物']||r['名称'])===name),'本屏已有该身份的槽位，请核对现有选择');
  fail(!plans.some(r=>r.binding.assetId===b.assetId||(r['人物']||r['名称'])===name),'追加清单重复');
  plans.push(structuredClone(ref));
 }
 fail(segment.references.filter(r=>r.binding&&!r.skipped).length+plans.length<=60,'附图超过60张');
 let slot=Math.max(-1,...segment.references.map(r=>r.slot))+1;
 for(const ref of plans){ref.slot=slot++;segment.references.push(ref);}
 return plans.length;
}
