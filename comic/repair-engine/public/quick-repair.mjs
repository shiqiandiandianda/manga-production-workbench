const area=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function placeQuickRepair(frame,viewport,size,obstacles=[]){
 const pad=10,gap=12,{width:vw,height:vh}=viewport;
 if(!frame||vw<=pad*2||vh<=pad*2||frame.x+frame.width<=0||frame.y+frame.height<=0||frame.x>=vw||frame.y>=vh)return null;
 const width=Math.min(size.width,vw-pad*2),height=Math.min(size.height,vh-pad*2);
 const left=clamp(frame.x,0,vw),right=clamp(frame.x+frame.width,0,vw),top=clamp(frame.y,0,vh),bottom=clamp(frame.y+frame.height,0,vh);
 const visible={x:left,y:top,width:right-left,height:bottom-top},cx=(left+right)/2,cy=(top+bottom)/2;
 const candidates=[[cx-width/2,bottom+gap],[left,bottom+gap],[cx-width/2,top-height-gap],[left,top-height-gap],[right+gap,cy-height/2],[left-width-gap,cy-height/2],[left-width-gap,top-height-gap],[right+gap,top-height-gap],[left-width-gap,bottom+gap]];
 return candidates.map(([x,y],rank)=>{const rect={x:clamp(x,pad,vw-width-pad),y:clamp(y,pad,vh-height-pad),width,height};const overlaps=obstacles.reduce((sum,b)=>sum+area(rect,b),0),distance=Math.hypot(Math.max(left-(rect.x+width),rect.x-right,0),Math.max(top-(rect.y+height),rect.y-bottom,0));return {...rect,score:(area(rect,visible)*6+overlaps*12)/(width*height)+distance*.0005+Math.hypot(rect.x-x,rect.y-y)*.001+rank*.002};}).sort((a,b)=>a.score-b.score)[0];
}

export class QuickRepairPanel{
 constructor(root,callbacks){
  this.root=root;this.callbacks=callbacks;this.context={};this.libraryOpen=false;this.regionKey='';this.collapsed=false;
  try{this.collapsed=localStorage.getItem('patch-quick-repair-collapsed')==='true';}catch{}
  this.find=id=>root.querySelector('#'+id);this.prompt=this.find('quick-prompt');this.referenceArea=this.find('quick-reference-area');
  this.find('quick-auto-text').addEventListener('change',()=>callbacks.autoText(this.find('quick-auto-text').checked,this.regionKey));
  this.find('quick-separate-bubble').addEventListener('change',()=>callbacks.separateBubble(this.find('quick-separate-bubble').checked,this.regionKey));
  this.prompt.addEventListener('input',()=>callbacks.prompt(this.prompt.value,this.regionKey));
  this.find('quick-submit').addEventListener('click',()=>callbacks.submit(this.regionKey));
  this.find('quick-collapse').addEventListener('click',()=>this.collapse(!this.collapsed));
  this.find('quick-unlock').addEventListener('click',()=>callbacks.action('unlock'));
  root.addEventListener('pointerdown',event=>{event.stopPropagation();callbacks.referenceFocus();});
  root.addEventListener('wheel',event=>{event.stopPropagation();if(event.ctrlKey)event.preventDefault();},{passive:false});
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.collapse(true);callbacks.canvasFocus();}});
  root.addEventListener('dragover',event=>{event.preventDefault();event.stopPropagation();});
  root.addEventListener('drop',event=>{event.preventDefault();event.stopPropagation();callbacks.files([...event.dataTransfer.files].filter(file=>file.type.startsWith('image/')));});
  for(const button of root.querySelectorAll('[data-quick-action]'))button.addEventListener('click',()=>{
   const action=button.dataset.quickAction;
   if(action==='library'){this.libraryOpen=!this.libraryOpen;this.find('quick-library').hidden=!this.libraryOpen;if(this.libraryOpen)callbacks.action('library');else callbacks.layout();return;}
   callbacks.action(action);
  });
  this.find('quick-library-mode').addEventListener('change',event=>callbacks.libraryMode(event.target.value));
  new ResizeObserver(()=>callbacks.layout()).observe(root);
 }
 collapse(value){this.collapsed=value;try{localStorage.setItem('patch-quick-repair-collapsed',String(value));}catch{}this.callbacks.layout();}
 update(context){
  this.context=context;const {region,regionKey,visible,disabled,submitDisabled,presets=[],references=[],library=[],locked}=context;
  if(regionKey!==this.regionKey){this.regionKey=regionKey;this.libraryOpen=false;this.refSignature='';this.librarySignature='';}
  this.root.hidden=!visible;if(!region)return;
  this.root.dataset.regionId=region.id;this.root.classList.toggle('collapsed',this.collapsed);
  this.find('quick-label').textContent=`${region.name} · ${region.ratio||'1:1'}`;
  this.find('quick-body').hidden=this.collapsed;
  const collapse=this.find('quick-collapse');collapse.textContent=this.collapsed?'快捷修改':'收起';collapse.title=this.collapsed?'显示选区快捷修改面板':'隐藏选区快捷修改面板';collapse.setAttribute('aria-expanded',String(!this.collapsed));
  this.find('quick-unlock').hidden=!locked;this.find('quick-unlock').disabled=context.busy;
  if(regionKey!==this.prompt.dataset.regionKey||document.activeElement!==this.prompt){if(this.prompt.value!==(region.prompt||''))this.prompt.value=region.prompt||'';this.prompt.dataset.regionKey=regionKey;}
  this.prompt.disabled=disabled;this.find('quick-auto-text').checked=region.autoText===true;this.find('quick-auto-text').disabled=disabled;this.find('quick-separate-bubble').checked=region.separateBubble===true;this.find('quick-separate-bubble').disabled=disabled;
  const submit=this.find('quick-submit');submit.disabled=submitDisabled;submit.textContent=region.submitting?'提交中':context.target==='auto'?'提交修改':'保存任务';submit.title=context.reason||`提交${region.name}`;
  this.find('quick-status').textContent=context.reason||'';this.find('quick-status').hidden=!context.reason;
  for(const button of this.root.querySelectorAll('[data-quick-action]')){const action=button.dataset.quickAction;button.disabled=['view-annotation','manage-library','templates'].includes(action)?context.busy:['reconnect','mode'].includes(action)?context.checking:disabled;}
  this.root.querySelector('[data-quick-action="reconnect"]').hidden=!context.reconnect;
  this.root.querySelector('[data-quick-action="mode"]').textContent=context.target==='auto'?'Codex 自动':context.target==='codex'?'当前对话':'网页 GPT';
  const presetSignature=JSON.stringify(presets.map(p=>[p.name,p.prompt]));
  if(presetSignature!==this.presetSignature){this.presetSignature=presetSignature;const chips=this.find('quick-presets');chips.replaceChildren();for(const [index,preset] of presets.entries()){const button=document.createElement('button');button.type='button';button.textContent=preset.name;button.title=preset.prompt;button.dataset.presetIndex=String(index);button.addEventListener('click',()=>this.callbacks.preset(index));chips.append(button);}}
  for(const button of this.find('quick-presets').children){const preset=presets[Number(button.dataset.presetIndex)];button.disabled=disabled||!preset?.prompt?.trim();button.classList.toggle('active',!!preset?.prompt&&region.prompt?.trim()===preset.prompt.trim());}
  const referenceSignature=JSON.stringify([references.map(r=>[r.id,r.url,r.name]),disabled,!!context.annotationImage]);
  if(referenceSignature!==this.refSignature||context.annotationImage!==this.lastAnnotation){this.refSignature=referenceSignature;this.lastAnnotation=context.annotationImage;const strip=this.find('quick-references');strip.replaceChildren();strip.hidden=!references.length&&!context.annotationImage;
   for(const reference of references){const item=document.createElement('div');item.className='quick-reference';const image=document.createElement('img');image.src=reference.url;image.alt=reference.name||'修图参考图';const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.disabled=disabled;remove.setAttribute('aria-label',`移除参考图：${reference.name||'图片'}`);remove.addEventListener('click',()=>this.callbacks.removeReference(reference.id));item.append(image,remove);strip.append(item);}
   if(context.annotationImage){const item=document.createElement('div');item.className='quick-reference annotation';const preview=document.createElement('button');preview.type='button';preview.title='查看选区标注';preview.setAttribute('aria-label','查看选区标注');const image=document.createElement('img');image.src=context.annotationImage;image.alt='选区标注';preview.append(image);preview.addEventListener('click',()=>this.callbacks.action('view-annotation'));const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.disabled=disabled;remove.setAttribute('aria-label','删除选区标注');remove.addEventListener('click',()=>this.callbacks.action('delete-annotation'));item.append(preview,remove);strip.append(item);}
  }
  this.find('quick-reference-count').textContent=references.length?`参考图 ${references.length}`:'';
  this.find('quick-library').hidden=!this.libraryOpen;
  this.root.querySelector('[data-quick-action="library"]').setAttribute('aria-expanded',String(this.libraryOpen));
  if(this.libraryOpen){this.find('quick-library-mode').value=context.libraryMode||'multiple';this.find('quick-library-mode').disabled=disabled;
   const signature=JSON.stringify([library.map(r=>[r.id,r.url]),references.map(r=>r.id),disabled]);if(signature!==this.librarySignature){this.librarySignature=signature;const grid=this.find('quick-library-grid');grid.replaceChildren();if(!library.length){const empty=document.createElement('p');empty.textContent='图库暂无图片，可粘贴或上传参考图。';grid.append(empty);}for(const reference of library){const button=document.createElement('button');button.type='button';button.disabled=disabled;button.setAttribute('aria-label',`选用图库参考图：${reference.name}`);button.title=reference.name;const selected=references.some(r=>r.id===reference.id);button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));const image=document.createElement('img');image.src=reference.url;image.alt=reference.name;image.loading='lazy';button.append(image);button.addEventListener('click',()=>this.callbacks.chooseReference(reference));grid.append(button);}}
  }
 }
 place(frame,viewport,obstacles){
  if(this.root.hidden)return;
  this.root.style.maxHeight=Math.max(80,viewport.height-24)+'px';
  const placement=placeQuickRepair(frame,viewport,{width:this.root.offsetWidth,height:this.root.offsetHeight},obstacles);
  if(!placement){this.root.hidden=true;return;}this.root.style.left=Math.round(placement.x)+'px';this.root.style.top=Math.round(placement.y)+'px';
 }
}
