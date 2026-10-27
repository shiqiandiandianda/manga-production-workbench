import path from 'node:path';
import {createHash} from 'node:crypto';

const digest=b=>createHash('sha256').update(b).digest('hex');
const check=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{status:400});};
const parse=file=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(file.bytes).replace(/^\uFEFF/,''));}catch{throw Object.assign(Error('JSON格式无效：'+file.relativePath),{status:400});}};
const text=file=>new TextDecoder('utf-8',{fatal:true}).decode(file.bytes);
const normalized=s=>s.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(/\n$/,'');
const localPath=(base,name)=>{check(typeof name==='string'&&name&&!name.startsWith('/')&&!/^[a-z]:/i.test(name)&&!name.replaceAll('\\','/').split('/').some(v=>!v||v==='.'||v==='..'),'制作资料索引路径无效');return path.posix.join(base,name.replaceAll('\\','/'));};

/** Adapt final prompt-driven manuscripts; drafts and execution variants are never separate story panels. */
export function inspectPromptDrivenPackage(files){
 const finals=files.filter(f=>/_定稿\.json$/u.test(f.relativePath)).map(file=>({file,data:parse(file)})).filter(({data})=>data['格式']==='提示词驱动制作1.0'&&data['阶段']==='定稿');
 if(!finals.length)return null;
 const byPath=new Map(files.map(f=>[f.relativePath,f])),titles=new Set(finals.map(f=>f.data['作品'])),episodes=[],seenEpisodes=new Set(),issues=[],ledger=[],audited=new Set(),compactBases=new Set();
 check(titles.size===1&&[...titles][0],'定稿资料的作品名称不一致');
 const required=rel=>{const file=byPath.get(rel);check(file,'制作资料缺少索引文件：'+rel);return file;};
 const audit=base=>{
  if(audited.has(base))return;audited.add(base);
  const checks=parse(required(localPath(base,'文件校验.json')));
  check(Array.isArray(checks),'文件校验清单格式无效');
  for(const row of checks){
   const file=required(localPath(base,row['文件']));check(file.bytes.length===row['大小']&&file.sha256===row.sha256,'制作资料文件校验失败：'+file.relativePath);
  }
  const descriptor=byPath.get(localPath(base,'精简导入.json'));
  if(descriptor){
   const config=parse(descriptor);
   check(config['格式']==='提示词驱动精简包1.0'&&config['提示词存储']==='执行JSON','不支持的精简制作包格式：'+descriptor.relativePath);
   check(checks.some(row=>localPath(base,row['文件'])===descriptor.relativePath),'文件校验清单缺少精简导入声明');
   compactBases.add(base);
  }
 };
 for(const {file,data} of finals.sort((a,b)=>a.data['话']-b.data['话'])){
  const ep=data['话'],base=path.posix.dirname(path.posix.dirname(file.relativePath));
  check(Number.isInteger(ep)&&ep>0&&!seenEpisodes.has(ep),'同一话有多个定稿或话号无效：'+ep);seenEpisodes.add(ep);audit(base);
  check(Array.isArray(data['格'])&&Array.isArray(data['生成单元'])&&Array.isArray(data['单格生成单元'])&&Array.isArray(data['资产库']),'定稿缺少格、双套生成单元或资产库：'+file.relativePath);
  const executionFile=required(file.relativePath.replace(/_定稿\.json$/u,'_执行提示词.json')),execution=parse(executionFile);
  check(execution['格式']==='双套执行提示词1.0'&&Array.isArray(execution['组']),'执行提示词格式不支持：'+executionFile.relativePath);
  const groups=kind=>{const matches=execution['组'].filter(g=>g['方式']===kind);check(matches.length===1&&Array.isArray(matches[0]['生成单元']),'执行提示词缺少唯一的'+kind+'组');return matches[0]['生成单元'];};
  const screen=groups('屏段'),single=groups('单格'),indexFile=required(localPath(base,'提示词索引.json')),index=parse(indexFile),textFile=required(localPath(base,'文字层.json')),textRows=parse(textFile);
  check(Array.isArray(index)&&Array.isArray(textRows),'提示词索引或文字层格式无效');
  const indices=new Map();for(const row of index.filter(r=>r['话']===ep)){const key=JSON.stringify([row['方式'],row['单元ID'],row['模式']]);check(!indices.has(key),'提示词索引重复：'+key);indices.set(key,row);}
  const unitPrompts=(unit,kind)=>{
   const result={},sources={};for(const mode of ['带字','空泡','无泡']){
    const entry=indices.get(JSON.stringify([kind,unit['单元ID'],mode]));check(entry,'提示词索引缺少 '+unit['单元ID']+' '+mode);
    check(JSON.stringify(entry['格号'])===JSON.stringify(unit['格号']),'提示词索引格号不符：'+unit['单元ID']);
    const originalPath=localPath(base,entry['文件']);let content,source;
    if(compactBases.has(base)){
     content=unit['提示词']?.[mode];
     check(typeof content==='string'&&digest(Buffer.from(content,'utf8'))===entry.sha256,'执行JSON提示词摘要不符：'+unit['单元ID']+' '+mode);
     const groupIndex=execution['组'].findIndex(g=>g['方式']===kind),unitIndex=execution['组'][groupIndex]['生成单元'].indexOf(unit);
     source={file:executionFile.relativePath,pointer:'/组/'+groupIndex+'/生成单元/'+unitIndex+'/提示词/'+mode,sha256:entry.sha256,originalFile:originalPath};
    }else{
     const original=required(originalPath);content=text(original);check(entry.sha256===original.sha256,'提示词TXT摘要不符：'+original.relativePath);
     source={file:original.relativePath,sha256:original.sha256};
    }
    check(typeof unit['提示词']?.[mode]==='string'&&normalized(content)===normalized(unit['提示词'][mode]),'执行JSON与TXT提示词不一致：'+originalPath);
    result[mode]=content;sources[mode]=source;
   }return {prompts:result,sources};
  };
  check(screen.length===data['生成单元'].length&&single.length===data['单格生成单元'].length,'定稿与执行稿的生成单元数不符');
  const assets=new Map(data['资产库'].map(a=>[a['资产ID']+'/'+a['版本'],a])),panels=new Map(),panelRecords=[],segments=[],texts=[],covered=new Set(),singles=new Map();
  for(const [i,p] of data['格'].entries()){check(typeof p['格ID']==='string'&&!panels.has(p['格号']),'定稿格号缺失或重复');panels.set(p['格号'],{raw:p,index:i});}
  check(new Set(data['格'].map(p=>p['格ID'])).size===panels.size,'定稿格ID重复');
  for(const u of single){check(Array.isArray(u['格号'])&&u['格号'].length===1&&!singles.has(u['格号'][0]),'单格生成单元必须唯一对应一格');const declared=data['单格生成单元'].find(v=>v['单元ID']===u['单元ID']);check(declared&&JSON.stringify(declared['格号'])===JSON.stringify(u['格号']),'定稿与单格执行稿映射不符');singles.set(u['格号'][0],{unit:u,...unitPrompts(u,'单格')});}
  const references=unit=>(unit['参考']||[]).map((r,slot)=>{
   const key=String(r['名称']||'').split('｜')[0],asset=assets.get(key);check(asset,'参考缺少对应资产版本：'+r['名称']);
   const type={'人物':'设定卡','场景':'场景','道具':'道具'}[asset['类型']];check(type,'不支持的资料资产类型：'+asset['类型']);
   return {slot,'类型':type,'人物':type==='设定卡'?asset['名称']:'','名称':asset['名称'],...(type==='场景'?{'场景':asset['名称']}:type==='道具'?{'道具':asset['名称']}:{}),'服装':type==='设定卡'?asset['状态说明']||'':'','说明':type==='设定卡'?'':asset['状态说明']||'','必须':true,assetSourceId:asset['资产ID'],assetSourceVersion:asset['版本'],assetPrompt:asset['提示词'],sourceReference:structuredClone(r),binding:null,skipped:false};
  });
  for(const [i,u] of screen.entries()){
   const declared=data['生成单元'][i];check(declared?.['单元ID']===u['单元ID']&&JSON.stringify(declared['格号'])===JSON.stringify(u['格号']),'定稿与屏段执行稿映射不符');
   const match=new RegExp('^E'+String(ep).padStart(3,'0')+'-S(\\d+)$').exec(u['单元ID']);check(match&&Number(match[1])===i+1&&Array.isArray(u['格号'])&&u['格号'].length,'屏段编号或读序不连续');
   const localId='段'+String(i+1).padStart(2,'0'),key='E'+String(ep).padStart(3,'0')+'-S'+String(i+1).padStart(3,'0'),prompt=unitPrompts(u,'屏段');
   for(const [row,number] of u['格号'].entries()){
    const panel=panels.get(number),one=singles.get(number);check(panel&&one&&!covered.has(number),'屏段源格缺失、重复或缺少独立单格提示词：'+number);covered.add(number);
    const raw=structuredClone(panel.raw),states={};for(const name of raw['出现角色']||[]){const direct=raw['当前状态']?.[name]?.['造型'],entry=(raw['资产索引']||[]).map(pair=>assets.get(pair.join('/'))).find(a=>a?.['类型']==='人物'&&a['名称']===name);if(direct||entry?.['状态说明'])states[name]=direct||entry['状态说明'];}
    raw['服装']=states;raw['出现道具']=(raw['资产索引']||[]).map(pair=>assets.get(pair.join('/'))).filter(a=>a?.['类型']==='道具').map(a=>a['名称']);raw['目标宽高比']=one.unit['画幅'];raw['提示词']=one.prompts;raw['生图提示词']=one.prompts['空泡'];
    panelRecords.push({id:raw['格ID'],segmentId:key,number,layout:{'格ID':raw['格ID'],'格号':number,'排':row+1},original:raw,production:{},source:{file:file.relativePath,pointer:'/格/'+panel.index,executionFile:executionFile.relativePath,unitId:one.unit['单元ID'],promptFiles:one.sources}});
    const line=textRows.find(t=>t['话']===ep&&t['格ID']===raw['格ID']);check(line&&line['生成单元']===u['单元ID']&&JSON.stringify(line['台词'])===JSON.stringify(raw['台词'])&&JSON.stringify(line['特效字'])===JSON.stringify(raw['特效字']),'文字层与定稿格内容不一致：'+raw['格ID']);
    for(const [ti,t] of (line['台词']||[]).entries()){check(typeof t['文本']==='string'&&t['文本'].trim(),'台词文本缺失');texts.push({...structuredClone(t),'文字ID':raw['格ID']+'-T'+String(ti+1).padStart(3,'0'),'格ID':raw['格ID'],'段ID':localId,'渲染':'工具',source:{file:textFile.relativePath,gridId:raw['格ID']}});}
    for(const [ti,t] of (line['特效字']||[]).entries()){const value=typeof t==='string'?t:t['文本']||t['字']||t['内容'];check(typeof value==='string','特效字文本缺失');texts.push({...(typeof t==='object'?structuredClone(t):{}),'文字ID':raw['格ID']+'-SFX'+String(ti+1).padStart(3,'0'),'格ID':raw['格ID'],'段ID':localId,'类型':'特效字','文本':value,'渲染':'模型'});}
   }
   segments.push({id:key,localId,episode:ep,order:i,panelIds:u['格号'].map(n=>panels.get(n).raw['格ID']),scene:[...new Set(u['格号'].map(n=>panels.get(n).raw['当前场景']))].join('／'),prompts:prompt.prompts,references:references(u),background:{'方式':'纯白'},source:{file:executionFile.relativePath,pointer:'/组/'+execution['组'].findIndex(g=>g['方式']==='屏段')+'/生成单元/'+i,unitId:u['单元ID'],promptFiles:prompt.sources},sourceContext:structuredClone(u['有效前情']||u['前情']),regions:{},positions:{},mode:'clean'});
  }
  check(covered.size===panels.size&&singles.size===panels.size,'屏段与单格须完整覆盖同一份剧情');
  episodes.push({episode:ep,title:data['话名']||'第'+ep+'话',segments,panelRecords,texts,typography:{},anchors:{},layout:{},sourceFormat:data['格式'],sourceFinal:file.relativePath,costumeRevision:structuredClone(data['服装修订'])});
  ledger.push({file:file.relativePath,name:'资产库',records:structuredClone(data['资产库'])});
 }
 check(episodes.length<=100,'一次最多导入100话');
 const count={episodes:episodes.length,segments:episodes.reduce((n,e)=>n+e.segments.length,0),panels:episodes.reduce((n,e)=>n+e.panelRecords.length,0),toolTexts:episodes.reduce((n,e)=>n+e.texts.filter(t=>t['渲染']==='工具').length,0),modelTexts:episodes.reduce((n,e)=>n+e.texts.filter(t=>t['渲染']==='模型').length,0),backgrounds:0,sourceWarnings:0};
 check(count.segments<=1000&&count.panels<=8000,'资料格数或屏段数超出上限');
 issues.push({severity:'warning',message:'双套为同一剧情的屏段与单格两种生成方式，不重复计算剧情格数；采用'+(compactBases.size?'执行JSON内嵌完整提示词':'执行提示词TXT')+'，保留前情与青衫修订原文。',location:''},{severity:'warning',message:'资料包未含已验收的图像母版，导入后请从墨库核对并绑定人物、服装、场景及道具参考。',location:''},{severity:'warning',message:'本包未提供像素裁区，初始单格位置仅为可编辑占位；成图后需看图确认裁格与文字位置。',location:''});
 const manifest=files.map(({bytes,...file})=>({...file,size:bytes.length})),title=[...titles][0],hash=digest(Buffer.from(JSON.stringify(manifest.map(f=>[f.relativePath,f.sha256]))));
 return {version:1,id:digest(Buffer.from(title)).slice(0,24),title,hash,manifest,episodes,ledger,documents:files.filter(f=>/\.(md|txt|csv)$/i.test(f.relativePath)).map(f=>({path:f.relativePath,text:text(f)})),issues,count,sourceFormat:'prompt-driven-production-1.0'};
}
