import {projectLibraryAssets} from './project-asset-library.js';
const unique=values=>[...new Set(values.filter(Boolean))];
const key=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\s《》〈〉「」『』·，,：:、_\-]/gu,'');
/** Search only linked libraries or one unambiguous project title, never every production. */
export function libraryProjectScopes(project,assets,projects=[]){
 const linked=unique([project?.assetLibrary?.mokuProjectId,...projectLibraryAssets(project,assets).map(a=>a.library?.projectId)]);
 if(linked.length)return {ids:linked,source:'linked',note:''};
 const title=key(project?.title),eligible=projects.filter(p=>!p.deletedAt&&key(p.name).length>=2),exact=eligible.filter(p=>key(p.name)===title),matches=exact.length?exact:eligible.filter(p=>title.includes(key(p.name)));
 if(matches.length===1)return {ids:[matches[0].id],source:'title',note:'墨库项目：'+matches[0].name};
 return {ids:['public'],source:'public',note:matches.length>1?'匹配到多个墨库项目，请在找图时选择项目库。':'未找到对应墨库项目，可在找图时选择项目库。'};
}
