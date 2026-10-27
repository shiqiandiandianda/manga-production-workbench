import {storyboardPage} from './storyboard-document.mjs';
import {createHash} from 'node:crypto';
import {importStoryboard} from './storyboard-import.mjs';
import {delimitedTable} from './delimited-table.mjs';
import {normalizeRows,id} from '../public/model.js';
import {SHOT_SIZES,CAMERA_ANGLES} from '../public/shot-settings.js';
import {episodeFromLabel} from '../public/storyboard-episodes.js';
const fail=message=>{throw Object.assign(Error(message),{status:400,code:'storyboard_data_invalid'});};
const value=(row,...keys)=>{for(const key of keys)if(row[key]!==undefined&&String(row[key]).trim())return Array.isArray(row[key])?row[key].join('、'):String(row[key]);return '';};
export async function readStoryboardData(input){
 const fileName=String(input.name||'粘贴分镜表'),parsed=await importStoryboard({...input,mode:'inspect'});let workbook=parsed.workbook;
 if(!workbook){const text=parsed.text.trim();if(text.startsWith('[')||text.startsWith('{')){const data=JSON.parse(text),rows=Array.isArray(data)?data:data.shots;if(!Array.isArray(rows)||!rows.length||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))fail('JSON需要非空分镜数组');const headers=[...new Set(rows.flatMap(row=>Object.keys(row)))];workbook=[{name:'分镜',headerIndex:0,table:[headers,...rows.map(row=>headers.map(h=>row[h]??''))],rowNumbers:[1,...rows.map((row,i)=>row.sourceRow||i+2)]}];}else workbook=[{name:'分镜',headerIndex:0,...delimitedTable(parsed.text)}];}
 const grouped=new Map(),descriptionKeys=['description','画面描述','画面内容','画面','分镜内容','分镜','画面内容描述'];
 for(const sheet of workbook){const headerIndex=sheet.headerIndex??0,headers=(sheet.table[headerIndex]||[]).map(v=>String(v).trim());if(!headers.some(h=>descriptionKeys.includes(h)))continue;
  const nonempty=headers.filter(Boolean);if(new Set(nonempty).size!==nonempty.length)fail(sheet.name+'有重复表头');if(sheet.cellErrors?.length)fail(sheet.name+'含错误单元格或无缓存公式，请在原表中修正');
  for(let index=headerIndex+1;index<sheet.table.length;index++){const cells=sheet.table[index],raw=Object.fromEntries(headers.filter(Boolean).map(h=>[h,cells[headers.indexOf(h)]??'']));if(!Object.values(raw).some(v=>String(v).trim()))continue;
   const episode=episodeFromLabel(value(raw,'episode','话','话数','集数','所属话'))||episodeFromLabel(sheet.name)||episodeFromLabel(input.episode);if(!episode)fail('未找到明确话号，请填写导入话号；不会默认当作第1话');
   if(!grouped.has(episode))grouped.set(episode,[]);grouped.get(episode).push({raw,sourceSheet:sheet.sourceName||sheet.name,sourceRow:sheet.rowNumbers?.[index]||index+1});
  }
 }
 if(!grouped.size)fail('没有找到含画面内容的分镜工作表');if(grouped.size>100)fail('一次最多导入100话');const total=[...grouped.values()].reduce((n,rows)=>n+rows.length,0);if(total>8000)fail('一次最多导入8000格，请按话分批导入');
 const shots=[],episodes=[];
 for(const [episode,rows] of [...grouped].sort(([a],[b])=>a-b)){
  const normalized=rows.map(({raw,sourceSheet,sourceRow},index)=>{const row={...raw,code:value(raw,'code','格号','镜头编号','编号')||String(index+1),sourceSheet,sourceRow};const size=value(raw,'shotSize','景别'),angle=value(raw,'cameraAngle','机位角度','镜头角度');
   for(const key of ['shotSize','景别','cameraAngle','机位角度','镜头角度'])delete row[key];if(SHOT_SIZES.includes(size))row.shotSize=size;if(CAMERA_ANGLES.includes(angle))row.cameraAngle=angle;
   row.shotSizeRaw=size;row.cameraAngleRaw=angle;row.sourceLocation=value(raw,'sourceLocation','分镜出处','来源位置','原著位置','原文出处');return row;});
  const imported=normalizeRows(normalized);for(const [index,shot] of imported.entries()){shot.episode=episode;shot.sourceFields=structuredClone(rows[index].raw);shot.shotSizeRaw=normalized[index].shotSizeRaw;shot.cameraAngleRaw=normalized[index].cameraAngleRaw;}
  shots.push(...imported);episodes.push({episode,title:value(rows[0].raw,'episodeTitle','话名'),shotIds:imported.map(s=>s.id),sourceSheets:[...new Set(rows.map(row=>row.sourceSheet))],status:'imported'});
 }
 const payload=typeof input.text==='string'?Buffer.from(input.text):Buffer.from(input.dataBase64,'base64'),created=new Date().toISOString();
 const project={id:id('project'),title:String(input.title||fileName.replace(/\.[^.]+$/,'')).trim().slice(0,180),revision:0,style:'',references:[],shots,pages:episodes.map(e=>storyboardPage(e.episode,shots.filter(shot=>e.shotIds.includes(shot.id)))),layerSchema:1,layerOrder:[],gradients:[],created,updated:created,storyboardImport:{version:1,fileName,fileKey:createHash('sha256').update(payload).digest('hex'),episodes}};
 return project;
}
