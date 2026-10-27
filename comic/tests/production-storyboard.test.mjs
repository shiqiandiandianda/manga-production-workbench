import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readXlsx,writeXlsx,writeZip,STYLE} from '../lib/xlsx.mjs';



import {createStudio} from '../server.mjs';
import {panel,polygonFor} from '../public/model.js';

import {sourceOriginalPath} from '../lib/source-originals.mjs';


const root=fileURLToPath(new URL('../',import.meta.url));
function tempDir(t,prefix){const parent=path.join(root,'.runtime','temp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,prefix));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

// A short invented novel: the production table is validated against it.
const NOVEL=['《测试小说》','作者：某某','','##第1章 雨夜','阿青蹲在檐下擦着剑。','“今晚有雨，别出门。”老周说。','“我偏要去看看。”','阿青笑了笑，把剑收进鞘里。','夜色降临，雨越下越大。','##第二章 来客','“开门！”门外有人喊道。','老周吓得一哆嗦，手里的灯差点掉了。','“谁？”','##第3章 不导入','“这一章不该出现。”'].join('\n');
const CLIENT_ROWS=[
  // 格号, 出现角色, 当前场景, 当前天气, 当前时间, 景别, 机位角度, 画面内容, 台词, 特效字, 画面备注
  [1,'阿青','小院','晴','傍晚','远景','俯拍','小院全景，阿青蹲在檐下擦剑','','','场景资产#1'],
  [2,'阿青、老周','小院','晴','傍晚','中景','平视','老周推门出来，压低声音劝阻','今晚有雨，别出门。','',''],
  [3,'阿青、老周','小院','晴','傍晚','近景','平视','阿青抬头，笑着回答','我偏要去看看！','',''],
  [4,'阿青','小院','晴','傍晚','特写','平视','阿青把剑收进剑鞘','','',''],
  [5,'阿青','小院','晴','傍晚','全景','平视','夜色降临，雨越下越大','','【转场】','场景资产#1'],
  [6,'阿青、灯笼','小院','晴','傍晚','近景','侧拍','闪回：小时候的阿青第一次握剑','剑要握稳。','【闪回·冷调】',''],
  [7,'老周','小院','晴','傍晚','特写','仰拍','门外突然有人重重拍门','开门！','砰',''],
];

const planWorkbook=()=>writeXlsx([
  {name:'角色资产表',rows:[['编号','角色','身份/功能','视觉设定'],[1,'阿青','主角','黑衣少年'],[2,'老周','老仆','驼背老人']]},
  {name:'场景资产表',rows:[['编号','场景','视觉设计要点','色彩/光影'],[1,'小院','青瓦小院','暖灰']]},
  {name:'道具视觉资产',rows:[['编号','资产/道具','视觉设计要点','剧情功能'],[1,'剑与剑鞘','旧铁剑','主角武器']]},
  {name:'60话分集细纲',rows:[['话数','单元','原著参考章节','话名','本话目标','预计格数'],[1,'单元一','第1-2章','雨夜来客','建立阿青的倔强',7]]}
]);


test('xlsx 读写：文本换行、特殊字符、数字、隐藏表、下拉与共享字符串表',()=>{
  const book=writeXlsx([{name:'表',rows:[[{v:'表头',s:STYLE.header},'数'],['甲&<>"\n乙',3.5],[null,true]],freeze:{row:1},filter:true,validations:[{range:'A2:A9',list:['甲','乙']},{range:'B2:B9',decimal:[0,2]}]},{name:'选项',rows:[['x']],hidden:true}]);
  assert.deepEqual(readXlsx(book),[{name:'表',rows:[['表头','数'],['甲&<>"\n乙',3.5],[null,true]]},{name:'选项',rows:[['x']]}]);
  // Excel 常用的 sharedStrings 与富文本写法也能读取。
  const shared=writeZip([
    {name:'xl/workbook.xml',data:'<workbook xmlns:r="r"><sheets><sheet name="第1话" sheetId="1" r:id="rId1"/></sheets></workbook>'},
    {name:'xl/_rels/workbook.xml.rels',data:'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'},
    {name:'xl/sharedStrings.xml',data:'<sst><si><t>格号</t></si><si><r><t>画面</t></r><r><t xml:space="preserve">内容</t></r><rPh><t>がめん</t></rPh></si></sst>'},
    {name:'xl/worksheets/sheet1.xml',data:'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="3"><c r="B3"><v>12</v></c><c r="C3" t="str"><v>a&amp;b</v></c></row></sheetData></worksheet>'}]);
  assert.deepEqual(readXlsx(shared),[{name:'第1话',rows:[['格号',null,'画面内容'],[],[null,12,'a&b']]}]);
  assert.throws(()=>readXlsx(Buffer.from('not a zip')),/xlsx/);
});

















async function studioFor(t){
  const dir=tempDir(t,'production-flow-');let generations=0;
  const studio=createStudio({dataDir:dir,bridge:{status:async()=>({connected:true,imageFeature:true}),generate:async()=>{generations++;return {bytes:Buffer.alloc(0)};},close(){}},jimengBridge:{status:async()=>({connected:false}),close(){}},storyboardGenerator:{close(){}},seedReference:false});
  await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{studio.close();await new Promise(resolve=>studio.server.close(resolve));});
  const base='http://127.0.0.1:'+studio.server.address().port;
  const request=async(route,method='GET',data)=>{const response=await fetch(base+route,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});return {status:response.status,data:await response.json()};};
  const project=(await request('/api/projects','POST',{title:'生产合成测试'})).data,route=`/api/projects/${project.id}/storyboard`,revision=()=>studio.store.db.projects.find(p=>p.id===project.id).revision;
  const call=(input)=>request(route,'POST',{expectedRevision:revision(),...input});
  return {studio,request,call,route,project:()=>studio.store.db.projects.find(p=>p.id===project.id)};
}



test('分镜原件只在检查确认并成功建工程后落盘，编辑器不能删除记录',async t=>{
 const f=await studioFor(t),bytes=Buffer.from(JSON.stringify([{code:'1',description:'合成原画面。',dialogue:'甲：原台词。'}]),'utf8');
 const checked=await f.request('/api/storyboards/check','POST',{name:'甲方分镜原件.json',dataBase64:bytes.toString('base64')});assert.equal(checked.status,200);
 assert.equal(fs.existsSync(path.join(f.studio.store.root,'original-uploads')),false);
 const confirmed=await f.request('/api/storyboards/check/'+checked.data.id+'/confirm','POST',{fileKey:checked.data.fileKey,sheet:checked.data.sheet,expectedVersion:checked.data.version});assert.equal(confirmed.status,200);
 const {createRuleProject}=await import('../public/rule-engine.js'),{nativeMeasurement}=await import('../lib/text-measure.mjs');
 const project=createRuleProject('原件交接',confirmed.data.shots,{},nativeMeasurement());
 const saved=await f.request('/api/projects/rule-layout','POST',{project,importCheck:confirmed.data.receipt});assert.equal(saved.status,201,JSON.stringify(saved.data));
 const original=saved.data.sourceOriginalFiles[0];assert.equal(original.role,'storyboard');assert.equal(original.name,'甲方分镜原件.json');assert.equal(original.hash,checked.data.fileKey);
 assert.deepEqual(fs.readFileSync(sourceOriginalPath(f.studio.store.root,saved.data.id,original.hash)),bytes);
 const edited=structuredClone(saved.data);delete edited.sourceOriginalFiles;
 const updated=await f.request('/api/projects/'+edited.id,'PUT',edited);assert.equal(updated.status,200,JSON.stringify(updated.data));assert.deepEqual(updated.data.sourceOriginalFiles,[original]);
});
















