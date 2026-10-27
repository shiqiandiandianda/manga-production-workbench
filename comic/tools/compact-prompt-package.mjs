import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadPackageFiles,inspectProductionPackage,packageDigest} from '../lib/production-package.mjs';

const fail=message=>{throw Error(message);};
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const parse=file=>JSON.parse(decode(file.bytes).replace(/^\uFEFF/,''));
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
const semantics=episodes=>JSON.stringify(episodes,(key,value)=>key==='source'?undefined:value);
const inside=(parent,child)=>{const rel=path.relative(parent,child);return !rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};

/** Copy into a new compact package; never rewrite the supplied production originals. */
export async function buildCompactPromptPackage({sourceDirectory,outputDirectory}){
 const source=fs.realpathSync(sourceDirectory),output=path.resolve(outputDirectory);
 if(inside(source,output)||inside(output,source))fail('精简包与原包必须使用互不包含的独立目录');
 if(fs.existsSync(output))fail('精简包目录已存在，请使用新的目录，原有文件未覆盖');
 const originals=await loadPackageFiles({directory:source}),baseline=await inspectProductionPackage(originals);
 if(baseline.sourceFormat!=='prompt-driven-production-1.0')fail('本工具仅处理提示词驱动制作1.0资料包');
 if(originals.some(f=>path.posix.basename(f.relativePath)==='精简导入.json'))fail('请选择含原始TXT的完整制作包');
 const byPath=new Map(originals.map(f=>[f.relativePath,f])),finals=originals.filter(f=>/_定稿\.json$/u.test(f.relativePath));
 const bases=new Set(finals.map(f=>path.posix.dirname(path.posix.dirname(f.relativePath))));
 if(bases.size!==1)fail('请一次精简一套完整资料包');
 const base=[...bases][0],at=name=>path.posix.join(base,name),indexFile=byPath.get(at('提示词索引.json')),index=parse(indexFile),rows=new Map(index.map(r=>[JSON.stringify([r['话'],r['方式'],r['单元ID'],r['模式']]),r]));
 const compact=[],add=(relativePath,bytes)=>compact.push({relativePath,bytes,sha256:packageDigest(bytes),sourceType:'local'});
 let prompts=0;
 for(const final of finals){
  add(final.relativePath,final.bytes);
  const episode=parse(final)['话'],executionPath=final.relativePath.replace(/_定稿\.json$/u,'_执行提示词.json'),execution=parse(byPath.get(executionPath));
  for(const group of execution['组'])for(const unit of group['生成单元'])for(const mode of ['带字','空泡','无泡']){
   const row=rows.get(JSON.stringify([episode,group['方式'],unit['单元ID'],mode]));
   if(!row)fail('缺少原始提示词索引：'+unit['单元ID']+' '+mode);
   const original=byPath.get(at(row['文件']));
   if(!original||original.sha256!==row.sha256)fail('原始提示词摘要不符：'+row['文件']);
   // TextDecoder preserves the legacy reader's BOM handling; prompts retain all other bytes.
   const value=decode(original.bytes);
   if(packageDigest(Buffer.from(value,'utf8'))!==row.sha256)fail('原始提示词包含独立UTF-8 BOM，请先明确保存规则：'+row['文件']);
   unit['提示词'][mode]=value;prompts++;
  }
  add(executionPath,jsonBytes(execution));
 }
 if(prompts!==index.length)fail('原始提示词索引存在未覆盖记录');
 add(indexFile.relativePath,indexFile.bytes);
 const textFile=byPath.get(at('文字层.json'));add(textFile.relativePath,textFile.bytes);
 add(at('精简导入.json'),jsonBytes({'格式':'提示词驱动精简包1.0','提示词存储':'执行JSON','作品':baseline.title,'话数':baseline.count.episodes,'屏段数':baseline.count.segments,'格数':baseline.count.panels,'完整提示词数':prompts,'来源包名称':path.basename(source),'来源文件校验摘要':byPath.get(at('文件校验.json')).sha256,'说明':'三模式完整提示词内嵌每话执行JSON；提示词索引保留原TXT名称和SHA256，导入逐条校验原文。'}));
 add(at('使用说明.txt'),Buffer.from('《'+baseline.title+'》精简导入包\n\n在漫画工作台选择“导入制作资料”，将资料路径指向本文件夹，扫描后选择新建工程。\n本包保留'+baseline.count.episodes+'话、'+baseline.count.segments+'屏段、'+baseline.count.panels+'格，以及'+prompts+'份带字/空泡/无泡完整提示词。屏段和单格是同一剧情的两种生成方式。\n提示词已收进每话“执行提示词.json”，无需逐份TXT；原TXT名称与摘要保留在提示词索引中。\n初稿、审核表、累计资产库和原文核对资料继续保存在原始完整资料包，未修改、未删除。\n资产仍为文字候选，正式生成前须核对并绑定真实图像参考。\n请保留本包目录结构；请勿把原包和精简包放在同一个导入目录中。\n','utf8'));
 add(at('文件校验.json'),jsonBytes(compact.map(f=>({'文件':path.posix.relative(base,f.relativePath),'大小':f.bytes.length,sha256:f.sha256}))));
 compact.sort((a,b)=>a.relativePath.localeCompare(b.relativePath,'en'));
 const parsed=await inspectProductionPackage(compact);
 if(semantics(baseline.episodes)!==semantics(parsed.episodes)||JSON.stringify(baseline.ledger)!==JSON.stringify(parsed.ledger)||JSON.stringify(baseline.count)!==JSON.stringify(parsed.count))fail('精简前后制作数据不一致，未写出精简包');
 for(const original of originals)if(packageDigest(fs.readFileSync(path.join(source,...original.relativePath.split('/'))))!==original.sha256)fail('读取期间原始资料已改变，请重新执行');
 fs.mkdirSync(output,{recursive:true});
 for(const file of compact){const target=path.join(output,...file.relativePath.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file.bytes,{flag:'wx'});}
 const report={sourceDirectory:source,outputDirectory:output,originalFiles:originals.length,compactFiles:compact.length,originalBytes:originals.reduce((n,f)=>n+f.bytes.length,0),compactBytes:compact.reduce((n,f)=>n+f.bytes.length,0),count:parsed.count,exactPrompts:prompts,productionDataIdentical:true,assetRecordsIdentical:true,originalsUnchanged:true,hash:parsed.hash};
 return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [sourceDirectory,outputDirectory]=process.argv.slice(2);
 if(!sourceDirectory||!outputDirectory)fail('用法：node compact-prompt-package.mjs 原始资料包目录 新精简包目录');
 console.log(JSON.stringify(await buildCompactPromptPackage({sourceDirectory,outputDirectory}),null,2));
}
