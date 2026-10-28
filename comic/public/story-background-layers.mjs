import {id,rectangle} from './model.js';

/** Turn narrative color sections into editable overlapping layers, never a separate transition layer. */
export function buildStoryBackgroundLayers(geometry,{episode=null,anchorPageId=null}={}){
 const specs=geometry.storyBackgroundLayers,group=Array.isArray(specs)?id('storyfade'):null;
 const source=Array.isArray(specs)?specs:geometry.backgrounds;
 const layers=source.map((b,index)=>{
  const fadeIn=b.fadeIn||0,fadeOut=b.fadeOut||0,color=b.color;
  const layer={id:id('gradient'),name:b.name||'剧情段落衬底',coverage:'area',storyBackgroundVersion:1,x:b.x,y:b.y,w:b.w,h:b.h,visible:true,locked:false,points:rectangle(),border:0,borderColor:'#111111',feather:0,gradient:{enabled:true,mode:'color',startColor:color,endColor:b.mode==='linear'?b.endColor:color,opacity:1,start:{x:.5,y:0},end:{x:.5,y:1}}};
  if(group)layer.storyCrossfade={version:1,group,index};
  if(fadeIn||fadeOut)layer.featherEdges={top:fadeIn,bottom:fadeOut,left:0,right:0};
  if(episode!==null&&anchorPageId){layer.designEpisode=episode;layer.assistantLayoutAnchor={episode,pageId:anchorPageId,y:b.y};}
  return layer;
 });
 // Later sections are below earlier sections, so the upper section can fade out.
 return group?layers.reverse():layers;
}

