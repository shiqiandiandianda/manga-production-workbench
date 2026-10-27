// The saved selection identity owns its number; task attempts never get a second numbering scheme.
const validNumber=value=>Number.isSafeInteger(value)&&value>0;
const namedNumber=item=>validNumber(item?.number)?item.number:Number(/^选区\s*(\d+)\s*$/.exec(item?.name||'')?.[1])||0;
const taskKey=task=>task.regionId||`task:${task.id}`;
export function taskOrder(task){return String(task.orderAt||task.createdAt||task.id||'');}
export function assignRegionNumbers(regions,tasks,previous={}){
  const numbers={},used=new Set(),list=[...tasks];
  for(const [key,number] of Object.entries(previous))if(validNumber(number)&&!used.has(number)){numbers[key]=number;used.add(number);}
  const candidates=[...regions.map(namedNumber),...list.map(task=>namedNumber(task.region))];
  let next=Math.max(0,...used,...candidates)+1;
  const assign=(key,preferred)=>{if(numbers[key])return numbers[key];const number=validNumber(preferred)&&!used.has(preferred)?preferred:next++;numbers[key]=number;used.add(number);return number;};
  for(const region of regions){region.number=assign(region.id,namedNumber(region));if(!region.name||/^选区\s*\d+\s*$/.test(region.name))region.name=`选区 ${region.number}`;}
  for(const task of list.sort((a,b)=>taskOrder(a).localeCompare(taskOrder(b))||a.id.localeCompare(b.id)))assign(taskKey(task),namedNumber(task.region));
  return numbers;
}
export function currentRegionTask(region,tasks){
  const related=[...tasks].filter(task=>task.regionId===region.id||task.id===region.jobId).sort((a,b)=>taskOrder(b).localeCompare(taskOrder(a))||b.id.localeCompare(a.id));
  return related[0]||null;
}
export function regionDeleted(id,{deletedRegionIds={},restoredRegionIds={}}={}){
  return Number(deletedRegionIds[id]||0)>Number(restoredRegionIds[id]||0);
}
export function buildRepairItems(regions,tasks,numbers,markers={}){
  const list=[...tasks],seen=new Set(),discarded=[],items=regions.map(region=>{
    const related=list.filter(task=>task.regionId===region.id||task.id===region.jobId).sort((a,b)=>taskOrder(b).localeCompare(taskOrder(a))||b.id.localeCompare(a.id));
    for(const task of related){seen.add(task.id);if(task.decision==='discarded')discarded.push(task);}
    const valid=related.filter(task=>task.decision!=='discarded');
    return{key:region.id,number:numbers[region.id],region,task:valid[0]||null,previous:valid.slice(1)};
  }).sort((a,b)=>a.number-b.number);
  const groups={deleted:[],discarded:[],orphaned:[]},maps={deleted:new Map(),discarded:new Map(),orphaned:new Map()};
  const add=(task,kind)=>{const key=taskKey(task),map=maps[kind];if(!map.has(key))map.set(key,{key,number:numbers[key],region:null,task:null,previous:[],historyKind:kind});map.get(key).previous.push(task);};
  for(const task of discarded)add(task,'discarded');
  for(const task of list)if(!seen.has(task.id))add(task,regionDeleted(task.regionId,markers)?'deleted':task.decision==='discarded'?'discarded':'orphaned');
  for(const kind of Object.keys(groups))groups[kind]=[...maps[kind].values()].map(item=>{item.previous.sort((a,b)=>taskOrder(b).localeCompare(taskOrder(a))||b.id.localeCompare(a.id));item.task=item.previous.shift();return item;}).sort((a,b)=>a.number-b.number);
  return{items,history:[...groups.deleted,...groups.discarded,...groups.orphaned],historyGroups:groups};
}
export function centeredFrameView(frame,viewport,page,zoom){
  const scale=Math.max(.00001,Math.min(zoom,Math.max(1,viewport.width-64)/frame.width,Math.max(1,viewport.height-64)/frame.height));
  return{zoom:scale,panX:viewport.width/2-(frame.x+frame.width/2)*scale-(viewport.width-page.width*scale)/2,panY:viewport.height/2-(frame.y+frame.height/2)*scale-(viewport.height-page.height*scale)/2};
}
