import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
export function findCodex(env=process.env){
  const custom=env.COMIC_CODEX_BIN,candidates=custom?[custom]:[];
  if(!custom){for(const directory of (env.PATH||'').split(path.delimiter))for(const ext of process.platform==='win32'?['.exe','.cmd','']:[''])candidates.push(path.join(directory,'codex'+ext));
    if(process.platform==='win32'&&env.LOCALAPPDATA){const directory=path.join(env.LOCALAPPDATA,'OpenAI','Codex','bin');try{candidates.push(...fs.readdirSync(directory).map(name=>path.join(directory,name,'codex.exe')).filter(p=>fs.existsSync(p)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs));}catch{}}
  }
  for(const candidate of candidates){if(!fs.existsSync(candidate)||!fs.statSync(candidate).isFile())continue;if(/\.cmd$/i.test(candidate)){const script=path.join(path.dirname(candidate),'node_modules','@openai','codex','bin','codex.js');if(fs.existsSync(script))return [process.execPath,script];continue;}return /\.[mc]?js$/i.test(candidate)?[process.execPath,candidate]:[candidate];}return null;
}
export function findPython(env=process.env){
  const candidates=env.COMIC_PYTHON_BIN?[env.COMIC_PYTHON_BIN]:[];
  if(!env.COMIC_PYTHON_BIN){if(env.USERPROFILE)candidates.push(path.join(env.USERPROFILE,'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe'));for(const directory of (env.PATH||'').split(path.delimiter))for(const name of process.platform==='win32'?['python.exe','python3.exe']:['python3','python'])candidates.push(path.join(directory,name));}
  return candidates.find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile())||null;
}
export function stopChild(child){
  if(!child||child.exitCode!==null)return;
  // A pooled worker exposes an operation handle; cancelling it must never target a sibling.
  if(typeof child.cancel==='function'){child.cancel();return;}
  if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore'});else child.kill('SIGTERM');
}
export function run(command,args,{cwd,input='',timeout=900000,env=process.env,onChild,onLine}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command[0],[...command.slice(1),...args],{cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});onChild?.(child);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    let stdout='',stderr='',buffer='',expired=false;const timer=setTimeout(()=>{expired=true;stopChild(child);},timeout);timer.unref();
    child.stdout.on('data',chunk=>{const text=chunk.toString();stdout=(stdout+text).slice(-4*1024*1024);buffer+=text;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);onLine?.(line);}if(buffer.length>1024*1024)buffer=buffer.slice(-1024*1024);});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-12000);});child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);if(buffer)onLine?.(buffer);if(expired)reject(new Error('Codex 执行超时，可重新生成；原图保留。'));else resolve({code,stdout,stderr});});child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
export function sanitizedNativeDiagnostics(value){
  if(!value||typeof value!=='object')return null;
  const text=(v,n)=>redact(String(v||'')).slice(0,n),count=v=>Number.isSafeInteger(v)&&v>=0?v:0;
  return {classification:text(value.classification,100),finalReply:text(value.finalReply,12000),lastAgentReply:text(value.lastAgentReply,12000),replyPhase:text(value.replyPhase,100)||null,finalReplyExplicit:value.finalReplyExplicit===true,replyCount:count(value.replyCount),lastError:value.lastError?{code:text(value.lastError.code,100),message:text(value.lastError.message,4000)}:null,turnStatus:text(value.turnStatus,100)||null,imageStarted:count(value.imageStarted),imageCompleted:count(value.imageCompleted),imageSaved:value.imageSaved===true,referenceViews:count(value.referenceViews),remoteEnded:value.remoteEnded===true,retry:{automatic:false,action:text(value.retry?.action,100),note:text(value.retry?.note,500)}};
}
export function bridgeError(message,{code='codex_connection_failed',stage='connection',retryable=false,mayHaveStarted=false,status=502,diagnostics=null,generationEnded=false,requiredAction=null}={}){
  return Object.assign(new Error(redact(message)),{code,stage,retryable,mayHaveStarted,status,diagnostics:sanitizedNativeDiagnostics(diagnostics),generationEnded:generationEnded===true,requiredAction});
}
export const cancelledError=()=>bridgeError('任务已取消，原图保留',{code:'COMIC_CANCELLED',stage:'cancelled',status:409});

// One JSONL request is active per process. CodexBridge owns pool scheduling.
export class JsonLineWorker {
  constructor(command,args,{cwd,env=process.env}={}){
    this.child=spawn(command[0],[...command.slice(1),...args],{cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child.stdout.setEncoding('utf8');this.child.stderr.setEncoding('utf8');
    this.sequence=0;this.closed=false;this.active=null;this.buffer='';this.stderr='';
    this.child.stdout.on('data',chunk=>{
      this.buffer+=chunk;let index;
      while((index=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,index);this.buffer=this.buffer.slice(index+1);this._line(line);}
      if(this.buffer.length>1024*1024)this.close(bridgeError('Python 返回的数据行超过限制',{code:'worker_protocol_error'}));
    });
    this.child.stderr.on('data',chunk=>{this.stderr=(this.stderr+chunk).slice(-12000);});
    this.child.on('error',error=>this.close(bridgeError(error.message,{code:'worker_start_failed',retryable:true})));
    this.child.on('close',()=>{
      if(this.buffer){this._line(this.buffer);this.buffer='';}
      this.closed=true;this._finish(bridgeError('Python 与 Codex app-server 连接中断；可重新生成，原图保留。'+(this.stderr?' '+redact(this.stderr).slice(-300):''),{code:'worker_closed',stage:this.active?.stage,retryable:true,mayHaveStarted:this.active?.started}));
    });
    this.child.stdin.on('error',error=>this.close(bridgeError('Python 连接写入失败：'+error.message,{code:'worker_closed',retryable:true,mayHaveStarted:this.active?.started})));
  }
  _line(line){
    if(!line.trim())return;let event;try{event=JSON.parse(line);}catch{this.close(bridgeError('Python 返回无效 JSONL 数据：'+redact(line).slice(0,300),{code:'worker_protocol_error',stage:'worker/read',mayHaveStarted:this.active?.started}));return;}
    const active=this.active;
    if(event.type==='error'&&event.id==null){this.close(bridgeError(event.message||'Python 请求接收失败',{code:event.code||'worker_protocol_error',stage:event.stage||'worker/read',retryable:event.retryable===true,mayHaveStarted:active?.started}));return;}
    if(!active||event.id!==active.id)return;
    clearTimeout(active.ackTimer);
    if(event.stage)active.stage=event.stage;
    if(event.stage==='turn/start'||event.phase==='generating')active.started=true;
    try{active.onEvent?.(event);}catch(error){this.close(bridgeError('任务进度处理失败：'+error.message,{code:'progress_callback_failed',stage:active.stage,mayHaveStarted:active.started}));return;}
    if(event.type==='error')this._finish(bridgeError(event.message||'Codex 连接失败',{code:event.code,stage:event.stage,retryable:event.retryable,mayHaveStarted:event.mayHaveStarted,diagnostics:event.diagnostics,generationEnded:event.generationEnded,requiredAction:event.requiredAction}));
    else if(event.type==='result')this._finish(null,event);
  }
  _finish(error,result){
    const active=this.active;if(!active)return;this.active=null;clearTimeout(active.timer);clearTimeout(active.ackTimer);active.signal?.removeEventListener('abort',active.abort);
    if(error)active.reject(error);else active.resolve(result);
  }
  request(payload,{timeout=960000,ackTimeout=15000,onEvent,signal}={}){
    if(this.closed)return Promise.reject(bridgeError('Python 生图连接已关闭',{code:'worker_closed',retryable:true}));
    if(this.active)return Promise.reject(bridgeError('同一 Python 生图连接不能同时执行两个镜头',{code:'worker_busy'}));
    if(signal?.aborted)return Promise.reject(cancelledError());
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const active={id,resolve,reject,onEvent,signal,stage:'connection',started:false};
      active.abort=()=>this.close(cancelledError());
      active.timer=setTimeout(()=>this.close(bridgeError(`Codex 在 ${active.stage} 阶段超时；可重新生成，原图保留。`,{code:'worker_timeout',stage:active.stage,retryable:true,mayHaveStarted:active.started})),timeout);active.timer.unref();
      active.ackTimer=setTimeout(()=>this.close(bridgeError('Python 在请求接收阶段没有返回确认（15 秒）；当前镜头未确认开始，原图保留。',{code:'worker_ipc_timeout',stage:'worker/read',retryable:true,mayHaveStarted:active.started})),ackTimeout);active.ackTimer.unref();
      this.active=active;signal?.addEventListener('abort',active.abort,{once:true});
      this.child.stdin.write(JSON.stringify({...payload,id})+'\n',error=>{if(error)this.close(bridgeError('Python 请求发送失败：'+error.message,{code:'worker_closed',stage:'worker/write',retryable:true,mayHaveStarted:active.started}));});
    });
  }
  close(error=bridgeError('生图连接已关闭',{code:'worker_closed',retryable:true})){
    if(this.closed)return;this.closed=true;this._finish(error);this.child.stdin.end();stopChild(this.child);
  }
}
export function redact(text=''){return String(text).replace(/(?:sk-|sk_proj_)[A-Za-z0-9_-]{8,}/g,'[已隐藏密钥]').replace(/Bearer\s+[^\s"']+/gi,'Bearer [已隐藏]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[已隐藏凭据]');}
