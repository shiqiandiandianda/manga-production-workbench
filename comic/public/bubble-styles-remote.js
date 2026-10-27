import {applyRemoteBubbleStyles} from './comic-styles.js';
import {refreshBubbleMaterials} from './bubble-material.js';
import {readClassifiedBubbleAssets} from './moku-bubble-catalog.js';

// 墨库「气泡素材」文件夹是气泡样式的唯一来源；读取失败时保留内置目录并如实报告。
let status={loaded:false,source:'builtin',count:0,error:'',publishedAt:''};
let pending=null;

// A different publisher can replace the cloud manifest while an editor stays open.
// Discover its current immutable revision through the existing authenticated proxy.
async function latestManifest(api,fallback){
 try{
  const page=await api('/api/library/assets?projectId=public&q='+encodeURIComponent('气泡素材库.json')+'&limit=100');
  const assets=(page.items||[]).filter(a=>a.name==='气泡素材库.json'&&a.folder==='气泡素材'&&!a.deletedAt&&a.recommendedRevisionId).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  for(const asset of assets.slice(0,3)){
   const manifest=await api('/api/library/revisions/'+encodeURIComponent(asset.recommendedRevisionId)+'/download');
   if(manifest?.format==='comic-bubble-style-library'&&manifest.items?.length&&(!fallback?.items?.length||String(manifest.publishedAt||'')>=String(fallback.publishedAt||'')))return {...manifest,items:manifest.items.map(item=>({...item,previewUrl:item.revisionId?'/api/library/revisions/'+encodeURIComponent(item.revisionId)+'/download':item.previewUrl||''})),ok:true,source:'moku'};
  }
 }catch{}
 return fallback;
}

export const bubbleStyleStatus=()=>({...status});

export async function loadRemoteBubbleStyles(api,{refresh=false}={}){
  if(pending)return pending;
  pending=(async()=>{
    try{
      let result;try{result=await api('/api/library/bubble-styles'+(refresh?'?refresh=1':''));}catch(error){result={items:[],error:error.message};}
      if(!result?.classified)result=await latestManifest(api,result);
      if(!result.items?.length){
       try{const classified=await readClassifiedBubbleAssets(api);if(classified.items.length)result=classified;}catch(error){result={...result,error:error.message};}
      }
      const items=(result.items||[]).filter(item=>item&&Array.isArray(item.contour)&&item.contour.length>=8);
      if(!items.length)throw new Error(result.error||'墨库「气泡素材」文件夹里还没有样式');
      const count=applyRemoteBubbleStyles(items);
      refreshBubbleMaterials();
      status={loaded:true,source:'moku',count,error:'',publishedAt:result.publishedAt||''};
    }catch(error){
      status={...status,loaded:false,source:'builtin',error:error.message||'读取墨库气泡样式失败'};
    }finally{pending=null;if(typeof document!=='undefined')document.body.dataset.bubbleStyles=status.loaded?'moku:'+status.count:'builtin';}
    return status;
  })();
  return pending;
}
