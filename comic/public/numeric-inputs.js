// Presentation precision only: never walk or round project/model data.
export function formatInputNumber(value){
 if(value===null||value===undefined||String(value).trim()==='')return '';
 const number=Number(value);if(!Number.isFinite(number))return String(value);
 const rounded=Number(number.toFixed(2));return Object.is(rounded,-0)?'0':String(rounded);
}

const installed=new WeakSet();
export function installNumericInputs(doc){
 if(!doc?.defaultView||installed.has(doc))return;installed.add(doc);
 const win=doc.defaultView;let queued=false;
 function format(input,force=false){
  if(!input?.matches?.('input[type="number"]')||!force&&input===doc.activeElement||input.validity.badInput)return;
  const value=formatInputNumber(input.value);if(input.value!==value)input.value=value;
 }
 function connectFrame(frame){
  try{if(frame.contentDocument)installNumericInputs(frame.contentDocument);}catch{/* Other-origin tools manage their own inputs. */}
 }
 function scan(root=doc){
  if(root.matches?.('input[type="number"]'))format(root);
  for(const input of root.querySelectorAll?.('input[type="number"]')||[])format(input);
  if(root.matches?.('iframe'))connectFrame(root);
  for(const frame of root.querySelectorAll?.('iframe')||[])connectFrame(frame);
 }
 function schedule(){if(queued)return;queued=true;win.requestAnimationFrame(()=>{queued=false;scan();});}
 new win.MutationObserver(records=>{for(const r of records){if(r.type==='attributes')format(r.target);else for(const node of r.addedNodes)if(node.nodeType===1)scan(node);}}).observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['value','type']});
 for(const event of ['input','pointerup','keyup'])doc.addEventListener(event,schedule,true);
 for(const event of ['change','blur'])doc.addEventListener(event,e=>{format(e.target,true);schedule();},true);
 doc.addEventListener('load',e=>{if(e.target?.tagName==='IFRAME')connectFrame(e.target);},true);
 scan();
}
if(typeof document!=='undefined')installNumericInputs(document);
