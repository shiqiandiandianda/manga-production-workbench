import fs from 'node:fs';import path from 'node:path';
const transient=new Set(['ECONNRESET','ECONNREFUSED','EPIPE','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH']);
/** Only GET transport failures may be replayed. A write can have reached the
 * service even if its reply was lost; callers must reconcile its request id. */
export function createLocalAssetServiceClient({origin,name='资产工作室',fetcher=globalThis.fetch,diagnosticFile,retryDelayMs=120}={}){
 const service=new URL(origin);
 function log(route,method,error,attempt){if(!diagnosticFile)return;try{fs.mkdirSync(path.dirname(diagnosticFile),{recursive:true});fs.appendFileSync(diagnosticFile,JSON.stringify({at:new Date().toISOString(),service:name,path:route.pathname,method,attempt,code:error.cause?.code||error.code||error.name})+'\n');}catch{}}
 async function call(route,options={},format='json'){
  const url=new URL(route,service);if(url.origin!==service.origin)throw Error('资产服务请求地址无效');
  const {timeoutMs=30000,signal,...init}=options,method=(init.method||'GET').toUpperCase(),headers=new Headers(init.headers);headers.set('Connection','close');
  for(let attempt=0;;attempt++){
   const timeout=AbortSignal.timeout(timeoutMs),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
   try{const response=await fetcher(url,{...init,method,headers,signal:requestSignal});
    if(!response.ok){let error='';try{error=(await response.json()).error||'';}catch{}const generic=/^(fetch failed|Failed to fetch)$/i.test(error);throw Object.assign(Error(generic?name+'处理请求时连接中断，请先查看生成记录确认任务状态。':error||name+'返回错误（HTTP '+response.status+'）'),{status:response.status,code:'asset_service_http_error',localServiceResponse:true,submissionUncertain:method!=='GET'&&response.status>=500});}
    return format==='bytes'?Buffer.from(await response.arrayBuffer()):await response.json();
   }catch(error){if(error.localServiceResponse)throw error;
    log(url,method,error,attempt+1);
    const network=transient.has(error.cause?.code||error.code)||error instanceof TypeError&&/fetch|terminated|network/i.test(error.message);
    if(method==='GET'&&attempt===0&&network&&!requestSignal.aborted){await new Promise(resolve=>setTimeout(resolve,retryDelayMs));continue;}
    const message=error instanceof SyntaxError?name+'返回的数据无法解析，请重新读取。':method==='GET'?name+'连接中断，读取失败；请稍后重新检查。':name+'连接中断，提交状态待核实；请先查看生成记录，不要重复点击生成。';
    throw Object.assign(Error(message,{cause:error}),{status:503,code:'asset_service_unreachable',submissionUncertain:method!=='GET'});
   }
  }
 }
 return {json:(route,options)=>call(route,options),bytes:(route,options)=>call(route,options,'bytes')};
}
