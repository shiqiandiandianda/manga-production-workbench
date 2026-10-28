import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import catalog from './catalog.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const missing=[...new Set([...catalog.features.flatMap(f=>[...f.source,...f.tests]),...catalog.flows.flatMap(f=>f.tests)])].filter(f=>!fs.existsSync(path.join(root,f)));
if(missing.length)throw Error('清单引用不存在：\n'+missing.join('\n'));
const code = files => files.map(f=>'`'+f+'`').join('、');
let out=`# 工作台功能、用户强感知功能与工作链路\n\n基准：GitHub 仓库 dev 的 b2b2f0b2965ada4df52554161bbfe596d3201c46 与本候选分支改动。此清单依据源码文件和对应测试登记，不代表逐项真实用户验收，也不能保证遗漏功能为零；测试关联为文件级证据。使用运行报告的 coverage.json 核对本次哪些测试实际通过。\n\n`;
out+=`共 ${catalog.features.length} 项功能（其中 ${catalog.features.filter(x=>x.core).length} 项列为强感知重点），${catalog.flows.length} 条链路（其中 ${catalog.flows.filter(x=>x.core).length} 条核心链路）。\n\n`;
let group='';for(const f of catalog.features){if(group!==f.group){group=f.group;out+=`## ${group}\n\n`;}
  out+=`- **${f.id} ${f.name}**${f.core?' 【强感知】':''}。入口：${f.entry}；边界：${f.boundary}。源码：${code(f.source)}；关联测试：${f.tests.length?code(f.tests):'未建立自动测试'}。\n`;
}
out+='\n## 工作链路\n\n';for(const f of catalog.flows)out+=`- **${f.id} ${f.name}**${f.core?' 【核心链路】':''}：${f.steps}。边界：${f.boundary}；关联测试：${f.tests.length?code(f.tests):'未建立自动测试'}。\n`;
out+='\n## 验收边界\n\n- 运行器中的“全量”是当前仓库发现的测试全集和已登记链路，不等于所有动作都有独立断言或已经真实操作。缺失、失败、跳过及超时需要单独处理。\n- 墨库测试包含模拟接口，以及配置 `QUALITY_MOKU_SOURCE` 后对本地 1.1.0／2.0.1／2.0.2 实际代码的普通合成账号闭环。生产墨库需要普通账号和隔离测试项目做另行联调；不要向生产资料写入。\n- 本分支新增逐话正式版本联动；不能把源代码或合成测试等同于生产验收。多话工程含尚不能拆分的额外字段时会明确阻止提交。真实生图、跨机协作、视觉质量和部署均须另行验收。\n';
const target=path.join(here,'功能与链路清单.md');fs.writeFileSync(target,out);
const excluded=new Set(['.git','node_modules','runtime','runtime-data','.runtime','.quality-deps','audit','audit-data','verification','outputs','cache','data','quality-runs','__pycache__']),testFiles=[];
function scan(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(ent.isSymbolicLink()||excluded.has(ent.name))continue;const file=path.join(dir,ent.name);if(ent.isDirectory())scan(file);else if(/\.(?:test|spec)\.[cm]?js$/.test(ent.name)||/^test_.*\.py$/.test(ent.name))testFiles.push(file);}}
scan(root);let index='# 自动化用例索引（静态发现）\n\n此索引按当前源码中的测试文件和用例名称生成，用于发现现有测试，不代表测试已执行或通过。动态生成的测试标题可能无法完整识别；实际结果以运行报告为准。\n\n',names=0;
for(const file of testFiles.sort()){
  const text=fs.readFileSync(file,'utf8'),relative=path.relative(root,file).replaceAll('\\','/');
  const titles=file.endsWith('.py')?[...text.matchAll(/^\s*def\s+(test_[A-Za-z0-9_]+)\s*\(/gm)].map(m=>m[1]):[...text.matchAll(/\b(?:test|it)(?:\.(?:skip|todo|only))?\s*\(\s*(['"`])([^\r\n]*?)\1/g)].map(m=>m[2]);
  names+=titles.length;index+=`## ${relative}\n\n`+(titles.length?titles.map(title=>'- '+title.replaceAll('\n',' ')).join('\n'):'- 动态标题或无法从源码静态提取。')+'\n\n';
}
fs.writeFileSync(path.join(here,'自动化用例索引.md'),index.trimEnd()+'\n');
console.log(`已生成 ${target}；功能 ${catalog.features.length}；链路 ${catalog.flows.length}；发现 ${testFiles.length} 个测试文件、${names} 个静态标题。`);
