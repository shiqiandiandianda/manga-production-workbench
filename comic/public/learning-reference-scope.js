/** Uses the learning library's own saved selection; never starts learning or generation. */
export function createLearningReferenceScope({api,onSaved}){
 const dialog=document.createElement('dialog');dialog.id='learning-reference-scope';dialog.setAttribute('aria-labelledby','learning-reference-scope-title');
 dialog.innerHTML='<header><strong id="learning-reference-scope-title">选择学习参考范围</strong><button data-close aria-label="关闭学习参考范围">关闭</button></header><label>学习项目<select data-project aria-label="学习参考所属项目"></select></label><p data-note></p><div data-controls hidden><div class="scope-range"><label>起始话数<input data-start aria-label="起始话数" type="number" min="1" step="1"></label><label>结束话数<input data-end aria-label="结束话数" type="number" min="1" step="1"></label><button data-range>按话数选择</button></div><div class="scope-tools"><button data-all>全选本项目参考</button><button data-clear>清空选择</button><span data-count role="status"></span></div><div data-list></div></div><p data-error role="alert"></p><footer><button data-cancel>取消</button><button data-save>保存学习范围</button></footer>';
 const css=document.createElement('style');css.textContent='#learning-reference-scope{width:min(900px,calc(100vw - 48px));max-height:calc(100vh - 48px);padding:22px;border:1px solid #45627d;border-radius:10px;background:#122230;color:#deebf7;overflow:auto}#learning-reference-scope::backdrop{background:#0009}#learning-reference-scope header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}#learning-reference-scope strong{font-size:18px}#learning-reference-scope label{display:grid;gap:6px}#learning-reference-scope select,#learning-reference-scope input{padding:9px;min-width:0}#learning-reference-scope button{padding:9px 14px}#learning-reference-scope p{font-size:13px;color:#b9cddd}#learning-reference-scope .scope-range,#learning-reference-scope .scope-tools{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:16px 0}#learning-reference-scope .scope-tools{align-items:center}#learning-reference-scope [data-list]{max-height:40vh;overflow:auto}#learning-reference-scope .scope-reference{display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid #45627d}#learning-reference-scope .scope-reference span{display:grid;gap:4px;overflow-wrap:anywhere}#learning-reference-scope .scope-reference strong{font-size:14px}#learning-reference-scope small{color:#b9cddd}#learning-reference-scope footer{display:flex;justify-content:flex-end;gap:12px;margin-top:16px}#learning-reference-scope [data-error]{color:#ffb5ac}#learning-reference-scope [hidden]{display:none!important}@media(max-width:600px){#learning-reference-scope .scope-range label{width:100%}}';
 css.textContent+='#learning-reference-scope{height:min(740px,calc(100vh - 48px))}#learning-reference-scope[open]{display:flex;flex-direction:column}#learning-reference-scope header,#learning-reference-scope footer{flex-shrink:0}#learning-reference-scope p{margin:8px 0}#learning-reference-scope [data-controls]{display:flex;flex-direction:column;flex:1;min-height:0}#learning-reference-scope [data-list]{flex:1;min-height:90px;max-height:none}#learning-reference-scope .scope-range{margin:10px 0}#learning-reference-scope .scope-range label{flex:1;min-width:140px}#learning-reference-scope .scope-tools{margin:10px 0}#learning-reference-scope .scope-reference{justify-content:flex-start}#learning-reference-scope .scope-reference input{width:18px;height:18px;min-width:18px;padding:0;flex:0 0 18px;margin:0}#learning-reference-scope .scope-reference span{flex:1;min-width:0}';
 document.head.append(css);document.body.append(dialog);const el=key=>dialog.querySelector('[data-'+key+']');
 let data,projectId='',selected=new Set(),saving=false,ticket=0;const collator=new Intl.Collator('zh-CN',{numeric:true});
 const refs=()=>data?.references.filter(r=>r.projectId===projectId).sort((a,b)=>(a.episode??Infinity)-(b.episode??Infinity)||collator.compare(a.name,b.name))||[];
 function count(){el('count').textContent='已选 '+selected.size+' / '+refs().length+' 份参考';}
 function render(){
  const list=el('list');list.replaceChildren();el('controls').hidden=!projectId;el('save').disabled=!projectId||saving;el('error').textContent='';
  el('note').textContent=projectId?'当前学习项目：'+data.projects.find(p=>p.id===projectId).name:'漫画台原先排版规则是固定快照；请选择自己的作品学习项目设置参考范围。';
  if(!projectId)return;const entries=refs();count();
  if(!entries.length){list.textContent='本项目还没有参考长图，请先在学习库的“参考学习”中导入。';return;}
  for(const ref of entries){
   const row=document.createElement('label');row.className='scope-reference';const input=document.createElement('input');input.type='checkbox';input.checked=selected.has(ref.id);input.setAttribute('aria-label',ref.name);
   const text=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');name.textContent=ref.name;detail.textContent=(Number.isInteger(ref.episode)?'第'+ref.episode+'话 · ':'未识别话数 · ')+'已核对 '+ref.checked+' / '+ref.candidates+' 格';text.append(name,detail);row.append(input,text);list.append(row);
   input.onchange=()=>{if(input.checked)selected.add(ref.id);else selected.delete(ref.id);el('error').textContent='';count();};
  }
 }
 function choose(){projectId=el('project').value;selected=new Set(refs().filter(r=>r.learningSelected).map(r=>r.id));el('start').value='';el('end').value='';render();}
 el('project').onchange=choose;
 el('range').onclick=()=>{
  const start=el('start').valueAsNumber,end=el('end').valueAsNumber;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start){el('error').textContent='请填写有效的起始和结束话数，结束话数不能小于起始话数。';return;}
  const matches=refs().filter(r=>Number.isInteger(r.episode)&&r.episode>=start&&r.episode<=end);
  if(!matches.length){el('error').textContent='本项目没有这个话数范围的参考，现有选择已保留。';return;}
  selected=new Set(matches.map(r=>r.id));render();
 };
 el('all').onclick=()=>{selected=new Set(refs().map(r=>r.id));render();};el('clear').onclick=()=>{selected.clear();render();};
 for(const key of ['close','cancel'])el(key).onclick=()=>{if(!saving)dialog.close();};
 dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});dialog.addEventListener('close',()=>{ticket++;});
 el('save').onclick=async()=>{
  if(saving||!projectId)return;saving=true;for(const node of dialog.querySelectorAll('button,input,select'))node.disabled=true;
  try{const referenceIds=refs().filter(r=>selected.has(r.id)).map(r=>r.id);await api('/api/auto-layout/learning-scope','POST',{projectId,referenceIds});dialog.close();await onSaved?.();}
  catch(error){el('error').textContent=error.message;}
  finally{saving=false;for(const node of dialog.querySelectorAll('button,input,select'))node.disabled=false;el('save').disabled=!projectId;}
 };
 return {dialog,async open(chosenProject){
  const current=++ticket;data=null;projectId='';selected.clear();el('project').replaceChildren(new Option('正在载入学习项目',''));el('project').disabled=true;el('controls').hidden=true;el('save').disabled=true;el('error').textContent='';el('note').textContent='正在读取学习库已有参考范围…';dialog.showModal();
  try{const result=await api('/api/auto-layout/learning-scope');if(current!==ticket||!dialog.open)return;data=result;el('project').replaceChildren(new Option('请选择作品学习项目',''),...data.projects.map(p=>new Option(p.name,p.id)));el('project').disabled=false;el('project').value=data.projects.some(p=>p.id===chosenProject)?chosenProject:'';choose();}
  catch(error){if(current===ticket)el('error').textContent=error.message;}
 }};
}
