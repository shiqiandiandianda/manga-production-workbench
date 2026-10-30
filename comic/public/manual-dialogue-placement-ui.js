import {speakerMarkup,badgePosition} from './bubble-speaker.js';
import {fontWeightOptions} from './font-weights.js';
import {placementRows,placementSettings,preparePlacement,positionPreparedDialogue} from './manual-dialogue-placement.js';
import {bubbleMaterials} from './bubble-material.js';
import {comicPreviewUrl,comicStyle} from './comic-styles.js';
import {FONT_LABELS} from './unified-typography.js';
import {svgBubbleMarkup,bubbleLayout,FONT_FAMILIES} from './lettering.js';
import {applyBubbleEdit} from './bubble-editor.js';
import {dialogueTemplateStyle,PRODUCTION_FONT_FIELDS} from './production-lettering-style.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kinds={speech:'对白',thought:'内心',person:'人名',location:'地点',time:'时间',narration:'旁白'};
export function mountManualDialoguePlacement({stage,button,getProject,getPage,getAssets=()=>[],getPoint,onPlace,onSettings,onLocate,onStyles,registerMaterial,toast}){
 const area=document.querySelector('.canvas-work-area'),panel=document.createElement('aside');panel.id='dialogue-placement-panel';panel.hidden=true;panel.setAttribute('aria-label','主画板点击摆放台词');area.prepend(panel);
 const speakerChip=document.createElement('div');speakerChip.className='bubble-speaker-chip dialogue-placement-speaker-chip';speakerChip.hidden=true;speakerChip.dataset.placementSpeakerGhost='';document.body.append(speakerChip);
 const rowNodes=new Map();let chromeSignature='',settingsOpen=false;
 const context=document.createElement('canvas').getContext('2d'),drafts=new Map();let preserveExisting=false,opened=false,armed=false,space=false,projectId='',selectedKey='',custom=null,settings={},rows=[],prepared=null,busy=false,ghost=null,pointer=null,status='';
 const find=s=>panel.querySelector(s),current=()=>custom||rows.find(r=>r.key===selectedKey),clearGhost=()=>{ghost?.remove();ghost=null;speakerChip.hidden=true;};
 function rowSpeaker(row){if(!row)return '';const source=row.sourceBubble||{},kind=row.kind||'speech',bubble={...source,type:kind==='speech'?'speech':kind==='thought'?'thought':'caption',speaker:row.speaker||source.speaker||'',shotId:row.shotId||source.shotId,productionSegment:row.segmentId||source.productionSegment};return speakerMarkup(getProject(),bubble,getAssets());}
 function sync(){const project=getProject();button.disabled=!project;if(!opened)return;if(!project){close();return;}if(project.id!==projectId){projectId=project.id;settings=placementSettings(project,getPage());drafts.clear();custom=null;selectedKey='';armed=false;}rows=placementRows(project,getPage());for(const row of rows)if(drafts.has(row.key))row.text=drafts.get(row.key);if(!custom&&!rows.some(r=>r.key===selectedKey))selectedKey=(rows.find(r=>!r.placed&&!r.locked)||rows[0])?.key||'';if(preserveExisting)loadExisting();paint();}
 function prepare(){const row=current();prepared=row&&String(row.text).trim()?preparePlacement(context,row,settings,{pageWidth:getPage()?.width||1280,preserveExisting}):null;return prepared;}
 function previewMarkup(){if(prepared?.status!=='fitted')return '';const b=prepared.bubble,l=bubbleLayout(context,b),tip=l.tail?.tip,left=Math.min(-10,(tip?.x??0)-10),top=Math.min(-10,(tip?.y??0)-10),right=Math.max(b.w+10,(tip?.x??0)+10),bottom=Math.max(b.h+10,(tip?.y??0)+10);return '<svg viewBox="'+[left,top,right-left,bottom-top].join(' ')+'">'+svgBubbleMarkup(context,b)+'</svg>';}
 function loadExisting(){const source=current()?.sourceBubble;preserveExisting=!!source;if(!source)settings=placementSettings(getProject(),getPage());if(source){const template=dialogueTemplateStyle(source);settings={...settings,...Object.fromEntries(PRODUCTION_FONT_FIELDS.filter(k=>source[k]!==undefined).map(k=>[k,source[k]])),...template.boxes.speech};}}
 function paintRows(){
  const list=find('.placement-source-list'),live=new Set(rows.map(r=>r.key));
  for(const [key,node] of rowNodes)if(!live.has(key)){node.remove();rowNodes.delete(key);}
  list.querySelector('.sub-note')?.remove();
  let cursor=list.firstChild;
  rows.forEach((r,i)=>{
   let node=rowNodes.get(r.key);
   if(!node){node=document.createElement('button');node.dataset.placementRow=r.key;rowNodes.set(r.key,node);}
   const identity=rowSpeaker(r),signature=JSON.stringify([i,identity,r.kind,r.locked,r.placed,r.text,r.gridId]);
   if(node.__rowSignature!==signature){node.innerHTML=`<div class="placement-row-heading"><span class="placement-row-number">${i+1}</span>${identity}<small>${r.locked?'已锁定':r.placed?'已摆放':'待摆放'}</small></div><p>${esc(r.text)}</p><small>${esc(r.gridId||'')}</small>`;node.disabled=!!r.locked;node.__rowSignature=signature;}
   const pressed=String(!custom&&r.key===selectedKey);if(node.getAttribute('aria-pressed')!==pressed)node.setAttribute('aria-pressed',pressed);
   if(node===cursor)cursor=cursor.nextSibling;else list.insertBefore(node,cursor);
  });
  if(!rows.length)list.innerHTML='<p class="sub-note">本话暂无源台词，可点击“新台词”。</p>';
  find('.placement-list-heading strong').textContent='本话台词 · '+rows.filter(r=>r.placed).length+'/'+rows.length;
 }
 function paint(){
  const expanded=new Map([...panel.querySelectorAll("details[data-placement-disclosure]")].map(el=>[el.dataset.placementDisclosure,el.open])),scrolls=[...panel.querySelectorAll(".placement-settings,.placement-source-list")].map(el=>[el.className,el.scrollTop]),active=document.activeElement,focusKey=panel.contains(active)?active.dataset.placementSetting:null;
  const row=current();prepare();
  const signature=JSON.stringify([settings,row,rowSpeaker(row),armed,status,settingsOpen,!!onStyles,!!getProject().productionPackage]);
  if(signature===chromeSignature){paintRows();updateMode();return;}
  chromeSignature=signature;
  const retainedList=find('.placement-source-list');
  panel.innerHTML=`<header><strong>点击摆放台词</strong><button data-placement-close aria-label="关闭台词摆放">×</button></header><div class="placement-settings"><div class="placement-style-row"><label>气泡框式<select data-placement-setting="styleId"><option value="builtin-oval" ${settings.styleId==='builtin-oval'?'selected':''}>默认圆框</option><option value="none" ${settings.styleId==='none'?'selected':''}>无框 · 只有台词</option><option value="default" ${settings.styleId==='default'?'selected':''}>按台词类型使用默认框</option>${bubbleMaterials.filter(s=>s.id!=='builtin-oval').map(s=>`<option value="${esc(s.id)}" ${settings.styleId===s.id?'selected':''}>${esc(s.label)}</option>`).join('')}</select></label><details class="placement-materials" data-placement-disclosure="materials"><summary>看图选框</summary><div>${bubbleMaterials.map(s=>`<button data-placement-material="${esc(s.id)}" title="${esc(s.label)}"><img loading="lazy" src="${esc(comicPreviewUrl(s.id))}" alt="${esc(s.label)}"></button>`).join('')}</div></details></div><div class="field-grid"><label>字体<select data-placement-setting="fontFamily">${Object.entries(FONT_LABELS).map(([k,v])=>`<option value="${esc(k)}" ${k===settings.fontFamily?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>字号 px<input data-placement-setting="fontSize" type="number" min="10" max="1024" step="1" value="${settings.fontSize}"></label></div><details data-placement-disclosure="appearance"><summary>字重、留白与外观</summary><div class="field-grid"><label>每行目标字数<input data-placement-setting="columns" type="number" min="3" max="10" value="${settings.columns}"></label><label>字重<select data-placement-setting="fontWeight">${fontWeightOptions(settings.fontFamily,settings.fontWeight).map(([n,label])=>`<option value="${n}" ${settings.fontWeight===n?'selected':''}>${label}</option>`).join('')}</select></label><label>文字颜色<input type="color" data-placement-setting="textColor" value="${settings.textColor}"></label><label>气泡底色<input type="color" data-placement-setting="fillColor" value="${settings.fillColor}"></label><label>填充不透明度 %<input type="number" min="0" max="100" data-placement-setting="fillOpacity" value="${settings.fillOpacity*100}"></label><label>描边 px<input type="number" min="0" max="256" step=".5" data-placement-setting="outlineWidth" value="${settings.outlineWidth}"></label></div><label class="placement-check"><input type="checkbox" data-placement-setting="tailVisible" ${settings.tailVisible?'checked':''}>显示尾巴</label></details></div><section class="placement-current"><div><div class="placement-current-speaker">${rowSpeaker(row)}</div><button data-placement-new>＋ 新台词</button></div><textarea data-placement-text rows="3" maxlength="4000" placeholder="选择下方台词或输入新台词">${esc(row?.text||'')}</textarea><div class="placement-preview" data-placement-preview>${previewMarkup()}</div><button data-placement-arm class="primary" ${!prepared||prepared.status!=='fitted'||row?.locked?'disabled':''}>${armed?'正在摆放 · 点击画面':row?.placed?'重新点击摆放当前句':'开始点击摆放'}</button><p role="status" data-placement-status>${esc(status||(!row?'选择台词，或新建台词。':prepared?.status!=='fitted'?'此字号超出页面可容纳范围，请调整字号或框式。':'已自动换好行；点击主画板摆放，空格拖动画布，Esc 暂停。'))}</p></section><div class="placement-list-heading"><strong>本话台词 · ${rows.filter(r=>r.placed).length}/${rows.length}</strong>${onStyles&&getProject().productionPackage?'<button data-placement-styles>统一样式</button>':''}</div><div class="placement-source-list"></div>`;
  const settingPane=find('.placement-settings'),heading=find('.placement-list-heading'),list=find('.placement-source-list'),editor=find('.placement-current');
  const toolbar=document.createElement('div');toolbar.className='placement-toolbar';
  const styleName=find('[data-placement-setting="styleId"] option:checked')?.textContent||'气泡';
  toolbar.innerHTML=`<button type="button" data-placement-settings-toggle aria-expanded="${settingsOpen}" aria-controls="placement-settings-content">摆放设置${settingsOpen?' ▴':' ▾'}</button><span title="${esc(styleName)}">${esc(styleName)} · ${settings.fontSize} px</span>`;
  panel.querySelector('header').after(toolbar);toolbar.after(settingPane);settingPane.id='placement-settings-content';settingPane.hidden=!settingsOpen;
  settingPane.after(heading);heading.after(list);list.after(editor);
  const compose=document.createElement('div');compose.className='placement-compose';
  editor.querySelector('div').after(compose);compose.append(find('[data-placement-text]'),find('[data-placement-preview]'));
  find('[data-placement-preview]').setAttribute('aria-label','当前台词样式预览');
  find('[data-placement-text]').setAttribute('aria-label','当前台词');
  find('[data-placement-settings-toggle]').onclick=()=>{settingsOpen=!settingsOpen;paint();};
  if(retainedList)find('.placement-source-list').replaceWith(retainedList);
  paintRows();
  for(const el of panel.querySelectorAll('details[data-placement-disclosure]'))el.open=expanded.get(el.dataset.placementDisclosure)||false;
  if(focusKey)find('[data-placement-setting="'+focusKey+'"]')?.focus({preventScroll:true});
  for(const [name,top] of scrolls)panel.getElementsByClassName(name)[0]?.scrollTo({top});
  find('[data-placement-close]').onclick=close;find('[data-placement-new]').onclick=()=>{custom={key:'custom',text:'',kind:'speech',speaker:''};settings=placementSettings(getProject(),getPage());preserveExisting=false;armed=false;status='输入台词后，点击画面放置。';paint();find('[data-placement-text]').focus();};
  find('[data-placement-arm]').onclick=()=>{if(armed){pause();return;}armed=true;status='';paint();};
  find('[data-placement-text]').oninput=e=>{const r=current();if(!r)return;preserveExisting=false;r.text=e.target.value;drafts.set(r.key,r.text);prepare();const preview=find('[data-placement-preview]');preview.innerHTML=previewMarkup();find('[data-placement-arm]').disabled=prepared?.status!=='fitted';armed=prepared?.status==='fitted';status='';updateMode();};
  for(const input of panel.querySelectorAll('[data-placement-setting]'))input.onchange=async()=>{if(!input.checkValidity()){input.reportValidity();return;}preserveExisting=false;const key=input.dataset.placementSetting,value=input.type==='checkbox'?input.checked:input.type==='number'||key==='fontWeight'?Number(input.value)/(key==='fillOpacity'?100:1):input.value;if(key==='styleId')await material(value);else{settings[key]=value;if(["fontFamily","fontWeight","fontSize"].includes(key)){busy=true;try{await document.fonts.load(settings.fontWeight+" "+settings.fontSize+"px "+FONT_FAMILIES[settings.fontFamily],"汉字Ag");}catch(e){toast("字体加载失败："+e.message,true);}finally{busy=false;}}onSettings?.(settings);paint();}};
  for(const b of panel.querySelectorAll('[data-placement-material]'))b.onclick=()=>material(b.dataset.placementMaterial);
  find('.placement-source-list').onclick=event=>{const b=event.target.closest('[data-placement-row]');if(!b||b.disabled)return;custom=null;selectedKey=b.dataset.placementRow;armed=true;status='';const r=current();loadExisting();onLocate?.(r);paint();find('[data-placement-row][aria-pressed="true"]')?.scrollIntoView({block:'nearest'});};
  find('[data-placement-styles]')?.addEventListener('click',()=>{pause();onStyles();});updateMode();
 }
 async function material(styleId){if(busy)return;busy=true;try{preserveExisting=false;const style=comicStyle(styleId);let localAssetId;if(style?.texture)localAssetId=await registerMaterial(style);const restore=styleId!=='none'&&(settings.styleId==='none'||settings.fillOpacity===0&&settings.outlineWidth===0);settings={...settings,styleId,definition:style?structuredClone(style):undefined,localAssetId,...(restore?{fillOpacity:1,outlineWidth:2.8,tailVisible:true}:{})};if(style?.preset)for(const k of ['fillColor','textColor','outlineColor'])if(style.preset[k])settings[k]=style.preset[k];onSettings?.(settings);status='';paint();}catch(e){toast(e.message,true);}finally{busy=false;}}
 function updateMode(){
  const active=opened&&armed&&prepared?.status==='fitted';
  area.classList.toggle('dialogue-placement-armed',active);button.setAttribute('aria-pressed',String(opened));
  const arm=find('[data-placement-arm]'),message=find('[data-placement-status]');
  if(arm){arm.textContent=active?'取消摆放 · Esc':current()?.placed?'重新点击摆放当前句':'开始点击摆放';arm.classList.toggle('placement-cancel',active);arm.setAttribute('aria-pressed',String(active));arm.title=active?'取消跟随鼠标的台词预览，保留已摆放的台词':'点击后，在画面上选择落点';}
  if(message)message.textContent=active?'正在摆放：点击画面放置，空格拖动画布。':status||(!current()?'选择台词，或新建台词。':prepared?.status!=='fitted'?'请填写台词，或调整字号与框式。':'已暂停摆放，可自由选择和拖动台词。');
  if(!active)clearGhost();else refreshPreview();
 }
 function open({customText,rowKey}={}){preserveExisting=false;opened=true;panel.hidden=false;area.classList.add('dialogue-placement-open');sync();if(rowKey&&rows.some(r=>r.key===rowKey)){custom=null;selectedKey=rowKey;}if(customText!==undefined){settings=placementSettings(getProject(),getPage());preserveExisting=false;custom={key:'custom',text:customText,kind:'speech',speaker:''};armed=!!String(customText).trim();paint();}else{loadExisting();armed=!!current()&&prepare()?.status==='fitted';paint();}window.dispatchEvent(new Event('resize'));}
 function pause(){armed=false;pointer=null;status='已取消摆放，已放置的台词不受影响。';clearGhost();updateMode();if(opened)paint();}
 function close(){opened=false;armed=false;pointer=null;clearGhost();panel.hidden=true;area.classList.remove('dialogue-placement-open','dialogue-placement-armed');button.setAttribute('aria-pressed','false');window.dispatchEvent(new Event('resize'));}
 function pointFor(event){if(!stage.contains(event.target))return null;const target=getPoint(event);return target?.page&&!target.page.designEpisodeRole?target:null;}
 const down=event=>{if(!opened||!armed||space||event.button!==0||event.altKey||event.ctrlKey||event.metaKey||busy)return;if(event.target.closest('[data-bubble]')){pause();return;}const target=pointFor(event);if(!target||!prepared||prepared.status!=='fitted')return;event.preventDefault();event.stopImmediatePropagation();try{const row=current(),parentId=event.target.closest('[data-panel]')?.dataset.panel,parent=target.page.panels.find(p=>p.id===parentId)||target.page.panels.toReversed().find(p=>p.visible!==false&&target.point.x>=p.x&&target.point.x<=p.x+p.w&&target.point.y>=p.y&&target.point.y<=p.y+p.h);onPlace({row:{...row},prepared:prepared.bubble,page:target.page,point:target.point,parent});drafts.delete(row.key);preserveExisting=false;clearGhost();rows=placementRows(getProject(),getPage());custom=null;const following=rows.slice(rows.findIndex(r=>r.key===row.key)+1).find(r=>!r.placed&&!r.locked);selectedKey=following?.key||row.key;armed=!!following;status=armed?'已摆放，继续点击画面放置下一句。':'已摆放；可直接拖动，或选择下一句。';const next=current();if(armed&&(next.segmentId!==row.segmentId||next.gridId!==row.gridId))onLocate?.(next);paint();find('[data-placement-row][aria-pressed="true"]')?.scrollIntoView({block:'nearest'});}catch(e){toast(e.message,true);}};
 function refreshPreview(){
  if(!pointer||!opened||!armed||space||!prepared||prepared.status!=='fitted'){clearGhost();return;}
  const event={...pointer,target:document.elementFromPoint(pointer.clientX,pointer.clientY)},target=event.target&&pointFor(event);
  if(!target){clearGhost();return;}
  clearGhost();ghost=document.createElementNS('http://www.w3.org/2000/svg','g');ghost.dataset.dialogueGhost='';ghost.style.pointerEvents='none';ghost.setAttribute('opacity','.55');const bubble=positionPreparedDialogue(getProject(),prepared.bubble,target.page,target.point);bubble.id='placement-ghost';bubble.visible=true;ghost.innerHTML=svgBubbleMarkup(context,bubble).replaceAll('pointer-events="all"','pointer-events="none"');// Keep the preview above every panel, also when the page has no rendered layers.
  ghost.setAttribute('transform',target.previewTransform||'');stage.append(ghost);
  const identity=rowSpeaker(current());if(speakerChip.innerHTML!==identity)speakerChip.innerHTML=identity;speakerChip.hidden=!identity;
  if(identity){const rect=ghost.getBoundingClientRect(),bounds=document.querySelector('#canvas-scroll').getBoundingClientRect(),position=badgePosition(rect,bounds,speakerChip.offsetWidth,speakerChip.offsetHeight,[]);speakerChip.style.left=position.left+'px';speakerChip.style.top=position.top+'px';}
 }
 const move=event=>{pointer={clientX:event.clientX,clientY:event.clientY};refreshPreview();};
 window.addEventListener('pointerdown',down,true);window.addEventListener('pointermove',move,true);window.addEventListener('dblclick',e=>{if(opened&&armed&&stage.contains(e.target)&&!e.target.closest('[data-bubble]')){e.preventDefault();e.stopImmediatePropagation();}},true);window.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.target.closest('input,textarea,select,[contenteditable]')){space=true;clearGhost();}if(e.key==='Escape'&&opened){pause();}});window.addEventListener('keyup',e=>{if(e.code==='Space')space=false;});button.onclick=()=>opened?close():getProject()&&open();return {sync,open,close,pause,refreshPreview,get active(){return opened;}};
}
