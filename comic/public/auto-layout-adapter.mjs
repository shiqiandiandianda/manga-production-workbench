import {createProject,id,clone,panel,rectangle} from './model.js';
import {SHOT_SIZES,CAMERA_ANGLES,normalizeCameraAngle} from './shot-settings.js';

// Geometry is supplied by the learning workbench. This adapter never designs a layout.
export function buildLayoutProject(script,geometry,{originalProject=null}={}){
 if(geometry?.format!=='comic-layout-geometry'||geometry.version!==1||geometry.canvas?.width!==1280)throw Error('排版格式无效');
 const rows=script?.shots,frames=geometry.panels;
 if(!Array.isArray(rows)||!rows.length||rows.length>800||frames?.length!==rows.length)throw Error('分镜格数不一致或超过800格');
 if(!Number.isSafeInteger(geometry.canvas.height)||geometry.canvas.height<1)throw Error('画板高度无效');
 if(JSON.stringify(geometry.sourcePanelKeys)!==JSON.stringify(rows.map(s=>s.key)))throw Error('固定镜号顺序变化');
 const project=createProject((script.title+' · 自动排版').slice(0,165)),episode=Number(script.episode)||1;
 if(originalProject){project.style=originalProject.style;project.references=clone(originalProject.references);for(const key of ['assetLibrary','speakerAvatars'])if(originalProject[key])project[key]=clone(originalProject[key]);}
 project.shots=rows.map((s,i)=>{
  const g=frames[i];if(g.key!==s.key||g.sourceShotCode!==String(s.code)||g.readingOrder!==i+1)throw Error('排版与分镜归属不一致');
  if(['x','y','w','h'].some(k=>!Number.isFinite(g[k]))||g.x<0||g.y<0||g.w<20||g.h<20||g.x+g.w>1280.01||g.y+g.h>geometry.canvas.height+.01||g.shape!=='rectangle')throw Error('画格坐标无效');
  const original=originalProject?.shots.find(o=>o.id===s.studioShotId);
  if(originalProject&&(!original||original.code!==s.code||original.description!==s.description||original.dialogue!==s.dialogue))throw Error('原分镜已改变，请重新送入排版');
  const shot={...(original?clone(original):clone(s)),id:id('shot'),code:String(s.code),title:String(s.title||s.code).slice(0,180),description:String(s.description||''),dialogue:String(s.dialogue||''),referenceIds:original?clone(original.referenceIds):[],episode,sourceLayoutKey:s.key};
  if(!original){shot.participants??=String(s.characters||'');shot.sfxWords??=String(s.sfx||'');}
  for(const [key,options]of [['shotSize',SHOT_SIZES],['cameraAngle',CAMERA_ANGLES]])if(shot[key]){const raw=shot[key],normalized=key==='cameraAngle'?normalizeCameraAngle(raw):raw;if(!options.includes(normalized)){shot[key+'Raw']=raw;delete shot[key];}else shot[key]=normalized;}
  return shot;
 });
 const page={id:id('page'),name:'第'+episode+'话 · 自动排版',width:1280,height:geometry.canvas.height,background:'#ffffff',storyboard:{episode,projection:'manual'},panels:[],bubbles:[]};
 project.pages=[page];project.gradients=[];
 for(const [i,g] of frames.entries()){
  const shot=project.shots[i],f=panel(shot.id,g.x,g.y,g.w,g.h);Object.assign(f,{name:shot.code,border:g.border??6,feather:g.feather??0,layoutRole:g.role,layoutSourceKey:g.key});page.panels.push(f);
  // No speaker or dialogue type is guessed. Unknown text remains editable, without a tail.
  let textY=f.y+24;
  for(const text of shot.dialogue.split(/\r?\n/).filter(t=>t.trim())){
   const h=Math.max(100,Math.ceil(text.length/16)*46+24);
   page.bubbles.push({id:id('bubble'),shotId:shot.id,parentPanelId:f.id,speaker:'',text,type:'caption',shape:'none',x:Math.max(0,Math.min(900,f.x+24)),y:textY,w:Math.min(700,Math.max(200,f.w-48)),h,fontSize:32,fontFamily:'source-han-sans',fontWeight:400,lineHeight:1.35,textColor:'#111111',fillOpacity:0,outlineWidth:0,tail:{visible:false},visible:true,locked:false});textY+=h+12;
  }
 }
 if(!Array.isArray(geometry.backgrounds)||geometry.backgrounds.length>200)throw Error('背景分段无效');
 let end=0;
 for(const b of geometry.backgrounds){
  if(!['x','y','w','h'].every(k=>Number.isFinite(b[k]))||b.x!==0||b.w!==1280||Math.abs(b.y-end)>.01||b.h<=0||!/^#[\da-f]{6}$/i.test(b.color)||!['solid','linear'].includes(b.mode)||b.mode==='linear'&&!/^#[\da-f]{6}$/i.test(b.endColor))throw Error('背景分段无效');
  end=b.y+b.h;
  project.gradients.push({id:id('gradient'),name:'排版底色 '+(project.gradients.length+1),coverage:'area',x:0,y:b.y,w:1280,h:b.h,visible:true,locked:false,points:rectangle(),border:0,borderColor:'#111111',feather:0,gradient:{enabled:true,mode:'color',startColor:b.color,endColor:b.mode==='linear'?b.endColor:b.color,opacity:1,start:{x:.5,y:0},end:{x:.5,y:1}}});
 }
 if(Math.abs(end-page.height)>.01)throw Error('背景没有覆盖整话');
 Object.assign(project,{layerSchema:1,layerGroupsVersion:1,editorLayoutVersion:2,layerOrder:[...project.gradients,...page.panels,...page.bubbles].map(v=>v.id),autoLayoutSource:{version:1,scriptId:script.id,profileVersion:geometry.profileVersion,source:clone(script.source),sourceProjectId:script.studioSource?.projectId||null,images:'原工程图片保留；新排版工程使用空画格',lettering:'保留原文的可编辑文字；说话人和位置待确认',generator:clone(geometry.generator||{})}});
 return project;
}
