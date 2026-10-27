import {PRODUCTION_PACKAGE_LIMITS as limits} from '../public/production-package-limits.js';
import {inspectPostLetteringPackage} from './post-lettering-package.mjs';
import {inspectPromptDrivenPackage} from './prompt-driven-package.mjs';
import {validateLayoutDesign} from '../public/layout-design.js';
import {productionPanelPrompts} from '../public/production-panel-prompts.js';
import {obsoleteProductionReference} from '../public/production-reference-policy.js';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {importStoryboard} from './storyboard-import.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export const packageDigest=bytes=>createHash('sha256').update(bytes).digest('hex');
const allowed=/\.(json|xlsx|md|txt|html|csv|tsv|png|jpe?g|webp|svg|py|pyc)$/i;
const fileLimit=()=>limits.fileBytes;
export function packagePath(value){const s=String(value||'').replaceAll('\\','/');if(!s||s.startsWith('/')||/^[a-z]:/i.test(s)||s.split('/').some(p=>!p||p==='.'||p==='..')||s.includes('\0'))fail('资料相对路径无效');return s;}
export async function loadPackageFiles(input,library){
 // A scan is one logical read operation: do not mix credentials if the
 // user signs in or out while the catalog or a fixed revision is loading.
 if(input.sourceType==='moku'&&library?.withSession)return library.withSession(()=>loadPackageFilesInSession(input,library));
 return loadPackageFilesInSession(input,library);
}
async function loadPackageFilesInSession(input,library){
 const files=[];let total=0;
 const add=(relativePath,bytes,origin={})=>{relativePath=packagePath(relativePath);if(path.posix.basename(relativePath).startsWith('~$')||!allowed.test(relativePath))return;if(bytes.length>fileLimit(relativePath))fail(relativePath+' 超过8MB');total+=bytes.length;if(total>limits.bytes)fail('资料包总大小超过256MiB，请按话数分开导入');if(files.length>=limits.files)fail('资料包超过10000个文件，请缩小资料范围');files.push({relativePath,bytes,sha256:packageDigest(bytes),...origin});};
 if(input.sourceType==='moku'){
  if(input.remoteProjectId!=='public'&&!/^[a-f0-9-]{36}$/i.test(input.remoteProjectId||''))fail('请选择明确的墨库项目');
  const prefix=String(input.folder||'').replaceAll('\\','/').replace(/^\/+|\/+$/g,'');
  for(let offset=0;offset<Infinity;offset+=200){const page=await library.read('/api/assets?'+new URLSearchParams({projectId:input.remoteProjectId,limit:'200',offset:String(offset)}));if(!Array.isArray(page.items))fail('墨库资料列表格式无效');
   for(const item of page.items){const folder=String(item.folder||'').replaceAll('\\','/').replace(/^\/+|\/+$/g,'');if(prefix&&folder!==prefix&&!folder.startsWith(prefix+'/'))continue;if(!allowed.test(item.name)||item.name.startsWith('~$'))continue;
    const detail=await library.read('/api/assets/'+item.id);if(detail.deletedAt)fail('资料已被删除：'+item.name,409);const rid=item.displayRevisionId||detail.recommendedRevisionId,revision=detail.revisions?.find(r=>r.id===rid);if(!revision||!/^([a-f0-9]{64})$/i.test(revision.sha256))fail('墨库资料缺少固定版本或摘要：'+item.name);
    const response=await library.remote('/api/revisions/'+rid+'/download'),chunks=[];let size=0;for await(const chunk of response.body){library.assertSession?.();size+=chunk.length;chunks.push(Buffer.from(chunk));}library.assertSession?.();const bytes=Buffer.concat(chunks);if(packageDigest(bytes)!==revision.sha256)fail('墨库资料校验失败：'+item.name,502);
    const rel=[prefix?folder.slice(prefix.length).replace(/^\//,''):folder,item.name].filter(Boolean).join('/');add(rel,bytes,{sourceType:'moku',projectId:input.remoteProjectId,assetId:item.id,revisionId:rid,objectVersion:detail.objectVersion});
   }if(page.items.length<200)break;
  }
 }else if(input.directory){
  const root=fs.realpathSync(String(input.directory));if(!fs.statSync(root).isDirectory())fail('请选择资料文件夹');
  const walk=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const file=path.join(directory,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile()&&allowed.test(entry.name)&&!entry.name.startsWith('~$')){if(fs.statSync(file).size>fileLimit(entry.name))fail(entry.name+' 超过8MB');add(path.relative(root,file),fs.readFileSync(file),{sourceType:'local'});}}};walk(root);
 }else{
  if(!Array.isArray(input.files)||input.files.length>limits.files)fail('请选择完整资料文件夹');
  let records=input.files.filter(f=>!String(f.name||f.relativePath).split(/[\\/]/).at(-1).startsWith('~$'));
  const names=records.map(f=>packagePath(String(f.relativePath||f.name).replaceAll('\\','/'))),first=names[0]?.split('/')[0];const trimRoot=names.every(n=>n.includes('/')&&n.startsWith(first+'/'));
  for(const [i,f] of records.entries()){if(typeof f.dataBase64!=='string'||f.dataBase64.length>Math.ceil(fileLimit(names[i])*4/3)+4||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.dataBase64))fail('资料文件编码无效');add(trimRoot?names[i].slice(first.length+1):names[i],Buffer.from(f.dataBase64,'base64'),{sourceType:'upload'});}
 }
 if(input.sourceType==='moku')library?.assertSession?.();if(!files.length)fail('没有找到可读取的制作资料');const seen=new Set();for(const file of files){const key=file.relativePath.toLowerCase();if(seen.has(key))fail('资料包有重复相对路径：'+file.relativePath);seen.add(key);}return files.sort((a,b)=>a.relativePath.localeCompare(b.relativePath,'en'));
}
function records(sheet){const hi=sheet.headerIndex>=0?sheet.headerIndex:0,headers=(sheet.table[hi]||[]).map(v=>String(v||''));return sheet.table.slice(hi+1).map((r,i)=>({values:Object.fromEntries(headers.filter(Boolean).map((h,j)=>[h,r[j]??''])),row:sheet.rowNumbers?.[hi+1+i]||hi+i+2}));}
function isStoryboardDraft(file,data){
 const relative=file.relativePath.replaceAll('\\','/');
 const formal=/^分镜\s*JSON(?:\s|\d|$)/i.test(String(data['格式']||''))||/(?:^|\/)分镜JSON\/|_分镜\.json$/i.test(relative);
 if(formal)return false;
 return /(?:^|\/)底稿(?:JSON)?(?:\/|$)/i.test(relative)||/_底稿\.json$/i.test(relative)||(!data['格式']&&Object.hasOwn(data,'节拍表')&&Object.hasOwn(data,'账本'));
}
function storyboardFilePriority(relativePath){
 const parts=String(relativePath||'').replaceAll('\\','/').normalize('NFKC').split('/'),name=parts.pop();
 if(parts.some(part=>/^分镜\s*JSON$/i.test(part)))return 2;
 return /分镜(?:\s*JSON)?\.json$/i.test(name)?1:0;
}
function isLegacyStoryboard(data){
 const rows=data?.['格'];
 return !String(data?.['格式']||'').trim()&&typeof data?.['作品']==='string'&&data['作品'].trim()&&Number.isInteger(data['话'])&&Array.isArray(rows)&&rows.length>0&&rows.every(row=>typeof row?.['格ID']==='string'&&row['格ID'].trim()&&['画面内容','生图提示词','直出提示词'].some(key=>typeof row[key]==='string'&&row[key].trim()))&&new Set(rows.map(row=>row['格ID'])).size===rows.length;
}
export async function inspectProductionPackage(files){
 const postLettering=inspectPostLetteringPackage(files);if(postLettering)return postLettering;
 const promptDriven=inspectPromptDrivenPackage(files);if(promptDriven)return promptDriven;
 const issues=[],issue=(severity,message,location='')=>issues.push({severity,message,location});const episodes=[],boards=new Map(),boardSources=new Map(),screens=new Map(),layouts=new Map(),documents=[],workbooks=[];
 const text=file=>new TextDecoder('utf-8',{fatal:true}).decode(file.bytes).replace(/^\uFEFF/,'');
 for(const file of files){
  if(/\.xlsx$/i.test(file.relativePath)){const data=await importStoryboard({name:file.relativePath,dataBase64:file.bytes.toString('base64'),mode:'inspect',maxColumns:160});workbooks.push({file:file.relativePath,sheets:data.workbook||[]});continue;}
  if(/\.(png|jpe?g|webp|pyc)$/i.test(file.relativePath))continue;
  const content=text(file);documents.push({path:file.relativePath,text:content});if(!/\.json$/i.test(file.relativePath))continue;
  let data;try{data=JSON.parse(content);}catch{fail('JSON格式无效：'+file.relativePath);}
  if(data.format?.startsWith('comic-layout-design')||/_排版布局\.json$/i.test(file.relativePath)){validateLayoutDesign(data);if(layouts.has(data.episode))fail('同一话有多个排版布局版本');layouts.set(data.episode,{data,file:file.relativePath,sha256:file.sha256});continue;}
  if(Array.isArray(data['屏段'])&&!(/屏段文字层/.test(String(data['版本']||''))||/屏段文字层[^/]*\.json$/i.test(file.relativePath)))continue;
  if(Array.isArray(data['屏段'])){if(!/屏段文字层\s+1\./.test(data['版本']||''))fail('不支持的屏段文字层版本：'+(data['版本']||'版本缺失')+'（'+file.relativePath+'）');if(screens.has(data['话']))fail('同一话有多个屏段版本，请分开导入');screens.set(data['话'],{data,file:file.relativePath});}
  else if(Array.isArray(data['格'])){
   // 底稿仍保留在来源清单中，不能与正式分镜竞争同一话的生产来源。
   if(isStoryboardDraft(file,data))continue;
   const priority=storyboardFilePriority(file.relativePath),declared=/^分镜\s*JSON(?:\s|\d|$)/i.test(String(data['格式']||''));
   // Preserve older unlabelled storyboards only when they have complete panel
   // identifiers and content; the IDs must also match the screen below.
   if(!priority&&!declared&&!isLegacyStoryboard(data))continue;
   const sources=boardSources.get(data['话'])||[];sources.push({data,file:file.relativePath,priority});boardSources.set(data['话'],sources);
  }
 }
 // Only official storyboard files participate in episode matching; other JSON originals remain in the manifest.
 for(const [episode,sources]of boardSources){
  // An explicit formal declaration is authoritative even in a directory
  // named 底稿. Do not silently discard a second declared formal source just
  // because another path has a higher folder priority.
  const declared=sources.filter(source=>/^分镜\s*JSON(?:\s|\d|$)/i.test(String(source.data['格式']||'')));
  const priority=Math.max(...sources.map(source=>source.priority));
  const screen=screens.get(episode)?.data,screenIds=screen?.['屏段']?.flatMap(segment=>segment['格']||[]).map(row=>row['格ID']),screenIdSet=new Set(screenIds||[]);
  const selected=declared.length?declared:priority?sources.filter(source=>source.priority===priority):sources.filter(source=>isLegacyStoryboard(source.data)&&Array.isArray(screenIds)&&screenIds.length===source.data['格'].length&&screenIdSet.size===screenIds.length&&source.data['格'].every(row=>screenIdSet.has(row['格ID'])));
  if(!selected.length)continue;
  if(selected.length>1)fail('同一话有多个分镜JSON版本：第'+episode+'话（'+selected.map(source=>source.file).join('、')+'）');
  const {data,file}=selected[0];boards.set(episode,{data,file});
 }
 if(!screens.size)fail('资料包缺少“屏段文字层.json”；请选包含屏段提示词目录的完整资料夹');if(screens.size>100)fail('一次最多导入100话');
 const boardTitles=new Set([...boards.values()].map(v=>String(v.data['作品']||'').trim())),titles=[...screens.values()].map(v=>String(v.data['作品']||'').trim());if(boardTitles.size>1)fail('逐格分镜的正式作品名称不一致');const title=[...boardTitles][0]||[...titles].sort((a,b)=>b.length-a.length)[0];if(!title)fail('资料包缺少作品名');for(const t of titles){if(t===title)continue;if(t&&[t+'，',t+',',t+' '].some(prefix=>title.startsWith(prefix)))issue('warning','屏段采用作品简称“'+t+'”，正式名称取逐格分镜“'+title+'”');else fail('资料包作品名称不一致');}
 for(const [ep,{data,file}] of [...screens].sort(([a],[b])=>a-b)){
  if(!Number.isInteger(ep)||ep<1||ep>9999)fail('资料话号无效');const board=boards.get(ep),segments=[],panelRecords=[],ids=new Set(),textIds=new Set();
  if(!board)issue('conflict','缺少逐格分镜JSON',file);else if(board.data['作品']!==title)fail('分镜与屏段作品不一致');
  const production=workbooks.filter(w=>w.file.includes('制作分镜表')).flatMap(w=>w.sheets.filter(s=>s.name===`第${ep}话`).map(s=>({file:w.file,sheet:s})));if(production.length>1)fail('同一话有多个制作表版本');
  const xrows=production[0]?records(production[0].sheet):[];const md=documents.find(d=>d.path.replaceAll('\\','/').endsWith(`第${String(ep).padStart(3,'0')}话_屏段提示词.md`));
  const segIds=new Set(data['屏段'].map(s=>s['段ID']));if(segIds.size!==data['屏段'].length)fail('屏段编号重复：第'+ep+'话');
  for(const [index,s] of data['屏段'].entries()){
   if(!s['段ID']||!Array.isArray(s['格'])||!s['格'].length||!Array.isArray(s['附图'])||!s['提示词']?.['空泡']?.trim()||!s['提示词']?.['无泡']?.trim()||!s['底图'])fail('屏段字段不完整：'+file+' '+s['段ID']);
   const number=/^段(\d{1,4})$/.exec(s['段ID']);if(!number||Number(number[1])<1)fail('段ID需采用段01等稳定编号');const key=`E${String(ep).padStart(3,'0')}-S${String(Number(number[1])).padStart(3,'0')}`;
   for(const p of s['格']){if(!p['格ID']||ids.has(p['格ID']))fail('格ID缺失或跨段重复：'+file);ids.add(p['格ID']);const originals=board?.data['格']||[],hasIds=originals.some(r=>r['格ID']),sourceIndex=hasIds?originals.findIndex(r=>r['格ID']===p['格ID']):Number(p['格号'])-1,original=originals[sourceIndex];if(hasIds&&originals.filter(r=>r['格ID']===p['格ID']).length!==1)fail('分镜JSON格ID缺失或重复：'+p['格ID']);if(!original)issue('conflict','屏段格号在分镜JSON中不存在',p['格ID']);const xr=xrows.find(r=>r.values['格ID']===p['格ID']);if(production.length&&!xr)issue('conflict','制作表缺少格ID',p['格ID']);
    if(xr&&original)for(const field of ['画面内容','景别','机位角度','当前场景','当前天气','当前时间','生图提示词'])if(String(xr.values[field]??'')!==String(original[field]??''))issue('conflict','制作表与分镜JSON不一致：'+field,p['格ID']);
    if(xr&&original){const a=productionPanelPrompts({original}),b=productionPanelPrompts({production:xr.values});for(const mode of ['empty','clean'])if(a[mode].text&&b[mode].text&&a[mode].text!==b[mode].text)issue('conflict','制作表与分镜JSON的单格'+(mode==='empty'?'空泡':'无泡')+'提示词不一致',p['格ID']);}
    panelRecords.push({id:p['格ID'],segmentId:key,number:p['格号'],layout:structuredClone(p),original:structuredClone(original||{}),production:xr?.values||{},source:{file:board?.file,pointer:'/格/'+sourceIndex,workbook:production[0]?.file,sheet:production[0]?.sheet.name,row:xr?.row}});
   }
   for(const ref of s['附图'])if(ref['类型']==='上一段成图'&&(!segIds.has(ref['段ID'])||data['屏段'].findIndex(x=>x['段ID']===ref['段ID'])>=index))fail('上一段引用不存在或形成循环：'+key);
   const bg=s['底图'];if(bg['方式']==='共用'){const source=data['屏段'].find(v=>v['段ID']===bg['段ID']);if(!source||source['底图']['方式']!=='本段出图'||source['底图']['图片']!==bg['图片'])fail('共用底图引用无效：'+key);}else if(bg['方式']!=='纯白'&&(bg['方式']!=='本段出图'||!bg['提示词']?.trim()))fail('底图提示词或方式无效：'+key);
   for(const variant of ['空泡','无泡'])if(md&&!md.text.replace(/\r\n/g,'\n').includes(s['提示词'][variant].replace(/\r\n/g,'\n')))issue('conflict','Markdown与JSON提示词不一致：'+variant,key);
   segments.push({id:key,localId:s['段ID'],episode:ep,order:index,panelIds:s['格'].map(p=>p['格ID']),scene:s['场景']||'',imageName:s['图片'],prompts:structuredClone(s['提示词']),references:s['附图'].map((r,i)=>({slot:i,...structuredClone(r),binding:null,skipped:false})).filter(r=>!obsoleteProductionReference(r)),background:structuredClone(bg),source:{file,pointer:'/屏段/'+index},regions:{},positions:{},mode:data['出图模式']==='无泡'?'clean':'empty'});
  }
  if(board&&board.data['格'].length!==ids.size)issue('conflict','分镜格数与屏段覆盖数量不同',file);if(xrows.length&&xrows.length!==ids.size)issue('conflict','制作表格数与屏段覆盖数量不同',file);
  const texts=structuredClone(data['文字']||[]);for(const t of texts){if(!t['文字ID']||textIds.has(t['文字ID'])||!ids.has(t['格ID'])||!segments.some(s=>s.localId===t['段ID']&&s.panelIds.includes(t['格ID']))||!['工具','模型'].includes(t['渲染'])||typeof t['文本']!=='string')fail('文字ID、渲染方式或所属格无效：'+file);textIds.add(t['文字ID']);}
  const layout=layouts.get(ep);if(data['排版布局引用']&&!layout)fail('缺少屏段声明的排版布局JSON：第'+ep+'话');
  if(layout){const boardFile=files.find(f=>f.relativePath===board?.file);if(!boardFile)fail('排版布局缺少对应源分镜');validateLayoutDesign(layout.data,{board:board.data,boardSha:boardFile.sha256});if(layout.data.source.storyboardPath.replaceAll('\\','/')!==board.file)fail('排版布局源分镜路径不符');if(data['排版布局引用']?.layoutVersion&&data['排版布局引用'].layoutVersion!==layout.data.layoutVersion)fail('屏段与布局版本不符');const planned=layout.data.generationSegments;if(planned.length!==segments.length)fail('排版布局与屏段数量不一致');for(const [i,s] of segments.entries()){const g=planned[i];if(g.segmentId!==s.id||JSON.stringify(g.panels.map(p=>p.panelId))!==JSON.stringify(s.panelIds))fail('排版布局与屏段格ID映射不一致');s.plannedRegions=Object.fromEntries(g.panels.map(p=>[p.panelId,structuredClone(p.rect)]));s.imagePlan=structuredClone(g.imagePlan);s.layoutDesignVersion=layout.data.layoutVersion;}for(const record of panelRecords)record.designRect=structuredClone(layout.data.finalLayout.panels.find(p=>p.panelId===record.id).rect);}
  episodes.push({...(layout?{layoutDesign:layout}:{}),episode:ep,title:board?.data['话名']||`第${ep}话`,segments,panelRecords,texts,typography:data['排字']||{},anchors:data['锚点定义']||{},layout:data['版式']||{}});
 }
 for(const d of documents.filter(d=>/核对\.txt$/.test(d.path))){for(const line of d.text.split(/\r?\n/))if(/^\s*- /.test(line))issue('warning',line.replace(/^\s*- /,''),d.path);}
 const ledger=[];for(const book of workbooks){for(const sheet of book.sheets){if(sheet.cellErrors?.length)for(const err of sheet.cellErrors)issue('conflict','表格含错误或未缓存公式：'+err.cell,book.file);if(!/底稿/.test(book.file))continue;ledger.push({file:book.file,name:sheet.name,records:records(sheet).map(r=>r.values)});}}
 const csv=documents.find(d=>/sb检查报告\.csv$/.test(d.path)),csvWarnings=csv?csv.text.split(/\r?\n/).filter(l=>l.startsWith('警告,')).length:0;
 const count={episodes:episodes.length,segments:episodes.reduce((n,e)=>n+e.segments.length,0),panels:episodes.reduce((n,e)=>n+e.panelRecords.length,0),toolTexts:episodes.reduce((n,e)=>n+e.texts.filter(t=>t['渲染']==='工具').length,0),modelTexts:episodes.reduce((n,e)=>n+e.texts.filter(t=>t['渲染']==='模型').length,0),backgrounds:episodes.reduce((n,e)=>n+e.segments.filter(s=>s.background['方式']==='本段出图').length,0),sourceWarnings:csvWarnings};
 if(count.segments>1000||count.panels>8000)fail('资料格数或屏段数超出上限');
 for(const ep of layouts.keys())if(!screens.has(ep))fail('排版布局话号没有对应屏段：'+ep);
 const manifest=files.map(({bytes,...file})=>({...file,size:bytes.length}));const hash=packageDigest(Buffer.from(JSON.stringify(manifest.map(f=>[f.relativePath,f.sha256]))));
 return {version:1,id:packageDigest(Buffer.from(title)).slice(0,24),title,hash,manifest,episodes,ledger,documents:documents.filter(d=>/\.(md|txt|csv)$/i.test(d.path)),issues,count};
}
