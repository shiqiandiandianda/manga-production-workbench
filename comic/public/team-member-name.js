export function memberName(value,{machine='',confirmed=false}={}){
 if(typeof value!=='string')return '';const name=value.replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim();
 if(!name||name.length>80||/^(?:DESKTOP|LAPTOP|WIN|PC|MM)[-_][a-z0-9_-]{5,}$/i.test(name)||/^(?:未命名|未填写|待填写)(?:设备|成员|姓名)?$/.test(name))return '';
 if(!confirmed&&machine&&name.toLowerCase()===machine.trim().toLowerCase())return '';return name;
}
/** Presentation groups only; installation IDs, authorizations and task owners stay intact. */
export function groupTeamMembers(members=[]){
 const primary=members.find(m=>m.id==='publisher'),groups=new Map();
 for(const m of members){const name=memberName(m.name,{confirmed:true}),samePrimary=primary?.machine&&m.machine?.toLocaleLowerCase()===primary.machine.toLocaleLowerCase(),key=samePrimary?'publisher':name?'name:'+name.normalize('NFKC').toLocaleLowerCase():'installation:'+m.id;if(!groups.has(key))groups.set(key,{key,installations:[]});groups.get(key).installations.push(m);}
 const priority=m=>m.id==='publisher'?0:m.connection==='online'?1:m.connection==='offline'?2:3;
 return [...groups.values()].map(g=>{g.installations.sort((a,b)=>priority(a)-priority(b)||(b.lastSeen||0)-(a.lastSeen||0));const representative=g.installations[0];return {...g,representative,name:representative.name||'待填写姓名',connection:g.installations.some(m=>m.connection==='online')?'online':g.installations.some(m=>m.connection==='offline')?'offline':'unknown',lastSeen:Math.max(...g.installations.map(m=>m.lastSeen||0))};}).sort((a,b)=>priority(a.representative)-priority(b.representative)||a.name.localeCompare(b.name));
}
/** LAN HTTP lacks randomUUID in Chromium; getRandomValues remains available. */
export function teamUUID(){
 const provider=globalThis.crypto;if(typeof provider?.randomUUID==='function')return provider.randomUUID();
 if(typeof provider?.getRandomValues!=='function')throw Error('当前浏览器不支持安全随机数，请使用新版 Edge 或 Chrome');
 const bytes=provider.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const h=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
