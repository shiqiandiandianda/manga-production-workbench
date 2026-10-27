/** Preview values already live on the project. Finish their transaction before replacing DOM or using history. */
export function settleInspectorDrafts(drafts,project,commit){
 const before=[...drafts.values()].find(snapshot=>snapshot?.id===project?.id);
 drafts.clear();
 if(!before||!project)return false;
 commit(before);return true;
}
