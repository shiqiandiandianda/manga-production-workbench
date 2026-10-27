import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {createRemoteLibrary} from '../lib/remote-library.mjs';import {createBubbleStyleLibrary} from '../lib/bubble-style-library.mjs';
const root=path.resolve('..'),live=path.join(root,'production-comic-data-current'),audit=path.join(root,'verification/editable-bubbles-20261022'),dataDir=path.join(audit,'publisher');fs.mkdirSync(dataDir,{recursive:true});
if(!fs.existsSync(path.join(dataDir,'bubble-styles.local.json')))fs.copyFileSync(path.join(live,'bubble-styles.local.json'),path.join(dataDir,'bubble-styles.local.json'));
const library=createRemoteLibrary({dataDir,configPath:path.join(live,'library-session.local.json'),store:{db:{libraryFonts:[]}}}),publisher=createBubbleStyleLibrary({dataDir,library});
const result=await publisher.publish();fs.writeFileSync(path.join(audit,'publish-result.json'),JSON.stringify(result,null,2));
// Preserve the durable pointer for the next launch; running clients discover it in the cloud.
fs.copyFileSync(path.join(dataDir,'bubble-styles.local.json'),path.join(live,'bubble-styles.local.json'));
console.log(JSON.stringify(result));
const manifest=await publisher.readManifest({refresh:true}),cache=JSON.parse(fs.readFileSync(path.join(dataDir,'bubble-styles.local.json'),'utf8')),checks=[];
for(const item of manifest.items.filter(s=>s.id.startsWith('ref22-'))){
 const entry=cache.items[item.id];for(const [kind,revisionId,sha256] of [['PNG',entry.revisionId,entry.sha256],['SVG',entry.svgRevisionId,entry.svgSha256]]){
  const bytes=Buffer.from(await(await library.remote('/api/revisions/'+revisionId+'/download')).arrayBuffer()),actual=createHash('sha256').update(bytes).digest('hex');if(actual!==sha256)throw Error('Hash mismatch '+item.id+' '+kind);checks.push({id:item.id,kind,revisionId,sha256,bytes:bytes.length,hashMatch:true});
 }
}
fs.writeFileSync(path.join(audit,'upload-verification.json'),JSON.stringify({ok:true,count:manifest.items.length,newStyles:8,verifiedFiles:checks.length,upperCircle:manifest.items.find(i=>i.id==='ref22-double').parts,manifestRevisionId:result.manifest.revisionId,checks},null,2));
console.log(JSON.stringify({ok:true,newStyles:8,verifiedFiles:checks.length}));
