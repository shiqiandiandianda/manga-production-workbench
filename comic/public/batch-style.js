import {selectedLayers} from './multi-selection.js';
import {normalizeBubbleStyle,FONT_FAMILIES} from './lettering.js';
const rules={panel:{border:v=>Number.isFinite(v)&&v>=0&&v<=256,borderColor:v=>/^#[a-f0-9]{6}$/i.test(v)},bubble:{outlineWidth:v=>Number.isFinite(v)&&v>=0&&v<=256,outlineColor:v=>/^#[a-f0-9]{6}$/i.test(v),fontFamily:v=>Object.hasOwn(FONT_FAMILIES,v),fontSize:v=>Number.isFinite(v)&&v>=10&&v<=2048,fontWeight:v=>Number.isInteger(v)&&v>=100&&v<=900&&v%100===0,textColor:v=>/^#[a-f0-9]{6}$/i.test(v),textAlign:v=>['left','center','right'].includes(v),writingMode:v=>['horizontal','vertical'].includes(v)}};
export function batchStyleTargets(project,keys,kind){return selectedLayers(project,keys).filter(entry=>entry.type===kind);}
export function sharedStyleValue(entries,kind,key){if(!entries.length)return null;const value=entry=>kind==='bubble'?normalizeBubbleStyle(entry.item)[key]:key==='border'?(entry.item.border||0):entry.item.borderColor;const first=value(entries[0]);return entries.every(entry=>value(entry)===first)?first:null;}
export function applyBatchStyle(project,keys,kind,key,value){
 const rule=rules[kind]?.[key];if(!rule||!rule(value))throw new Error('批量样式值无效或超出范围');
 const targets=batchStyleTargets(project,keys,kind);if(!targets.length)throw new Error('所选图层没有可修改的'+(kind==='panel'?'格子':'对白'));
 if(targets.some(entry=>entry.item.locked))throw new Error('请先解锁所选'+(kind==='panel'?'格子':'对白'));
 for(const entry of targets)entry.item[key]=value;return targets.length;
}
export function batchStyleMarkup(project,keys,escape){
 const all=selectedLayers(project,keys),panels=all.filter(e=>e.type==='panel'),bubbles=all.filter(e=>e.type==='bubble');
 const control=(kind,key)=>'data-section="batch-style" data-batch-kind="'+kind+'" data-field="'+key+'"';
 const locked=entries=>entries.some(e=>e.item.locked)?' disabled':'';
 const number=(entries,kind,key,label,min,max,step=1)=>{const value=sharedStyleValue(entries,kind,key);return '<label>'+label+'<input type="number" '+control(kind,key)+' aria-label="'+label+'" value="'+(value??'')+'" placeholder="多种值" min="'+min+'" max="'+max+'" step="'+step+'"'+locked(entries)+'></label>';};
 const color=(entries,kind,key,label)=>{const value=sharedStyleValue(entries,kind,key),first=sharedStyleValue(entries.slice(0,1),kind,key)||'#242830';return '<label>'+label+'<div class="batch-color"><input type="color" '+control(kind,key)+' aria-label="'+label+'选择器" value="'+(value||first)+'"'+locked(entries)+'><input type="text" '+control(kind,key)+' aria-label="'+label+'" maxlength="7" value="'+escape(value||'')+'" placeholder="多种颜色"'+locked(entries)+'></div></label>';};
 const select=(entries,kind,key,label,options,numeric=false)=>{const value=sharedStyleValue(entries,kind,key);return '<label>'+label+'<select '+control(kind,key)+(numeric?' data-value-type="number"':'')+' aria-label="'+label+'"'+locked(entries)+'>'+(value===null?'<option value="" selected disabled>多种值</option>':'')+options.map(([v,l])=>'<option value="'+escape(v)+'" '+(v===value?'selected':'')+'>'+escape(l)+'</option>').join('')+'</select></label>';};
 let html='<section class="batch-style-editor"><p>修改一项，统一应用到所选的对应图层。多种值表示当前样式不同；锁定对象需先解锁。</p>';
 if(panels.length)html+='<h3>格子描边 · '+panels.length+' 个</h3><div class="field-grid">'+number(panels,'panel','border','格子描边粗细 px',0,256,.5)+color(panels,'panel','borderColor','格子描边颜色')+'</div>';
 if(bubbles.length)html+='<h3>对白字体与气泡 · '+bubbles.length+' 个</h3>'+select(bubbles,'bubble','fontFamily','字体',[['source-han-sans','思源黑体'],['source-han-serif','思源宋体'],['system-sans','系统黑体'],['system-serif','系统宋体']])+'<div class="field-grid">'+number(bubbles,'bubble','fontSize','字号 px',10,2048)+select(bubbles,'bubble','fontWeight','字重',[100,200,300,400,500,600,700,800,900].map(v=>[v,{100:'极细',200:'纤细',300:'细体',400:'常规',500:'中等',600:'半粗',700:'加粗',800:'特粗',900:'重体'}[v]]),true)+color(bubbles,'bubble','textColor','文字颜色')+select(bubbles,'bubble','textAlign','对齐',[['left','靠左'],['center','居中'],['right','靠右']])+select(bubbles,'bubble','writingMode','文字排列',[['horizontal','横排'],['vertical','竖排']])+number(bubbles,'bubble','outlineWidth','气泡描边粗细 px',0,256,.5)+color(bubbles,'bubble','outlineColor','气泡描边颜色')+'</div>';
 return html+'</section>';
}
