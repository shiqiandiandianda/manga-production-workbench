import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {writeFileAtomicSync} from './durable-files.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex'),check=(ok,message,status=400)=>{if(!ok)throw Object.assign(Error(message),{status});};
const chapter=file=>Number(/第\s*(\d+)\s*章/u.exec(file)?.[1]||0);
const folder=(root,id)=>{check(/^project_[a-f0-9-]{36}$/u.test(id),'项目编号无效');return path.join(root,'novel-sources',id);};
export function readNovelChapter(root,project,number){
 const dir=folder(root,project.id);let bound=[];try{bound=JSON.parse(fs.readFileSync(path.join(dir,'index.json')));}catch(e){if(e.code!=='ENOENT')throw e;}const extra=bound.find(f=>f.chapter===number);let file,name,sha256;
 if(extra){check(/^[a-f0-9]{64}\.txt$/u.test(extra.file),'原文章节路径无效');file=path.join(dir,extra.file);name=extra.name;sha256=extra.sha256;}else{const source=project.productionPackage?.manifest?.find(f=>chapter(f.relativePath)===number&&/\.(txt|md)$/iu.test(f.relativePath)&&/(原文核对|原著|小说)/u.test(f.relativePath));check(source,'当前工程没有这份小说原文',404);check(!source.relativePath.split(/[\\/]/u).some(p=>p==='..'||p==='.'),'原文路径无效');file=path.join(root,'production-sources',project.productionPackage.hash,...source.relativePath.split('/'));name=source.relativePath;sha256=source.sha256;}
 const bytes=fs.readFileSync(file);check(bytes.length<=2*1024*1024&&digest(bytes)===sha256,'原著原件摘要已改变，请重新补充',409);return {bytes,name,sha256};
}
export function saveNovelSources(root,project,files){
 check(Array.isArray(files)&&files.length>0&&files.length<=100,'请选择1—100份小说章节');const dir=folder(root,project.id);fs.mkdirSync(dir,{recursive:true});const indexFile=path.join(dir,'index.json');let index=[];try{index=JSON.parse(fs.readFileSync(indexFile));}catch(e){if(e.code!=='ENOENT')throw e;}
 let total=0;for(const file of files){check(typeof file.name==='string'&&/^第\s*\d+\s*章[^/\\]*\.(txt|md)$/iu.test(file.name)&&typeof file.text==='string','请选择以“第102章”等章节命名的小说原文TXT');const bytes=Buffer.from(file.text,'utf8');total+=bytes.length;check(bytes.length<=2*1024*1024&&total<=16*1024*1024,'原文过大，请分批补充');const sha256=digest(bytes),name=sha256+'.txt';writeFileAtomicSync(path.join(dir,name),bytes);index=index.filter(i=>i.chapter!==chapter(file.name));index.push({chapter:chapter(file.name),name:file.name,file:name,sha256,...(file.sourcePath?{sourcePath:file.sourcePath}:{})});}
 writeFileAtomicSync(indexFile,JSON.stringify(index));return {chapters:index.length};
}
export function novelEvidence(root,project,{name,state='',chapters=[]}){
 const dir=folder(root,project.id),files=[];let extra=[];try{extra=JSON.parse(fs.readFileSync(path.join(dir,'index.json')));}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const file of extra)if(chapters.includes(file.chapter))files.push({...file,path:path.join(dir,file.file),label:file.name});
 for(const file of project.productionPackage?.manifest||[]){const number=chapter(file.relativePath);if(!number||!chapters.includes(number)||!/\.(txt|md)$/iu.test(file.relativePath)||!/(原文核对|原著|小说)/u.test(file.relativePath)||files.some(f=>f.chapter===number))continue;check(!file.relativePath.split(/[\\/]/u).some(p=>p==='..'||p==='.'),'原文路径无效');files.push({...file,chapter:number,path:path.join(root,'production-sources',project.productionPackage.hash,...file.relativePath.split('/')),label:file.relativePath});}
 const garment=/长衫|儒衫|官服|衣袍|长袍|夜行衣|甲胄|斗篷|衣裙|布衣/u.exec(state)?.[0]||'',color=/[黑白青灰红蓝紫黄]色/u.exec(state)?.[0]||'',rank=/镇抚使|百户|千户|总旗|官差/u.exec(state)?.[0]||'',excerpts=[];
 for(const file of files.slice(0,6)){const bytes=fs.readFileSync(file.path);check(bytes.length<=2*1024*1024&&digest(bytes)===file.sha256,'原著原件摘要已改变，请重新补充',409);let paragraph=0;const lines=bytes.toString('utf8').split(/\r?\n/u).flatMap((quote,i)=>quote.trim()?[{quote:quote.trim(),line:i+1,paragraph:++paragraph}]:[]);
  let scored=lines.map((p,i)=>{const near=lines.slice(Math.max(0,i-2),i+3).map(p=>p.quote).join('\n'),person=near.includes(name),outfit=!!garment&&p.quote.includes(garment),sameColor=!!color&&p.quote.includes(color),position=!!rank&&p.quote.includes(rank);return {...p,person,outfit,position,score:(outfit?8:0)+(sameColor?4:0)+(position?5:0)+(person?3:0)};}).filter(p=>p.score>=5&&(p.person||p.outfit)&&(p.outfit||p.position)).sort((a,b)=>b.score-a.score||a.line-b.line).slice(0,2);
  if(!scored.length)scored=lines.filter(p=>p.quote.includes(name)).slice(0,2).map(p=>({...p,outfit:false,person:true,score:0}));
  for(const p of scored)excerpts.push({...p,quote:p.quote.slice(0,700),truncated:p.quote.length>700,chapter:file.chapter,file:file.label,sha256:file.sha256,sourceUrl:'/api/projects/'+project.id+'/novel-source?chapter='+file.chapter,location:'第'+file.chapter+'章 · 第'+p.line+'行',kind:'novel',clothingExplicit:p.outfit,personExplicit:p.person});
 }
 return {kind:'novel',available:files.length>0,excerpts:excerpts.slice(0,1),clothingExplicit:excerpts.slice(0,1).some(e=>e.clothingExplicit),missingChapters:chapters.filter(c=>!files.some(f=>f.chapter===c)),chapters:files.map(f=>f.chapter)};
}
