// Some Windows systems allocate ephemeral ports from Fetch's blocked range.
import portPolicy from '../../quality/port-policy.cjs';
export const {isFetchBlockedPort}=portPolicy;

export async function listenForFetch(server){
 for(let attempt=0;attempt<64;attempt++){
  await new Promise((resolve,reject)=>{const error=e=>reject(e);server.once('error',error);server.listen(0,'127.0.0.1',()=>{server.off('error',error);resolve();});});
  const port=server.address().port;
  if(!isFetchBlockedPort(port))return 'http://127.0.0.1:'+port;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 }
 throw Error('无法分配可供 Fetch 使用的隔离回环端口');
}
