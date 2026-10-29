import test from 'node:test';
import assert from 'node:assert/strict';
import {publishAtStartup} from '../startup-publication.mjs';

const conflict=()=>Object.assign(Error('主版本本机修改与同事已发布代码冲突：comic/public/app.js。请先合并，未覆盖团队版本。'),{status:409});
test('源代码冲突保留同一已发布版本，允许团队服务继续启动，不重试或强推',async()=>{
 const latest={manifest:{contentId:'signed-existing',version:'V19'},signature:'unchanged'},before=JSON.stringify(latest),messages=[];let calls=0;
 const result=await publishAtStartup({latest,async publish(options){assert.deepEqual(options,{force:true});calls++;throw conflict();}},{report:m=>messages.push(m)});
 assert.equal(result,latest);assert.equal(JSON.stringify(latest),before);assert.equal(calls,1);assert.equal(messages.length,1);assert.match(messages[0],/待合并/);
});
test('首次启动没有已发布版本时，发布冲突不能伪装为服务就绪',async()=>{
 await assert.rejects(()=>publishAtStartup({latest:null,publish:async()=>{throw conflict();}}),/代码冲突/);
});
test('正常启动发布照常返回结果',async()=>{
 const release={manifest:{contentId:'new'}},result=await publishAtStartup({publish:async()=>release});assert.equal(result,release);
});
test('语法错误、读取失败或其他409仍向启动器报告',async()=>{
 for(const error of [Object.assign(Error('语法检查失败'),{status:422}),Error('磁盘读取失败'),Object.assign(Error('其他冲突'),{status:409})]){
  await assert.rejects(()=>publishAtStartup({latest:{manifest:{contentId:'old'}},publish:async()=>{throw error;}}),e=>e===error);
 }
});
