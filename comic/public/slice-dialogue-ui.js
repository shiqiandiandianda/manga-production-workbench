import {dialogueSegments} from './bubble-dialogue-segments.js';
import {frameRegionOnSource,validateSliceRegion} from './panel-slices.js';
import {localDialogueId,dialogueGroupFor,createSliceDialogueGroup,groupTextRegions} from './slice-dialogue-groups.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function restoreSliceDialogueGroups({texts,existing,rootFrame,source,preview,positions}){
 const groups={};
 for(const b of new Set(existing.values())){
  if(!dialogueSegments(b).length)continue;const first=texts.find(t=>t['文字ID']===b.dialogueSegments[0].sourceTextId);if(!first)continue;
  const r=frameRegionOnSource(source,rootFrame,preview,{x:(b.x-rootFrame.x)/rootFrame.w,y:(b.y-rootFrame.y)/rootFrame.h,w:b.w/rootFrame.w,h:b.h/rootFrame.h});if(!validateSliceRegion(r))continue;
  const ids=b.dialogueSegments.map((s,i)=>s.sourceTextId||localDialogueId(first['文字ID']));
  if(!b.dialogueSegments[1].sourceTextId&&!texts.some(t=>t['文字ID']===ids[1]))texts.push({...structuredClone(first),'文字ID':ids[1],'文本':b.dialogueSegments[1].text,localDialogue:true});
  const group={textIds:ids,region:r,segments:structuredClone(b.dialogueSegments),bubble:{...structuredClone(b),fontSize:b.fontSize*r.w*preview.width/b.w},changed:false};groups[ids[0]]=group;
  for(const id of ids)existing.set(id,b);Object.assign(positions,groupTextRegions(group));
 }
 return groups;
}
export function mountSliceDialogueControls({host,texts,positions,regions,groups,existing,preview,editor,feedback,getBusy}){
 const list=host.querySelector('.slice-text-list'),detail=host.querySelector('[data-slices-text-detail]');if(!list||!detail)return {update(){}};
 const toolbar=document.createElement('div');toolbar.className='slice-dialogue-toolbar';toolbar.innerHTML='<button type="button" data-slices-merge-dialogue disabled>合并为双圆气泡</button><small>勾选同一格的两句台词</small>';list.before(toolbar);
 detail.insertAdjacentHTML('beforeend','<label data-slices-dialogue-edit hidden>本段台词<textarea data-slices-dialogue-text rows="4" maxlength="4000"></textarea></label><button type="button" data-slices-add-dialogue>＋ 新增一段台词（双圆气泡）</button>');
 const input=detail.querySelector('[data-slices-dialogue-text]'),merge=toolbar.querySelector('button'),add=detail.querySelector('[data-slices-add-dialogue]');let current=null,cardIds='';
 function cards(){
  const ids=texts.map(t=>t['文字ID']).join('|');if(ids!==cardIds){
   // Existing cards keep their speaker avatars. Only manual paragraphs need a new card.
   for(const el of list.querySelectorAll('[data-local-dialogue]'))if(!texts.some(t=>t['文字ID']===el.dataset.localDialogue))el.remove();
   for(const t of texts)if(t.localDialogue&&!list.querySelector('[data-slice-text="'+CSS.escape(t['文字ID'])+'"]')){const div=document.createElement('div');div.dataset.localDialogue=t['文字ID'];div.innerHTML='<button data-slice-text="'+esc(t['文字ID'])+'"><strong>'+esc(t['说话人']||'台词')+' · 新增台词</strong><span class="slice-line-content"></span><small data-slice-text-state></small></button>';const previous=list.querySelector('[data-slice-text="'+CSS.escape(t['文字ID'].slice(6))+'"]')?.closest('.slice-dialogue-card');if(previous)previous.after(div);else list.append(div);}
   for(const button of list.querySelectorAll('[data-slice-text]'))if(!button.closest('.slice-dialogue-card')){const wrap=document.createElement('div');wrap.className='slice-dialogue-card';button.before(wrap);wrap.append(button);const label=document.createElement('label');label.className='slice-dialogue-select';label.innerHTML='<input type="checkbox" data-merge-text="'+esc(button.dataset.sliceText)+'" aria-label="勾选合并台词"><span>合并</span>';wrap.prepend(label);}
   cardIds=ids;
  }
  for(const button of list.querySelectorAll('[data-slice-text]')){const id=button.dataset.sliceText,t=texts.find(t=>t['文字ID']===id),g=dialogueGroupFor(groups,id),checkbox=button.closest('.slice-dialogue-card').querySelector('input');checkbox.disabled=!!g||t?.['类型']!=='对白'||existing.get(id)?.locked===true;if(checkbox.disabled)checkbox.checked=false;button.classList.toggle('active',id===current);button.querySelector('.slice-line-content').textContent=g?g.segments[g.textIds.indexOf(id)].text:t?.['文本']||'';button.querySelector('[data-slice-text-state]').textContent=g?'双圆气泡 · 第 '+(g.textIds.indexOf(id)+1)+' 段':positions[id]?'已放置':'待放置';}
  merge.disabled=getBusy()||list.querySelectorAll('[data-merge-text]:checked').length!==2;
 }
 function update(id){current=id;cards();const g=dialogueGroupFor(groups,id),t=texts.find(t=>t['文字ID']===id);detail.querySelector('[data-slices-dialogue-edit]').hidden=!g;add.hidden=!t||!!g||t['类型']!=='对白';add.disabled=getBusy()||existing.get(id)?.locked===true;input.disabled=getBusy()||existing.get(id)?.locked===true;if(g&&document.activeElement!==input)input.value=g.segments[g.textIds.indexOf(id)].text;if(g)host.querySelector('[data-slices-current-text]').textContent='双圆气泡 · 第 '+(g.textIds.indexOf(id)+1)+' 段';}
 list.addEventListener('change',e=>{if(e.target.matches('[data-merge-text]'))cards();});
 function create(ids){editor.mutate(()=>createSliceDialogueGroup(ids,{texts,positions,regions,groups,existing,preview,fontFamily:host.querySelector('[data-layout-font]')?.value}));editor.selectTarget('text',ids[0]);feedback('已合并为双圆气泡。两段文字可分别拖动、调整换行和编辑；完成后点击“裁格并排字”。');}
 merge.onclick=()=>{if(getBusy())return;try{create([...list.querySelectorAll('[data-merge-text]:checked')].map(c=>c.dataset.mergeText));}catch(e){feedback(e.message,true);}};
 add.onclick=()=>{if(getBusy()||!current)return;const first=current,t=texts.find(t=>t['文字ID']===first),id=localDialogueId(first);try{editor.mutate(()=>{texts.push({...structuredClone(t),'文字ID':id,'文本':'',localDialogue:true});createSliceDialogueGroup([first,id],{texts,positions,regions,groups,existing,preview,fontFamily:host.querySelector('[data-layout-font]')?.value});});editor.selectTarget('text',id);input.focus();feedback('已增加第二段台词，输入文字后可独立移动。');}catch(e){feedback(e.message,true);}};
 input.onchange=()=>{if(getBusy())return;const g=dialogueGroupFor(groups,current);if(!g)return;try{editor.mutate(()=>{const next=structuredClone(g.segments);next[g.textIds.indexOf(current)].text=input.value;if(next.map(s=>s.text).join('\n\n').length>4000)throw Error('两段台词合计最多 4000 字');g.segments=next;g.changed=true;});}catch(e){feedback(e.message,true);input.value=g.segments[g.textIds.indexOf(current)].text;}};
 return {update};
}
