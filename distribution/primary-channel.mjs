import fs from 'node:fs';
import path from 'node:path';
/** The signing installation talks to its own publisher independently of DHCP. */
export function localPrimaryChannel(root,channel){
 const file=path.join(root,'runtime-data/distribution/master/master.local.json');
 if(!channel?.publicKey||!fs.existsSync(file))return channel;
 const identity=JSON.parse(fs.readFileSync(file));
 if(!identity.privateKey||identity.publicKey!==channel.publicKey)return channel;
 const address=new URL(channel.masterUrl);
 if(!['http:','https:'].includes(address.protocol)||address.username||address.password)throw Error('主机发布地址无效');
 address.hostname='127.0.0.1';
 return {...channel,masterUrl:address.origin};
}
/** Update only URLs hosted by this publisher; access tokens and device IDs stay intact. */
export function retargetPrimaryAccess(state,previousMaster,currentMaster){
 const previous=new URL(previousMaster),current=new URL(currentMaster);if(previous.hostname===current.hostname)return 0;
 let count=0;for(const access of Object.values(state.clients||{})){
  let url;try{url=new URL(access.hub);}catch{continue;}
  if(url.hostname!==previous.hostname)continue;
  url.hostname=current.hostname;access.hub=url.origin+url.pathname.replace(/\/$/,'');count++;
 }return count;
}
