import {FONT_FAMILIES} from './lettering.js';

export const BOARD_KINDS=['cover','tail'];
export const BOARD_LABELS={cover:'封面',tail:'尾图'};
export const BOARD_LAYER_LABELS={workTitle:'作品名',episodeLabel:'第几话',episodeTitle:'话名',completed:'本话结束',nextLabel:'下一话',nextEpisodeTitle:'下一话话名',fixedText:'固定文字'};
const copy=value=>structuredClone(value),own=(object,key)=>Object.hasOwn(object||{},key);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function episodeNumber(value){
 const text=String(value??'').trim().replace(/[０-９]/gu,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0));
 const match=/^(?:第\s*)?([0-9]+|[零〇一二两三四五六七八九十百千]+)(?:\s*[话集])?$/u.exec(text);if(!match)return null;
 let number=Number(match[1]);if(!Number.isInteger(number)){const digits={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9},units={十:10,百:100,千:1000};number=0;let digit=0;for(const c of match[1])if(c in digits)digit=digits[c];else{number+=(digit||1)*units[c];digit=0;}number+=digit;}
 return number>=1&&number<=9999?number:null;
}
const layer=(key,y,fontSize,h=160)=>({key,x:128,y,w:1024,h,fontFamily:'source-han-sans',fontSize,minFontSize:16,color:'#ffffff',strokeColor:'#172333',strokeWidth:3,fontWeight:700,writingMode:'horizontal',fit:'shrink',align:'center',lineHeight:1.25,visible:true});
export function defaultBoardTemplates(){return {workTitle:null,cover:{width:1280,height:1800,background:'#162b43',backgroundAssetId:null,imageFit:'cover',layers:[layer('workTitle',140,100,280),layer('episodeLabel',1060,64),layer('episodeTitle',1260,96,280)]},tail:{width:1280,height:1800,background:'#162b43',backgroundAssetId:null,imageFit:'cover',layers:[layer('completed',240,88),layer('nextLabel',860,64),layer('nextEpisodeTitle',1070,84,280),{...layer('fixedText',1510,42,150),text:'感谢阅读，我们下一话见！'}]}};}
export function ensureEpisodeBoards(project){if(!project.episodeBoards)project.episodeBoards={version:1,templateRevision:0,templates:defaultBoardTemplates(),episodes:{}};return project.episodeBoards;}
export function pageEpisode(project,page){return episodeNumber(page?.storyboard?.episode)||episodeNumber(project.shots?.find(s=>page?.panels?.some(f=>f.shotId===s.id))?.episode)||episodeNumber(project.shots?.find(s=>page?.panels?.some(f=>f.shotId===s.id))?.storyboard?.episode)||episodeNumber(/^第\s*([^话]+)话/u.exec(page?.name||'')?.[1])||((project.pages||[]).filter(p=>!p.designEpisodeRole).length===1?episodeNumber(/第\s*([^话]+)话/u.exec(project.importReview?.sheet||'')?.[1]):null)||null;}
export function episodeCatalog(project){
 const byNumber=new Map(),add=(rows,source)=>{for(const row of rows||[]){const number=episodeNumber(row.episode??row.number??row['话数']??row['话']);if(!number)continue;const title=String(row.title??row['话名']??'').trim();if(!byNumber.has(number)||title)byNumber.set(number,{episode:number,title,source});}};

 add(project.storyboardImport?.episodes,'导入分镜表');

 add(project.episodeOutline?.episodes,'分话细纲');
 for(const page of project.pages||[]){const n=pageEpisode(project,page);if(n&&!byNumber.has(n))byNumber.set(n,{episode:n,title:'',source:'画板话数'});}
 if(!byNumber.size)byNumber.set(episodeNumber(project.episodeBoards?.currentEpisode)||1,{episode:episodeNumber(project.episodeBoards?.currentEpisode)||1,title:'',source:'手填话数'});
 return [...byNumber.values()].sort((a,b)=>a.episode-b.episode);
}
export function currentBoardEpisode(project,page){return pageEpisode(project,page)||episodeNumber(project.episodeBoards?.currentEpisode)||episodeCatalog(project)[0]?.episode||1;}
export function boardContext(project,number){
 const data=project.episodeBoards,overrides=data?.episodes?.[number]||{},catalog=episodeCatalog(project),auto=catalog.find(e=>e.episode===number),displayNumber=overrides.episodeNumber??number,next=catalog.find(e=>e.episode===displayNumber+1);
 const workTitle=data?.templates?.workTitle??project.episodeOutline?.workTitle??project.title;
 const episodeTitle=own(overrides,'episodeTitle')?overrides.episodeTitle:auto?.title||'';
 const nextEpisodeTitle=own(overrides,'nextEpisodeTitle')?overrides.nextEpisodeTitle:next?.title||'';
 return {number,displayNumber,nextNumber:displayNumber+1,workTitle,episodeTitle,nextEpisodeTitle,autoTitle:auto?.title||'',autoNextTitle:next?.title||'',overrides,source:auto?.source||'手填',nextMissing:!nextEpisodeTitle.trim()};
}
export function resolveBoard(project,kind,number,assets=project.assets||[]){
 const templates=project.episodeBoards?.templates||defaultBoardTemplates(),template=copy(templates[kind]),context=boardContext(project,number),override=context.overrides[kind];
 if(override?.useOwnBackground&&override.backgroundAssetId)template.backgroundAssetId=override.backgroundAssetId;
 template.width=1280;
 const image=assets instanceof Map?assets.get(template.backgroundAssetId):assets.find(a=>a.id===template.backgroundAssetId);
 const imageHeight=image?.width>0&&image?.height>0?Math.max(1,Math.round(1280*image.height/image.width)):null;
 if(Number.isSafeInteger(imageHeight)){template.height=imageHeight;template.imageFit='contain';template.heightMode='image';template.sourceImageSize={width:image.width,height:image.height};}

 const texts={workTitle:context.workTitle,episodeLabel:`第 ${context.displayNumber} 话`,episodeTitle:context.episodeTitle||'本话话名待填',completed:`第 ${context.displayNumber} 话 完`,nextLabel:`下一话 · 第 ${context.nextNumber} 话`,nextEpisodeTitle:context.nextEpisodeTitle||'下一话名待填'};
 template.layers=template.layers.map(item=>({...item,text:context.overrides.texts?.[kind+'.'+item.key]??(item.key==='fixedText'?item.text:texts[item.key]),pending:item.key==='nextEpisodeTitle'&&context.nextMissing||item.key==='episodeTitle'&&!context.episodeTitle.trim()}));
 return {...template,kind,episode:number,context};
}
export function boardAssetIds(project){const ids=new Set();for(const kind of BOARD_KINDS){const id=project.episodeBoards?.templates?.[kind]?.backgroundAssetId;if(id)ids.add(id);}for(const episode of Object.values(project.episodeBoards?.episodes||{}))for(const kind of BOARD_KINDS)if(episode[kind]?.backgroundAssetId)ids.add(episode[kind].backgroundAssetId);return [...ids];}
export function remapBoardAssets(project,mapping){if(!project.episodeBoards)return;delete project.episodeBoards.sharedKey;project.episodeBoards.templateRevision=0;for(const kind of BOARD_KINDS){const board=project.episodeBoards.templates[kind];if(board.backgroundAssetId)board.backgroundAssetId=mapping.get(board.backgroundAssetId);}for(const episode of Object.values(project.episodeBoards.episodes))for(const kind of BOARD_KINDS)if(episode[kind]?.backgroundAssetId)episode[kind].backgroundAssetId=mapping.get(episode[kind].backgroundAssetId);}
export function validateEpisodeBoards(project){
 const state=project.episodeBoards;if(state===undefined)return;const assert=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{status:400});},plain=v=>v&&typeof v==='object'&&!Array.isArray(v),text=(v,max=1000)=>typeof v==='string'&&v.length<=max,number=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max,color=v=>/^#[a-f0-9]{6}$/i.test(v),asset=v=>v===null||typeof v==='string'&&/^asset_[0-9a-f-]{36}$/.test(v);
 assert(state.version===1&&plain(state.templates)&&plain(state.episodes)&&Object.keys(state.episodes).length<=9999,'封面 / 尾图模板数据无效');
 assert(state.currentEpisode===undefined||episodeNumber(state.currentEpisode)===state.currentEpisode,'模板话数无效');
 assert(state.templates.workTitle===null||text(state.templates.workTitle,180),'作品名过长');
 for(const kind of BOARD_KINDS){const board=state.templates[kind];assert(plain(board)&&board.width===1280&&Number.isInteger(board.height)&&number(board.height,320,8192)&&color(board.background)&&asset(board.backgroundAssetId)&&['cover','contain'].includes(board.imageFit),'固定画板尺寸或底图无效');
  assert(board.originEpisode===undefined||Number.isInteger(board.originEpisode)&&board.originEpisode>=1&&board.originEpisode<=9999,'底图归属话号须为1—9999的阿拉伯数字');
  const keys=kind==='cover'?['workTitle','episodeLabel','episodeTitle']:['completed','nextLabel','nextEpisodeTitle','fixedText'];assert(Array.isArray(board.layers)&&board.layers.length===keys.length&&keys.every(key=>board.layers.filter(l=>l.key===key).length===1),'固定文字层不能增加、删除或重复');
  for(const l of board.layers)assert(number(l.x,-1280,2560)&&number(l.y,-8192,16384)&&number(l.w,20,2560)&&number(l.h,20,16384)&&Object.hasOwn(FONT_FAMILIES,l.fontFamily)&&number(l.fontSize,10,1024)&&number(l.minFontSize,10,l.fontSize)&&color(l.color)&&color(l.strokeColor)&&number(l.strokeWidth,0,64)&&[400,500,600,700,800,900].includes(l.fontWeight)&&['horizontal','vertical'].includes(l.writingMode)&&['shrink','wrap'].includes(l.fit)&&['left','center','right'].includes(l.align)&&number(l.lineHeight,1,3)&&typeof l.visible==='boolean'&&(l.key!=='fixedText'||text(l.text)),'封面 / 尾图文字外观参数无效');
 }
 for(const [key,entry] of Object.entries(state.episodes)){assert(episodeNumber(key)&&plain(entry),'单话模板数据无效');for(const field of ['episodeTitle','nextEpisodeTitle'])assert(entry[field]===undefined||text(entry[field]),'单话话名过长');assert(entry.episodeNumber===undefined||episodeNumber(entry.episodeNumber)===entry.episodeNumber,'单话话数无效');assert(entry.texts===undefined||plain(entry.texts)&&Object.keys(entry.texts).length<=7&&Object.entries(entry.texts).every(([key,v])=>/^(cover|tail)\.[a-zA-Z]+$/.test(key)&&text(v)),'单话文字无效');for(const kind of BOARD_KINDS)if(entry[kind]!==undefined)assert(plain(entry[kind])&&typeof entry[kind].useOwnBackground==='boolean'&&asset(entry[kind].backgroundAssetId),'单话独立底图无效');}
}

/** One measurement layout is used by both SVG preview and PNG export. */
export function boardTextLayout(context,layer){
 const chars=text=>[...String(text)],family=FONT_FAMILIES[layer.fontFamily],vertical=layer.writingMode==='vertical';
 const calculate=size=>{context.font=`${layer.fontWeight} ${size}px ${family}`;const step=size*layer.lineHeight;
  let lines=[];for(const paragraph of String(layer.text??'').split('\n')){let line='';for(const char of chars(paragraph)){const attempt=line+char,extent=vertical?chars(attempt).length*size:context.measureText(attempt).width;if(line&&extent>(vertical?layer.h:layer.w)){lines.push(line);line='';}line+=char;}lines.push(line);}
  const extents=lines.map(line=>vertical?chars(line).length*size:context.measureText(line).width),width=vertical?lines.length*step:Math.max(0,...extents),height=vertical?Math.max(0,...extents):lines.length*step;
  const glyphs=[];if(vertical){lines.forEach((line,i)=>{const y=layer.y+(layer.align==='left'?0:layer.align==='right'?layer.h-extents[i]:(layer.h-extents[i])/2);chars(line).forEach((char,j)=>glyphs.push({text:char,x:layer.x+layer.w-(i+.5)*step,y:y+(j+.5)*size}));});}
  else lines.forEach((line,i)=>glyphs.push({text:line,x:layer.x+(layer.align==='left'?0:layer.align==='right'?layer.w:layer.w/2),y:layer.y+(i+.5)*step}));
  return {fontSize:size,font:context.font,glyphs,width,height,fits:width<=layer.w+.01&&height<=layer.h+.01,textAnchor:vertical?'middle':({left:'start',right:'end',center:'middle'})[layer.align]};
 };
 return calculate(layer.fontSize);
}
export function boardSvg(board,measurement,{assetUrl,selectedKey='',controls=true}={}){
 let content=`<rect width="1280" height="${board.height}" fill="${board.background}"/>`;
 if(board.backgroundAssetId)content+=`<image href="${escape(assetUrl(board.backgroundAssetId))}" width="1280" height="${board.height}" preserveAspectRatio="xMidYMid ${board.imageFit==='contain'?'meet':'slice'}"/>`;
 for(const layer of board.layers){if(!layer.visible)continue;const layout=boardTextLayout(measurement,layer),selected=layer.key===selectedKey;
  content+=`<g data-board-layer="${layer.key}" aria-label="${BOARD_LAYER_LABELS[layer.key]}" tabindex="${controls?'0':'-1'}"><rect x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}" fill="transparent" stroke="${controls&&selected?'#92c7ff':'none'}" stroke-width="3" stroke-dasharray="10 6"/>`;
  for(const glyph of layout.glyphs)content+=`<text x="${glyph.x}" y="${glyph.y}" font-family="${escape(FONT_FAMILIES[layer.fontFamily])}" font-size="${layout.fontSize}" font-weight="${layer.fontWeight}" text-anchor="${layout.textAnchor}" dominant-baseline="central" fill="${layer.pending?'#ffad42':layer.color}" stroke="${layer.strokeColor}" stroke-width="${layer.strokeWidth*2}" stroke-linejoin="round" paint-order="stroke fill" pointer-events="none">${escape(glyph.text)}</text>`;
  content+='</g>';
 }
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 ${board.height}" role="img" aria-label="第${board.context.displayNumber}话${BOARD_LABELS[board.kind]}预览">${content}</svg>`;
}
export async function paintEpisodeBoard(context,board,{imageLoader}={}){
 context.save();try{context.beginPath();context.rect(0,0,1280,board.height);context.clip();context.fillStyle=board.background;context.fillRect(0,0,1280,board.height);
 if(board.backgroundAssetId){const image=await imageLoader(board.backgroundAssetId),w=image.naturalWidth||image.width,h=image.naturalHeight||image.height,scale=(board.imageFit==='contain'?Math.min:Math.max)(1280/w,board.height/h);context.drawImage(image,(1280-w*scale)/2,(board.height-h*scale)/2,w*scale,h*scale);}
 for(const layer of board.layers){if(!layer.visible)continue;const layout=boardTextLayout(context,layer);context.font=layout.font;context.textAlign=({start:'left',middle:'center',end:'right'})[layout.textAnchor];context.textBaseline='middle';context.fillStyle=layer.pending?'#ffad42':layer.color;context.strokeStyle=layer.strokeColor;context.lineWidth=layer.strokeWidth*2;context.lineJoin='round';for(const glyph of layout.glyphs){if(layer.strokeWidth)context.strokeText(glyph.text,glyph.x,glyph.y);context.fillText(glyph.text,glyph.x,glyph.y);}}
 }finally{context.restore();}
}
