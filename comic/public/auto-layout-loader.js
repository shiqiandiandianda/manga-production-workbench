/** Keep toolbar entries immediate; load the optional workspace on first use. */
export function mountLazyAutoLayout(options){
 const button=document.createElement('button'),reflowButton=document.createElement('button');
 button.id='auto-layout-toggle';button.textContent='单格排版';button.title='选择话数与风格，单格排版并接回画布';
 reflowButton.id='screen-artwork-reflow-toggle';reflowButton.textContent='屏段排版（图片生成后）';reflowButton.title='检查本话成图并重排接回画布';
 document.querySelector('#display-menu').after(button,reflowButton);
 let pending;
 const load=()=>pending||=(import('./auto-layout-ui.js').then(({mountAutoLayout})=>mountAutoLayout({...options,button,reflowButton})).catch(error=>{pending=null;throw error;}));
 async function openForEpisode(number){try{return await(await load()).openForEpisode(number);}catch(error){options.toast(error.message,true);}}
 button.onclick=()=>openForEpisode();
 reflowButton.onclick=async()=>{try{const ui=await load();await ui.reflowButton.onclick();}catch(error){options.toast(error.message,true);}};
 return {button,reflowButton,openForEpisode};
}
