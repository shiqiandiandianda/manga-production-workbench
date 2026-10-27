// 回退用：把分片存储（studio.json 索引 + projects/*.json）合并成旧版单文件，供 0.5.1 及更早版本读取。
// 用法：node tools/store-export-v1.mjs <主平台数据目录>   （需先停止工作台）
// 结果写到 <数据目录>/studio.v1-export.json；回退时把它改名为 studio.json 即可，原文件不改动。
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function exportLegacyDatabase(dataDir){
 const index=JSON.parse(fs.readFileSync(path.join(dataDir,'studio.json'),'utf8'));
 if(index.storage!==2)throw new Error('数据目录已经是旧版单文件格式，无需转换');
 const {storage,projectOrder=[],...rest}=index;
 const projects=projectOrder.map(id=>{const project=JSON.parse(fs.readFileSync(path.join(dataDir,'projects',id+'.json'),'utf8'));if(project.id!==id)throw new Error('工程文件编号不一致：'+id);return project;});
 const output=path.join(dataDir,'studio.v1-export.json');
 fs.writeFileSync(output,JSON.stringify({...rest,projects},null,2),'utf8');
 return {output,projects:projects.length};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const dir=process.argv[2];if(!dir){console.error('用法：node tools/store-export-v1.mjs <主平台数据目录>');process.exit(2);}
 try{const result=exportLegacyDatabase(path.resolve(dir));console.log(`已导出 ${result.projects} 个工程：${result.output}`);}catch(error){console.error(error.message);process.exitCode=1;}
}
