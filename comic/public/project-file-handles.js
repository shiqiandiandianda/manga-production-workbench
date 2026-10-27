// File handles belong to a single imported project, never to a project title.
const bindings=new Map();
const database=new Promise(resolve=>{
 if(!globalThis.indexedDB)return resolve(null);
 const request=indexedDB.open('comic-project-json-files',1);
 request.onupgradeneeded=()=>request.result.createObjectStore('files');
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null);
});
export async function projectFileBinding(id){
 if(bindings.has(id))return bindings.get(id);
 const db=await database;if(!db)return null;
 return new Promise(resolve=>{const request=db.transaction('files').objectStore('files').get(id);request.onsuccess=()=>{if(request.result)bindings.set(id,request.result);resolve(request.result||null);};request.onerror=()=>resolve(null);});
}
export async function bindProjectFile(id,value){
 bindings.set(id,value);const db=await database;if(!db)return;
 // Browsers without handle serialization still support same-session saving.
 await new Promise(resolve=>{try{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(value,id);tx.oncomplete=resolve;tx.onerror=resolve;tx.onabort=resolve;}catch{resolve();}});
}
