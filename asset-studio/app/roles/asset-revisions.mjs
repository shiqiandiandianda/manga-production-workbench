import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash}from'node:crypto';
import {ensurePanelGeneration} from '../../../comic/public/panel-generation.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),active=new Set(['queued','running','recoverable','awaiting_confirmation','delegated']);
export function revisionInput(input){
 if(typeof input.notes!=='string'||!input.notes.trim()||input.notes.length>6000)throw Error('请填写1—6000字修改意见');
 if(typeof input.requestId!=='string'||!/^[\w-]{8,180}$/.test(input.requestId))throw Error('修改请求编号无效');
 if(input.strokes!==undefined&&!Array.isArray(input.strokes))throw Error('画笔标注格式无效');const strokes=input.strokes||[];let count=0;
 if(strokes.length>100)throw Error('最多保留100条画笔标注');
 const clean=strokes.map(s=>{if(!s||!Number.isFinite(s.width)||s.width<=0||s.width>.05||!Array.isArray(s.points)||!s.points.length)throw Error('画笔标注无效');count+=s.points.length;if(count>12000)throw Error('标注过于复杂，请减少笔画');return {width:s.width,points:s.points.map(p=>{if(!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1))throw Error('标注坐标超出图片范围');return [...p];})};});
 return {notes:input.notes.trim(),requestId:input.requestId,strokes:clean};
}
const componentLabels={card:'整张资产图',face:'脸部与发型',views:'正面、侧面和背面三视图',front:'正面全身',side:'侧面全身',back:'背面全身',hands:'手部',prop:'道具配饰','scene-front':'场景正视图','scene-reverse':'场景反打'};
const viewSlots=['front','side','back'],handCells={'top-left':'左上格','top-right':'右上格','bottom-left':'左下格','bottom-right':'右下格'};
function handRegion(image,cell){const left=Math.floor(image.width/2),top=Math.floor(image.height/2),x=cell.endsWith('right')?left:0,y=cell.startsWith('bottom')?top:0;return {x,y,w:x?image.width-left:left,h:y?image.height-top:top,sourceWidth:image.width,sourceHeight:image.height};}
export function revisionPrompt(record,notes,marked){const revision=record.revisionOf||{};return ['对当前资产原图做局部修改，输出一张完整的修改后图片。','除修改意见明确要求调整的部分外，保持原图画风、构图、背景、人物身份、服装、头身比和其他内容。不要重新设计整张图。',revision.component&&revision.component!=='card'?'本次只改【'+componentLabels[revision.component]+'】组件；其他拼版组件不参与生成。':'',revision.referenceComponent?'附加的一致性参照图为【'+componentLabels[revision.referenceComponent]+'】。按修改意见从参照中统一胡须（上唇、下巴、两颊的位置、形状、长度和颜色）、帽子、衣领、服装、饰物等指定细节；修改胡须不等于更换五官或年龄，未指定修改的面孔与年龄保持；不要把参照图拼进输出。':'',revision.handCell?'仅输出手图【'+handCells[revision.handCell]+'】这一只手及其手腕、护腕，不输出四手拼图，不加入其他手；按原图比例和朝向修正。':'',revision.component==='views'?'输出横向的正面、四分之三侧面、背面三视图，三栏等宽且人物比例一致。':'',marked?'附加参考图的红色笔画只用于指出问题位置；结合文字意见修改对应部位。保留未圈注区域的内容，最终图不得出现红线、圈注或标记。':'只修改文字意见明确要求的部位，其余内容保持。','资产：'+record.name+(record.outfit?'｜'+record.outfit:''),'修改意见：',notes].filter(Boolean).join('\n');}
export function createProductionRevisions({records,folder,file,load,native,editorJson,coordination,view,refresh,save,image}){
 const pending=new Map();
 async function sourceBytes(record,component,handCell=''){
  if(handCell){if(component!=='hands'||!Object.hasOwn(handCells,handCell))throw Error('单手修改范围无效');const source=await load(await sourceBytes(record,'hands')),r=handRegion(source,handCell),c=native.createCanvas(r.w,r.h);c.getContext('2d').drawImage(source,r.x,r.y,r.w,r.h,0,0,r.w,r.h);return c.toBuffer('image/png');}
  if(component==='views'){
   if(!['front','side','back'].every(k=>fs.existsSync(file(record,k))))throw Error('三视图尚未齐全，请完成后再修改三视图');
   const images=await Promise.all(['front','side','back'].map(k=>load(fs.readFileSync(file(record,k))))),h=Math.min(2400,Math.max(...images.map(im=>im.height))),w=Math.max(Math.ceil(h/2),...images.map(im=>Math.ceil(im.width*h/im.height)));
   const scale=Math.min(1,4096/(w*3)),cw=Math.max(1,Math.floor(w*scale)),ch=Math.max(20,Math.floor(h*scale)),c=native.createCanvas(cw*3,ch),ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);for(const[i,im]of images.entries()){const z=Math.min(cw/im.width,ch/im.height);ctx.drawImage(im,i*cw+(cw-im.width*z)/2,(ch-im.height*z)/2,im.width*z,im.height*z);}return c.toBuffer('image/png');
  }
  if(!['card','face','front','side','back','hands','prop','scene-front','scene-reverse'].includes(component))throw Error('修改组件无效');
  const slot=component==='card'?(fs.existsSync(file(record,'card'))?'card':record.legacy?'free':'card'):component;
  if(!fs.existsSync(file(record,slot)))throw Error('所选图片尚未生成，暂时不能修改');return fs.readFileSync(file(record,slot));
 }
 async function revise(parent,input){
  const clean=revisionInput(input),key=parent.id+':'+clean.requestId;
  if(pending.has(key))return pending.get(key);
  const previous=records.find(r=>r.revisionOf?.recordId===parent.id&&r.revisionOf.requestId===clean.requestId);if(previous)return view(await refresh(previous));
  const operation=(async()=>{
   if(active.has(parent.status)||Object.values(parent.phases||{}).some(p=>active.has(p.status)))throw Error('这项资产仍在生成，请完成后再提交修改');
   const component=parent.type==='scene'?(input.component||'scene-front'):parent.type==='character'?(input.component||'card'):'card',separate=parent.type==='character'&&component!=='card',individualView=viewSlots.includes(component),handCell=input.handCell||'';
   if(handCell&&(component!=='hands'||!Object.hasOwn(handCells,handCell)))throw Error('单手修改范围无效');
   if(parent.type==='scene'&&!['scene-front','scene-reverse'].includes(component))throw Error('请选择要修改的场景视图');
   if(separate&&(!['face','views','front','side','back','hands','prop'].includes(component)||parent.characterOutputMode==='card'||!(parent.components||[]).includes(individualView?'views':component)))throw Error('这张记录没有所选独立组件，请选择整张资产图');
   const referenceComponent=input.referenceComponent||'';if(referenceComponent&&(parent.type!=='character'||!['face','views','front','side','back','hands','prop'].includes(referenceComponent)||referenceComponent===component&&!handCell))throw Error('一致性参照组件无效');
   const bytes=await sourceBytes(parent,component,handCell),sourceHash=hash(bytes),referenceBytes=referenceComponent?await sourceBytes(parent,referenceComponent):null,handBase=handCell?await sourceBytes(parent,'hands'):null;
   if(input.sourceUpdatedAt!==undefined&&input.sourceUpdatedAt!==(parent.updatedAt||parent.createdAt))throw Error('原图已有更新，请重新打开修改意见');
   if(input.sourceSha256&&input.sourceSha256!==sourceHash)throw Error('原图已有更新，请重新打开修改意见');
   const duplicate=records.find(r=>r.revisionOf?.recordId===parent.id&&r.revisionOf.sourceSha256===sourceHash&&r.revisionOf.notes===clean.notes&&r.revisionOf.component===component&&(r.revisionOf.handCell||'')===handCell&&(r.revisionOf.referenceComponent||'')===referenceComponent&&JSON.stringify(r.revisionOf.strokes)===JSON.stringify(clean.strokes)&&(active.has(r.status)||r.teamPendingSubmissions&&Object.keys(r.teamPendingSubmissions).length));if(duplicate)return view(await refresh(duplicate));
   if(records.some(r=>r.revisionOf?.recordId===parent.id&&(active.has(r.status)||r.revisionOf.submissionState==='uncertain')))throw Error('这张原图已有修改任务，请先查看原修改记录的进度');
   const base=await load(bytes),width=base.width,height=base.height;if(width<20||width>4096||height<20||width*height>100000000)throw Error('所选图片尺寸暂不支持直接修改');
   const createdAt=new Date().toISOString(),target=parent.type==='character'?(separate?(individualView?'views':component):'role-card'):parent.type==='scene'?component:'prop';
   const r={id:'production_'+randomUUID(),requestId:clean.requestId,name:parent.name,type:parent.type,outfit:parent.outfit||'',prompt:parent.prompt||'',projectId:parent.projectId,source:structuredClone(parent.source||null),referenceIds:[],status:'queued',createdAt,jobs:{},phases:{},finished:[],slots:{},components:parent.type==='scene'?[...(parent.components||['scene-front'])]:[target],...(parent.type==='character'?{characterOutputMode:'card',characterRole:parent.characterRole||'auto',appearanceNotes:parent.appearanceNotes||''}:{}),...(parent.type==='scene'?{sceneOutputMode:parent.sceneOutputMode||'both',sceneReverseSubmitted:true,sceneMeta:structuredClone(parent.sceneMeta||{})}:{})};
   if(separate){r.characterOutputMode='components';r.components=[...parent.components];}
   if(parent.boardTitle)r.boardTitle=parent.boardTitle;
   r.assetId='card_'+r.id;r.revisionOf={version:3,recordId:parent.id,component,handCell,referenceComponent,referenceSha256:referenceBytes?hash(referenceBytes):null,sourceSha256:sourceHash,sourceUpdatedAt:parent.updatedAt||parent.createdAt,...clean,createdAt};
   fs.mkdirSync(path.join(folder,r.id),{recursive:true});
   if(parent.type==='scene')for(const slot of ['scene-front','scene-reverse'])if(fs.existsSync(file(parent,slot))){image(r,slot,fs.readFileSync(file(parent,slot)));if(slot!==component)r.finished.push(slot);}
   if(separate){for(const slot of ['face','front','side','back','hands','prop'])if(fs.existsSync(file(parent,slot))){image(r,slot,fs.readFileSync(file(parent,slot)));for(const k of ['zoom','ox','oy'])if(Number.isFinite(parent.slots?.[slot]?.[k]))r.slots[slot][k]=parent.slots[slot][k];}r.finished=parent.components.filter(k=>k!==target&&(k==='views'?['front','side','back'].every(v=>r.slots[v]):!!r.slots[k]));}
   if(handBase){fs.writeFileSync(path.join(folder,r.id,'revision-hands-base.png'),handBase);r.revisionOf.handBaseSha256=hash(handBase);r.revisionOf.region=handRegion(await load(handBase),handCell);}else image(r,individualView?component:target,bytes);
   fs.writeFileSync(file(r,'card'),fs.existsSync(file(parent,'card'))?fs.readFileSync(file(parent,'card')):bytes);r.width=parent.width||width;r.height=parent.height||height;
   records.push(r);save();
   let jobSubmissionStarted=false;
   try{return await coordination.run(r,async()=>{
    const canvas=native.createCanvas(width,height),ctx=canvas.getContext('2d');ctx.drawImage(base,0,0);const basePng=canvas.toBuffer('image/png'),snapshot=path.join(folder,r.id,'revision-base-'+sourceHash+'.png');fs.writeFileSync(snapshot,basePng);
    const registered=await editorJson('/api/assets',{method:'POST',body:{filePath:snapshot,name:r.name+' · 修改原图'}}),refs=[],registeredAssets=[registered],referenceFiles=[snapshot];
    if(referenceBytes){const reference=path.join(folder,r.id,'revision-consistency.png');fs.writeFileSync(reference,referenceBytes);const a=await editorJson('/api/assets',{method:'POST',body:{filePath:reference,name:r.name+' · '+componentLabels[referenceComponent]+'一致性参照'}});refs.push(a.id);registeredAssets.push(a);referenceFiles.push(reference);r.revisionOf.referenceAssetId=a.id;}
    if(clean.strokes.length){ctx.strokeStyle='#ff3030';ctx.fillStyle='#ff3030';ctx.lineCap='round';ctx.lineJoin='round';for(const stroke of clean.strokes){ctx.lineWidth=Math.max(1,stroke.width*width);ctx.beginPath();for(const[i,p]of stroke.points.entries()){if(!i)ctx.moveTo(p[0]*width,p[1]*height);else ctx.lineTo(p[0]*width,p[1]*height);}if(stroke.points.length===1){ctx.arc(stroke.points[0][0]*width,stroke.points[0][1]*height,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}else ctx.stroke();}
     const marked=path.join(folder,r.id,'revision-annotation.png');fs.writeFileSync(marked,canvas.toBuffer('image/png'));const a=await editorJson('/api/assets',{method:'POST',body:{filePath:marked,name:r.name+' · 修改位置标注'}});refs.push(a.id);registeredAssets.push(a);referenceFiles.push(marked);r.revisionOf.annotationAssetId=a.id;}
    r.revisionOf.sourceAssetId=registered.id;r.referenceIds=[registered.id,...refs];
    for(const[i,source]of referenceFiles.entries())fs.copyFileSync(source,file(r,'reference'+i));
    const project=await editorJson('/api/projects/'+r.projectId),shotId='shot_'+randomUUID(),panelId='panel_'+randomUUID(),pageId='page_'+randomUUID(),prompt=revisionPrompt(r,clean.notes,!!clean.strokes.length);
    project.shots.push({id:shotId,code:'REV-'+r.id.slice(-8),title:r.name+' · 修改',description:prompt,productionPrompt:prompt,dialogue:'',referenceIds:refs});
    project.pages.push({id:pageId,name:('资产修改 · '+r.name).slice(0,180),width:project.layerSchema===1?1280:Math.max(320,width),height,background:'#ffffff',storyboard:{episode:0,projection:'asset'},panels:[{id:panelId,shotId,name:'修改图',x:0,y:0,w:width,h:height,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],kind:'panel',border:0,borderColor:'#111111',feather:0,visible:true,locked:false,candidates:[],imageAssetId:registered.id,imageTransform:{x:0,y:0,scale:1},referenceIds:refs,generation:{version:1,promptSource:'imported',referenceRoles:refs.map(assetId=>({assetId,role:'style',name:assetId===r.revisionOf.referenceAssetId?'组件一致性参照':'红笔修改位置标注'}))}}],bubbles:[]});
    if(Array.isArray(project.layerOrder))project.layerOrder.push(panelId);
    ensurePanelGeneration(project,project.pages.at(-1).panels[0],registeredAssets);
    await editorJson('/api/projects/'+r.projectId,{method:'PUT',body:project,timeout:60000});r.revisionOf.pageId=pageId;r.revisionOf.panelId=panelId;save();
    jobSubmissionStarted=true;const jobs=await coordination.submit(r,target,'/api/jobs',{method:'POST',body:{projectId:r.projectId,panelIds:[panelId],provider:'codex',action:'edit',editPrompt:prompt,basePanelDataUrl:'data:image/png;base64,'+basePng.toString('base64'),baseRegion:{x:0,y:0,w:width,h:height}},timeout:60000},{panelId});
    if(!jobs?.[0]?.id)throw Error('修改任务提交状态待核实，请查看原记录，不要重复提交');r.jobs[target]=jobs[0].id;r.revisionOf.submissionState='submitted';r.phases[target]={jobId:jobs[0].id,status:jobs[0].status||'queued',message:'按修改意见与画笔标注处理'};r.generatedPrompts={[target]:{prompt,referenceIds:r.referenceIds,createdAt}};r.status='running';save();return view(r);
   },clean.requestId);}catch(error){r.status='failed';r.error=error.message;r.revisionOf.submissionState=!jobSubmissionStarted||error.status>=400&&error.status<500?'rejected':'uncertain';save();throw error;}
  })();pending.set(key,operation);try{return await operation;}finally{pending.delete(key);}
 }
 async function applyResult(record,component,bytes){const revision=record.revisionOf;if(!revision)return false;
  if(component==='views'&&viewSlots.includes(revision.component)){image(record,revision.component,bytes);return true;}
  if(component==='hands'&&revision.handCell){const original=fs.readFileSync(path.join(folder,record.id,'revision-hands-base.png'));if(hash(original)!==revision.handBaseSha256)throw Error('手图原件快照已改变，未替换任何手部图片');const base=await load(original),r=revision.region;if(!r||![r.x,r.y,r.w,r.h].every(Number.isInteger)||r.x<0||r.y<0||r.w<=0||r.h<=0||r.x+r.w>base.width||r.y+r.h>base.height)throw Error('单手回填区域无效');const result=await load(bytes),canvas=native.createCanvas(base.width,base.height),ctx=canvas.getContext('2d');ctx.drawImage(base,0,0);ctx.clearRect(r.x,r.y,r.w,r.h);ctx.drawImage(result,r.x,r.y,r.w,r.h);fs.writeFileSync(path.join(folder,record.id,'revision-result-raw.png'),bytes);image(record,'hands',canvas.toBuffer('image/png'));return true;}return false;
 }
 return {revise,sourceBytes,applyResult};
}
