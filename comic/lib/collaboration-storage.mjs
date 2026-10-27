import {COLLABORATION_FOLDER} from '../public/collaboration-files.js';
const segment=value=>Array.from(String(value||'未命名工程').normalize('NFKC').replace(/[\\/\x00-\x1f\x7f]/g,'_').replace(/^\.+|\.+$/g,'').trim()||'未命名工程').slice(0,48).join('');
const assetId=value=>/^asset_[a-f0-9-]{36}$/i.test(value||'');
function assetsIn(value,into=new Set(),depth=0){if(depth>30)return into;if(typeof value==='string'&&assetId(value))into.add(value);else if(Array.isArray(value))for(const item of value)assetsIn(item,into,depth+1);else if(value&&typeof value==='object')for(const item of Object.values(value))assetsIn(item,into,depth+1);return into;}
/** Use explicit episode metadata, never infer an episode from an image filename. */
export function collaborationStorage(project={}){
 const id=String(project.id||project.projectId||'').replace(/^project_/,'').slice(0,8),root=COLLABORATION_FOLDER+'/'+segment(project.title)+(id?'（'+id+'）':''),episodes=new Map(),shots=new Map((project.shots||[]).map(s=>[s.id,s]));
 for(const page of project.pages||[])for(const frame of [...(page.panels||[]),...(page.bubbles||[])]){
  const episode=Number(page.storyboard?.episode||shots.get(frame.shotId)?.episode);if(!Number.isInteger(episode)||episode<1)continue;
  for(const id of assetsIn(frame)){if(!episodes.has(id))episodes.set(id,new Set());episodes.get(id).add(episode);}
 }
 return {root,asset(id){const list=[...(episodes.get(id)||[])];return root+'/'+(list.length===1?'第'+list[0]+'话':'共用资料')+'/漫画图片';},font:root+'/共用资料/字体',original:root+'/导入原件',snapshot:root+'/工程文件'};
}
