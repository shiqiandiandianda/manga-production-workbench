import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
const sha=b=>createHash('sha256').update(b).digest('hex');
const check=(ok,message)=>{if(!ok)throw Object.assign(Error('无字后嵌资料：'+message),{status:400});};
const parse=f=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(f.bytes).replace(/^\uFEFF/,''));}catch{check(false,'JSON无效：'+f.relativePath);}};
const relative=(base,name)=>{check(typeof name==='string'&&name&&!/^[\\/]|:/.test(name)&&name.replaceAll('\\','/').split('/').every(s=>s&&s!=='.'&&s!=='..'),'索引路径无效');return path.posix.join(base,name.replaceAll('\\','/'));};
const rect=(r,w,h)=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&r[0]>=0&&r[1]>=0&&r[2]>0&&r[3]>0&&r[0]+r[2]<=w+.001&&r[1]+r[3]<=h+.001;

export function inspectPostLetteringPackage(files){
 // Version titles are documentation, while source references and per-grid data
 // define the import contract. Recognize that structure before legacy layouts.
 const candidates=files.filter(f=>/\.json$/i.test(f.relativePath)).flatMap(file=>{
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(file.bytes).replace(/^\uFEFF/,''));}catch{return [];}
  return data&&Array.isArray(data['分集'])&&['完整提示词引用','资产文件','文字文件'].every(k=>typeof data[k]==='string')&&/无[字泡].*(?:后.*嵌|工具)/u.test(data['正文模式']||'')?[{file,data}]:[];
 });
 if(!candidates.length)return null;check(candidates.length===1,'重复的导入声明');
 const {file:descriptor,data:config}=candidates[0],base=path.posix.dirname(descriptor.relativePath),map=new Map(files.map(f=>[f.relativePath,f]));
 const required=name=>{const f=map.get(relative(base,name));check(f,'缺少文件：'+name);return f;};
 const audit=parse(required('文件校验.json')),verified=new Set();
 check((!audit['算法']||audit['算法']==='SHA-256')&&Array.isArray(audit['文件'])&&audit['文件'].length,'文件校验.json：需要非空文件清单及SHA-256摘要');
 const checks=audit['文件'].map(row=>({name:row['路径']??row.path,size:row['字节数']??row.bytes??row.size,hash:row.SHA256??row.sha256}));
 for(const row of checks)check(typeof row.name==='string'&&Number.isSafeInteger(row.size)&&row.size>=0&&/^[a-f0-9]{64}$/i.test(row.hash||''),'文件校验.json：路径、字节数或SHA-256字段无效');
 // Both descriptor-relative and complete-package-relative manifests are used.
 // Resolve their declared paths as a set; never disable checksum verification.
 const roots=[...new Set([base,path.posix.dirname(base),'.'])].map(root=>({root,count:checks.filter(row=>map.has(relative(root,row.name))).length})).sort((a,b)=>b.count-a.count);
 check(roots.length===1||roots[0].count!==roots[1].count,'校验文件路径存在多个匹配目录，请选择单个完整制作包');
 const auditRoot=roots[0].root;
 for(const row of checks){const name=relative(auditRoot,row.name),f=map.get(name);check(f,'校验清单缺少文件：'+name);check(!verified.has(name)&&f.bytes.length===row.size&&f.sha256.toLowerCase()===row.hash.toLowerCase(),'文件校验失败：'+name);verified.add(name);}
 const verifiedFile=name=>{const f=required(name);check(verified.has(f.relativePath),'校验清单缺少：'+name);return f;};
 const index=parse(verifiedFile(config['完整提示词引用'])),textFile=verifiedFile(config['文字文件']),textData=parse(textFile),assetFile=verifiedFile(config['资产文件']),assetData=parse(assetFile);
 check(config['分集'].length&&Array.isArray(index['条目'])&&Array.isArray(textData['文字']),'导入集合需要分集、提示词索引条目和文字层文字数组');
 const assets=new Map(),episodes=[],usedEpisodes=new Set(),usedGrids=new Set(),usedTexts=new Set(),usedIndex=new Set();
 for(const kind of ['人物','场景','道具'])for(const a of assetData[kind]||[]){check(a['资产ID']&&!assets.has(a['资产ID']),'资产ID重复');assets.set(a['资产ID'],{...a,kind});}
 for(const declared of config['分集']){
  const ep=declared['话'];check(Number.isInteger(ep)&&ep>0&&!usedEpisodes.has(ep),'话号无效或重复');usedEpisodes.add(ep);
  const entries=index['条目'].filter(r=>r['话']===ep);check(entries.length&&new Set(entries.map(r=>r['执行文件'])).size===1&&new Set(entries.map(r=>r['定稿文件'])).size===1,'定稿或执行索引不唯一：'+ep);
  const finalFile=verifiedFile(entries[0]['定稿文件']),execFile=verifiedFile(entries[0]['执行文件']),final=parse(finalFile),execution=parse(execFile);
  check(final['话']===ep&&execution['话']===ep&&final['作品']===config['作品']&&(!execution['作品']||execution['作品']===config['作品'])&&Array.isArray(final['格'])&&Array.isArray(execution['屏段'])&&Array.isArray(declared['格']),'作品话号或数据结构不符：第'+ep+'话');
  check(same(final['格'].map(({提示词,...record})=>record),declared['格'].map(({提示词,...record})=>record)),'集合与定稿内容不一致：'+ep);
  const layoutFile=verifiedFile(execution['排版布局引用']),layout=parse(layoutFile);
  check((!layout.format||layout.format==='comic-layout-design')&&layout['话']===ep&&(!layout['坐标单位']||['px','像素'].includes(layout['坐标单位']))&&Array.isArray(layout['屏段']),'排版布局需要对应话号、屏段数组和像素坐标：'+layoutFile.relativePath);
  const planned=new Map();for(const screen of layout['屏段']){
   const size=screen['画布像素']||layout['成品屏段像素'];check(Array.isArray(size)&&size.length===2&&size.every(v=>Number.isInteger(v)&&v>0&&v<=20000),'组版画布尺寸无效：'+layoutFile.relativePath);
   for(const grid of screen['格']||[]){check(!planned.has(grid['格ID'])&&rect(grid['矩形像素'],...size),'组版格ID重复或越界');planned.set(grid['格ID'],{...grid,screen:screen['屏段号']});}
  }
  const segments=[],panelRecords=[],texts=[];
  check(final['格'].length===entries.length&&execution['屏段'].length===entries.length&&planned.size===entries.length,'定稿、执行、组版覆盖数量不符');
  for(const [i,raw] of final['格'].entries()){
   const id=raw['格ID'],entry=entries.find(r=>r['格ID']===id),unit=execution['屏段'][i],plan=planned.get(id);
   check(id&&!usedGrids.has(id)&&entry&&unit?.['格']?.length===1&&unit['格'][0]['格ID']===id&&unit['段ID']===entry['段ID']&&raw['生成单元ID']===unit['段ID'],'单格来源缺失或重复：'+id);
   usedGrids.add(id);usedIndex.add(entry);
   const size=unit['生成画布像素'],prompt=unit['提示词']?.['无字'];check(raw['提示词']?.['无字']===prompt,'定稿与执行提示词不一致：'+id);
   check(Array.isArray(size)&&size.length===2&&size.every(v=>Number.isInteger(v)&&v>=128&&v<=16384)&&typeof prompt==='string'&&prompt.trim(),'尺寸或无字提示词缺失：'+id);
   check(plan,'排版布局缺少格：'+id);
   const declaredRects=[entry['矩形像素'],raw['排版']?.['矩形像素'],unit['格'][0]['裁切']?.['成品屏段矩形']].filter(Boolean);
   check(declaredRects.length&&declaredRects.every(r=>same(plan['矩形像素'],r))&&same(raw['排版']?.['生成画布像素'],size),'单格尺寸或组版位置不一致：'+id);
   if(entry['排版引用'])check(relative(base,entry['排版引用'])===layoutFile.relativePath,'提示词索引排版引用不一致：'+id);
   const localId='单格'+String(i+1).padStart(3,'0'),segmentId='E'+String(ep).padStart(3,'0')+'-S'+String(i+1).padStart(3,'0');
   const voiceIds=new Set((assetData['画外声音']||[]).map(a=>a['资产ID']));
   const refs=(unit['资产引用']||[]).filter(key=>!voiceIds.has(key)).map((key,slot)=>{
    const a=assets.get(key);check(a,'引用资产不存在：'+key);
    const image=a['参考图']?verifiedFile(a['参考图']):null,type={人物:'设定卡',场景:'场景',道具:'道具'}[a.kind];
    return {slot,'类型':type,'人物':a.kind==='人物'?a['名称']:'','名称':a['名称'],'服装':'','必须':!!image,assetSourceId:key,assetSourceVersion:assetFile.sha256,assetPrompt:a['完整提示词'],sourceReference:structuredClone(a),...(image?{packageImage:{path:image.relativePath,sha256:image.sha256}}:{}),binding:null,skipped:false};
   });
   const source={file:execFile.relativePath,pointer:'/屏段/'+i+'/提示词/无字',sha256:sha(Buffer.from(prompt))},original=structuredClone(raw);
   original['提示词']={'无泡':prompt};original['出现道具']=refs.filter(r=>r['类型']==='道具').map(r=>r['名称']);
   panelRecords.push({id,segmentId,number:raw['格号'],layout:{'格ID':id,'格号':raw['格号'],'排':1},original,production:{},source:{file:finalFile.relativePath,pointer:'/格/'+i,executionFile:execFile.relativePath,unitId:unit['段ID'],promptFiles:{'无泡':source}}});
   const positions={},rows=textData['文字'].filter(t=>t['格ID']===id);
   check(JSON.stringify(rows.map(t=>t['文字ID']))===JSON.stringify(unit['文字引用']),'文字引用不符：'+id);
   for(const t of rows){
    check(t['话']===ep&&t['段ID']===unit['段ID']&&t['渲染']==='工具'&&!usedTexts.has(t['文字ID'])&&rect(t['框像素'],...size),'文字归属、坐标或ID无效：'+id);usedTexts.add(t['文字ID']);
    const [x,y,w,h]=t['框像素'];positions[t['文字ID']]={x:x/size[0],y:y/size[1],w:w/size[0],h:h/size[1]};
    texts.push({...structuredClone(t),'段ID':localId,source:{file:textFile.relativePath,originalSegmentId:t['段ID']}});
   }
   segments.push({id:segmentId,localId,episode:ep,order:i,panelIds:[id],scene:raw['当前场景']||'',prompts:{'无泡':prompt},references:refs,background:{'方式':'纯白'},source:{file:execFile.relativePath,pointer:'/屏段/'+i,promptFiles:{'无泡':source}},regions:{},positions:{},plannedRegions:{[id]:{x:0,y:0,w:1,h:1}},plannedTextPositions:positions,imagePlan:{width:size[0],height:size[1]},singleMode:true,mode:'clean'});
  }
  check(JSON.stringify(texts.map(t=>t['文字ID']))===JSON.stringify((execution['文字']||[]).map(t=>t['文字ID'])),'执行文字层覆盖不符：'+ep);
  episodes.push({episode:ep,title:final['话名'],segments,panelRecords,texts,typography:{fontFamily:'microsoft-yahei',fontSize:textData['正文统一字号像素']},anchors:{},layout:{},assemblyLayout:{data:layout,file:layoutFile.relativePath,sha256:layoutFile.sha256},sourceFinal:finalFile.relativePath});
 }
 check(usedIndex.size===index['条目'].length&&usedTexts.size===textData['文字'].length,'索引或文字存在未覆盖条目');
 const manifest=files.map(({bytes,...f})=>({...f,size:bytes.length})),hash=sha(Buffer.from(JSON.stringify(manifest.map(f=>[f.relativePath,f.sha256]))));
 return {version:1,id:sha(Buffer.from(config['作品'])).slice(0,24),title:config['作品'],hash,manifest,episodes,ledger:[{file:assetFile.relativePath,name:'资产库',records:[...assets.values()]}],documents:files.filter(f=>/\.(md|txt|csv)$/i.test(f.relativePath)).map(f=>({path:f.relativePath,text:new TextDecoder('utf-8',{fatal:true}).decode(f.bytes)})),issues:[{severity:'warning',message:'本包按单格无字提示词生成，台词作为工具文字层保留；组版及文字坐标是预案，成图后请核对再排字。',location:descriptor.relativePath}],sourceFormat:'post-lettering-20261027',count:{episodes:episodes.length,segments:usedGrids.size,panels:usedGrids.size,toolTexts:usedTexts.size,modelTexts:0,backgrounds:0,sourceWarnings:0}};
}
