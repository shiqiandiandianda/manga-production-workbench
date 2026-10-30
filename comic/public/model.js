import {TEXT_FONT_DEFAULTS} from './text-font-defaults.js';
import {SHOT_SIZES,validateShotSettings} from './shot-settings.js';
import {isCircleFrame} from './frame-primitives.js';
import {parseNamedStates,sourceCharacterStates} from './character-states.js';
import {scaleReflowLettering} from './reflow-lettering.mjs';
export const id = prefix => `${prefix}_${globalThis.crypto.randomUUID()}`;
export const clone = value => JSON.parse(JSON.stringify(value));
export const rectangle = () => [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
export const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
export function bounds(panel) {
  const xs=panel.points.map(p=>p.x*panel.w),ys=panel.points.map(p=>p.y*panel.h);
  const x=Math.min(...xs),y=Math.min(...ys);
  return {x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};
}
export function pathFor(panel,absolute=false) {
  if(isCircleFrame(panel.points)){const x=absolute?panel.x:0,y=absolute?panel.y:0;return `M ${x} ${y+panel.h/2} A ${panel.w/2} ${panel.h/2} 0 1 0 ${x+panel.w} ${y+panel.h/2} A ${panel.w/2} ${panel.h/2} 0 1 0 ${x} ${y+panel.h/2} Z`;}
  return panel.points.map((p,i)=>`${i?'L':'M'}${(absolute?panel.x:0)+p.x*panel.w} ${(absolute?panel.y:0)+p.y*panel.h}`).join(' ')+' Z';
}
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const onSegment=(a,b,c)=>Math.abs(cross(a,b,c))<1e-8&&c.x>=Math.min(a.x,b.x)-1e-8&&c.x<=Math.max(a.x,b.x)+1e-8&&c.y>=Math.min(a.y,b.y)-1e-8&&c.y<=Math.max(a.y,b.y)+1e-8;
const intersects=(a,b,c,d)=>(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);
export function validPolygon(points) {
  if(!Array.isArray(points)||points.length<3||points.length>64||points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>8||Math.abs(p.y)>8))return false;
  let area=0;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    if(Math.hypot(a.x-b.x,a.y-b.y)<.003)return false;
    area+=a.x*b.y-b.x*a.y;
    for(let j=i+1;j<points.length;j++) {
      if(j===i+1||(i===0&&j===points.length-1))continue;
      if(intersects(a,b,points[j],points[(j+1)%points.length]))return false;
    }
  }
  return Math.abs(area)>.006;
}
export function fitImage(panel,asset,overscan=1.08) {
  const b=bounds(panel),scale=Math.max(b.w/asset.width,b.h/asset.height)*overscan;
  return {x:b.x+(b.w-asset.width*scale)/2,y:b.y+(b.h-asset.height*scale)/2,scale};
}
export const shapePresets = [
  {id:'rectangle',label:'矩形'},
  {id:'slanted',label:'斜切'},
  {id:'trapezoid',label:'梯形'},
  {id:'cut-corner',label:'切角'},
  {id:'hexagon',label:'六边形'},
  {id:'free-polygon',label:'自由多边形'}
];
const shapePoints = {
  rectangle:rectangle(),
  slanted:[{x:.14,y:0},{x:1,y:0},{x:.86,y:1},{x:0,y:1}],
  trapezoid:[{x:.12,y:0},{x:.88,y:0},{x:1,y:1},{x:0,y:1}],
  'cut-corner':[{x:0,y:0},{x:.86,y:0},{x:1,y:.16},{x:1,y:1},{x:.12,y:1},{x:0,y:.84}],
  hexagon:[{x:.16,y:0},{x:.84,y:0},{x:1,y:.5},{x:.84,y:1},{x:.16,y:1},{x:0,y:.5}],
  'free-polygon':[{x:0,y:.08},{x:.48,y:0},{x:.92,y:.06},{x:1,y:.34},{x:.90,y:.88},{x:.56,y:1},{x:.12,y:.91},{x:0,y:.55}]
};
export function polygonFor(shapeId='rectangle') {
  if(!Object.hasOwn(shapePoints,shapeId))throw new Error('未知的格子形状');
  return clone(shapePoints[shapeId]);
}

export function panel(shotId,x,y,w,h,kind='panel') {
  return {id:id('panel'),shotId,x,y,w,h,points:rectangle(),kind,visible:true,locked:false,border:kind==='background'?0:6,borderColor:'#111111',feather:kind==='background'?60:0,imageAssetId:null,imageTransform:null,candidates:[],generationToken:null};
}





export function makePage(shotIds=[],_options=null,width=COMIC_PAGE_WIDTH,height=DEFAULT_PAGE_HEIGHT){if(!Number.isFinite(width)||width<=0||!Number.isSafeInteger(height)||height<1)throw Error('画板尺寸无效');const gap=40,h=shotIds.length?Math.max(20,(height-gap*Math.max(0,shotIds.length-1))/shotIds.length):720;return {id:id('page'),name:'长图',width,height:Math.max(height,Math.ceil(shotIds.length*(h+gap)-gap)),background:'#ffffff',panels:shotIds.map((shotId,index)=>panel(shotId,0,index*(h+gap),width,h)),bubbles:[]};}




export function createProject(title='未命名漫画',demo=false) {
  const descriptions=demo?['黄昏，短刀将一封信钉在古宅门柱上，近景，信封与短刀清楚可见。','古宅门口，黑衣女侠回头对身后的白衣女子说话，双人中景，落日从门外照入。','黑衣女侠抬手从门柱上取下信件，侧后方中景，衣袖与发带带出动作。','黑衣女侠低头读信，面部与信纸近景，目光停顿。']:['填写这个镜头的画面内容'];
  const shots=descriptions.map((description,i)=>({id:id('shot'),code:`S${String(i+1).padStart(2,'0')}`,title:demo?['信件特写','门口对话','取信','阅读特写'][i]:'新镜头',description,dialogue:demo&&i===1?'你待在这里别动，\n我出门看看':demo&&i===3?'原来是她……':'',referenceIds:[]}));
  const page=makePage(shots.map(s=>s.id));page.name='长图 01';
  if(demo){const scene=page.panels[1];page.bubbles.push({id:id('bubble'),shotId:shots[1].id,x:scene.x+scene.w*.22,y:scene.y+scene.h*.12,w:350,h:120,text:shots[1].dialogue,type:'speech',...TEXT_FONT_DEFAULTS,visible:true});}
  return {id:id('project'),title,revision:0,style:'',references:[],shots,pages:[page],created:new Date().toISOString(),updated:new Date().toISOString()};
}
export function parseTable(text) {
  const trimmed=text.replace(/^\uFEFF/,'').trim();
  if(!trimmed)throw new Error('分镜表为空');
  if(trimmed.startsWith('[')||trimmed.startsWith('{')) {
    const parsed=JSON.parse(trimmed),rows=Array.isArray(parsed)?parsed:parsed.shots;
    if(!Array.isArray(rows))throw new Error('JSON 需要是镜头数组，或包含 shots 数组');
    return normalizeRows(rows);
  }
  if(trimmed.startsWith('|')){
    const lines=trimmed.split(/\r?\n/).filter(l=>l.trim());
    const cells=l=>l.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(c=>c.trim().replaceAll('\\|','|'));
    const headers=cells(lines.shift());
    const data=lines.filter(l=>!/^\s*\|?[\s:|\-]+\|?\s*$/.test(l)).map(cells);
    return normalizeRows(data.map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]||'']))));
  }
  const delimiter=trimmed.includes('\t')?'\t':',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<trimmed.length;i++) {
    const char=trimmed[i];
    if(char==='"') {if(quoted&&trimmed[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(char===delimiter&&!quoted){row.push(cell);cell='';}
    else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&trimmed[i+1]==='\n')i++;row.push(cell);if(row.some(c=>c.trim()))rows.push(row);row=[];cell='';}
    else cell+=char;
  }
  if(quoted)throw new Error('分镜表中的引号没有闭合');
  row.push(cell);if(row.some(c=>c.trim()))rows.push(row);
  if(rows.length<2)throw new Error('请包含表头和至少一行镜头');
  const headers=rows.shift().map(c=>c.trim());
  return normalizeRows(rows.map(row=>Object.fromEntries(headers.map((key,i)=>[key,row[i]||'']))));
}
export function normalizeRows(rows,{sheet='',rowNumbers=[],columns={}}={}) {
  if(!Array.isArray(rows)||!rows.length)throw new Error('分镜表没有数据行');
  if(rows.length>800)throw new Error('一次最多导入 800 个镜头');
  const value=(r,...keys)=>{for(const key of keys)if(r[key]!==undefined&&r[key]!==null)return Array.isArray(r[key])?r[key].join('、'):String(r[key]).trim();return '';};
  const original=(r,...keys)=>{for(const key of keys)if(r[key]!==undefined&&r[key]!==null)return String(r[key]);return '';};
  const codes=new Set(),issues=[];
  const shots=rows.map((row,i)=>{
    const sourceRow=Number.isInteger(row?.sourceRow)&&row.sourceRow>0?row.sourceRow:rowNumbers[i]||i+2,sourceSheet=sheet||original(row||{},'sourceSheet');
    const code=value(row||{},'code','格号','镜头编号','镜头号','分镜编号','编号')||'S'+String(i+1).padStart(2,'0');
    try{
    if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('第 '+(i+2)+' 行不是有效分镜');
    if(codes.has(code))throw new Error('镜头编号重复：'+code);codes.add(code);
    const description=original(row,'description','画面描述','画面内容','画面','分镜内容','分镜','画面内容描述');
    const dialogue=original(row,'dialogue','对白','台词','对话','对白内容');
    if(!description.trim())throw new Error('镜头 '+code+' 缺少画面描述');
    if(description.length>20000||dialogue.length>4000)throw new Error('镜头 '+code+' 的描述或台词超过支持长度');
    const notes=value(row,'continuityNotes','连续性备注','连续性','道具动作状态','画面备注','备注'),weather=value(row,'weather','当前天气','天气'),role=value(row,'declaredPanelRole','主副格','画格类型','主副格类型');
    const declaredPanelRole=role?(/^(?:main|primary|主格|主画面)$/i.test(role)?'main':/^(?:sub|secondary|inset|副格|嵌格)$/i.test(role)?'sub':''):/(?:【|\[)主格(?:】|\])/.test(notes)?'main':/(?:【|\[)(?:副格|嵌格)(?:】|\])/.test(notes)?'sub':'';
    const characterStates=sourceCharacterStates(row),propStates=value(row,'propStates','道具状态'),propNames=value(row,'propNames','props','道具','出现道具','道具名称')||parseNamedStates(propStates).entries.map(entry=>entry.name).join('、');
     const standardContext=!!characterStates||['出现角色','当前场景','当前天气','当前时间','画面备注','人物服装状态','道具状态','主副格'].some(key=>value(row,key)),context=standardContext?[
       declaredPanelRole?'画格职责：'+(declaredPanelRole==='main'?'主格':'副格'):'',
       value(row,'participants','参与人物','人物','角色','出现角色')?'出场角色：'+value(row,'participants','参与人物','人物','角色','出现角色'):'',
       value(row,'location','地点','当前场景')?'场景：'+value(row,'location','地点','当前场景'):'',value(row,'time','时间','当前时间')?'时间：'+value(row,'time','时间','当前时间'):'',weather?'天气：'+weather:'',
       characterStates?'人物服装与状态：'+characterStates:'',propStates?'道具状态：'+propStates:'',notes?'画面备注：'+notes:''
     ].filter(Boolean):[];
    return validateShotSettings({id:id('shot'),code,title:value(row,'title','镜头名称','标题')||code,description,dialogue,referenceIds:[],
      ...(value(row,'shotSize')?{shotSize:value(row,'shotSize')}:SHOT_SIZES.includes(value(row,'景别'))?{shotSize:value(row,'景别')}:{}),...(value(row,'cameraAngle','机位角度','镜头角度')?{cameraAngle:value(row,'cameraAngle','机位角度','镜头角度')}:{}),...(original(row,'cameraAngleRaw','cameraAngle','机位角度','镜头角度')?{cameraAngleRaw:original(row,'cameraAngleRaw','cameraAngle','机位角度','镜头角度')}:{}),...(row.productionPrompt!==undefined?{productionPrompt:original(row,'productionPrompt')}:context.length?{productionPrompt:[description,...context].join('\n')}:{}),
      ...(value(row,'sfxWords','特效字','音效字','音效','拟声词','soundEffects')?{sfxWords:value(row,'sfxWords','特效字','音效字','音效','拟声词','soundEffects')}:{}),...(propNames?{propNames}:{}),page:value(row,'page','页码','长图编号'),sourceRow,...(sourceSheet?{sourceSheet}:{}),
      sceneType:value(row,'sceneType','场面类型','戏类型','场景类型'),
      ...(row.readingUnits!==undefined?{readingUnits:structuredClone(row.readingUnits)}:{}),
      narrativeRole:value(row,'narrativeRole','叙事职责','分镜职责','功能','作用')||(declaredPanelRole==='main'?'main':declaredPanelRole==='sub'?'detail':''),
      shotScale:value(row,'shotScale','景别'),
      sceneId:value(row,'sceneId','场面编号','场景编号','场面ID','场景ID'),
      participants:value(row,'participants','参与人物','人物','角色','出现角色'),
      location:value(row,'location','地点','当前场景'),time:value(row,'time','时间','当前时间'),
       ...(weather?{weather}:{}),...(declaredPanelRole?{declaredPanelRole}:{}),...(characterStates?{characterStates}:{}),...(propStates?{propStates}:{}),...(value(row,'sourceLocation','分镜出处','来源位置')?{sourceLocation:value(row,'sourceLocation','分镜出处','来源位置')}:{}),
      transition:value(row,'transition','转场','过渡'),
      importance:value(row,'importance','重要性')||(declaredPanelRole==='main'?'5':declaredPanelRole==='sub'?'2':''),
      widthConstraint:value(row,'widthConstraint','构图宽度','锁定宽度'),
      characterPositions:value(row,'characterPositions','人物站位','站位'),
      continuityNotes:[notes,weather&&!notes.split(/\r?\n/).includes('天气：'+weather)?'天气：'+weather:''].filter(Boolean).join('\n')});
    }catch(error){
      const keys=error.field==='cameraAngle'?['cameraAngle','机位角度','镜头角度']:error.field==='shotSize'?['shotSize','景别']:[];
      const key=keys.find(k=>row?.[k]!==undefined),column=columns[key]||'',cell=column?column+sourceRow:'',panel=value(row||{},'格号');
      const location=(sourceSheet?sourceSheet+'!':'')+(cell||'第 '+sourceRow+' 行')+(panel?'（格 '+panel+'）':'（'+code+'）');
      issues.push({sheet:sourceSheet,row:sourceRow,column,cell,code,panel,field:key||error.field||'',originalValue:key?original(row,key):error.originalValue??'',message:location+'：'+error.message});
    }
  });
  if(issues.length)throw Object.assign(new Error(issues.slice(0,6).map(i=>i.message).join('\n')+(issues.length>6?'\n共 '+issues.length+' 行需要确认':'')),{status:400,importIssues:issues,importRows:rows});
  return shots;
}
export function layoutShots(shots,_options=null,width=COMIC_PAGE_WIDTH,height=DEFAULT_PAGE_HEIGHT){return [makePage(shots.map(shot=>shot.id),null,width,Math.max(height,shots.length*760-40))];}





// The saved document stays independent from the finite browser render window.
export const COMIC_PAGE_WIDTH = 1280;
export const DEFAULT_PAGE_HEIGHT = 3840;
export const MIN_PAGE_HEIGHT = 1;
export function validatePageHeight(height) {
  if(!Number.isSafeInteger(height)||height<MIN_PAGE_HEIGHT)throw new Error('页面高度需要是正安全整数（至少 1 像素）');
  return height;
}
const scaleFields=(target,fields,factor)=>{
  if(!target)return;
  for(const field of fields)if(Number.isFinite(target[field]))target[field]*=factor;
};
/** Explicit, reversible width migration. Existing IDs and normalized nodes stay unchanged. */
export function rescalePageWidth(page,width=COMIC_PAGE_WIDTH) {
  if(!page||!Number.isFinite(page.width)||page.width<=0||!Number.isSafeInteger(width)||width<320||width>4096)throw new Error('页面宽度无效');
  const factor=width/page.width;
  const nextHeight=validatePageHeight(Math.max(1,Math.round(page.height*factor)));
  if(factor===1)return page;
  for(const frame of page.panels||[]) {
    scaleFields(frame,['x','y','w','h','border','feather'],factor);
    scaleFields(frame.imageTransform,['x','y','scale'],factor);
    if(frame.featherEdges)for(const key of ['top','bottom','left','right'])frame.featherEdges[key]=Math.min(10000,frame.featherEdges[key]*factor);
  }
  for(const bubble of page.bubbles||[]) {
    scaleFields(bubble,['x','y','w','h','outlineWidth','shadowOffsetX','shadowOffsetY'],factor);
    scaleReflowLettering(bubble,factor);
    if(bubble.tail?.mode!=='normalized')scaleFields(bubble.tail,['x','y'],factor);
  }
  page.width=width;page.height=nextHeight;
  return page;
}
/** Changing the page length preserves artwork positions; optional scaleContent changes vertical geometry. */
export function resizePageHeight(page,height,{scaleContent=false}={}) {
  validatePageHeight(height);
  if(!page||!Number.isFinite(page.height)||page.height<=0)throw new Error('页面高度无效');
  if(scaleContent) {
    const factor=height/page.height;
    for(const frame of page.panels||[]) {
      scaleFields(frame,['y','h'],factor);
      scaleFields(frame.imageTransform,['y'],factor);
    }
    for(const bubble of page.bubbles||[]) {
      scaleFields(bubble,['y','h'],factor);
      scaleReflowLettering(bubble,1,factor);
      if(bubble.tail?.mode!=='normalized')scaleFields(bubble.tail,['y'],factor);
    }
  }
  page.height=height;return page;
}
/** Read-order strip layout. Legacy widths are presented at 1280 without modifying saved artwork. */
export function layoutLongStrip(pages,{width=COMIC_PAGE_WIDTH,gap=0}={}) {
  if(!Array.isArray(pages)||!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(gap)||gap<0)throw new Error('连续长图参数无效');
  let offset=0;
  const entries=pages.map((page,index)=>{
    if(!page||!Number.isFinite(page.width)||page.width<=0)throw new Error('页面宽度无效');
    validatePageHeight(page.height);
    const scale=width/page.width,height=Math.max(1,Math.round(page.height*scale));
    if(!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(offset+height))throw new Error('长图总高度超出安全整数范围，请拆分工程');
    const entry={page,pageId:page.id,index,x:0,y:offset,width,height,scale,endY:offset+height};
    offset+=height;
    if(index<pages.length-1) {
      if(!Number.isSafeInteger(offset+gap))throw new Error('长图总高度超出安全整数范围，请拆分工程');
      offset+=gap;
    }
    return entry;
  });
  return {width,height:offset,gap,pages:entries};
}
export const pageOffsets=(pages,options)=>layoutLongStrip(pages,options).pages;
export function visibleStripPages(layout,startY,endY) {
  if(!layout||!Number.isFinite(startY)||!Number.isFinite(endY)||endY<startY)return [];
  return layout.pages.filter(entry=>entry.endY>startY&&entry.y<endY);
}
export function pageAtStripPoint(layout,point) {
  if(!layout||!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.x>layout.width)return null;
  const entry=layout.pages.find(item=>point.y>=item.y&&point.y<item.endY);
  if(!entry)return null;
  return {...entry,local:{x:point.x/entry.scale,y:(point.y-entry.y)/entry.scale}};
}
/** Lazy finite export regions, never a single canvas as tall as the full document. */
export function* stripSegments(layout,{segmentHeight=8192}={}) {
  if(!layout||!Number.isSafeInteger(layout.height)||layout.height<0||!Number.isSafeInteger(segmentHeight)||segmentHeight<=0)throw new Error('长图分段尺寸无效');
  let index=0;
  for(let y=0;y<layout.height;) {
    const height=Math.min(segmentHeight,layout.height-y),endY=y+height;
    yield {index:index++,y,startY:y,endY,height,width:layout.width,pages:visibleStripPages(layout,y,endY).map(entry=>({...entry,sourceStartY:Math.max(0,(y-entry.y)/entry.scale),sourceEndY:Math.min(entry.page.height,(endY-entry.y)/entry.scale)}))};
    y=endY;
  }
}
