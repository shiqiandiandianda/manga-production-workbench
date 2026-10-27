import fs from 'node:fs';
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const origin=value=>{try{const url=new URL(value);return /^https?:$/.test(url.protocol)&&!url.username&&!url.password?url.origin:null;}catch{return null;}};
/** Project choices stay local; the editor's login is the shared session authority. */
export function readMokuConfig(configFile,sessionFile=''){
 const config=read(configFile)||{},shared=read(sessionFile),base=origin(config.base),sharedBase=origin(shared?.base||shared?.baseUrl);
 if(shared?.cookie&&sharedBase&&(!base||base===sharedBase))return {...config,base:sharedBase,cookie:shared.cookie,sessionSource:'editor'};
 return {...config,sessionSource:'local'};
}
