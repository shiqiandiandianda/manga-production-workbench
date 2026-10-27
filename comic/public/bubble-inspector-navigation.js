/** Dialogue tabs are local view state; changing a tab never edits a bubble. */
export const BUBBLE_INSPECTOR_TABS=['font','frame','more'];
export function bubbleInspectorView(host){return {tab:host.querySelector('[data-bubble-inspector-tab][aria-selected="true"]')?.dataset.bubbleInspectorTab||host.dataset.bubbleViewTab||'font',scroll:host.closest('.inspector')?.scrollTop||0};}
export function showBubbleInspectorTab(host,tab,{focus=false,resetScroll=false}={}){
 if(!BUBBLE_INSPECTOR_TABS.includes(tab))tab='font';host.dataset.bubbleViewTab=tab;
 for(const button of host.querySelectorAll('[data-bubble-inspector-tab]')){const active=button.dataset.bubbleInspectorTab===tab;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;if(active&&focus)button.focus({preventScroll:true});}
 for(const pane of host.querySelectorAll('[data-bubble-inspector-pane]'))pane.hidden=pane.dataset.bubbleInspectorPane!==tab;
 if(resetScroll)host.closest('.inspector')?.scrollTo({top:0});
}
export function mountBubbleInspectorNavigation(host){
 host.addEventListener('input',event=>{const input=event.target;if(input.dataset.section!=='bubble-tail'||input.type!=='range')return;const selector=input.dataset.field==='anchorT'?'[data-tail-anchor-output]':input.dataset.field==='width'?'[data-tail-width-output]':null,output=selector&&host.querySelector(selector);if(output)output.textContent=Math.round(input.valueAsNumber*10)/10+'%';});
 host.addEventListener('click',event=>{const tab=event.target.closest('[data-bubble-inspector-tab]');if(tab)showBubbleInspectorTab(host,tab.dataset.bubbleInspectorTab,{resetScroll:true});else if(event.target.closest('[data-action="bubble-choose-material"]'))showBubbleInspectorTab(host,'frame',{resetScroll:true});});
 host.addEventListener('keydown',event=>{const button=event.target.closest('[data-bubble-inspector-tab]');if(!button||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const i=BUBBLE_INSPECTOR_TABS.indexOf(button.dataset.bubbleInspectorTab),index=event.key==='Home'?0:event.key==='End'?2:(i+(event.key==='ArrowRight'?1:2))%3;showBubbleInspectorTab(host,BUBBLE_INSPECTOR_TABS[index],{focus:true,resetScroll:true});});
}
