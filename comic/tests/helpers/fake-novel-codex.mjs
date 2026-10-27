// Local RPC fixture only: no external connection, login or image tool.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import assert from 'node:assert/strict';
assert.ok(process.argv.includes('--disable')&&process.argv.includes('image_generation'));
assert.ok(!process.argv.includes('--enable'));
assert.equal(process.env.OPENAI_API_KEY,undefined);assert.equal(process.env.CODEX_API_KEY,undefined);
const columns=['格号','出现角色','当前场景','当前天气','当前时间','景别','机位角度','画面内容','台词','特效字','画面备注'];
const row={episode:1,page:1,...Object.fromEntries(columns.map(c=>[c,''])),格号:'1',出现角色:'甲',当前场景:'山林',当前天气:'晴',当前时间:'白天',景别:'中景',机位角度:'平视',画面内容:'甲拿着珠子站在石道前。',台词:'甲：我收下了。',画面备注:'待审核',bindings:[],internal:{节拍:'揭示',强度:'3',情绪:'好奇'}};
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
for await(const line of readline.createInterface({input:process.stdin})){let request;try{request=JSON.parse(line);}catch{continue;}if(request.id===undefined)continue;const method=request.method;let result={};
  if(method==='account/read')result={account:{type:'chatgpt',email:'fixture@example.invalid'}};
  if(method==='thread/start'){assert.equal(request.params.sandbox,'read-only');assert.equal(request.params.approvalPolicy,'never');const cwd=path.resolve(request.params.cwd),allowed=path.resolve(process.env.FAKE_NOVEL_ROOT);assert.ok(cwd===allowed||cwd.startsWith(allowed+path.sep));result={thread:{id:'fixture-thread'}};}
  if(method==='turn/start')result={turn:{id:'fixture-turn'}};
  emit({id:request.id,result});if(method!=='turn/start')continue;
  const prompt=request.params.input.find(item=>item.type==='text').text,stage=prompt.includes('ORIGINAL_SOURCE_JSON')?'facts':prompt.includes('CROSS_CHECK_JSON')?'check':'storyboard';
  if(process.env.FAKE_NOVEL_TRACE)fs.appendFileSync(process.env.FAKE_NOVEL_TRACE,JSON.stringify({stage,prompt})+'\n');
  let payload=stage==='facts'?[{chapter:1,paragraph:1,kind:'事件',quote:'甲收下珠子，没有吞服。',command:'must be discarded'}]:stage==='check'?[{episode:1,level:'conflict',message:'原著本章未吞服，甲方细纲需核对。',sourceIds:['F1','C1_1'],command:'must be discarded'}]:[row];
  if(process.env.FAKE_NOVEL_PAYLOAD)payload=JSON.parse(process.env.FAKE_NOVEL_PAYLOAD);
  if(process.env.FAKE_NOVEL_MODE==='empty-check'&&stage==='check')payload=[];
  if(process.env.FAKE_NOVEL_MODE==='unbound-check'&&stage==='check')payload=[{episode:1,level:'conflict',message:'合成无来源冲突',sourceIds:['F1','C999_1']}];
  if(['retry-then-success','retry-then-fail'].includes(process.env.FAKE_NOVEL_MODE)){
    emit({method:'error',params:{threadId:'fixture-thread',turnId:'fixture-turn',willRetry:true,error:{message:'Reconnecting... 2/5',additionalDetails:'synthetic stream disconnected before completion'}}});
    if(process.env.FAKE_NOVEL_MODE==='retry-then-fail'){
      const error={message:'synthetic retry limit reached',additionalDetails:'synthetic connection closed'};
      emit({method:'error',params:{threadId:'fixture-thread',turnId:'fixture-turn',willRetry:false,error}});
      emit({method:'turn/completed',params:{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'failed',error}}});continue;
    }
  }
  const text=JSON.stringify(payload);emit({method:'item/completed',params:{threadId:'fixture-thread',turnId:'fixture-turn',item:{type:'agentMessage',phase:'final_answer',text}}});emit({method:'turn/completed',params:{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'completed'}}});
}
