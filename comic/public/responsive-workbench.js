import {mountInspectorShortcut} from './inspector-shortcut.js';
import {mountFloatingCanvasTools} from './floating-canvas-tools.js';

// Move the existing controls, preserving their listeners and editing semantics.
export function mountResponsiveWorkbench({onOpenInspector,getInspectorState,onAddNode,onDeleteNode}={}){
 const $=selector=>document.querySelector(selector),toolbar=$('.canvas-toolbar'),tools=$('.tools');
 document.body.classList.add('unified-workbench');
 const menus=[];
 function menu(host,id,label){
  const root=document.createElement('details');root.className='workbench-menu';root.id=id;
  const summary=document.createElement('summary');summary.textContent=label;summary.setAttribute('role','button');summary.setAttribute('aria-expanded','false');
  const panel=document.createElement('div');panel.className='workbench-menu-panel';root.append(summary,panel);host.append(root);menus.push(root);
  root.addEventListener('toggle',()=>{summary.setAttribute('aria-expanded',String(root.open));if(root.open){for(const other of menus)if(other!==root)other.open=false;position(root);if(id==='edit-menu')requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));}});
  return panel;
 }
 function move(host,...selectors){for(const selector of selectors){const node=$(selector);if(node)host.append(node);}}
 function caption(host,text){const node=document.createElement('span');node.className='menu-caption';node.textContent=text;host.append(node);}
 function position(root){const panel=root.lastElementChild,box=root.firstElementChild.getBoundingClientRect(),width=Math.min(320,innerWidth-24);panel.style.width=width+'px';panel.style.left=Math.max(12,Math.min(innerWidth-width-12,box.left))+'px';panel.style.top=box.bottom+8+'px';panel.style.maxHeight=Math.max(120,innerHeight-box.bottom-24)+'px';}

 // Six stable editing entries. Detailed commands live in named groups.
 const insert=menu(tools,'insert-menu','＋ 添加');insert.id='insert-actions';
 caption(insert,'文字与素材');move(insert,'#add-bubble','[data-open-sfx]','#gradient-tool','[data-tool="insert-space"]');
 const edit=menu(tools,'edit-menu','编辑');
 caption(edit,'画面图层');move(edit,'#image-layer-copy','#image-layer-paste');
 caption(edit,'选择范围');for(const button of [...$('#select-all-menu').children])edit.append(button);
 const group=document.createElement('div');group.className='inline-frame-tools';group.dataset.placement='dock';move(edit,'#page-settings');
 $('#select-all-trigger').hidden=true;
 const view=menu(toolbar,'display-menu','视图');
 move(view,'#panel-notes-toggle','#panel-display-mode','#panel-info-toggle');
 $('#draft-toggle').hidden=true;
 $('#view-more').hidden=true;
 const right=$('.toolbar-right');toolbar.append(right);
 move(right,'#history-steps-toggle','#undo','#redo','#zoom');
 const properties=mountInspectorShortcut({host:right,onOpenInspector,getInspectorState});
 properties.button.querySelector('.properties-wide-label').textContent='属性';
 properties.button.title='打开当前对象属性 · 双击画格也可打开';

 const generate=$('.generation-actionbar');
 const generationPanel=menu(generate,'generation-menu','生图');
 move(generationPanel,'#generate-current-episode');
 for(const selector of ['#generate-current-panel','#prompt-source-batch','#reference-review-episode']){const node=$(selector);if(node)node.hidden=true;}
 $('#generate-current-episode').textContent='生成本话缺图';
 $('#generate-current-episode').classList.remove('primary');
 $('.topbar').insertBefore(generate,$('.export-wrap'));
 const footer=$('.job-heading');footer.insertBefore($('#generation-scope-status'),$('#job-latest-status'));
 const projectTools=menu($('.topbar'),'project-tools-menu','更多');
 move(projectTools,'.integration-actions');
 $('.export-wrap').after($('#project-tools-menu'));
 $('.workspace-controls').hidden=true;

 // Keep the controls intact in a movable palette above the layout canvas.
 const editor=$('.app-shell>.editor'),area=document.createElement('div');area.className='canvas-work-area';editor.before(area);area.append(editor);
 const dock=document.createElement('aside');dock.id='canvas-tool-dock';dock.className='canvas-tool-dock';dock.setAttribute('aria-label','排版常用工具');
 dock.innerHTML='<div class="canvas-tool-heading"><strong>常用工具</strong><button data-tool-size="smaller" aria-label="缩小工具栏">−</button><button data-tool-size="larger" aria-label="放大工具栏">＋</button><button data-close-canvas-tools aria-label="收起常用工具" title="收起常用工具">×</button></div><div class="canvas-tool-content"><div class="dock-primary-tools" role="group" aria-label="选择、格子与图片"></div></div>';
 const primary=dock.querySelector('.dock-primary-tools'),content=dock.querySelector('.canvas-tool-content'),rect=$('[data-tool="rect"]');rect.textContent='格子';rect.title='调整画格边框和裁切范围，图片与对白保持原位';$('[data-tool="move"]').title='选中和移动图层；拖动边角时遵守等比开关';
 primary.append($('[data-tool="move"]'),rect,$('[data-tool="image"]'));content.append(group);toolbar.prepend(tools);tools.style.width='auto';tools.style.flex='0 1 auto';area.append(dock);
 const nodeModes=document.createElement('div');nodeModes.className='dock-frame-modes';nodeModes.hidden=true;nodeModes.dataset.frameModes='';const nodes=$('[data-tool="nodes"]');nodes.textContent='自由节点';nodes.title='拖动节点调整画格轮廓，图片保持原位';nodeModes.append(nodes);primary.after(nodeModes);
 const oldMenu=$('.panel-tool-wrap');oldMenu.before($('#toolbar-add-panel'),$('[data-tool="mask"]'));oldMenu.remove();
 const nodeActions=document.createElement('div');nodeActions.className='dock-node-actions';nodeActions.dataset.nodeControls='';nodeActions.hidden=true;nodeActions.innerHTML='<button data-node-add aria-label="增加格子点">加点</button><button data-node-delete aria-label="删除格子点">删点</button><small>点击边线加点，选中节点后可删除</small>';nodeModes.after(nodeActions);nodeActions.querySelector('[data-node-add]').onclick=onAddNode;nodeActions.querySelector('[data-node-delete]').onclick=onDeleteNode;
 const creates=$('.layer-create');creates.classList.add('rail-create');creates.setAttribute('aria-label','新增图层');$('.workspace-rail').insertBefore(creates,$('[data-open-generation-settings]'));for(const [id,label] of [['layer-add','格子＋'],['layer-add-bubble','对白'],['layer-add-gradient','渐变']])$('#'+id).textContent=label;creates.querySelector('[data-open-sfx]').textContent='特效';
 const toggle=document.createElement('button');toggle.id='canvas-tools-toggle';toggle.textContent='常用工具';toggle.setAttribute('aria-controls',dock.id);toolbar.prepend(toggle);
 const floating=mountFloatingCanvasTools({dock,area,toolbar});
 function showTools(value){const changed=area.classList.contains('tools-collapsed')===value;area.classList.toggle('tools-collapsed',!value);toggle.setAttribute('aria-expanded',String(value));if(changed)window.dispatchEvent(new Event('resize'));}
 toggle.onclick=()=>showTools(area.classList.contains('tools-collapsed'));dock.querySelector('[data-close-canvas-tools]').onclick=()=>showTools(false);
 // Keep detailed frame controls visible on desktop and reopen them on selection.
 const small=matchMedia('(max-width:700px)'),openCanvasTools=()=>{if(!small.matches)showTools(true);};
 showTools(!small.matches);
 small.addEventListener('change',()=>showTools(!small.matches));
 primary.addEventListener('click',event=>{if(event.target.closest('[data-tool]'))openCanvasTools();});

 const compact=matchMedia('(max-width:1000px)'),viewCommands=[...view.children],mobileViewCaption=document.createElement('span');mobileViewCaption.className='menu-caption';mobileViewCaption.textContent='视图设置';
 function compactTools(){if(compact.matches){edit.append(mobileViewCaption,...viewCommands);}else{mobileViewCaption.remove();view.append(...viewCommands);}}
 compact.addEventListener('change',compactTools);compactTools();

 document.addEventListener('pointerdown',event=>{for(const root of menus)if(!root.contains(event.target))root.open=false;});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')for(const root of menus)root.open=false;});
 for(const root of menus)root.lastElementChild.addEventListener('click',event=>{if(event.target.closest('button,a')&&!event.target.closest('.inline-frame-tools'))root.open=false;});
 const resize=new ResizeObserver(()=>{document.documentElement.style.setProperty('--responsive-tools-bottom',Math.round(toolbar.getBoundingClientRect().bottom)+'px');for(const root of menus)if(root.open)position(root);});resize.observe(toolbar);
 return {group,floating,openCanvasTools,syncInspectorShortcut:properties.sync,inspectorShortcutButton:properties.button};
}
