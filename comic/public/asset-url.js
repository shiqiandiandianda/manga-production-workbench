// Browser image decoding may reuse a live image despite HTTP no-cache.
// Give each load session and each explicit path refresh a distinct URL.
const session=typeof document==='undefined'?'':Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
const revisions=new Map();let epoch=0,sequence=0;
export function assetUrl(id){if(String(id).startsWith('comic:'))return '/api/comic-style-library/items/'+encodeURIComponent(String(id).slice(6))+'/image';const revision=revisions.get(id)||0;return '/assets/'+id+(session||epoch||revision?'?v='+[session,epoch,revision].join('-'):'');}
export function refreshAssetUrl(id){if(id){if(!revisions.has(id)&&revisions.size>=1024){revisions.clear();epoch=++sequence;}revisions.set(id,++sequence);}else{revisions.clear();epoch=++sequence;}}
