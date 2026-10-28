import {textAssetInstructions} from '../public/asset-text-references.js';
import {appendDefaultImageConstraints} from '../public/generation-constraints.js';
import {prepareGenerationReferences} from './generation-reference-order.mjs';
import {unifiedArtStyleInstructions} from '../public/generation-art-style.js';
import {frameSizingInstructions} from '../public/generation-frame-sizing.js';
import {generationLayoutInstructions} from '../public/panel-generation.js';
import {normalizeNativeSizing,assessNativeResult} from "../public/native-image-sizing.js";
import {jimengImageCapabilities} from './native-model-capabilities.mjs';

import {closestModelRatio} from '../public/panel-composition.js';
import fs from 'node:fs';
import {effectiveShotDescription} from '../public/shot-settings.js';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomInt,createHash} from 'node:crypto';
import {check,imageInfo} from './store.mjs';
import {findPython,run,stopChild} from './process.mjs';

import {assetProductionPrompt,sceneAssetImagePrompt} from "./codex.mjs";


const ROOT=fileURLToPath(new URL('../',import.meta.url));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NODE_ID=/^node_[0123456789abcdefghjkmnpqrstvwxyz]{10}$/;
const CROCKFORD='0123456789abcdefghjkmnpqrstvwxyz';
export const createJimengNodeId=()=>'node_'+Array.from({length:10},()=>CROCKFORD[randomInt(CROCKFORD.length)]).join('');
export const isCanonicalJimengNodeId=value=>typeof value==='string'&&NODE_ID.test(value);
const digest=value=>createHash('sha256').update(Buffer.isBuffer(value)?value:typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const safeMessage=value=>String(value||'即梦官方 CLI 请求失败').replace(/https?:\/\/\S+/g,'[已隐藏访问地址]').replace(/(?:Bearer\s+|creditConfirmationToken["':=\s]+)\S+/gi,'[已隐藏凭证]').slice(0,700);
export function jimengError(message,{code='jimeng_failed',requiredAction,recoverable=false,phase,status=502}={}){return Object.assign(new Error(safeMessage(message)),{code,requiredAction,recoverable,phase,status});}
const COMMAND_WORDS=new Set(['version','schema','auth','status','account','model','list','find','node','create','edit','image','quote','confirm','run','show','operation','wait','resource','get','upload','download','canvas','ls','login','logout','refresh']);
export function parseCliEnvelope(result,args=[]){
  const stdout=String(result.stdout??''),stderr=String(result.stderr??''),clean=stdout.trim();
  const command=[];for(const word of args){if(!COMMAND_WORDS.has(word)||command.length===3)break;command.push(word);}
  const diagnostic={command:command.join(' ')||'unknown',exitCode:Number.isInteger(result.code)?result.code:null,signal:result.signal||null,stdoutBytes:Number.isInteger(result.stdoutBytes)?result.stdoutBytes:Buffer.byteLength(stdout),stderrBytes:Number.isInteger(result.stderrBytes)?result.stderrBytes:Buffer.byteLength(stderr),stdoutTruncated:result.stdoutTruncated===true,stderrTruncated:result.stderrTruncated===true,hasBom:stdout.includes('\uFEFF'),firstNonWhitespaceCodePoint:stdout.replace(/^[ \t\r\n]*/,'').codePointAt(0)??null};
  const fail=kind=>{const error=jimengError(`即梦 CLI ${diagnostic.command} 输出无法解析（退出码 ${diagnostic.exitCode??'无'}，标准输出 ${diagnostic.stdoutBytes} 字节，错误输出 ${diagnostic.stderrBytes} 字节）；保留原任务编号后检查`,{code:'jimeng_protocol_error',requiredAction:'inspect'});error.protocol={...diagnostic,outputKind:kind};throw error;};
  if(diagnostic.stdoutTruncated)return fail('truncated_stdout');
  if(!clean){
    // Some CLI failures write the complete JSON error envelope to stderr. Never accept success there.
    if(result.code!==0&&!diagnostic.stderrTruncated){try{const value=JSON.parse(stderr.trim());if(value&&typeof value==='object'&&!Array.isArray(value)&&value.ok===false)return value;}catch{}}
    return fail(result.signal?'process_signalled':'empty_stdout');
  }
  let value;try{value=JSON.parse(clean);}catch{return fail(clean[0]==='{'||clean[0]==='['?'invalid_json':'mixed_or_non_json_stdout');}
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.ok!=='boolean')return fail('unexpected_envelope');
  return value;
}

export const TERMINAL_PHASES=['rejected','failed'];
const FAILED_STATES=new Set(['failed','fail','failure','error','rejected','cancelled','canceled','expired']);
const lowerState=value=>String(value??'').toLowerCase();
/** A finished operation with no successful image: submission error, failed operation state, or every resource failed. */
export function terminalFailure(observed){const resources=Array.isArray(observed?.resources)?observed.resources:[];return !!observed?.submissionError||FAILED_STATES.has(lowerState(observed?.state))||(resources.length>0&&resources.every(r=>FAILED_STATES.has(lowerState(r.state))));}
function contained(root,file){const relative=path.relative(path.resolve(root),path.resolve(file));return relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative);}
function assertAbsolute(file){check(path.isAbsolute(file),'即梦任务需要明确的本机绝对路径',409);}
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temporary=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(temporary,file);}
function load(file){if(!fs.existsSync(file))return null;try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw jimengError('即梦恢复记录损坏，请保留原文件检查',{code:'jimeng_state_corrupt',requiredAction:'inspect',status:409});}}
export function findJimeng(env=process.env){const candidates=env.COMIC_JIMENG_BIN?[env.COMIC_JIMENG_BIN]:[String.raw`D:\工具\即梦画布CLI\dreamina-canvas.exe`,...(env.PATH||'').split(path.delimiter).map(p=>path.join(p,process.platform==='win32'?'dreamina-canvas.exe':'dreamina-canvas'))];return candidates.find(p=>fs.existsSync(p)&&fs.statSync(p).isFile())||null;}
export function buildJimengPrompt(input){return appendDefaultImageConstraints([baseJimengPrompt(input),textAssetInstructions(input.textAssetReferences)].filter(Boolean).join('\n'));}
function baseJimengPrompt(input){if(['scene','prop'].includes(input.shot?.assetVisualContract?.role))return sceneAssetImagePrompt(input);if(input.kind==='asset-production')return assetProductionPrompt(input);if(input.kind==='breakout-foreground')throw jimengError('当前即梦通道不支持透明前景，请选择Codex',{code:'transparent_foreground_unsupported',status:400});return [(input.shot.productionPrompt||input.shot.description||''),unifiedArtStyleInstructions(input.style),generationLayoutInstructions(input.panel),frameSizingInstructions(input),input.action==='edit'?'本次修改要求：'+input.editPrompt:''].filter(Boolean).join('\n');}
export function cliRunner(command,args,{cwd,env,timeout=90000,signal,onChild}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(jimengError('任务已取消',{code:'COMIC_CANCELLED',status:409}));
    const child=spawn(command,args,{cwd,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});onChild?.(child);
    let stdout='',stderr='',stdoutBytes=0,stderrBytes=0,stdoutTruncated=false,stderrTruncated=false,ended=false;
    const stop=()=>stopChild(child),timer=setTimeout(()=>{stop();finish(jimengError('即梦 CLI 等待超时，请查询原任务恢复',{code:'jimeng_timeout',recoverable:true,requiredAction:'resume'}));},timeout);timer.unref();
    const abort=()=>{stop();finish(jimengError('任务已取消；已提交的云端任务仍可用原编号查询',{code:'COMIC_CANCELLED',recoverable:true,status:409}));};signal?.addEventListener('abort',abort,{once:true});
    function finish(error,result){if(ended)return;ended=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);}
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',v=>{stdoutBytes+=Buffer.byteLength(v);if(stdout.length+v.length>8*1024*1024)stdoutTruncated=true;stdout=(stdout+v).slice(0,8*1024*1024);});child.stderr.on('data',v=>{stderrBytes+=Buffer.byteLength(v);if(stderr.length+v.length>65536)stderrTruncated=true;stderr=(stderr+v).slice(0,65536);});
    child.on('error',e=>finish(jimengError(e.message,{code:'jimeng_start_failed'})));child.on('close',(code,signal)=>finish(null,{code,signal,stdout,stderr,stdoutBytes,stderrBytes,stdoutTruncated,stderrTruncated}));
  });
}
// Uses the installed CLI public contract. Never uses provider HTTP APIs or persisted access materials.
export class JimengBridge{
  constructor({env=process.env,runner=cliRunner,stateDir=path.join(ROOT,'.runtime','jimeng'),taskRoot=ROOT,command,now=Date.now}={}){
    this.env=env;this.runner=runner;this.command=command||findJimeng(env);this.taskRoot=path.resolve(taskRoot);this.stateDir=path.resolve(stateDir);assertAbsolute(this.stateDir);check(contained(this.taskRoot,this.stateDir),'即梦状态目录必须位于本次数据目录内',409);this.now=now;this.contract=null;this.metadataPending=null;this.canvasLocks=new Map();this.children=new Set();this.loginStarting=null;this.closed=false;this.login={running:false,message:''};this.loginPending=null;
  }
  runtimeEnv(){const temporary=path.join(this.stateDir,'temp'),cliState=path.join(this.stateDir,'cli-state');fs.mkdirSync(temporary,{recursive:true,mode:0o700});fs.mkdirSync(cliState,{recursive:true,mode:0o700});for(const directory of [temporary,cliState]){const real=fs.realpathSync(directory);assertAbsolute(real);check(contained(fs.realpathSync(this.taskRoot),real),'即梦临时或恢复目录的真实路径超出项目范围',409);}const env={...this.env,TEMP:temporary,TMP:temporary,DREAMINA_CANVAS_STATE_DIR:cliState};delete env.OPENAI_API_KEY;delete env.CODEX_API_KEY;return env;}
  async invoke(args,options={}){
    check(!this.closed,'即梦连接已关闭',409);check(this.command,'未找到即梦官方 CLI，请设置 COMIC_JIMENG_BIN',409);
    const globals=['--format','json','--non-interactive','--profile',this.env.COMIC_JIMENG_PROFILE||'default'];
    if(this.env.COMIC_JIMENG_REGION)globals.push('--region',this.env.COMIC_JIMENG_REGION);
    let active,result;try{result=await this.runner(this.command,[...args,...globals],{cwd:ROOT,env:this.runtimeEnv(),...options,onChild:child=>{active=child;this.children.add(child);options.onChild?.(child);}});}finally{if(active)this.children.delete(active);}
    const envelope=parseCliEnvelope(result,args);
    if(envelope.ok!==true||result.code!==0){
      const error=envelope.error||{},failure=jimengError(error.message||result.stderr,{code:error.code||'jimeng_failed',requiredAction:error.requiredAction,recoverable:error.requiredAction==='resume',status:result.code===10?409:502});if(error.validation&&typeof error.validation==='object')failure.validation={...(typeof error.validation.reasonCode==='string'?{reasonCode:error.validation.reasonCode.slice(0,100)}:{}),...(typeof error.validation.fieldPath==='string'?{fieldPath:error.validation.fieldPath.slice(0,200)}:{}),...(typeof error.validation.detail==='string'?{detail:safeMessage(error.validation.detail)}:{})};failure.publicError={code:failure.code,reason:error.reason,class:error.class,requiredAction:error.requiredAction,...(failure.validation?{validation:failure.validation}:{})};failure.creditConfirmation=envelope.creditConfirmation?{minimumCreditCeiling:envelope.creditConfirmation.minimumCreditCeiling,reason:envelope.creditConfirmation.reason}:undefined;throw failure;
    }
    return envelope.data;
  }
  async metadata(){
    if(this.contract)return this.contract;
    if(!this.metadataPending)this.metadataPending=(async()=>{
      const version=await this.invoke(['version']),schema=await this.invoke(['schema']);
      check(Array.isArray(schema?.subcommands)&&Array.isArray(schema.globalFlags),'当前即梦 CLI 未返回可验证命令契约',409);
      const command=segments=>segments.reduce((node,name)=>node?.subcommands?.find(s=>s.name===name),schema);
      for(const [segments,flags] of [[['node','create','image'],['node-id','update-id','mode','model','prompt']], [['node','quote'],['node-id']], [['node','confirm'],['credit-ceiling']], [['node','run'],['submit-id','credit-token']], [['operation','wait'],['project-id','timeout']], [['resource','download'],['output']]]){
        const spec=command(segments);check(spec&&flags.every(name=>spec.flags?.some(f=>f.name===name)),'即梦 CLI 版本与本工具所需契约不一致，请先核对版本',409);
      }
      this.contract={version:version.version,schema};return this.contract;
    })().finally(()=>this.metadataPending=null);
    return this.metadataPending;
  }
  async status(){
    if(!this.command)return {provider:'jimeng',installed:false,connected:false,needsLogin:false,message:'未找到即梦官方 CLI，请设置 COMIC_JIMENG_BIN',login:this.publicLogin()};
    try{const meta=await this.metadata(),auth=await this.invoke(['auth','status']);return {provider:'jimeng',installed:true,version:meta.version,connected:auth.loggedIn===true,needsLogin:auth.loggedIn!==true,profile:auth.profile,region:auth.region,message:auth.loggedIn?'已连接即梦官方 CLI；模型与积分以服务端实时返回为准':'请完成即梦官方授权登录',login:this.publicLogin()};}
    catch(e){return {provider:'jimeng',installed:true,connected:false,needsLogin:e.requiredAction==='login',message:e.message,errorCode:e.code,requiredAction:e.requiredAction,...(e.validation?{validation:e.validation}:{}),...(e.protocol?{protocol:e.protocol}:{}),login:this.publicLogin()};}
  }
  publicLogin(){return {running:this.login.running,message:this.login.message,...(this.login.verificationUrl?{verificationUrl:this.login.verificationUrl,userCode:this.login.userCode}:{})};}
  async startLogin(){if(this.loginStarting)return this.loginStarting;this.loginStarting=this._startLogin().finally(()=>this.loginStarting=null);return this.loginStarting;}
  async _startLogin(){
    if(this.login.running)return this.publicLogin();
    await this.metadata();const auth=await this.invoke(['auth','status']);if(auth.loggedIn)return {running:false,message:'即梦账号已登录'};
    const result=await this.invoke(['auth','login']),challenge=result.challenge;if(result.state?.loggedIn){this.login={running:false,message:'即梦授权已完成'};return this.publicLogin();}
    check(challenge?.deviceCode&&challenge.verificationUri,'官方 CLI 未返回完整授权挑战',502);
    this.login={running:true,message:'请打开官方授权页面完成登录',verificationUrl:challenge.verificationUriComplete||challenge.verificationUri,userCode:challenge.userCode};
    this.loginPending=this.invoke(['auth','wait','--device-code',challenge.deviceCode,'--timeout','10m'],{timeout:660000}).then(value=>{this.login={running:false,message:value.state?.loggedIn?'即梦授权已完成':'授权未完成，请检查连接'};}).catch(error=>{this.login={running:false,message:error.message};}).finally(()=>this.loginPending=null);
    return this.publicLogin();
  }
  async models(){const status=await this.status();check(status.connected,status.message,409);return this.invoke(['model','list','--type','image']);}
  async imageCapabilities({assets=[]}={}){const catalogue=await this.models();return jimengImageCapabilities({catalogue,channelVersion:this.contract?.version??null,assets});}
  async validateSelection(input,referenceCount=0){
    check(typeof input.model==='string'&&input.model.trim(),'请选择即梦模型',400);const catalogue=await this.models(),model=catalogue.items?.find(m=>m.model===input.model);check(model,'所选模型不在官方实时目录中，请刷新后重新选择',409);
    const selected=model.modes?.find(m=>m.name===input.mode);check(selected,'所选模型不支持此生图方式',409);
    const flags=new Map((selected.flags||[]).map(f=>[f.flag.replace(/^--/,''),f]));
    const ratioResolved=input.ratio==='auto'?closestModelRatio(input.panel,flags.get('ratio')):input.ratio;
    for(const [name,value] of Object.entries({ratio:ratioResolved,resolution:input.resolution,count:1,prompt:buildJimengPrompt(input)})){
      const flag=flags.get(name);if(value===undefined||value===''){check(!flag?.required,`所选模型需要填写 ${name}`,400);continue;}
      if(name==='count'&&!flag)continue;check(flag||name==='prompt',`所选模型没有公开 ${name} 参数`,400);
      if(flag?.values)check(flag.values.includes(String(value)),`${name} 不在模型允许选项中`,400);
      if(typeof value==='number'){if(flag?.min!==undefined)check(value>=flag.min,`${name} 低于模型下限`,400);if(flag?.max!==undefined)check(value<=flag.max,`${name} 超过模型上限`,400);}
      if(typeof value==='string'){if(flag?.minLength!==undefined)check(value.length>=flag.minLength,`${name} 太短`,400);if(flag?.maxLength!==undefined)check(value.length<=flag.maxLength,`${name} 太长`,400);}
    }
    check(input.mode!=='i2i'||referenceCount>0,'图生图需要参考图片',400);check(input.mode!=='t2i'||referenceCount===0,'参考图片需要选择图生图方式',400);
    if(selected.references){check(referenceCount>=selected.references.min&&referenceCount<=selected.references.max,'参考图数量不符合所选模型规格',400);if(referenceCount){const images=selected.references.types?.find(t=>t.mediaType==='image');check(images&&referenceCount>=images.min&&referenceCount<=images.max,'模型未允许此数量的图片参考',400);}}
    return {mode:selected,flags,ratioResolved};
  }
  recordFile(directory){assertAbsolute(directory);check(contained(this.taskRoot,directory),'即梦任务目录必须位于本次数据目录内',409);if(fs.existsSync(directory)){const real=fs.realpathSync(directory);assertAbsolute(real);check(contained(fs.realpathSync(this.taskRoot),real),'即梦任务真实目录超出项目范围',409);}return path.join(directory,'jimeng-state.json');}
  write(file,state){state.updatedAt=new Date(this.now()).toISOString();atomic(file,state);}
  async canvas(localProjectId,title,options){
    const key=digest(localProjectId),file=path.join(this.stateDir,'projects',key+'.json');if(this.canvasLocks.has(key))return this.canvasLocks.get(key);
    const pending=(async()=>{let state=load(file);if(state?.phase==='saved')return state;
      if(state){let cursor;do{const result=await this.invoke(['canvas','ls','--limit','100',...(cursor?['--cursor',cursor]:[])],options),found=result.items?.find(p=>p.projectId===state.canvasId);if(found){state={...state,phase:'saved',webUrl:found.webUrl};atomic(file,state);return state;}cursor=result.hasMore?result.nextCursor:null;}while(cursor);throw jimengError('画布创建结果尚未确认，请保留原编号检查后恢复',{code:'jimeng_canvas_unknown',requiredAction:'inspect',status:409});}
      state={canvasId:randomUUID(),phase:'creating'};atomic(file,state);
      try{const result=await this.invoke(['canvas','create',title.slice(0,180),'--project-id',state.canvasId],options);check(result.project?.projectId===state.canvasId,'官方 CLI 返回画布编号不一致',502);state={...state,phase:'saved',webUrl:result.project.webUrl};atomic(file,state);return state;}
      catch(e){state.phase='unknown';atomic(file,state);throw e;}
    })().finally(()=>this.canvasLocks.delete(key));this.canvasLocks.set(key,pending);return pending;
  }
  async prepare(directory,input,referenceFiles,options={}){
    const sizing=normalizeNativeSizing(input.nativeSizing??input.panel?.nativeSizing);if(sizing?.mode==='model-long'){check(sizing.provider==='jimeng','主格长幅设置与即梦通道不一致',400);check(!sizing.request.width,'即梦当前通道未适配任意精确像素尺寸，请选择公开比例与分辨率档',400);input={...input,model:sizing.imageModelId||input.model,mode:sizing.generationMode||input.mode,ratio:sizing.request.ratio||input.ratio,resolution:sizing.request.resolution||input.resolution};}
    const file=this.recordFile(directory),actualRefs=input.action==='edit'?[input.basePanelPath,...referenceFiles]:referenceFiles;check(actualRefs.every(Boolean),'即梦局部重绘需要格子裁图，请重新发起重绘',400);
    const selection=await this.validateSelection(input,actualRefs.length);if(input.ratio==="auto")input={...input,ratio:selection.ratioResolved};const prompt=buildJimengPrompt(input),planDigest=digest({model:input.model,mode:input.mode,ratio:input.ratio,resolution:input.resolution,prompt,references:actualRefs.map(p=>digest(fs.readFileSync(p)))});
    let state=load(file);
    if(state){check(isCanonicalJimengNodeId(state.nodeId),'恢复记录中的即梦节点编号不符合当前官方格式；请保留记录并修复本地编号',409);check(state.planDigest===planDigest,'任务恢复时分镜或参考已经改变，请保留原任务并重新发起',409);if(state.phase==='awaiting_confirmation'||state.phase==='ready'||state.phase==='submitted'||state.phase==='done')return state;if(state.submissionAttempted)throw jimengError('生成提交结果尚未确认，请查询原任务恢复',{code:'jimeng_submission_unknown',recoverable:true,requiredAction:'resume',status:409});}
    else{state={jobKey:path.basename(directory),localProjectId:input.projectId,canvasId:null,nodeId:createJimengNodeId(),updateId:randomUUID(),submitId:randomUUID(),planDigest,phase:'preparing',references:[],generationSelection:{model:input.model,mode:input.mode,ratio:input.ratio,resolution:input.resolution}};this.write(file,state);}
    const canvas=await this.canvas(input.projectId,input.projectTitle||'漫画镜头',options);state.canvasId=canvas.canvasId;state.webUrl=canvas.webUrl;this.write(file,state);
    for(let i=0;i<actualRefs.length;i++){
      let ref=state.references[i];if(!ref){ref={resourceId:randomUUID(),phase:'reserved',reason:'local_asset_without_canvas_node'};state.references.push(ref);this.write(file,state);}
      if(ref.phase!=='saved'){if(['uploading','unknown'].includes(ref.phase)){const result=await this.invoke(['resource','get',ref.resourceId,'--project-id',state.canvasId],options);check(result.status==='success','参考图上传结果尚未确认，请检查原资源后恢复',409);}
        else{ref.phase='uploading';this.write(file,state);try{const result=await this.invoke(['resource','upload','--file',actualRefs[i],'--type','image','--project-id',state.canvasId,'--resource-id',ref.resourceId],options);check(result.resourceId===ref.resourceId,'参考图资源编号不一致',502);}catch(e){ref.phase='unknown';this.write(file,state);throw e;}}
        ref.phase='saved';this.write(file,state);
      }
    }
    const params=['--project-id',state.canvasId,'--node-id',state.nodeId,'--update-id',state.updateId,'--title',input.shot.code+' · '+input.shot.title,'--mode',input.mode,'--model',input.model,'--prompt',prompt];
    for(const name of ['ratio','resolution'])if(input[name])params.push('--'+name,input[name]);if(selection.flags.has('count'))params.push('--count','1');for(const ref of state.references)params.push('--ref','res:'+ref.resourceId);
    if(state.phase==='saving'||state.phase==='save_unknown'){
      const shown=await this.invoke(['node','show','--project-id',state.canvasId,'--node-id',state.nodeId],options),node=shown.nodes?.find(item=>item.result==='FOUND'&&item.node?.nodeId===state.nodeId)?.node;
      check(node?.generation?.prompt===prompt&&node.generation.model===input.model&&node.generation.mode===input.mode,'节点保存结果尚未确认，请检查原节点；不会自动重新创建',409);
    }else{
      state.phase='saving';this.write(file,state);
      try{const saved=await this.invoke(['node','create','image',...params],options);check(saved.node?.nodeId===state.nodeId,'即梦返回节点编号不一致',502);}catch(e){state.phase='save_unknown';this.write(file,state);throw e;}
    }
    state.phase='ready';this.write(file,state);return this.quote(directory,options);
  }
  async quote(directory,options={}){
    const file=this.recordFile(directory),state=load(file);check(state?.canvasId&&state.nodeId,'即梦节点尚未保存',409);
    const quote=await this.invoke(['node','quote','--project-id',state.canvasId,'--node-id',state.nodeId],options);
    check(Array.isArray(quote.items)&&quote.items.length===1&&quote.items[0].nodeId===state.nodeId&&quote.items.every(i=>!i.error&&Number.isInteger(i.maxCredits))&&Number.isInteger(quote.totalMaxCredits),'官方报价不完整；请检查节点后重新报价',409);
    state.quote={items:quote.items.map(i=>({nodeId:i.nodeId,maxCredits:i.maxCredits})),totalMaxCredits:quote.totalMaxCredits,draftVersion:quote.draftVersion,confirmable:quote.confirmable,confirmationRequired:quote.confirmationRequired,quotedAtMs:this.now()};
    state.phase=quote.confirmationRequired===false?'ready':'awaiting_confirmation';this.write(file,state);return state;
  }
  async submit(directory,{creditCeiling,...options}={}){
    const file=this.recordFile(directory);let state=load(file);check(state&&!state.submissionAttempted,'此任务已有提交记录，请用原编号恢复查询',409);
    state=await this.quote(directory,options);let token;
    if(creditCeiling!==undefined){
      check(Number.isInteger(creditCeiling)&&creditCeiling>=0,'请输入有效积分消费上限',400);
      if(state.quote.totalMaxCredits>creditCeiling)throw Object.assign(jimengError('最新报价超过批准上限，请查看新报价再批准',{code:'jimeng_price_changed',status:409}),{awaitingConfirmation:true,quote:state.quote,recovery:this.publicState(state)});check(state.quote.confirmable!==false,'服务端暂时无法确认此报价',409);
      // The CLI may not need a credit token, but the local user has still approved this exact quote.
      if(state.quote.confirmationRequired!==false){
        let approval;try{approval=await this.invoke(['node','confirm','--project-id',state.canvasId,'--node-id',state.nodeId,'--credit-ceiling',String(creditCeiling)],options);}catch(error){if(error.requiredAction==='confirm')state=await this.quote(directory,options);state.phase='awaiting_confirmation';this.write(file,state);throw Object.assign(error,{awaitingConfirmation:true,quote:state.quote,recovery:this.publicState(state)});}
        check(typeof approval.creditConfirmationToken==='string'&&approval.creditCeiling<=creditCeiling,'官方 CLI 未返回有效消费上限批准',502);token=approval.creditConfirmationToken;
      }
      state.authorizedCreditCeiling=creditCeiling;
    }else{
      // Every generation waits for the current user's explicit credit approval,
      // even when the CLI itself reports that no confirmation token is required.
      state.phase='awaiting_confirmation';this.write(file,state);return {awaitingConfirmation:true,quote:state.quote,recovery:this.publicState(state)};
    }
    state.submissionAttempted=true;state.phase='submitting';this.write(file,state);
    try{
      const result=await this.invoke(['node','run','--project-id',state.canvasId,'--node-id',state.nodeId,'--submit-id',state.submitId,...(token?['--credit-token',token]:[])],options),item=result.items?.find(i=>i.nodeId===state.nodeId&&i.submitId===state.submitId);
      check(item,'即梦没有返回本次提交身份，需查询原编号',502);state.submissionState=item.state;state.operationRef=state.submitId;state.resources=(item.resources||[]).map(r=>({resourceId:r.resourceId,state:r.state}));
      if(String(item.state).toLowerCase()==='rejected'){state.phase='rejected';this.write(file,state);throw jimengError(item.error?.message||'服务端拒绝本次生成，请检查输入',{code:'jimeng_rejected',requiredAction:'inspect',status:409});}
      state.phase='submitted';this.write(file,state);return state;
    }catch(e){if(state.phase!=='rejected'){state.phase='submission_unknown';state.operationRef=state.submitId;this.write(file,state);}throw Object.assign(e,{recoverable:state.phase!=='rejected',requiredAction:state.phase!=='rejected'?'resume':e.requiredAction});}
    finally{token=undefined;}
  }
  publicState(state){return state?{canvasId:state.canvasId,webUrl:state.webUrl,nodeId:state.nodeId,submitId:state.submitId,operationRef:state.operationRef,phase:state.phase,selectedResourceId:state.selectedResourceId,authorizedCreditCeiling:state.authorizedCreditCeiling}:null;}
  async finish(directory,input,options={}){
    const file=this.recordFile(directory),state=load(file);check(state?.submissionAttempted&&UUID.test(state.submitId),'缺少可恢复的即梦提交编号',409);
    options.onProgress?.('正在查询即梦原任务进度',{phase:'generating',recovery:this.publicState(state)});
    let observed,lastError,transientRetries=0;const began=this.now(),rounds=Math.max(1,Math.min(12,Math.ceil((options.monitorTimeoutMs??600000)/55000)));
    for(let round=0;round<rounds;round++){
      try{observed=await this.invoke(['operation','wait',state.submitId,'--project-id',state.canvasId,'--timeout','55s','--interval','5s'],{...options,timeout:65000});break;}
      catch(e){
        lastError=e;const incomplete=e.publicError?.class==='operation_incomplete'||e.code==='cli.operation_incomplete';
        const transient=e.publicError?.reason==='network_timeout'&&transientRetries++<2;
        if(options.signal?.aborted||(!incomplete&&!transient)||this.now()-began>=(options.monitorTimeoutMs??600000))break;
        options.onProgress?.('即梦原任务仍在生成，继续查询同一任务',{phase:'generating',elapsedMs:this.now()-began,recovery:this.publicState(state)});
      }
    }
    if(!observed){this.write(file,{...state,phase:'recoverable'});throw Object.assign(lastError||jimengError('即梦仍在生成，请查询原任务继续观察'),{recoverable:true,requiredAction:lastError?.requiredAction||'resume'});}
    check(observed.operationRef===state.submitId,'即梦返回了其他任务的操作编号',502);
    if(observed.awaitingConfirmation){check(observed.awaitingConfirmation.nodeId===state.nodeId,'积分确认节点与原任务不一致',502);state.submissionAttempted=false;state.phase='awaiting_confirmation';this.write(file,state);const latest=await this.quote(directory,options);latest.phase='awaiting_confirmation';this.write(file,latest);return {awaitingConfirmation:true,quote:latest.quote,recovery:this.publicState(latest)};}
    const available=(observed.resources||[]).filter(r=>['success','succeeded'].includes(String(r.state).toLowerCase()));
    if(!available.length&&terminalFailure(observed)){
      // The original operation has ended without an image. Nothing is still
      // running in the cloud, so the slot must be freed and no resume offered.
      state.generationEnded=true;state.phase='failed';this.write(file,state);
      throw Object.assign(jimengError(observed.submissionError?.message||'即梦本次生成已结束但没有产出图片（可能未通过审核）；可修改后重新发起',{code:'jimeng_generation_failed',requiredAction:'inspect',status:409}),{generationEnded:true,recovery:this.publicState(state)});
    }
    if(!available.length){state.phase='recoverable';this.write(file,state);throw jimengError(observed.submissionError?.message||'任务尚未产出可用图片，请用原任务恢复查询',{code:'jimeng_operation_incomplete',recoverable:true,requiredAction:'resume',status:409});}
    // The original operation has a successful image. Downloading/validating it
    // may fail later, but there is no remaining cloud generation to occupy an
    // image slot. Keep the submission identity for download-only recovery.
    state.generationEnded=true;this.write(file,state);
    check(available.length===1,'本次任务有多个终态图片，请先明确选片',409);const resourceId=available[0].resourceId;check(UUID.test(resourceId),'即梦返回无效公开资源编号',502);
    const resource=await this.invoke(['resource','get',resourceId,'--project-id',state.canvasId],options);check(resource.type==='image'&&resource.status==='success','即梦资源还不是成功图片',409);
    state.selectedResourceId=resourceId;state.phase='downloading';this.write(file,state);
    const out=path.join(directory,'out');fs.mkdirSync(out,{recursive:true});assertAbsolute(fs.realpathSync(out));check(contained(fs.realpathSync(directory),fs.realpathSync(out)),'即梦下载真实目录超出本次任务范围',409);const previousName=state.download?.fileName;check(!previousName||/^[0-9a-f-]+(?:-recovery-[0-9a-f-]+)?\.png$/.test(previousName),'本地下载记录文件名无效',409);let output=path.join(out,previousName||resourceId+'.png');assertAbsolute(output);
    let bytes;if(fs.existsSync(output)&&state.download?.sha256){bytes=fs.readFileSync(output);check(digest(bytes)===state.download.sha256,'本地下载文件已改变，请保留后检查',409);}
    else{if(fs.existsSync(output))output=path.join(out,resourceId+'-recovery-'+randomUUID()+'.png');const downloaded=await this.invoke(['resource','download',resourceId,'--project-id',state.canvasId,'--output',output],options);const actual=path.resolve(downloaded.path||'');check(actual===path.resolve(output)&&contained(out,actual)&&fs.existsSync(actual)&&!fs.lstatSync(actual).isSymbolicLink(),'即梦下载路径超出本次任务目录',502);check(contained(fs.realpathSync(out),fs.realpathSync(actual)),'即梦下载的真实路径超出目录',502);bytes=fs.readFileSync(actual);check(bytes.length>0&&downloaded.size===bytes.length&&downloaded.sha256===digest(bytes),'即梦下载大小或校验和不一致',502);state.download={sha256:downloaded.sha256,size:downloaded.size,fileName:path.basename(output)};this.write(file,state);}
    const info=imageInfo(bytes),nativeGeneration=assessNativeResult(input.nativeSizing??input.panel?.nativeSizing,info,{provider:'jimeng',imageModelId:state.generationSelection?.model||input.model||null,channelVersion:this.contract?.version??null});nativeGeneration.checkedAt=new Date().toISOString();nativeGeneration.control='discrete';nativeGeneration.imageModelState='contract';nativeGeneration.generationSelection=state.generationSelection||{model:input.model,mode:input.mode,ratio:input.ratio,resolution:input.resolution};let alignedBytes=null,alignedPath=null,alignmentError=nativeGeneration.notice;
    state.nativeGeneration=nativeGeneration;
    if(input.action==='edit'&&!nativeGeneration.requiresAcceptance){
      const aligned=path.join(out,'aligned_panel.png'),python=findPython(this.env);check(python,'即梦局部重绘贴图需要 Python',409);
      const result=await run([python],['-c',"import sys;sys.path.insert(0,sys.argv[1]);from image_pipeline import align_patch;align_patch(sys.argv[2],(int(sys.argv[3]),int(sys.argv[4])),sys.argv[5])",path.join(ROOT,'python'),output,String(input.cropBox[2]),String(input.cropBox[3]),aligned],{cwd:ROOT,env:this.runtimeEnv(),timeout:30000});
      if(result.code===0){alignedBytes=fs.readFileSync(aligned);alignedPath=aligned;}else alignmentError=safeMessage(result.stderr||'生成图比例不适合当前格子；原图保留为候选');
    }
    state.phase='done';this.write(file,state);return {filePath:output,bytes,info,alignedPath,alignedBytes,alignmentError,nativeGeneration,nativeSizingResult:nativeGeneration,sizeMismatch:nativeGeneration.mismatch,description:'即梦官方 CLI 图片生成并校验完成',provider:'jimeng',recovery:this.publicState(state),timings:null};
  }
  resumeState(directory){const state=load(this.recordFile(directory));check(state?.nodeId&&state.submitId,'缺少可恢复的即梦节点或提交记录',409);check(!TERMINAL_PHASES.includes(state.phase),'这次即梦生成已明确结束（被拒绝或失败），没有可查询的进行中任务；请修改后重新发起',409);return {submissionAttempted:state.submissionAttempted===true,recovery:this.publicState(state)};}
  async generate(directory,input,referenceFiles,{approvalCeiling,recoveryOnly=false,preparationOnly=false,...options}={}){
    if(recoveryOnly)return this.finish(directory,input,options);
    ({input,referenceFiles}=prepareGenerationReferences(input,referenceFiles));
    let state;try{state=await this.prepare(directory,input,referenceFiles,options);}catch(error){try{const saved=load(this.recordFile(directory));if(saved?.nodeId&&saved.submitId&&!saved.submissionAttempted)Object.assign(error,{recoverable:true,recovery:this.publicState(saved),requiredAction:error.requiredAction||'resume'});}catch{}throw error;}
    options.onProgress?.('即梦画布与镜头已保存',{phase:'quoting',recovery:this.publicState(state)});
    if(preparationOnly&&!state.submissionAttempted){state=await this.quote(directory,options);state.phase='awaiting_confirmation';this.write(this.recordFile(directory),state);return {awaitingConfirmation:true,quote:state.quote,recovery:this.publicState(state)};}
    if(state.submissionAttempted)return this.finish(directory,input,options);
    const submitted=await this.submit(directory,{...options,creditCeiling:approvalCeiling});
    if(submitted.awaitingConfirmation)return submitted;
    options.onProgress?.('即梦已受理镜头',{phase:'generating',recovery:this.publicState(submitted)});return this.finish(directory,input,options);
  }
  close(){this.closed=true;for(const child of this.children)stopChild(child);this.children.clear();}
}
