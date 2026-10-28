import {randomUUID} from 'node:crypto';
import {check} from './store.mjs';
import {redact,stopChild} from './process.mjs';

export function officialCodexLoginUrl(value){
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&['auth.openai.com','auth0.openai.com','chatgpt.com'].includes(url.hostname)?url.href:null;
  }catch{return null;}
}
const message=value=>redact(String(value||'')).replace(/https?:\/\/\S+/gi,'[登录链接已隐藏]').slice(0,500);

// Only public ceremony state is kept here. Tokens remain in the official Codex process.
export function createCodexLogin(bridge,{stop=stopChild,now=Date.now,timeoutMs=280000}={}){
  let active=null,state={running:false,state:'idle',message:''};
  const snapshot=({links=true}={})=>{
    const result={...state};
    if(!links){delete result.authUrl;delete result.userCode;}
    return result;
  };
  function finish(attempt,next){
    if(active!==attempt)return;
    clearTimeout(attempt.timer);active=null;
    state={attemptId:state.attemptId,method:state.method,startedAt:state.startedAt,running:false,...next};
  }
  function start(method='browser'){
    check(['browser','device'].includes(method),'登录方式只能为 browser 或 device',400);
    check(typeof bridge.login==='function','当前 Codex 通道不支持登录，请更新工作台',409);
    if(active){check(state.method===method,'已有登录正在进行，请先取消本次登录再更换方式',409);return snapshot();}
    const attempt={child:null,timer:null};active=attempt;
    state={attemptId:randomUUID(),method,running:true,state:'starting',startedAt:now(),expiresAt:now()+timeoutMs,message:'正在准备官方登录页面…'};
    attempt.timer=setTimeout(()=>{
      finish(attempt,{state:'expired',message:'本次登录等待已超时，请重新开始登录。'});
      stop(attempt.child);
    },timeoutMs);attempt.timer.unref?.();
    Promise.resolve().then(()=>active!==attempt?{code:1}:bridge.login(child=>{
      if(active===attempt)attempt.child=child;else stop(child);
    },{method,onEvent:event=>{
      if(active!==attempt||event?.type!=='login')return;
      const authUrl=officialCodexLoginUrl(event.authUrl);
      if(!authUrl){finish(attempt,{state:'failed',message:'Codex 返回的登录链接无效，请重试或使用终端登录。'});stop(attempt.child);return;}
      state={...state,state:'waiting',authUrl,message:method==='device'?'在官方页面输入下方设备码，完成授权后这里会自动检查连接。':'在官方页面完成 ChatGPT 登录，完成后这里会自动检查连接。'};
      if(method==='device'&&/^[A-Za-z0-9-]{4,32}$/.test(event.userCode||''))state.userCode=event.userCode;
    }})).then(result=>{
      finish(attempt,result.code===0&&result.connected===true?{state:'completed',message:'官方登录已完成，正在检查账号与会话连接。'}:{state:'failed',message:message(result.message||'未收到官方登录成功确认，请重试。')});
    },error=>finish(attempt,{state:'failed',message:message(error.message||'官方登录未完成，请重试。')}));
    return snapshot();
  }
  function cancel(attemptId){
    if(!active){check(!attemptId||attemptId===state.attemptId,'登录已变化，请刷新登录状态',409);return snapshot();}
    check(attemptId===state.attemptId,'登录已变化，请刷新登录状态后再取消',409);
    const attempt=active;finish(attempt,{state:'cancelled',message:'本次登录已取消，可以重新开始。'});stop(attempt.child);
    return snapshot();
  }
  return {snapshot,start,cancel,close(){if(active)cancel(state.attemptId);}};
}
