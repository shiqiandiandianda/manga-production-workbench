export function installShutdown({busy=()=>false,details=()=>[],close=()=>{},forceClose=close,pause=()=>{}}={}){
 if(!process.send)return;
 process.on('message',async message=>{if(!['distribution-status','distribution-stop','distribution-force-stop'].includes(message?.type))return;
  try{if(message.type==='distribution-force-stop'){await pause();await forceClose();process.send?.({id:message.id,stopped:true,forced:true},()=>process.exit(0));return;}const active=await busy(),info=active?await details():[];if(message.type==='distribution-status')return process.send?.({id:message.id,busy:!!active,details:info});if(active)return process.send?.({id:message.id,busy:true,details:info,error:'仍有任务进行中'});await pause();await close();process.send?.({id:message.id,stopped:true},()=>process.exit(0));}catch(e){process.send?.({id:message.id,error:e.message});}
 });
}
