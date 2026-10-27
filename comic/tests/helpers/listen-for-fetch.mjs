// Port 0 may select a port on Fetch's forbidden-port list. Retry only that
// specific local bind error; do not turn connection errors into test passes.
export async function listenForFetch(server){
 for(let attempt=0;attempt<32;attempt++){
  await new Promise((resolve,reject)=>{
   const onError=error=>reject(error);
   server.once('error',onError);
   server.listen(0,'127.0.0.1',()=>{server.off('error',onError);resolve();});
  });
  const origin='http://127.0.0.1:'+server.address().port;
  try{const response=await fetch(origin+'/api/health');await response.arrayBuffer();return origin;}
  catch(error){
   await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
   if(error.cause?.message!=='bad port')throw error;
  }
 }
 throw new Error('隔离服务多次获得 Fetch 禁止的端口');
}
