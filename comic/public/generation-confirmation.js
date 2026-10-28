// No work is submitted until the explicit confirmation button is clicked.
export function confirmGeneration({title,message,items=[],confirmLabel='确认生成'}){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='generation-confirm-dialog';dialog.dataset.generationConfirmation='';
  const heading=document.createElement('h2');heading.id='generation-confirm-title';heading.textContent=title;dialog.setAttribute('aria-labelledby',heading.id);
  const summary=document.createElement('p');summary.textContent=message;dialog.append(heading,summary);
  if(items.length){const list=document.createElement('ul');for(const item of items){const li=document.createElement('li');li.textContent=item;list.append(li);}dialog.append(list);}
  const footer=document.createElement('footer'),cancel=document.createElement('button'),confirm=document.createElement('button');
  cancel.type=confirm.type='button';cancel.textContent='取消';cancel.dataset.generationCancel='';cancel.autofocus=true;confirm.textContent=confirmLabel;confirm.dataset.generationConfirm='';confirm.className='primary';footer.append(cancel,confirm);dialog.append(footer);
  let accepted=false;cancel.onclick=()=>dialog.close();confirm.onclick=()=>{accepted=true;confirm.disabled=true;dialog.close();};
  dialog.addEventListener('close',()=>{dialog.remove();resolve(accepted);},{once:true});document.body.append(dialog);dialog.showModal();cancel.focus();
 });
}
