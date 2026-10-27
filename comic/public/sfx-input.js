/** Keep IME confirmation separate from the user's request to add a text layer.
 * Do not prevent IME Enter/Escape defaults: the platform needs them to select/cancel candidates.
 */
export function bindSfxInput(form,input,{onSubmit}={}){
 let composing=false,imeConfirmation=false;
 const start=()=>{composing=true;imeConfirmation=false;};
 const update=()=>{composing=true;};
 const end=()=>{composing=false;};
 input.addEventListener('compositionstart',start);
 input.addEventListener('compositionupdate',update);
 input.addEventListener('compositionend',end);
 input.addEventListener('beforeinput',event=>{if(event.isComposing||event.inputType==='insertCompositionText')composing=true;});
 input.addEventListener('keydown',event=>{
  const ime=composing||event.isComposing||event.keyCode===229;
  // Keep typing, candidate navigation and native editing shortcuts inside this field.
  // A deliberate save outside composition can still reach the editor's existing save handler.
  if(!ime&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s')return;
  event.stopPropagation();
  if(ime){if(event.key==='Enter'||event.keyCode===229)imeConfirmation=true;return;}
  if(event.key==='Enter'){
   event.preventDefault();imeConfirmation=false;form.requestSubmit();
  }else imeConfirmation=false;
 });
 input.addEventListener('keyup',event=>{event.stopPropagation();});
 input.addEventListener('blur',()=>{composing=false;});
 form.addEventListener('click',event=>{if(event.target.closest('button[type="submit"]')&&!composing)imeConfirmation=false;});
 form.addEventListener('submit',event=>{
  event.preventDefault();
  if(composing||imeConfirmation||event.isComposing)return;
  const text=input.value.trim();if(text)onSubmit(text);
 });
 return {get composing(){return composing;},get imeConfirmation(){return imeConfirmation;}};
}
