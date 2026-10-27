export function mountProjectCenterUI({getProject,flushSave,toast}){
 const button=document.createElement('button');button.id='project-center-open';button.textContent='项目中心';button.title='请求同事帮忙生图、查看接单与结果';document.querySelector('.integration-actions').append(button);
 button.onclick=async()=>{const target=window.open('about:blank','_blank');if(target)target.opener=null;try{await flushSave();const project=getProject();const url='/project-center.html'+(project?'?project='+encodeURIComponent(project.id):'');if(target)target.location.href=url;else window.open(url,'_blank','noopener');}catch(e){target?.close();toast(e.message,true);}};
 return {close(){button.remove();}};
}
