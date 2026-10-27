import {spawn} from 'node:child_process';
import {access,readdir,readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {saveImageDiagnostic} from './image-diagnostics.mjs';
import {generatedImageBytes} from './generated-image.mjs';

export function codexEnvironment(source=process.env){
  const env={...source};
  // Let the official CLI own authentication; never load or copy its tokens.
  for(const key of Object.keys(env))if(/^(OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN|CODEX_INTERNAL_.*|CODEX_SESSION_ID|CODEX_THREAD_ID|CODEX_PERMISSION_PROFILE)$/.test(key))delete env[key];
  if(!env.CODEX_HOME)env.CODEX_HOME=path.join(env.USERPROFILE||os.homedir(),'.codex');
  return env;
}
export async function findCodex(env=codexEnvironment()){
  const candidates=[env.SCENE_CODEX_PATH,env.CODEX_CLI_PATH];
  if(process.platform==='win32'){
    const base=path.join(env.LOCALAPPDATA||path.join(env.USERPROFILE||os.homedir(),'AppData','Local'),'OpenAI','Codex','bin');
    try{const dirs=await readdir(base,{withFileTypes:true});for(const dir of dirs.filter(d=>d.isDirectory()).reverse())candidates.push(path.join(base,dir.name,'codex.exe'));}catch{}
  }
  for(const dir of (env.PATH||env.Path||'').split(path.delimiter))if(dir)candidates.push(path.join(dir,process.platform==='win32'?'codex.exe':'codex'));
  for(const candidate of candidates.filter(Boolean)){try{await access(candidate);return candidate;}catch{}}
  return null;
}
function failure(code,message,status=400){return Object.assign(Error(message),{code,status});}
export function codexFailure(raw){
  if(/usage.?limit|quota|out of.*credits|limit.*reached|rate.?limit/i.test(raw))return failure('codex_usage_limit','本机 Codex 账号额度暂时用尽或受到限流。已完成内容已保存，请查看 Codex 额度后继续。',429);
  if(/log.?in|unauthorized|authentication|401|refresh.*token/i.test(raw))return failure('codex_login_required','本机 Codex 登录已失效。请在 Codex 中登录 ChatGPT，再继续拆解。');
  if(/timeout|timed out|connect|routing|network|stream disconnected/i.test(raw))return failure('codex_network','本机 Codex 连接模型服务失败。请确认 Codex 本身能正常回复，再继续拆解。',503);
  return failure('codex_failed','本机 Codex 未完成本段分析。正文和已完成进度已保留，请检测 Codex 连接后重试。');
}
function run(binary,args,{env,input='',signal,timeout=15000,onEvent}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{env,windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
    let stdout='',stderr='',pending='',settled=false;
    const timer=setTimeout(()=>{child.kill();finish(failure('codex_timeout','Codex 回复超时，本段未计为完成；已完成进度保留。',504));},timeout);
    const abort=()=>{child.kill();finish(failure('codex_cancelled','本段拆解已暂停。'));};
    function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){error.cliStderr=stderr;reject(error);}else resolve(value);}
    child.on('error',()=>finish(failure('codex_unavailable','无法启动 Codex，请安装或更新官方 Codex CLI。')));
    child.stdout.on('data',chunk=>{const text=chunk.toString();stdout=(stdout+text).slice(-4000000);pending+=text;let newline;while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);try{onEvent?.(JSON.parse(line));}catch{}}});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-20000);});
    child.on('close',code=>finish(null,{code,stdout,stderr}));
    child.stdin.on('error',()=>{});child.stdin.end(input);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}
export function codexClient(dataDir){
  let cached,checkedAt=0;
  const state={active:false,stage:'idle',message:'',startedAt:0,updatedAt:0};
  function stage(value,message){Object.assign(state,{stage:value,message,updatedAt:Date.now()});}
  async function status(force=false){
    if(!force&&cached&&Date.now()-checkedAt<15000)return cached;
    const env=codexEnvironment(),binary=await findCodex(env);
    if(!binary)return {available:false,authenticated:false,message:'未找到本机 Codex。请安装官方 Codex CLI，并使用 ChatGPT 账号登录。'};
    try{const result=await run(binary,['login','status'],{env});const ok=result.code===0&&/Logged in using ChatGPT/i.test(result.stdout+'\n'+result.stderr);cached={available:true,authenticated:ok,message:ok?'已连接本机 Codex · 所选 Codex 通道使用当前 ChatGPT/Codex 账号额度。':'请使用 ChatGPT 账号登录本机 Codex；API 密钥登录不使用订阅额度。'};}catch{cached={available:true,authenticated:false,message:'Codex 登录状态检查失败，请更新或登录本机 Codex。'};}
    checkedAt=Date.now();return cached;
  }
  return {status,state,async image({prompt,size='1536x864',references=[],model='',signal}){
    const info=await status();if(!info.authenticated)throw Object.assign(failure('codex_login_required',info.message),{providerConfirmed:true});
    const env=codexEnvironment(),binary=await findCodex(env),base=path.join(dataDir,'codex-jobs');await mkdir(base,{recursive:true});const job=await mkdtemp(path.join(base,'image-'));
    let threadId='';let processReturned=false,processResult=null;const events=[];const startedAt=Date.now();
    try{
      const schemaFile=path.join(job,'schema.json'),outputFile=path.join(job,'result.json');await writeFile(schemaFile,JSON.stringify({type:'object',additionalProperties:false,required:['imagePath'],properties:{imagePath:{type:'string'}}}));
      const args=['exec','--ignore-user-config','--skip-git-repo-check','--ephemeral','--sandbox','read-only','--cd',job,'--output-schema',schemaFile,'--output-last-message',outputFile,'--json','--color','never'];
      for(const flag of ['shell_tool','unified_exec','shell_snapshot','apps','hooks','remote_plugin','multi_agent','memories'])args.push('--disable',flag);
      args.push('--enable','image_generation','-c','web_search="disabled"','-c','model_reasoning_effort="low"');
      // 工作台的补丁：本机 Codex 默认先试 WebSocket 传输，5 次重试全部超时后才回退 HTTPS，
      // 每次调用白等 40-90 秒。这里按角色工房同样的方式显式声明不支持 WebSocket，
      // 直接走 HTTPS，出图总耗时可缩短一半以上。
      args.push('-c','model_providers.workbench-http={name="OpenAI",requires_openai_auth=true,wire_api="responses",supports_websockets=false}','-c','model_provider="workbench-http"');
      if(!model){try{model=(await readFile(path.join(env.CODEX_HOME,'config.toml'),'utf8')).match(/^model\s*=\s*"([\w.\-]+)"/m)?.[1]||'';}catch{}}
      if(model)args.push('--model',model);
      for(const [index,reference]of references.entries()){const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(reference);if(!match)throw Object.assign(failure('invalid_reference','参考图格式不正确。'),{providerConfirmed:true});const bytes=Buffer.from(match[2],'base64');if(bytes.length>5*1024*1024)throw Object.assign(failure('invalid_reference','单张参考图超过 5 MB。'),{providerConfirmed:true});const file=path.join(job,'reference-'+index+'.'+match[1]);await writeFile(file,bytes);args.push('--image',file);}
      args.push('-');
      const result=await run(binary,args,{env,signal,timeout:540000,input:'请调用内置 image generation 工具，严格只生成一张完整 PNG 场景图。本次只允许调用一次图片生成工具；成功后立即返回其实际保存路径，不再调用第二次生成或自主另造一张。使用已登录 ChatGPT/Codex 账号额度，禁止调用 API、命令、插件或其他生成工具。不得用文字、SVG、网页或代码代替图片。参考图的用途以本次提示词为准；反打任务必须以正打图锁定同一空间和物件。无需复制文件，工具保存到默认 generated_images 目录即可。最后 JSON 的 imagePath 填工具实际生成的 PNG 绝对路径。目标尺寸 '+size+'，横向 16:9。\n场景图要求：\n'+prompt,onEvent(event){if(event.type==='thread.started')threadId=event.thread_id;if(event.type==='error'||event.type==='turn.failed')events.push({type:event.type,message:event.message||event.error?.message||''});}});
      processReturned=true;processResult=result;let file;try{file=JSON.parse((await readFile(outputFile,'utf8')).replace(/^\uFEFF/,'' )).imagePath;}catch{}
      try{return await generatedImageBytes({codexHome:env.CODEX_HOME,threadId,reportedPath:file,startedAt,requireLandscape:true});}catch(error){if(result.code!==0)throw codexFailure(events.length?events.map(event=>event.message).join('\n'):result.stderr);throw error;}
    }catch(error){if(processReturned)error.providerConfirmed=true;try{error.diagnosticId=await saveImageDiagnostic(dataDir,{startedAt,finishedAt:Date.now(),threadId,code:error.code||'codex_failed',exitCode:processResult?.code??null,stderr:processResult?.stderr||error.cliStderr||'',events});}catch{}throw error;}finally{const target=path.resolve(job);if(path.dirname(target)===path.resolve(base))await rm(target,{recursive:true,force:true}).catch(()=>{});}
  },async analyze({input,instructions,schema,model='',signal}){
    const info=await status(true);if(!info.authenticated)throw failure('codex_login_required',info.message);
    const env=codexEnvironment(),binary=await findCodex(env);const base=path.join(dataDir,'codex-jobs');await mkdir(base,{recursive:true});const job=await mkdtemp(path.join(base,'analysis-'));
    Object.assign(state,{active:true,startedAt:Date.now()});stage('starting','正在启动本机 Codex，使用已登录账号额度…');
    try{
      const schemaFile=path.join(job,'schema.json'),outputFile=path.join(job,'result.json');await writeFile(schemaFile,JSON.stringify(schema));
      // Read only the preferred model name, never any credentials or provider secrets.
      if(!model){try{const config=await readFile(path.join(env.CODEX_HOME,'config.toml'),'utf8');model=config.match(/^model\s*=\s*"([\w.\-]+)"/m)?.[1]||'';}catch{}}
      const args=['exec','--ignore-user-config','--skip-git-repo-check','--ephemeral','--sandbox','read-only','--cd',job,'--output-schema',schemaFile,'--output-last-message',outputFile,'--json','--color','never'];
      for(const flag of ['shell_tool','unified_exec','shell_snapshot','apps','hooks','remote_plugin','multi_agent','memories','image_generation','view_image'])args.push('--disable',flag);
      args.push('-c','web_search="disabled"','-c','model_reasoning_effort="low"');
      // 同上：跳过 WebSocket 重试，直接走 HTTPS（工作台补丁）
      args.push('-c','model_providers.workbench-http={name="OpenAI",requires_openai_auth=true,wire_api="responses",supports_websockets=false}','-c','model_provider="workbench-http"');
      if(model)args.push('--model',model);args.push('-');
      const result=await run(binary,args,{env,signal,timeout:480000,input:instructions+'\n仅分析以下输入数据，禁止使用工具、读取文件或执行命令。\n'+JSON.stringify(input),onEvent(event){
        if(event.type==='turn.started')stage('working','Codex 正在分析当前段，结果返回后保存场景并更新完成比例。');
        if(event.type==='error')stage('reconnecting','Codex 正在重新连接模型服务；当前段尚未完成。');
        if(event.type==='item.completed'&&event.item?.type==='agent_message')stage('validating','已收到 Codex 回复，正在校验场景与原文依据…');
      }});
      if(result.code!==0)throw codexFailure(result.stdout+'\n'+result.stderr);
      let output;try{output=await readFile(outputFile,'utf8');JSON.parse(output);}catch{throw failure('codex_invalid_output','Codex 未返回有效的场景 JSON，本段未保存。');}
      stage('completed','当前段已返回，正在保存拆解结果。');return output;
    }catch(error){stage('error',error.message);throw error;}finally{state.active=false;const target=path.resolve(job);if(path.dirname(target)===path.resolve(base))await rm(target,{recursive:true,force:true}).catch(()=>{});}
  }};
}
