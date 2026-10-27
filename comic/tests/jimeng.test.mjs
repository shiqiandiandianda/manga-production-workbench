import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {JimengBridge,buildJimengPrompt,isCanonicalJimengNodeId} from '../lib/jimeng.mjs';
import {buildImagePrompt,sourceKey} from '../lib/codex.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const schema=JSON.parse(fs.readFileSync(path.join(root,'tests','fixtures','dreamina-schema-1.0.2.json'),'utf8')).data;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const input={action:'generate',projectId:'project_'+randomUUID(),projectTitle:'mock',model:'canonical-model-from-live-list',mode:'t2i',ratio:'1:1',resolution:'1K',style:'漫画',shot:{code:'P001',title:'镜头',description:'光线与动作',embeddedTexts:[{type:'sfx',text:'嗖',placement:'动作后方'},{type:'system',text:'任务完成'}]},panel:{w:100,h:100,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]},referenceRoles:[]};
function contract(args){
  let command=schema,index=0;while(command.subcommands?.some(s=>s.name===args[index])){const name=args[index++];command=command.subcommands.find(s=>s.name===name);}
  const flags=new Map([...(command.flags||[]),...schema.globalFlags].map(f=>['--'+f.name,f]));
  for(;index<args.length;index++){const token=args[index];if(!token.startsWith('--'))continue;const flag=flags.get(token);assert.ok(flag,'Flag outside installed schema: '+token);if(flag.type!=='boolean'){index++;assert.ok(args[index]!==undefined);}}
  if(args.includes('--node-id'))assert.ok(isCanonicalJimengNodeId(args[args.indexOf('--node-id')+1]),'Node ID outside installed CLI canonical grammar');
  assert.ok(!args.includes('--yes'));assert.ok(args.includes('--non-interactive'));
}
function fixture(t,{confirmationRequired=true,runLost=false,quoteCredits=120,waitLost=false,downloadEscape=false,uploadLost=false,saveLost=false,confirmPriceChanged=false}={}){
  const directory=fs.mkdtempSync(path.join(root,'.runtime','jimeng-tests-')),job=path.join(directory,'job');fs.mkdirSync(job);const calls=[],resourceId=randomUUID();let price=quoteCredits,savedNode,confirmationFailed=false;
  const arg=(args,name)=>args[args.indexOf('--'+name)+1];
  const response=data=>({code:0,stdout:JSON.stringify({ok:true,data}),stderr:''});
  const runner=async(command,args,options)=>{
    contract(args);calls.push({args:[...args],env:options.env});
    if(args[0]==='version')return response({version:'1.0.2'});
    if(args[0]==='schema')return response(schema);
    if(args[0]==='auth')return response({loggedIn:true,profile:'default',region:'cn'});
    if(args[0]==='model')return response({items:[{model:input.model,type:'image',modes:[{name:'t2i',flags:[{flag:'--prompt',required:true},{flag:'--ratio',required:true,values:['1:1']},{flag:'--resolution',required:true,values:['1K']},{flag:'--count',min:1,max:1}],references:{min:0,max:0,types:[]}},{name:'i2i',flags:[{flag:'--prompt',required:true},{flag:'--ratio',required:true,values:['1:1']},{flag:'--resolution',required:true,values:['1K']}],references:{min:1,max:10,types:[{mediaType:'image',min:1,max:10}]}}]}]});
    if(args[0]==='canvas')return response({project:{projectId:arg(args,'project-id'),webUrl:'https://jimeng.jianying.com/canvas/mock'}});
    if(args[0]==='node'&&args[1]==='create'){savedNode={nodeId:arg(args,'node-id'),generation:{prompt:arg(args,'prompt'),model:arg(args,'model'),mode:arg(args,'mode')}};if(saveLost)throw new Error('lost save response');return response({node:savedNode});}
    if(args[0]==='node'&&args[1]==='show')return response({nodes:[{nodeId:arg(args,'node-id'),result:'FOUND',node:savedNode}],draftVersion:1});
    if(args[0]==='node'&&args[1]==='quote')return response({items:[{nodeId:arg(args,'node-id'),maxCredits:price}],totalMaxCredits:price,draftVersion:1,confirmationRequired,confirmable:true});
    if(args[0]==='node'&&args[1]==='confirm'){if(confirmPriceChanged&&!confirmationFailed){confirmationFailed=true;price=200;return {code:10,stdout:JSON.stringify({ok:false,error:{code:'cli.generation_confirmation_required',requiredAction:'confirm',message:'latest credits require approval'},creditConfirmation:{minimumCreditCeiling:200}})};}return response({creditConfirmationToken:'secret-credit-token-never-persist',creditCeiling:Number(arg(args,'credit-ceiling')),expiresAt:'tomorrow'});}
    if(args[0]==='node'&&args[1]==='run'){
      if(runLost)throw new Error('lost response after submission');
      return response({items:[{nodeId:arg(args,'node-id'),submitId:arg(args,'submit-id'),state:'ACCEPTED',resources:[{resourceId,state:'running'}]}]});
    }
    if(args[0]==='operation'){
      if(waitLost)return {code:20,stdout:JSON.stringify({ok:false,error:{code:'cli.operation_incomplete',requiredAction:'resume',message:'still running'}})};
      return response({operationRef:args[2],state:'success',resources:[{resourceId,state:'success'}]});
    }
    if(args[0]==='resource'&&args[1]==='upload'){if(uploadLost)throw new Error('lost upload response');return response({resourceId:arg(args,'resource-id'),mediaType:'image'});}
    if(args[0]==='resource'&&args[1]==='get')return response({resourceId:args[2],type:'image',status:'success'});
    if(args[0]==='resource'&&args[1]==='download'){const output=arg(args,'output');if(!downloadEscape)fs.writeFileSync(output,png);return response({resourceId:args[2],path:downloadEscape?'C:\\escape.png':output,size:png.length,sha256:createHash('sha256').update(png).digest('hex')});}
    throw new Error('Unexpected command: '+args.join(' '));
  };
  const bridge=new JimengBridge({command:'mock-cli.exe',runner,stateDir:path.join(directory,'state')});
  t.after(()=>{bridge.close();const target=path.resolve(directory),parent=path.resolve(path.join(root,'.runtime'));assert.ok(path.dirname(target)===parent&&path.basename(target).startsWith('jimeng-tests-'));fs.rmSync(target,{recursive:true,force:true});});
  return {bridge,job,calls,directory,setPrice:value=>price=value,state:()=>JSON.parse(fs.readFileSync(path.join(job,'jimeng-state.json'),'utf8'))};
}
test('官方报价需要批准时保存身份与草稿，不会confirm/run；同一job不会创建重复节点',async t=>{
 const f=fixture(t),first=await f.bridge.generate(f.job,input,[]),again=await f.bridge.generate(f.job,input,[]);
 assert.equal(first.awaitingConfirmation,true);assert.equal(first.quote.totalMaxCredits,120);assert.equal(first.recovery.submitId,again.recovery.submitId);
 assert.equal(f.calls.filter(c=>c.args[0]==='canvas').length,1);assert.equal(f.calls.filter(c=>c.args[0]==='node'&&c.args[1]==='create').length,1);assert.ok(f.calls.every(c=>!['run','confirm'].includes(c.args[1])));
 assert.ok(f.calls.every(c=>path.resolve(c.env.TEMP)===path.resolve(f.directory,'state/temp')&&path.resolve(c.env.DREAMINA_CANVAS_STATE_DIR)===path.resolve(f.directory,'state/cli-state')));
});
test('批准上限后用原submit运行；token只传运行参数不保存，文件校验后完成',async t=>{
 const f=fixture(t),first=await f.bridge.generate(f.job,input,[]),result=await f.bridge.generate(f.job,input,[],{approvalCeiling:120});
 assert.deepEqual(result.bytes,png);assert.equal(result.recovery.submitId,first.recovery.submitId);assert.equal(f.state().authorizedCreditCeiling,120);
 const saved=fs.readFileSync(path.join(f.job,'jimeng-state.json'),'utf8');assert.ok(!saved.includes('secret-credit-token'));assert.ok(!saved.includes('creditConfirmationToken'));assert.equal(f.calls.filter(c=>c.args[1]==='run').length,1);assert.equal(f.calls.filter(c=>c.args[1]==='confirm').length,1);
 assert.ok(f.calls.find(c=>c.args[1]==='run').args.includes('secret-credit-token-never-persist'));
});
test('最新报价提高不能跨越已批准ceiling，confirm与run均不调用',async t=>{
 const f=fixture(t);await f.bridge.generate(f.job,input,[]);f.setPrice(200);await assert.rejects(f.bridge.generate(f.job,input,[],{approvalCeiling:120}),/超过批准/);
 assert.equal(f.calls.filter(c=>c.args[1]==='run'||c.args[1]==='confirm').length,0);assert.equal(f.state().quote.totalMaxCredits,200);
});
test('run响应丢失后只查原operation，不重放提交或索要第二次token',async t=>{
 const f=fixture(t,{runLost:true});await f.bridge.generate(f.job,input,[]);await assert.rejects(f.bridge.generate(f.job,input,[],{approvalCeiling:120}),e=>e.recoverable===true);const submit=f.state().submitId;
 const result=await f.bridge.generate(f.job,input,[],{recoveryOnly:true});assert.deepEqual(result.bytes,png);assert.equal(result.recovery.submitId,submit);assert.equal(f.calls.filter(c=>c.args[1]==='run').length,1);assert.equal(f.calls.filter(c=>c.args[1]==='confirm').length,1);
});
test('wait返回20保留可恢复身份，不改成空成功；下载逃逸被拒绝',async t=>{
 const waiting=fixture(t,{confirmationRequired:false,waitLost:true});await assert.rejects(waiting.bridge.generate(waiting.job,input,[],{approvalCeiling:120}),e=>e.recoverable===true&&e.requiredAction==='resume');assert.equal(waiting.state().phase,'recoverable');assert.equal(waiting.calls.filter(c=>c.args[1]==='run').length,1);
 const escaping=fixture(t,{confirmationRequired:false,downloadEscape:true});await assert.rejects(escaping.bridge.generate(escaping.job,input,[],{approvalCeiling:120}),/下载路径/);assert.equal(escaping.state().phase,'downloading');
});
test('模型与参数严格来自实时目录，拒绝alias/非法分辨率/参考类型并且未写云端',async t=>{
 for(const patch of [{model:'marketing-alias'},{resolution:'4K'},{mode:'i2i'}]){const f=fixture(t);await assert.rejects(f.bridge.generate(f.job,{...input,...patch},[]));assert.equal(f.calls.filter(c=>c.args[0]==='canvas'||c.args[0]==='resource'||c.args[0]==='node').length,0);}
});
test('图内字进入两个provider的prompt，台词仍保留编辑层且指纹随图内字改变',()=>{
 assert.match(buildJimengPrompt(input),/嗖/);assert.match(buildJimengPrompt(input),/任务完成/);assert.match(buildImagePrompt(input),/系统牌匾/);
 assert.notEqual(sourceKey({style:input.style,references:[]},input.shot),sourceKey({style:input.style,references:[]},{...input.shot,embeddedTexts:['叮']}));
});

test('上传响应丢失或进程停在uploading，恢复只查原资源不重复上传',async t=>{
 const f=fixture(t,{uploadLost:true}),reference=path.join(f.directory,'reference.png');fs.writeFileSync(reference,png);const shot={...input,mode:'i2i'};
 await assert.rejects(f.bridge.generate(f.job,shot,[reference]),/lost upload/);const state=f.state();state.references[0].phase='uploading';fs.writeFileSync(path.join(f.job,'jimeng-state.json'),JSON.stringify(state));
 const result=await f.bridge.generate(f.job,shot,[reference]);assert.equal(result.awaitingConfirmation,true);assert.equal(f.calls.filter(c=>c.args[1]==='upload').length,1);assert.ok(f.calls.some(c=>c.args[1]==='get'&&c.args[2]===state.references[0].resourceId));
});

test('保存响应丢失后按真实nodes[].node契约回读同一节点，不重复创建',async t=>{
 const f=fixture(t,{saveLost:true,confirmationRequired:false});await assert.rejects(f.bridge.generate(f.job,input,[]),/lost save response/);const before=f.state();assert.equal(before.phase,'save_unknown');
 const restored=await f.bridge.generate(f.job,input,[],{preparationOnly:true});assert.equal(restored.awaitingConfirmation,true);assert.equal(restored.quote.confirmationRequired,false);assert.equal(restored.recovery.nodeId,before.nodeId);assert.equal(restored.recovery.submitId,before.submitId);
 assert.equal(f.calls.filter(c=>c.args[0]==='node'&&c.args[1]==='create').length,1);const shown=f.calls.find(c=>c.args[0]==='node'&&c.args[1]==='show');assert.ok(shown.args.includes(before.nodeId));assert.ok(f.calls.every(c=>!['run','confirm'].includes(c.args[1])));
});
test('即梦重绘明确底图是参考1，角色和画风参考编号按实际输入后移',()=>{
 const prompt=buildJimengPrompt({...input,action:'edit',editPrompt:'调整光线',referenceRoles:[{role:'character',name:'角色甲'},{role:'style',name:'画风乙'}]});
 assert.match(prompt,/1：当前格子原图/);assert.match(prompt,/2：character，角色甲/);assert.match(prompt,/3：style，画风乙/);
});

test('quote与confirm之间实时涨价保留原身份和新报价，批准新上限后才运行',async t=>{
 const f=fixture(t,{confirmPriceChanged:true}),first=await f.bridge.generate(f.job,input,[]);
 await assert.rejects(f.bridge.generate(f.job,input,[],{approvalCeiling:120}),error=>error.awaitingConfirmation===true&&error.quote.totalMaxCredits===200&&error.recovery.submitId===first.recovery.submitId);
 assert.equal(f.state().phase,'awaiting_confirmation');assert.notEqual(f.state().submissionAttempted,true);assert.equal(f.calls.filter(c=>c.args[1]==='run').length,0);
 const done=await f.bridge.generate(f.job,input,[],{approvalCeiling:200});assert.equal(done.recovery.submitId,first.recovery.submitId);assert.equal(f.calls.filter(c=>c.args[1]==='run').length,1);assert.equal(f.calls.filter(c=>c.args[0]==='node'&&c.args[1]==='create').length,1);
});

test('即梦恢复记录允许明确隔离数据目录，并拒绝该目录之外的任务',async t=>{
 const {default:os}=await import('node:os');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'漫画 恢复路径-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
 const bridge=new JimengBridge({taskRoot:directory,stateDir:path.join(directory,'provider-jimeng'),command:'fixture-never-run',runner:()=>{throw Error('This path test must not invoke any CLI');}});
 const job=path.join(directory,'jobs','中文 空格');fs.mkdirSync(job,{recursive:true});assert.equal(bridge.recordFile(job),path.join(job,'jimeng-state.json'));
 assert.throws(()=>bridge.recordFile(path.join(os.tmpdir(),'outside-task')),/本次数据目录/);assert.equal(path.resolve(bridge.runtimeEnv().DREAMINA_CANVAS_STATE_DIR),path.resolve(directory,'provider-jimeng/cli-state'));bridge.close();
});
