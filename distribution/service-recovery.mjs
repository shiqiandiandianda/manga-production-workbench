/** Recover only a stopped child. Never restart a live process or replay a job. */
export function createServiceRecovery({alive,blocked,available,start,log=()=>{},now=Date.now,limit=3,windowMs=300000}){
 let pending=false,nextAt=0,attempts=[],lastExit=null,lastError=null;
 function exited(info){lastExit={...info,at:new Date(now()).toISOString(),expected:blocked()};log('exit',lastExit);if(!lastExit.expected)nextAt=now()+1000;}
 async function tick(){
  if(pending||blocked()||alive()||now()<nextAt)return false;
  attempts=attempts.filter(at=>now()-at<windowMs);
  if(attempts.length>=limit){nextAt=attempts[0]+windowMs;lastError='短时间内多次退出，已暂停自动恢复，请查看服务日志';log('paused',{retryAt:new Date(nextAt).toISOString()});return false;}
  pending=true;
  try{
   if(!await available()){lastError='编辑器端口已被其他进程占用，未停止或替换该进程';nextAt=now()+30000;log('port-occupied',{});return false;}
   if(blocked()||alive())return false;
   attempts.push(now());nextAt=now()+[5000,15000,60000][Math.min(attempts.length-1,2)];log('recovering',{attempt:attempts.length});
   await start();lastError=null;log('recovered',{});return true;
  }catch(error){lastError=String(error.message||error).slice(0,500);log('recovery-failed',{error:lastError});return false;}
  finally{pending=false;}
 }
 return {tick,exited,status:()=>({pending,attempts:attempts.length,lastExit,lastError,nextAt})};
}
