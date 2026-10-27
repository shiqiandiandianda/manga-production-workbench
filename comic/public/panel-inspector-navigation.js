/** Inspector navigation is view state only. It never edits a comic project. */
export const PANEL_INSPECTOR_TABS=['generation','references','layout','image'];
export function panelInspectorView(host){return {tab:host.querySelector('[data-panel-inspector-tab][aria-selected="true"]')?.dataset.panelInspectorTab||'generation',scroll:host.closest('.inspector')?.scrollTop||0};}
export function showPanelInspectorTab(host,tab,{focus=false,resetScroll=false}={}){
 if(!PANEL_INSPECTOR_TABS.includes(tab))tab='generation';
 for(const button of host.querySelectorAll('[data-panel-inspector-tab]')){const active=button.dataset.panelInspectorTab===tab;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;if(active&&focus)button.focus({preventScroll:true});}
 for(const pane of host.querySelectorAll('[data-panel-inspector-pane]'))pane.hidden=pane.dataset.panelInspectorPane!==tab;
 if(resetScroll)host.closest('.inspector')?.scrollTo({top:0});
}
export function mountPanelInspectorNavigation(host){
 host.addEventListener('click',event=>{const button=event.target.closest('[data-panel-inspector-tab]');if(button)showPanelInspectorTab(host,button.dataset.panelInspectorTab,{resetScroll:true});});
 host.addEventListener('keydown',event=>{const button=event.target.closest('[data-panel-inspector-tab]');if(!button)return;const keys=['ArrowRight','ArrowLeft','Home','End'];if(!keys.includes(event.key))return;event.preventDefault();const i=PANEL_INSPECTOR_TABS.indexOf(button.dataset.panelInspectorTab),index=event.key==='Home'?0:event.key==='End'?3:(i+(event.key==='ArrowRight'?1:3))%4;showPanelInspectorTab(host,PANEL_INSPECTOR_TABS[index],{focus:true,resetScroll:true});});
}
