import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';

const privateAddress=ip=>ip==='::1'||/^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(ip)||/^f[cd][0-9a-f]{2}:/i.test(ip);
export class AssetCenterClient{
 constructor({url,token,timeout=30000}){this.url=new URL(url);if(!['http:','https:'].includes(this.url.protocol)||this.url.username||this.url.password||this.url.pathname!=='/'||this.url.search||this.url.hash)throw Error('资产中心地址需要是 http(s)://主机:端口');if(typeof token!=='string'||!/^act_[a-f0-9]{64}$/.test(token))throw Error('访问令牌格式无效');this.token=token;this.timeout=timeout;}
 async request(route,{method='GET',data,binary=false,signal}={}){
  if(!route.startsWith('/api/')||route.startsWith('//'))throw Error('资产中心接口路径无效');const host=this.url.hostname.replace(/^\[|\]$/g,''),addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await dns.lookup(host,{all:true});if(!addresses.length||this.url.protocol==='http:'&&addresses.some(item=>!privateAddress(item.address)))throw Error('HTTP连接只允许本机或私有局域网；公网中心必须使用HTTPS');if(addresses.some(item=>item.address.startsWith('169.254.')||item.address.startsWith('fe80:')||['0.0.0.0','::'].includes(item.address)))throw Error('不允许连接链路本地或未指定地址');
  const bytes=data===undefined?null:Buffer.from(JSON.stringify(data)),target=new URL(route,this.url),pinned=addresses[0];
  return new Promise((resolve,reject)=>{const request=(target.protocol==='https:'?https:http).request(target,{method,signal,headers:{Authorization:'Bearer '+this.token,...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{})},lookup:(_host,options,callback)=>options?.all?callback(null,[pinned]):callback(null,pinned.address,pinned.family)},response=>{const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>45*1024*1024){response.destroy(Error('中心返回数据过大'));return;}chunks.push(chunk);});response.on('error',reject);response.on('end',()=>{const buffer=Buffer.concat(chunks);if(response.statusCode<200||response.statusCode>=300){let message;try{message=JSON.parse(buffer.toString()).error;}catch{};return reject(Object.assign(Error(String(message||'资产中心请求失败').replaceAll(this.token,'[redacted]').slice(0,600)),{status:response.statusCode}));}if(binary)return resolve(buffer);try{resolve(JSON.parse(buffer.toString()));}catch{reject(Error('资产中心返回了无效JSON'));}});});request.setTimeout(this.timeout,()=>request.destroy(Error('资产中心连接超时')));request.once('error',error=>reject(Object.assign(Error(String(error.message).replaceAll(this.token,'[redacted]')),{code:error.code})));if(bytes)request.write(bytes);request.end();});
 }
 status(options=''){return this.request('/api/v1/status'+options);}
 submit(data){return this.request('/api/v1/requirements/batches',{method:'POST',data});}
 claim(data){return this.request('/api/v1/tasks/claim',{method:'POST',data});}
 heartbeat(taskId,data){return this.request('/api/v1/tasks/'+taskId+'/heartbeat',{method:'POST',data});}
 result(taskId,data){return this.request('/api/v1/tasks/'+taskId+'/result',{method:'POST',data});}
 fail(taskId,data){return this.request('/api/v1/tasks/'+taskId+'/fail',{method:'POST',data});}
 image(versionId){if(!/^version_[a-f0-9-]{36}$/.test(versionId))throw Error('图片版本编号无效');return this.request('/api/v1/versions/'+versionId+'/image',{binary:true});}
}
