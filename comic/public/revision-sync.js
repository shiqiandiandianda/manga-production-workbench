// Decides how an editor window reacts when the server reports a newer project revision.
// The server bumps the revision for two very different reasons:
//   1. its own bookkeeping (image attach and asset production), and
//   2. another window saving different document content.
// Adopting the revision number alone is only safe for (1); for (2) it would let this
// window's stale copy overwrite the other window's edits on the next save.

// Fields the server owns or changes on its own; they never come from another editor.
const SERVER_OWNED_PANEL_FIELDS=['imageAssetId','imageTransform','candidates','generationToken','breakoutCandidates','imageEffects'];

export function comparableProject(project){
  if(!project)return '';
  return JSON.stringify(project,function(key,value){
    if(this===project&&(key==='revision'||key==='updated'||['productionAssets'].includes(key)))return undefined;
    if(this===project.episodeBoards&&['templateRevision','sharedKey'].includes(key))return undefined;
    if(SERVER_OWNED_PANEL_FIELDS.includes(key)&&this&&typeof this==='object'&&Array.isArray(this.points))return undefined;
    return value;
  });
}

// Keep server sharing metadata current without replacing local editable template contents.
export function syncEpisodeBoardRevision(source,target){
  if(!source?.episodeBoards||!target?.episodeBoards)return;
  target.episodeBoards.templateRevision=source.episodeBoards.templateRevision;
  target.episodeBoards.sharedKey=source.episodeBoards.sharedKey;
}

// A preview/cancel restores editable content, never an older save acknowledgement.
// Only copy metadata from this window's current project; external content still uses revisionDecision.
export function preserveEditRevision(current,target){
  if(current?.id===target?.id&&Number.isInteger(current.revision)&&current.revision>target.revision){
    target.revision=current.revision;target.updated=current.updated;
    syncEpisodeBoardRevision(current,target);
  }
  return target;
}

/**
 * @returns {'ignore'|'adopt-revision'|'adopt-content'|'conflict'}
 *  ignore          nothing newer, or a save is in flight (decide after it settles)
 *  adopt-revision  only server-owned fields changed; keep local content, take the number
 *  adopt-content   another window changed content and this window has no unsaved edits
 *  conflict        another window changed content while this window has unsaved edits
 */
export function revisionDecision({localRevision,server,baseComparable,dirty,saving}){
  if(!server||saving||!Number.isInteger(server.revision)||!(server.revision>localRevision))return 'ignore';
  if(baseComparable&&comparableProject(server)===baseComparable)return 'adopt-revision';
  return dirty?'conflict':'adopt-content';
}
