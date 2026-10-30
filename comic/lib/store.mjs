import {validDialogueSegments} from '../public/bubble-dialogue-segments.js';
import {validTextAssetBindings} from '../public/asset-text-references.js';
import {validPromptOverrides} from '../public/prompt-source.js';
import {validOutfitOverrides} from '../public/episode-outfit.js';
import {validateEpisodeBoards} from '../public/episode-boards.js';
import {validateProductionPackage} from '../public/production-package-model.js';
import {validateSliceRegion} from '../public/panel-slices.js';
import {normalizeArtDirection} from '../public/comic-art-direction.js';
import {normalizeNativeSizing} from '../public/native-image-sizing.js';
import {validateBreakoutMetadata} from './breakout-production.mjs';
import {validateProductionAssets} from './asset-production.mjs';
import {WORKSPACE_REFERENCE_LIMIT} from '../public/panel-references.js';
import {validateShotSettings} from '../public/shot-settings.js';
import {allLayers} from '../public/layers.js';
import {validPanelEffects} from '../public/panel-effects.js';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {writeFileAtomicSync} from './durable-files.mjs';
import {readPendingPurges,filterPurgedIndex,finishPendingPurge} from './project-purge.mjs';
import {validPolygon} from "../public/model.js";
import {BUBBLE_TYPES,BUBBLE_SHAPES,FONT_FAMILIES,BUBBLE_TEXT_ALIGNS,BUBBLE_TAIL_SIDES,validBubblePoints} from '../public/lettering.js';
import {canonicalBubbleTail} from '../public/bubble-tail-compat.js';
import {validBubbleParts} from '../public/bubble-parts.js';
import {validBubbleRays} from '../public/bubble-rays.js';
import {validBubbleFrame} from '../public/bubble-frame.js';
import {validAssetContour} from '../public/comic-styles.js';
export const uid=prefix=>`${prefix}_${randomUUID()}`;
export function check(condition,message,status=400){if(!condition){const error=new Error(message);error.status=status;throw error;}}
export function cleanId(value){check(typeof value==='string'&&/^[a-z]+_[0-9a-f-]{36}$/.test(value),'编号无效');return value;}
// 数据存储（分片）：
//  - studio.json        索引：版本、素材、任务、版式库等，以及工程顺序 projectOrder（紧凑 JSON）
//  - projects/<id>.json 每个工程一个文件（紧凑 JSON）
// 内存里仍是同一个 store.db（含 projects 数组），其余代码不用改。保存时只重写有变化的工程文件；
// 旧版单文件 studio.json 首次启动时自动拆分，原文件另存为 studio.json.v1-backup。
const STORAGE_VERSION=2,BACKUP_INTERVAL_MS=10*60*1000,SCRUB_INTERVAL_MS=2000,SCRUB_BUDGET_MS=12;
const digest=text=>createHash('sha1').update(text).digest('hex');
const projectFileName=id=>{cleanId(id);return id+'.json';};
export class Store {
  constructor(root){
    this.root=root;fs.mkdirSync(root,{recursive:true});this.pendingPurges=readPendingPurges(root);
    this.file=path.join(root,'studio.json');this.projectDir=path.join(root,'projects');
    this.meta=new Map();this.dirty=new Set();this.indexHash=null;this.lastSaveError=null;this.retryTimer=null;this.scrubCursor=0;this.lastIndexBackup=0;
    if(fs.existsSync(this.file)){
      let saved;try{saved=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(error){throw new Error('工程数据无法读取，原文件已保留：'+error.message);}
      saved=filterPurgedIndex(saved,this.pendingPurges);
      if(saved?.storage===STORAGE_VERSION)this.db=this.loadSharded(saved);
      else{this.db=saved;this.legacy=true;}
    }else this.db={version:1,projects:[],assets:[],jobs:[],layouts:[]};
    check(this.db.version===1&&Array.isArray(this.db.projects)&&Array.isArray(this.db.jobs),'工程版本不受支持');
    if(this.legacy){
      // 旧版单文件：先完整备份，再拆分。拆分失败时原文件保持不变。
      const backup=this.file+'.v1-backup';if(!fs.existsSync(backup))fs.copyFileSync(this.file,backup);
      for(const project of this.db.projects)this.dirty.add(project.id);
    }
    for(const asset of this.db.assets){asset.filePath||=path.resolve(this.root,'assets',asset.id+asset.extension);asset.storage='path';}
    for(const job of this.db.jobs){
      // A queued job never reached the provider, so keeping it queued is safe and
      // prevents an auto-update restart from destroying the whole waiting batch.
      if(job.status==='queued'&&job.kind!=='collab-generation'){job.phase='queued';job.requiredAction=null;job.message='服务重启前尚未开始，已保留在队列；可继续或取消';job.updated=new Date().toISOString();continue;}
      if(job.status==='queued'||job.status==='running'){job.status=job.provider==='jimeng'&&job.recovery?.operationRef?'recoverable':'failed';job.message=job.provider==='jimeng'?'上次即梦任务被中断，请查询原任务恢复；请勿重新提交以免重复扣费。':'上次任务被中断，可重新生成；已有素材保留。';job.updated=new Date().toISOString();}
    }
    this.save();
    if(this.lastSaveError){clearTimeout(this.retryTimer);throw new Error('工程数据无法写入：'+this.lastSaveError);}
    delete this.legacy;
    for(const record of this.pendingPurges.values())try{finishPendingPurge(this,record);}catch(error){console.error('项目彻底删除尚未完成，可在项目管理中重试：'+error.message);}
    this.scrubTimer=setInterval(()=>this.scrub(SCRUB_BUDGET_MS),SCRUB_INTERVAL_MS);this.scrubTimer.unref?.();
  }
  loadSharded(index){
    const projects=[],loaded=new Set(),order=Array.isArray(index.projectOrder)?index.projectOrder:[];
    const read=id=>{
      const file=path.join(this.projectDir,projectFileName(id));let text;
      try{text=fs.readFileSync(file,'utf8');}catch(error){if(error.code==='ENOENT')throw new Error('工程文件缺失：projects/'+id+'.json；请从备份恢复，原数据保持不变');throw error;}
      let project;try{project=JSON.parse(text);}catch(error){throw new Error('工程文件无法读取：projects/'+id+'.json，原文件已保留：'+error.message);}
      check(project?.id===id,'工程文件编号不一致：projects/'+id+'.json');
      projects.push(project);loaded.add(id);this.meta.set(id,this.stamp(project,digest(JSON.stringify(project))));
    };
    for(const id of order)if(!loaded.has(id))read(id);
    // 写完工程文件、尚未写入索引时断电：把多出来的工程文件也读回来，避免丢失新工程。
    let names=[];try{names=fs.readdirSync(this.projectDir);}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const name of names.filter(n=>/^[a-z]+_[0-9a-f-]{36}\.json$/.test(n)).sort()){const id=name.slice(0,-5);if(!loaded.has(id)&&!this.pendingPurges.has(id)){read(id);this.dirty.add(id);}}
    const {storage,projectOrder,...rest}=index;
    this.indexHash=null;
    return {...rest,projects};
  }
  stamp(project,hash){return {object:project,revision:project.revision,updated:project.updated,deletedAt:project.deletedAt,hash};}
  /** 标记一个在原对象上直接修改、但没有更新 revision/updated 的工程，下次保存时写盘。 */
  markProject(project){const id=typeof project==='string'?project:project?.id;if(id)this.dirty.add(id);}
  changed(project){
    const meta=this.meta.get(project.id);
    return !meta||this.dirty.has(project.id)||meta.object!==project||meta.revision!==project.revision||meta.updated!==project.updated||meta.deletedAt!==project.deletedAt;
  }
  writeProject(project,text=JSON.stringify(project)){
    const hash=digest(text),meta=this.meta.get(project.id);
    if(meta?.hash!==hash){
      fs.mkdirSync(this.projectDir,{recursive:true});
      const file=path.join(this.projectDir,projectFileName(project.id));
      try{if(fs.existsSync(file)&&Date.now()-fs.statSync(file).mtimeMs>BACKUP_INTERVAL_MS)fs.copyFileSync(file,file+'.bak');}catch{}
      writeFileAtomicSync(file,text);
    }
    this.meta.set(project.id,this.stamp(project,hash));this.dirty.delete(project.id);
  }
  /** Publish an editor revision in memory only after its existing shard is written.
   * A failed write leaves the old revision retryable by the same client. */
  replaceProject(previous,next,{commit=()=>{}}={}){
    const index=this.db.projects.indexOf(previous);
    check(index>=0&&previous.id===next.id,'工程已改变，请重新载入',409);
    try{this.writeProject(next);}catch(error){
      this.lastSaveError=error.message;
      throw Object.assign(new Error('工程尚未保存到本机，请检查磁盘空间或文件占用后重试：'+error.message),{status:503,code:'storage_write_failed'});
    }
    this.db.projects[index]=next;commit();
    check(this.save(),'工程文件已写入，但共享模板或任务索引尚未保存，请保留窗口并重试',503);
    return next;
  }
  // Progress messages change many times per image. Coalescing them keeps the event loop free.
  // Status changes still call save() directly.
  saveSoon(delay=1000){if(this.saveTimer)return;this.saveTimer=setTimeout(()=>{this.saveTimer=null;this.save();},delay);this.saveTimer.unref?.();}
  /** 关闭前把所有工程与内存逐一核对一遍再写盘。 */
  flush(){this.scrub(Infinity);this.save();}
  /** 只写有变化的工程文件和索引。写盘失败不会抛出到调用方：记录原因，稍后自动重试。 */
  save(){
    if(this.saveTimer){clearTimeout(this.saveTimer);this.saveTimer=null;}
    const errors=[],order=[],live=new Set();
    for(const project of this.db.projects){
      order.push(project.id);live.add(project.id);
      if(this.changed(project))try{this.writeProject(project);}catch(error){errors.push(error);}
    }
    for(const id of [...this.meta.keys()])if(!live.has(id)){
      // Unplanned removals remain recoverable; explicit purge removes its metadata first.
      try{const from=path.join(this.projectDir,projectFileName(id)),to=path.join(this.projectDir,'removed');fs.mkdirSync(to,{recursive:true});if(fs.existsSync(from))fs.renameSync(from,path.join(to,id+'-'+Date.now()+'.json'));this.meta.delete(id);}catch(error){errors.push(error);}
    }
    const {projects,...rest}=this.db,text=JSON.stringify({version:rest.version,storage:STORAGE_VERSION,projectOrder:order,...rest});
    const hash=digest(text);
    if(!errors.length&&hash!==this.indexHash)try{
      if(fs.existsSync(this.file)&&Date.now()-this.lastIndexBackup>BACKUP_INTERVAL_MS&&!this.legacy){fs.copyFileSync(this.file,this.file+'.bak');this.lastIndexBackup=Date.now();}
      writeFileAtomicSync(this.file,text);this.indexHash=hash;
    }catch(error){errors.push(error);}
    if(errors.length){
      this.lastSaveError=errors[0].message;console.error('工程数据暂时无法写盘，稍后自动重试：'+this.lastSaveError);
      if(!this.retryTimer){this.retryTimer=setTimeout(()=>{this.retryTimer=null;this.save();},1000);this.retryTimer.unref?.();}
    }else this.lastSaveError=null;
    return errors.length===0;
  }
  /** 兜底核对：少数代码直接改工程对象而不更新版本号，这里分批比对内容，有差异就补写。 */
  scrub(budgetMs){
    const projects=this.db.projects;if(!projects.length)return 0;
    const started=performance.now();let found=0;
    for(let n=0;n<projects.length&&(n===0||performance.now()-started<budgetMs);n++){
      const project=projects[this.scrubCursor++%projects.length];
      if(this.changed(project))continue;
      const text=JSON.stringify(project);
      if(digest(text)!==this.meta.get(project.id)?.hash){found++;try{this.writeProject(project,text);}catch(error){this.dirty.add(project.id);this.lastSaveError=error.message;if(!this.retryTimer){this.retryTimer=setTimeout(()=>{this.retryTimer=null;this.save();},1000);this.retryTimer.unref?.();}}}
    }
    return found;
  }
  /** 工程的内容戳：内容写盘后才变化，状态接口据此只返回有变化的工程。 */
  projectStamp(id){return this.meta.get(id)?.hash||null;}
  close(){clearInterval(this.scrubTimer);clearTimeout(this.retryTimer);clearTimeout(this.saveTimer);}
  project(id){const p=this.db.projects.find(p=>p.id===id&&!p.deletedAt);check(p,'工程不存在',404);this.dirty.add(p.id);return p;}
  asset(id){const a=this.db.assets.find(a=>a.id===id);check(a,'图片不存在',404);return a;}
  assetPath(id){const a=this.asset(cleanId(id));return a.filePath||path.resolve(this.root,'assets',a.id+a.extension);}
}
const string=(v,max=20000)=>typeof v==='string'&&v.length<=max;
const number=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
const color=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
const safeVertical=(y,height,minHeight)=>number(y,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER)&&number(height,minHeight,Number.MAX_SAFE_INTEGER)&&number(y+height,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER);
export function validateProject(project) {
  check(validOutfitOverrides(project?.characterOutfitOverrides),'本话服装覆盖记录无效');
  if(project?.productionPackage)validateProductionPackage(project);
  check(project&&string(project.title,180)&&project.title.trim(),'请填写工程名称');cleanId(project.id);
  if(project.assetLibrary!==undefined){
    const library=project.assetLibrary;check(library&&library.version===1&&Array.isArray(library.assetIds)&&library.assetIds.length<=100000&&new Set(library.assetIds).size===library.assetIds.length,'项目资产清单无效');library.assetIds.forEach(cleanId);
    check(Array.isArray(library.directories)&&library.directories.length<=20&&library.directories.every(value=>string(value,32768)&&value.trim()),'项目资产目录无效');
    check(library.manualAssetIds===undefined||(Array.isArray(library.manualAssetIds)&&library.manualAssetIds.every(id=>library.assetIds.includes(id))),'手动资产清单无效');
  }
  validateEpisodeBoards(project);
  check(string(project.style)&&Array.isArray(project.shots)&&project.shots.length<=(project.storyboardImport?8000:800),'镜头或画风数据无效');
  let maskPointTotal=0;const shotIds=new Set(),allIds=new Set([project.id]);
  const unique=id=>{cleanId(id);check(!allIds.has(id),'工程里出现重复编号');allIds.add(id);};
  for(const shot of project.shots){validateShotSettings(shot);unique(shot.id);shotIds.add(shot.id);check(string(shot.code,80)&&string(shot.title,180)&&string(shot.description)&&string(shot.dialogue,4000),'分镜字段无效');check(shot.embeddedTexts===undefined||(Array.isArray(shot.embeddedTexts)&&shot.embeddedTexts.length<=100&&shot.embeddedTexts.every(item=>typeof item==='string'?string(item,2000):item&&typeof item==='object'&&!Array.isArray(item)&&string(item.text,2000)&&(item.type===undefined||string(item.type,40))&&(item.placement===undefined||string(item.placement,1000)))&&JSON.stringify(shot.embeddedTexts).length<=20000),'图内文字需要有效文本且总量不超过限制');check(Array.isArray(shot.referenceIds)&&shot.referenceIds.length<=10,'镜头参考图片过多');shot.referenceIds.forEach(cleanId);}
  if(project.speakerAvatars!==undefined){check(project.speakerAvatars&&typeof project.speakerAvatars==='object'&&!Array.isArray(project.speakerAvatars)&&Object.keys(project.speakerAvatars).length<=500,'说话人头像数据无效');for(const [name,assetId] of Object.entries(project.speakerAvatars)){check(string(name,180)&&name.trim(),'头像需要说话人姓名');cleanId(assetId);}}
  check(Array.isArray(project.references)&&project.references.length<=60,'参考图片数据无效');
  for(const ref of project.references){cleanId(ref.assetId);check(['character','scene','style','prop'].includes(ref.role)&&string(ref.name,180),'参考图片类型无效');}
  const pageLimit=project.productionPackage?1000:100;
  check(Array.isArray(project.pages)&&project.pages.length>0&&project.pages.length<=pageLimit,'工程需要 1—'+pageLimit+' 张画板'+(project.productionPackage?'（制作资料一屏一画板）':''));
  function validateBubble(bubble,page,archived=false){
      unique(bubble.id);if(bubble.localReplacement!==undefined){const r=bubble.localReplacement;check(r?.version===1&&/^[a-f0-9-]{36}$/.test(r.taskId||''),'本地气泡替换记录无效');cleanId(r.patchLayerId);}check(archived||bubble.parentPanelId===undefined||page.panels.some(f=>f.id===bubble.parentPanelId),'气泡所属格子不存在');check(bubble.name===undefined||string(bubble.name,120),'图层名称无效');
      check(string(bubble.text,4000)&&BUBBLE_TYPES.includes(bubble.type)&&number(bubble.x,-page.width,page.width*2)&&safeVertical(bubble.y,bubble.h,20)&&number(bubble.w,30,page.width*2)&&number(bubble.fontSize,10,2048)&&typeof bubble.visible==='boolean','对白图层无效');
      check(validDialogueSegments(bubble),'双圆气泡的独立台词或文字区域无效');
      const optional=(key,valid)=>bubble[key]===undefined||valid(bubble[key]);
      check(optional('shape',value=>BUBBLE_SHAPES.includes(value))&&optional('points',validBubblePoints)&&optional('assetContour',validAssetContour)&&optional('assetParts',validBubbleParts)&&optional('assetRays',validBubbleRays)&&optional('assetFrame',validBubbleFrame)&&optional('assetTailKind',value=>['straight','curved','lightning'].includes(value))&&optional('assetInsets',value=>value&&['left','right','top','bottom'].every(key=>number(value[key],0,.45))&&value.left+value.right<.95&&value.top+value.bottom<.95)&&optional('outlineWidth',value=>number(value,0,256))&&optional('outlineColor',color)&&optional('fillColor',color)&&optional('fillOpacity',value=>number(value,0,1))&&optional('textColor',color),'对白图层无效：气泡轮廓或颜色参数无效');
      if(bubble.shape==='asset')check(validAssetContour(bubble.assetContour),'素材气泡缺少有效的可编辑轮廓');
      check(optional('lineBreakMode',value=>['auto','explicit'].includes(value))&&optional('writingMode',value=>['horizontal','vertical'].includes(value))&&optional('textDirection',value=>['ltr','rtl'].includes(value))&&optional('fontFamily',value=>typeof value==='string'&&Object.hasOwn(FONT_FAMILIES,value))&&optional('fontWeight',value=>Number.isInteger(value)&&value>=100&&value<=900&&value%100===0)&&optional('lineHeight',value=>number(value,.8,3))&&optional('letterSpacing',value=>number(value,-128,256))&&optional('textAlign',value=>BUBBLE_TEXT_ALIGNS.includes(value))&&optional('padding',value=>number(value,0,4096))&&optional('overflow',value=>['visible','fit','expand'].includes(value))&&optional('locked',value=>typeof value==='boolean'),'对白图层无效：文字外观参数无效');
      if(bubble.textBox!==undefined){const box=bubble.textBox;check(box&&number(box.x,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER)&&number(box.y,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER)&&number(box.w,1,Number.MAX_SAFE_INTEGER)&&number(box.h,1,Number.MAX_SAFE_INTEGER),'对白图层无效：独立文字框坐标无效');}
      if(bubble.tail!==undefined){
        const canonical=canonicalBubbleTail(bubble);if(canonical)bubble.tail=canonical;
        const tail=bubble.tail,normalized=tail?.mode==='normalized',limit=normalized?3:Number.MAX_SAFE_INTEGER,min=normalized?-2:-Number.MAX_SAFE_INTEGER;
        check(tail&&typeof tail==='object'&&((tail.x===undefined&&tail.y===undefined)||(number(tail.x,min,limit)&&number(tail.y,min,limit)))&&(tail.mode===undefined||['absolute','normalized'].includes(tail.mode))&&(tail.side===undefined||BUBBLE_TAIL_SIDES.includes(tail.side))&&(tail.base===undefined||number(tail.base,.1,.9))&&(tail.anchorT===undefined||number(tail.anchorT,0,1))&&(tail.width===undefined||number(tail.width,.01,.8))&&(tail.visible===undefined||typeof tail.visible==='boolean'),'对白图层无效：尾尖参数无效');
      }
  }
  for(const page of project.pages){
    unique(page.id);check(string(page.name,180)&&number(page.width,320,4096)&&(Number.isSafeInteger(page.height)&&page.height>=1)&&color(page.background),'长图尺寸或底色无效');
    check(Array.isArray(page.panels)&&page.panels.length<=1000&&Array.isArray(page.bubbles)&&page.bubbles.length<=3200,'长图图层过多');
    for(const panel of page.panels)check(validPromptOverrides(panel.generation?.promptOverrides),'本格修改提示词无效：每种模式最多20000字');
    for(const panel of page.panels){unique(panel.id);if(panel.panelSlice!==undefined){const s=panel.panelSlice;check(s?.version===1&&/^[a-f0-9]{64}$/.test(s.sourceHash||'')&&/^[a-f0-9]{64}$/.test(s.key||'')&&string(s.panelId,120)&&string(s.segmentId,120)&&validateSliceRegion(s.region),'裁格来源记录无效');cleanId(s.rootPanelId);cleanId(s.sourceAssetId);}if(panel.cutoutLayer!==undefined){const c=panel.cutoutLayer;check(c&&c.version===1&&page.panels.some(f=>f.id===c.parentPanelId&&f.id!==panel.id&&!f.cutoutLayer),'抠图层缺少同画板原画格');cleanId(c.parentPanelId);cleanId(c.sourceAssetId);check(typeof c.sessionId==='string'&&/^[a-f0-9-]{36}$/i.test(c.sessionId),'抠图会话无效');if(c.kind==='upscale')check(number(c.scale,1,1000000)&&number(c.width,1,1000000)&&number(c.height,1,1000000)&&string(c.model,160),'高清图层参数无效');else if(c.kind!==undefined)check(['repair-patch','selected-cutout'].includes(c.kind)&&/^[a-f0-9-]{36}$/.test(c.taskId||''),'本地补图图层参数无效');}if(panel.localRegion!==undefined){const r=panel.localRegion,z=r?.sourceSize,c=r?.crop;check(r?.version===1&&r.taskId===panel.cutoutLayer?.taskId&&z&&Number.isInteger(z.width)&&Number.isInteger(z.height)&&z.width>0&&z.height>0&&z.width*z.height<=100000000&&c&&['x','y','w','h'].every(k=>Number.isInteger(c[k]))&&c.x>=0&&c.y>=0&&c.w>0&&c.h>0&&c.x+c.w<=z.width&&c.y+c.h<=z.height,'本地选区来源无效');cleanId(r.sourcePanelId);}if(panel.nativeSizing!==undefined)normalizeNativeSizing(panel.nativeSizing);if(panel.artDirection!==undefined)normalizeArtDirection(panel.artDirection);if(panel.generation?.artDirection!==undefined)normalizeArtDirection(panel.generation.artDirection);validateBreakoutMetadata(panel);if(panel.imageEffects!==undefined){check(panel.imageEffects?.version===1,'图内特效快照无效');cleanId(panel.imageEffects.imageAssetId);normalizeArtDirection(panel.imageEffects.artDirection);}if(panel.referenceTextBindings!==undefined)check(validTextAssetBindings(panel.referenceTextBindings),'本格文生资产描述无效（最多60项，每项1—2000字）');if(panel.referenceNeedBindings!==undefined){const entries=Object.entries(panel.referenceNeedBindings||{});check(panel.referenceNeedBindings&&typeof panel.referenceNeedBindings==='object'&&!Array.isArray(panel.referenceNeedBindings)&&entries.length<=WORKSPACE_REFERENCE_LIMIT,'本格参考对应关系无效');for(const [key,b]of entries){check(string(key,500)&&b&&['character','scene','prop','style'].includes(b.role)&&string(b.name,180),'本格参考需求无效');cleanId(b.assetId);}}if(panel.referenceIds!==undefined){check(Array.isArray(panel.referenceIds)&&panel.referenceIds.length<=WORKSPACE_REFERENCE_LIMIT&&new Set(panel.referenceIds).size===panel.referenceIds.length,'本格参考图片无效或超过工作台 60 张上限');panel.referenceIds.forEach(cleanId);}check(panel.name===undefined||string(panel.name,120),'图层名称无效');check(validPanelEffects(panel),'羽化、画笔蒙版或渐变参数无效');maskPointTotal+=(panel.mask?.strokes||[]).reduce((n,s)=>n+s.points.length,0);check(maskPointTotal<=100000,'工程蒙版笔画过多，请按话拆分工程');if(panel.generation!==undefined){const g=panel.generation;check(g?.promptSource===undefined||['imported','current','post-lettering','direct'].includes(g.promptSource),'本格提示词来源无效');check(g&&g.version===1&&string(g.prompt)&&(g.negativePrompt===undefined||string(g.negativePrompt,4000))&&string(g.shotSize,100)&&string(g.cameraAngle,100)&&string(g.dialogue,4000)&&Array.isArray(g.embeddedTexts)&&g.embeddedTexts.length<=100&&Array.isArray(g.referenceRoles)&&g.referenceRoles.length<=WORKSPACE_REFERENCE_LIMIT&&g.sourceSnapshot&&string(JSON.stringify(g.sourceSnapshot),120000),'本格独立生产内容无效');validateShotSettings({productionPrompt:g.prompt,shotSize:g.shotSize,cameraAngle:g.cameraAngle,characterStates:g.characterStates,propStates:g.propStates,sourceLocation:g.sourceLocation});for(const ref of g.referenceRoles){cleanId(ref.assetId);check(['character','scene','style','prop'].includes(ref.role)&&string(ref.name,180),'本格参考快照无效');}if(panel.shotId)cleanId(panel.shotId);}else check(panel.shotId===''||shotIds.has(panel.shotId),'格子来源镜头不存在');check(['panel','background'].includes(panel.kind)&&number(panel.x,-page.width,page.width*2)&&safeVertical(panel.y,panel.h,20)&&number(panel.w,20,page.width*3)&&validPolygon(panel.points),'格子轮廓或坐标无效');check(number(panel.border,0,256)&&number(panel.feather,0,10000)&&color(panel.borderColor)&&typeof panel.visible==='boolean'&&typeof panel.locked==='boolean','格子外观字段无效');if(panel.imageAssetId)cleanId(panel.imageAssetId);if(panel.imageTransform)check(number(panel.imageTransform.x,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER)&&number(panel.imageTransform.y,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER)&&number(panel.imageTransform.scale,Number.MIN_VALUE,Number.MAX_SAFE_INTEGER)&&(panel.imageTransform.flipX===undefined||typeof panel.imageTransform.flipX==='boolean')&&(panel.imageTransform.flipY===undefined||typeof panel.imageTransform.flipY==='boolean')&&(panel.imageTransform.rotation===undefined||number(panel.imageTransform.rotation,-180,180)),'图片取景参数无效');check(Array.isArray(panel.candidates)&&panel.candidates.length<=40,'候选图片过多');panel.candidates.forEach(cleanId);}
    for(const bubble of page.bubbles)validateBubble(bubble,page);
  }
  check(project.archivedBubbles===undefined||(Array.isArray(project.archivedBubbles)&&project.archivedBubbles.length<=10000),'原文归档格式或数量无效');
  for(const bubble of project.archivedBubbles||[]){check((bubble.storyboard||string(bubble.layoutSourceLineId,120)&&/^E\d+-\d+-\d+$/u.test(bubble.layoutSourceLineId))&&bubble.visible===false,'归档原文需要来源信息且不在画面显示');const source=bubble.archivedFrom;check(source&&string(source.pageName,180)&&number(source.pageWidth,320,4096),'归档原文的原页面信息无效');cleanId(source.pageId);validateBubble(bubble,{width:source.pageWidth,panels:[]},true);}
  check(project.gradients===undefined||(Array.isArray(project.gradients)&&project.gradients.length<=(project.storyboardImport?8000:200)),'渐变图层过多');
  for(const g of project.gradients||[]){unique(g.id);check(string(g.name,120)&&['document','area'].includes(g.coverage)&&typeof g.visible==='boolean'&&typeof g.locked==='boolean'&&number(g.x,-4096,8192)&&safeVertical(g.y,g.h,1)&&number(g.w,1,12288)&&validPolygon(g.points)&&validPanelEffects(g)&&g.gradient,'渐变图层参数无效');if(g.stripSpace!==undefined)check(g.stripSpace?.version===1&&g.coverage==='area'&&g.x===0&&g.w===1280&&Number.isSafeInteger(g.h)&&number(g.h,1,10000)&&project.pages.some(p=>p.id===g.stripSpace.pageId)&&g.gradient.enabled&&g.gradient.mode==='color'&&g.gradient.startColor.toLowerCase()===g.gradient.endColor.toLowerCase(),'插入底图参数无效');maskPointTotal+=(g.mask?.strokes||[]).reduce((n,s)=>n+s.points.length,0);check(maskPointTotal<=100000,'工程蒙版笔画过多');}
  if(project.layerOrder!==undefined){const ids=allLayers(project).map(e=>e.item.id),validIds=new Set(ids);check(Array.isArray(project.layerOrder)&&project.layerOrder.length===ids.length&&new Set(project.layerOrder).size===ids.length&&project.layerOrder.every(key=>validIds.has(key)),'图层顺序与当前图层不一致');}
  if(project.layerSchema!==undefined)check(project.layerSchema===1&&project.pages.every(p=>p.width===1280),'联通画板宽度固定为 1280 px');
  if(project.layerGroupsVersion!==undefined)check(project.layerGroupsVersion===1,'镜头组版本无效');
  if(project.editorLayoutVersion!==undefined)check(project.editorLayoutVersion===2,'编辑器版本无效');
  if(project.productionAssets!==undefined)validateProductionAssets(project.productionAssets);
  return project;
}
export function imageInfo(bytes) {
  check(Buffer.isBuffer(bytes)&&bytes.length>24&&bytes.length<=256*1024*1024,'图片为空或超过 256 MB');
  let width,height,mime,extension;
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'){width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);mime='image/png';extension='.png';}
  else if(bytes[0]===255&&bytes[1]===216){
    for(let offset=2;offset+8<bytes.length;){if(bytes[offset]!==255){offset++;continue;}const marker=bytes[offset+1];if(marker===217||marker===218)break;if(marker===216||marker===0||marker===1||(marker>=208&&marker<=215)){offset+=2;continue;}const length=bytes.readUInt16BE(offset+2);if(length<2||offset+2+length>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){height=bytes.readUInt16BE(offset+5);width=bytes.readUInt16BE(offset+7);break;}offset+=2+length;}
    mime='image/jpeg';extension='.jpg';
  }else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
    const kind=bytes.toString('ascii',12,16);if(kind==='VP8X'&&bytes.length>=30){width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3);}else if(kind==='VP8 '&&bytes.length>=30&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=bytes.readUInt16LE(26)&16383;height=bytes.readUInt16LE(28)&16383;}else if(kind==='VP8L'&&bytes.length>=25&&bytes[20]===47){const bits=bytes.readUInt32LE(21);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}mime='image/webp';extension='.webp';
  }
  check(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=20000&&height<=2000000&&width*height<=100000000,'仅支持有效的 PNG、JPEG 或 WebP 图片');return {width,height,mime,extension};
}
