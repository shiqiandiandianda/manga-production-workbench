export function releaseDay(value=new Date()){
 const date=new Date(value);if(!Number.isFinite(date.getTime()))throw Error('版本日期无效');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
export function parsedReleaseVersion(value){const m=/^(\d{4}-\d{2}-\d{2}) V(\d{2,})$/.exec(String(value||''));return m?{day:m[1],sequence:Number(m[2])}:null;}
export function nextReleaseVersion(previous,now=new Date()){
 const day=releaseDay(now),old=parsedReleaseVersion(previous),sequence=old?.day===day?old.sequence+1:1;
 return day+' V'+String(sequence).padStart(2,'0');
}
export function displayReleaseVersion(value){
 if(!value)return '尚未发布';if(parsedReleaseVersion(value))return value;
 const old=/^(\d{4})(\d{2})(\d{2})\d{6}-[a-f0-9]+$/.exec(String(value));
 return old?old[1]+'-'+old[2]+'-'+old[3]+' 旧版':String(value);
}
