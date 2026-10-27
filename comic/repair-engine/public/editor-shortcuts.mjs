import {editorToolShortcut} from './editor-tools.mjs';
export function clipboardDestination(target){
 if(target?.isContentEditable||['TEXTAREA','INPUT','SELECT'].includes(target?.tagName))return 'text';
 if(target?.closest?.('#reference-area, #quick-reference-area'))return 'reference';
 if(target?.closest?.('#import-result'))return 'result';
 return 'editor';
}
export function handleLayerPasteKey(event,target,hasLayers,paste){
 if(event.isComposing||event.altKey||!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='v'||!hasLayers||clipboardDestination(target)!=='editor')return false;
 event.preventDefault();if(!event.repeat)paste();return true;
}
export function blocksEditorShortcuts(target,event){
 if(!target)return false;
 if(target.isContentEditable||target.tagName==='TEXTAREA')return true;
 if(target.tagName==='SELECT')return true;
 if(target.tagName!=='INPUT')return false;
 if(target.type==='range')return false;
 if(['checkbox','radio','button','color'].includes(target.type))return ['Enter',' '].includes(event.key);
 if(target.type!=='number'||!target.closest?.('#repair-inspector'))return true;
 // Preserve number editing (including Delete, paste and field-local undo).
 return !(editorToolShortcut(event)||(!event.ctrlKey&&!event.metaKey&&!event.altKey&&['f','q','x',' '].includes(event.key.toLowerCase())));
}
export function bindPropertyShortcutFocus(panel,focusCanvas){
 const doc=panel.ownerDocument,win=doc.defaultView;
 let pointer=null;
 panel.addEventListener('pointerdown',event=>{
  const input=event.target.closest('input');
  if(event.button===0&&input&&['range','number'].includes(input.type))pointer={id:event.pointerId,input,value:input.value};
 });
 doc.addEventListener('pointerup',event=>{
  if(!pointer||pointer.id!==event.pointerId)return;
  const {input,value}=pointer;pointer=null;
  if(input.type==='range'||input.value!==value)win.requestAnimationFrame(()=>{if(doc.activeElement===input)focusCanvas();});
 });
 doc.addEventListener('pointercancel',()=>{pointer=null;});
 panel.addEventListener('change',event=>{
  const input=event.target;
  if(input.tagName==='SELECT'||['color','checkbox','radio'].includes(input.type))win.requestAnimationFrame(()=>{if(doc.activeElement===input)focusCanvas();});
 });
 panel.addEventListener('keydown',event=>{
  if(event.isComposing||!['Enter','Escape'].includes(event.key)||event.target.tagName!=='INPUT'||!['number','range'].includes(event.target.type))return;
  event.preventDefault();event.stopPropagation();focusCanvas();
 });
}
