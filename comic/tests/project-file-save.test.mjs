import test from 'node:test';import assert from 'node:assert/strict';import {saveProjectFile,projectFileName} from '../public/project-file-save.js';
const setup=()=>{const calls=[],state={id:'p'},args={projectId:'p',title:'工程/测试',currentProjectId:()=>state.id,chooseFile:async options=>{calls.push(['pick',options]);return {name:'工程.comic.json',createWritable:async()=>({write:async text=>calls.push(['write',JSON.parse(text)]),close:async()=>calls.push(['close']),abort:async()=>calls.push(['abort'])})}},flushSave:async()=>calls.push(['flush']),exportProject:async id=>(calls.push(['export',id]),{format:'comic-strip-studio',version:2,project:{id},assets:[]})};return {args,calls,state};};
test('选择路径后先保存当前工程，再写可打开的工程快照',async()=>{const {args,calls}=setup(),result=await saveProjectFile(args);assert.equal(result.cancelled,false);assert.deepEqual(calls.map(v=>v[0]),['pick','flush','export','write','close']);assert.equal(calls[0][1].suggestedName,'工程_测试.json');assert.equal(calls[3][1].format,'comic-strip-studio');});
test('取消、工程切换、失败及无选择器时不写文件',async()=>{let x=setup();x.args.chooseFile=async()=>{throw Object.assign(Error('cancel'),{name:'AbortError'})};assert.equal((await saveProjectFile(x.args)).cancelled,true);assert.equal(x.calls.length,0);x=setup();x.args.chooseFile=async()=>{x.state.id='another';return {}};await assert.rejects(saveProjectFile(x.args),/工程已切换/);assert.equal(x.calls.length,0);x=setup();x.args.flushSave=async()=>{throw Error('保存失败')};await assert.rejects(saveProjectFile(x.args),/保存失败/);assert.deepEqual(x.calls.map(v=>v[0]),['pick']);x=setup();x.args.chooseFile=undefined;await assert.rejects(saveProjectFile(x.args),/浏览器不支持/);assert.equal(projectFileName('A:B.'),'A_B.json');});

test('已绑定 JSON 直接写回同一文件；外部修改和权限拒绝不覆盖',async()=>{
 const x=setup(),writes=[];let modified=10,size=20;
 const handle={name:'原工程.json',getFile:async()=>({lastModified:modified,size}),requestPermission:async()=> 'granted',createWritable:async()=>({write:async text=>writes.push(text),close:async()=>{modified++;size++;}})};
 x.args.binding={handle,stamp:{lastModified:10,size:20}};x.args.chooseFile=()=>{throw Error('不应该另存为');};
 const saved=await saveProjectFile(x.args);assert.equal(writes.length,1);assert.equal(saved.binding.handle,handle);
 x.args.binding=saved.binding;modified++;await assert.rejects(saveProjectFile(x.args),/其他窗口或程序修改/);assert.equal(writes.length,1);
 handle.requestPermission=async()=> 'denied';await assert.rejects(saveProjectFile(x.args),/写入权限/);assert.equal(writes.length,1);
});
