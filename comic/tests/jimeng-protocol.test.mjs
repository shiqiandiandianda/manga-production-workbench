import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createJimengNodeId,isCanonicalJimengNodeId,parseCliEnvelope,JimengBridge} from '../lib/jimeng.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const stderrFixture=fs.readFileSync(path.join(root,'tests','fixtures','dreamina-local-error-stderr.json'),'utf8');
test('真实CLI错误输出形态：exit2空stdout+完整stderr错误envelope可解析并保留validation',async()=>{
 const bridge=new JimengBridge({command:'never-launched-mock-cli',runner:async()=>({code:2,stdout:'',stderr:stderrFixture})});
 try{await assert.rejects(bridge.invoke(['node','show','--node-id','node_bad']),error=>error.code==='cli.invalid_node_id'&&error.validation.reasonCode==='node_id_invalid'&&error.validation.fieldPath==='nodeId'&&error.validation.detail==='Use node_ followed by 10 lowercase Crockford Base32 characters.');}finally{bridge.close();}
});
test('完整stdout JSON兼容BOM和外围空白，stderr不能作为成功响应',()=>{
 const value={schemaVersion:'1',ok:true,data:{loggedIn:true}};
 assert.deepEqual(parseCliEnvelope({code:0,stdout:'\uFEFF\n'+JSON.stringify(value)+'\r\n',stderr:''},['auth','status']),value);
 assert.throws(()=>parseCliEnvelope({code:0,stdout:'',stderr:JSON.stringify(value)},['auth','status']),error=>error.protocol.outputKind==='empty_stdout');
});
test('混合日志、截断、非envelope和进程信号只输出脱敏诊断，绝不grep猜成功',()=>{
 for(const [result,kind] of [
  [{code:1,stdout:'WARNING Bearer secret-test\n{"ok":true,"data":{}}',stderr:'signed https://example.invalid/?token=secret-test'},'mixed_or_non_json_stdout'],
  [{code:0,stdout:'{"ok":true,"data":{}}',stderr:'',stdoutTruncated:true,stdoutBytes:9000000},'truncated_stdout'],
  [{code:0,stdout:'{"message":"partial result"}',stderr:''},'unexpected_envelope'],
  [{code:null,signal:'SIGTERM',stdout:'',stderr:''},'process_signalled'],
  [{code:2,stdout:'',stderr:'WARNING\n'+stderrFixture},'empty_stdout']
 ]){
  assert.throws(()=>parseCliEnvelope(result,['node','create','image','--prompt','secret-test']),error=>error.code==='jimeng_protocol_error'&&error.protocol.outputKind===kind&&!JSON.stringify(error.protocol).includes('secret-test')&&!error.message.includes('secret-test'));
 }
});
test('云Node ID按本地官方Crockford格式生成，UUID和非小写/易混字母不会通过',()=>{
 const generated=Array.from({length:200},createJimengNodeId);assert.equal(new Set(generated).size,generated.length);assert.ok(generated.every(isCanonicalJimengNodeId));assert.ok(generated.every(value=>value.length===15));
 for(const invalid of ['node_00000000-0000-0000-0000-000000000000','node_012345678','node_01234567890','node_abcdefghiu','node_ABCDEFGHJK'])assert.equal(isCanonicalJimengNodeId(invalid),false);
});
test('CLI validation detail清理访问地址和凭证，仅保留公开字段',async()=>{
 const data=JSON.parse(stderrFixture);data.error.validation.detail='bad https://example.invalid/?token=private-test Bearer private-test';
 const bridge=new JimengBridge({command:'never-launched-mock-cli',runner:async()=>({code:2,stdout:'',stderr:JSON.stringify(data)})});
 try{await assert.rejects(bridge.invoke(['node','show','--node-id','node_bad']),error=>error.validation.detail.includes('[已隐藏')&&!error.validation.detail.includes('private-test'));}finally{bridge.close();}
});
