// The browser's Save As dialog supplies the destination. Auto-save remains separate.
export function projectFileName(title){
 const base=String(title||'漫画工程').replace(/[<>:"/\\|?*\x00-\x1f]/gu,'_').replace(/[.\s]+$/u,'').slice(0,120)||'漫画工程';
 return base+'.json';
}
export async function saveProjectFile({projectId,title,chooseFile,flushSave,exportProject,currentProjectId,binding}){
 if(!binding&&typeof chooseFile!=='function')throw Error('当前浏览器不支持写回工程文件，请使用 Microsoft Edge 或 Chrome 打开工作台');
 let handle=binding?.handle;try{if(!handle)handle=await chooseFile({suggestedName:projectFileName(title),types:[{description:'JSON 工程文件',accept:{'application/json':['.json']}}],excludeAcceptAllOption:true});}catch(error){if(error?.name==='AbortError')return {cancelled:true};throw error;}
 if(currentProjectId()!==projectId)throw Error('工程已切换，未写入文件，请重新保存');
 if(!/\.json$/i.test(handle.name||''))throw Error('工程文件请使用 .json 扩展名');
 if(handle.requestPermission&&await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('未获得当前 JSON 文件的写入权限，工程尚未写入');
 if(currentProjectId()!==projectId)throw Error('工程已切换，未写入文件，请重新保存');
 await flushSave();if(currentProjectId()!==projectId)throw Error('保存期间工程已切换，未写入文件');
 const data=await exportProject(projectId);if(currentProjectId()!==projectId)throw Error('导出期间工程已切换，未写入文件');
 if(binding?.stamp&&handle.getFile){const file=await handle.getFile();if(file.lastModified!==binding.stamp.lastModified||file.size!==binding.stamp.size)throw Error('JSON 文件已被其他窗口或程序修改，为避免覆盖请重新导入文件');}
 const stream=await handle.createWritable();try{await stream.write(JSON.stringify(data));await stream.close();}catch(error){await stream.abort?.().catch(()=>{});throw error;}
 const file=handle.getFile?await handle.getFile():null;
 return {cancelled:false,name:handle.name||projectFileName(title),binding:{handle,stamp:file?{lastModified:file.lastModified,size:file.size}:null}};
}
