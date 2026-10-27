import {batchesFrom,segments} from './scenes.ts';
import type {Project} from './scenes.ts';
import {parseScript,SOURCE_PARSING_VERSION} from './script-structure.ts';
export function repairSource(project:Project){
  if(project.sourceParsingVersion===SOURCE_PARSING_VERSION&&(!project.text||project.batches.length))return {project,repaired:false,removed:0};
  const parsed=parseScript(project.text),oldChapters=project.batches.flatMap(batch=>batch.chapters);
  const unchanged=oldChapters.length===parsed.chapters.length&&oldChapters.every((chapter,index)=>chapter.text===parsed.chapters[index].text);
  if(!project.text||unchanged)return {project:{...project,sourceParsingVersion:SOURCE_PARSING_VERSION},repaired:true,removed:parsed.ignoredTocEntries};
  const newByText=new Map(parsed.chapters.map(chapter=>[chapter.text.trim(),chapter]));
  const mapping=new Map(oldChapters.map(chapter=>[chapter.id,newByText.get(chapter.text.trim())]));
  const finished=new Set(project.batches.filter(batch=>batch.status==='done').flatMap(batch=>batch.chapters.map(chapter=>newByText.get(chapter.text.trim())?.id).filter(Boolean)));
  const scenes=project.scenes.flatMap(scene=>{const evidence=scene.evidence.flatMap(item=>{const chapter=mapping.get(item.chapterId);return chapter?.text.includes(item.quote)?[{...item,chapterId:chapter.id}]:[];});return evidence.length?[{...scene,evidence}]:[];});
  const batches=batchesFrom(parsed.chapters).map(batch=>batch.chapters.every(chapter=>finished.has(chapter.id))?{...batch,status:'done',completedParts:segments(batch).length}:batch);
  return {project:{...project,scenes,batches,sourceParsingVersion:SOURCE_PARSING_VERSION},repaired:true,removed:parsed.ignoredTocEntries};
}
