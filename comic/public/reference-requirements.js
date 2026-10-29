import {projectLibraryAssets} from './project-asset-library.js';
import {stateReferenceMetadata} from './character-state-references.js';
import {panelReferenceIds} from './panel-references.js';
import {declaredScene,deriveSceneReference} from './reference-scene-source.js';
import {generationPromptSelection} from './prompt-source.js';
import {sourceStateFields} from './character-states.js';
import {productionSegment} from './production-package-model.js';
export const referenceSource=(project,panel)=>project.shots.find(s=>s.id===panel.shotId)||panel.generation?.sourceSnapshot?.original||{};
export function referenceInputStamp(project,panel){
 const source=referenceSource(project,panel),text=JSON.stringify({participantEncoding:2,productionReferences:productionSegment(project,panel.productionSegment)?.references,extraReferences:panel.referenceNeedBindings,prompt:generationPromptSelection(panel,project),participants:source.participants,location:source.location,props:source.props,propNames:source.propNames,sourceFields:source.sourceFields,states:sourceStateFields(source),panelStates:panel.generation?.characterStates,visible:panel.artDirection?.visibleCharacters??panel.generation?.artDirection?.visibleCharacters,sourceRefs:source.referenceIds});
 let hash=2166136261;for(const c of text)hash=Math.imul(hash^c.codePointAt(0),16777619);return (hash>>>0).toString(16);
}
export function processedReferenceRequirements(project,panel){const value=panel.referenceRequirements;return value?.version===1&&value.sourceStamp===referenceInputStamp(project,panel)?value:null;}

const split=value=>(Array.isArray(value)?value:String(value||'').split(/[、，,；;\n]+/u)).map(s=>String(s).trim()).filter(s=>s&&!/^(无|空镜|—|-)$/u.test(s));
const unique=values=>[...new Set(values)];
export function deriveReferenceRequirements(project,panel,assets,{extraAssetIds=[]}={}){
 const source=referenceSource(project,panel),text=generationPromptSelection(panel,project).text,existing=panelReferenceIds(project,panel),sourceIds=unique([...(source.referenceIds||[]),...(panel.generation?.sourceSnapshot?.original?.referenceIds||[])]),allowed=new Set([...sourceIds,...existing,...extraAssetIds,...projectLibraryAssets(project,assets).map(a=>a.id)]),pool=assets.filter(a=>allowed.has(a.id)&&a.filePath&&!['candidate','stale'].includes(a.productionStatus));
 const mentioned=name=>{const term=String(name).normalize('NFKC'),content=text.normalize('NFKC');if(term.length<2)return false;for(let at=content.indexOf(term);at>=0;at=content.indexOf(term,at+term.length)){if(!/(?:没有|不出现|不含|不要画|不画|排除|画外)[^，。；;\n]{0,8}$/u.test(content.slice(Math.max(0,at-18),at))&&!/^(?:不出镜|不在画面|不出现|未入画|缺席|的画外音)/u.test(content.slice(at+term.length)))return true;}return false;};
 const catalog=pool.map(asset=>({asset,meta:stateReferenceMetadata(project,asset)})),infer=role=>unique(catalog.filter(({meta})=>meta.role===role&&[meta.name,...meta.aliases].some(mentioned)).map(({meta})=>meta.name));
 const sceneEvidence=deriveSceneReference(project,panel,{sceneNames:catalog.filter(c=>c.meta.role==='scene').flatMap(c=>[c.meta.name,...c.meta.aliases])});
 const visible=panel.artDirection?.visibleCharacters??panel.generation?.artDirection?.visibleCharacters,rawPeople=source.participants||source.sourceFields?.['出现角色'],rawScene=declaredScene(source)||sceneEvidence.location,rawProps=source.propNames||source.props||source.sourceFields?.['出现道具']||source.storyboard?.clientFields?.['道具'],defined=value=>Array.isArray(value)||String(value??'').trim()!=='',participants=Array.isArray(visible)?visible:split(rawPeople),scenes=split(rawScene),props=split(rawProps),characterStates=panel.generation?.characterStates||sourceStateFields(source).characterStates||'';
 // Structured entries may name one confirmed crowd card (e.g. 百户、缇骑).
 // Joining and splitting them again invents separate identities and loses that binding.
 const people=defined(rawPeople)||Array.isArray(visible)?participants:infer('character');
 const requirements={version:1,sourceStamp:referenceInputStamp(project,panel),participants:Array.isArray(rawPeople)||Array.isArray(visible)?people:people.join('、'),location:sceneEvidence.explicitNone?'':(defined(rawScene)?scenes:infer('scene')).join('、'),props:(defined(rawProps)?props:infer('prop')).join('、'),characterStates,sceneEvidence,inferred:!defined(rawPeople)&&!Array.isArray(visible)||sceneEvidence.kind!=='field'||!defined(rawProps)};
 return {source,text,existing,sourceIds,allowed,pool,catalog,sceneEvidence,requirements,characterStates};
}
