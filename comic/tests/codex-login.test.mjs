import test from 'node:test';
import assert from 'node:assert/strict';
import {createCodexLogin,officialCodexLoginUrl} from '../lib/codex-login.mjs';
import {CodexBridge} from '../lib/codex.mjs';
import {bridgeError} from '../lib/process.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,options={}){
 const attempts=[],stopped=[];
 const bridge={login(onChild,settings){return new Promise((resolve,reject)=>{const child={id:attempts.length};attempts.push({resolve,reject,settings,child});onChild(child);});}};
 const login=createCodexLogin(bridge,{stop:child=>{if(child)stopped.push(child);},...options});t.after(()=>login.close());return {login,attempts,stopped};
}
test('login URLs require an exact official HTTPS host without credentials or custom ports',()=>{
 for(const u of ['http://auth.openai.com/a','https://auth.openai.com.bad.test/','javascript:alert(1)','https://user:secret@chatgpt.com/','https://chatgpt.com:999/a'])assert.equal(officialCodexLoginUrl(u),null);
 assert.equal(officialCodexLoginUrl('https://auth.openai.com/authorize?state=fixture'),'https://auth.openai.com/authorize?state=fixture');
});
test('duplicate login is idempotent; public state excludes tokens and completion needs an explicit receipt',async t=>{
 const f=fixture(t),first=f.login.start();assert.equal(f.login.start().attemptId,first.attemptId);await tick();assert.equal(f.attempts.length,1);
 f.attempts[0].settings.onEvent({type:'login',authUrl:'https://auth.openai.com/fixture',accessToken:'private',userCode:'discarded'});
 assert.equal(f.login.snapshot().state,'waiting');assert.equal(f.login.snapshot().accessToken,undefined);assert.equal(f.login.snapshot({links:false}).authUrl,undefined);assert.equal(f.login.snapshot().userCode,undefined);
 f.attempts[0].resolve({code:0});await tick();assert.equal(f.login.snapshot().state,'failed');assert.equal(f.login.snapshot().authUrl,undefined);
 f.login.start();await tick();f.attempts[1].resolve({code:0,connected:true});await tick();assert.equal(f.login.snapshot().state,'completed');
});
test('cancel protects against stale tabs and late completion cannot overwrite a newer attempt',async t=>{
 const f=fixture(t),first=f.login.start();await tick();assert.throws(()=>f.login.cancel('stale'),/登录已变化/);assert.throws(()=>f.login.start('device'),/先取消/);
 f.login.cancel(first.attemptId);assert.equal(f.stopped.length,1);const second=f.login.start('device');await tick();
 f.attempts[0].resolve({code:0,connected:true});await tick();assert.equal(f.login.snapshot().attemptId,second.attemptId);assert.equal(f.login.snapshot().running,true);
 f.attempts[1].settings.onEvent({type:'login',authUrl:'https://auth.openai.com/codex/device',userCode:'ABCD-1234'});assert.equal(f.login.snapshot().userCode,'ABCD-1234');
 f.attempts[1].reject(Error('failed Bearer fake-credential https://auth.openai.com/?secret=fixture'));await tick();assert.equal(f.login.snapshot().state,'failed');assert.doesNotMatch(f.login.snapshot().message,/fake-credential|secret=fixture/);
});
test('login timeout stops only its own process and clears the temporary link',async t=>{
 const f=fixture(t,{timeoutMs:15});f.login.start();await tick();f.attempts[0].settings.onEvent({type:'login',authUrl:'https://auth.openai.com/fixture'});
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(f.login.snapshot().state,'expired');assert.equal(f.stopped.length,1);assert.equal(f.login.snapshot().authUrl,undefined);
});
test('cancelling before startup does not launch a login child',async t=>{
 const f=fixture(t),initial=f.login.start();f.login.cancel(initial.attemptId);await tick();assert.equal(f.attempts.length,0);assert.equal(f.login.snapshot().state,'cancelled');
});
test('bridge maps explicit missing ChatGPT login to an actionable state; network errors stay failures',async t=>{
 const bridge=new CodexBridge({env:{COMIC_CODEX_BIN:process.execPath,COMIC_PYTHON_BIN:process.execPath},runner:async()=>({code:0,stdout:'codex-test',stderr:''})});t.after(()=>bridge.close());
 bridge._request=async()=>{throw bridgeError('请完成官方登录',{code:'chatgpt_login_required',stage:'account/read'});};
 let state=await bridge.status({force:true,checkSession:true});assert.equal(state.needsLogin,true);assert.equal(state.connectionState,'needs_login');assert.equal(state.sessionReady,false);
 bridge._request=async()=>{throw bridgeError('网络故障',{code:'workspace_routing_timeout'});};state=await bridge.status({force:true,checkSession:true});assert.equal(state.needsLogin,false);assert.equal(state.connectionState,'temporary_failure');
});
test('bridge only forwards ceremony fields and does not treat process exit as login success',async t=>{
 const seen=[];let confirm=false;
 const bridge=new CodexBridge({env:{COMIC_CODEX_BIN:process.execPath,COMIC_PYTHON_BIN:process.execPath},runner:async(_command,args,{onLine})=>{
  assert.deepEqual(args.slice(-2),['--login-method','device']);onLine(JSON.stringify({type:'login',authUrl:'https://auth.openai.com/codex/device',userCode:'ABCD-1234',accessToken:'secret'}));
  if(confirm)onLine(JSON.stringify({type:'result',connected:true}));return {code:0,stdout:'private',stderr:''};
 }});t.after(()=>bridge.close());
 assert.equal((await bridge.login(()=>{},{method:'device',onEvent:e=>seen.push(e)})).connected,false);confirm=true;
 assert.equal((await bridge.login(()=>{},{method:'device',onEvent:e=>seen.push(e)})).connected,true);assert.deepEqual(Object.keys(seen[0]).sort(),['authUrl','type','userCode']);
});
