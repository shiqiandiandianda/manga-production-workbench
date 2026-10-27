export const COLLABORATION_FOLDER='协作工程';
const normalize=value=>String(value||'').normalize('NFKC').replaceAll('\\','/').replace(/^\/+|\/+$/g,'');
/** Sync media belongs to engineering storage, even when it has an image MIME. */
export function isCollaborationFile(item){
 const folder=normalize(item?.folder||item?.library?.folder);
 return ['协作工程','协作工程原件','漫画工程快照'].some(root=>folder===root||folder.startsWith(root+'/'));
}
