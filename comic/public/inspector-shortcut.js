/** Explicitly opens properties for the live selection; it never toggles an already-open inspector shut. */
export const INSPECTOR_SHORTCUT_LABEL='详细属性';
export function inspectorShortcutState(value={}){return {enabled:value.enabled!==false,expanded:value.expanded===true};}
export function requestInspectorShortcut(getState,onOpen){if(!inspectorShortcutState(getState()).enabled)return false;onOpen();return true;}
export function mountInspectorShortcut({host,before=null,placement='toolbar',onOpenInspector,getInspectorState,document:doc=host.ownerDocument||globalThis.document}={}){
 const legacy=doc.querySelector('#inspector-toggle'),read=getInspectorState||(()=>({enabled:!!legacy&&!legacy.disabled,expanded:legacy?.getAttribute('aria-expanded')==='true'}));
 const open=onOpenInspector||(()=>{if(legacy&&!legacy.disabled&&legacy.getAttribute('aria-expanded')!=='true')legacy.click();});
 const button=doc.createElement('button');button.type='button';button.className='properties-shortcut properties-shortcut-'+placement;button.setAttribute('data-properties-shortcut',placement);button.setAttribute('aria-label',INSPECTOR_SHORTCUT_LABEL);button.setAttribute('aria-controls','inspector-panel');button.title='详细属性：打开当前选中格子、气泡或图层的属性；未选择对象时打开页面设置';
 button.innerHTML='<span class="properties-wide-label">详细属性</span><span class="properties-short-label" aria-hidden="true">属性</span>';
 if(before)host.insertBefore(button,before);else host.append(button);
 const sync=()=>{const state=inspectorShortcutState(read());button.disabled=!state.enabled;button.setAttribute('aria-expanded',String(state.expanded));button.classList.toggle('active',state.expanded);};
 const onClick=()=>{sync();requestInspectorShortcut(read,open);sync();};button.addEventListener('click',onClick);
 const Observer=doc.defaultView?.MutationObserver||globalThis.MutationObserver,observer=legacy&&Observer?new Observer(sync):null;observer?.observe(legacy,{attributes:true,attributeFilter:['aria-expanded','disabled']});sync();
 return {button,sync,open:onClick,destroy(){observer?.disconnect();button.removeEventListener('click',onClick);button.remove();}};
}
