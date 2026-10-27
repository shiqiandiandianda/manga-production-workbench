export async function requestJSON(url,options={}, {timeoutMs=10000,fetchImpl=fetch,controller=new AbortController()}={}){
  const timer=setTimeout(()=>controller.abort('timeout'),timeoutMs);
  try{
    const response=await fetchImpl(url,{...options,signal:controller.signal});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'请求未完成，请重试');return result;
  }catch(error){if(controller.signal.aborted)throw new Error(controller.signal.reason==='timeout'?'等待超时，请重试或直接填写保存目录':'已取消读取');throw error;}
  finally{clearTimeout(timer);}
}
export class FolderPicker {
  constructor(dialog,{read=path=>requestJSON('/repair/api/storage/folders?path='+encodeURIComponent(path)),onClose=()=>{}}={}){
    this.dialog=dialog;this.read=read;this.onClose=onClose;this.token=0;this.path='';this.selected=null;this.busy=false;
    const find=id=>dialog.querySelector('#'+id);this.location=find('folder-location');this.list=find('folder-list');this.status=find('folder-picker-status');this.destination=find('folder-destination');this.confirm=find('folder-confirm');this.up=find('folder-up');this.drives=find('folder-drive');
    find('folder-cancel').addEventListener('click',()=>this.finish(null));find('folder-close').addEventListener('click',()=>this.finish(null));
    dialog.addEventListener('cancel',event=>{event.preventDefault();this.finish(null);});
    this.confirm.addEventListener('click',()=>{if(!this.busy&&this.selected)this.finish(this.selected);});
    find('folder-open').addEventListener('click',()=>void this.load(this.location.value.trim()));
    this.location.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void this.load(this.location.value.trim());}});
    this.up.addEventListener('click',()=>void this.load(this.parent||''));
    find('folder-roots').addEventListener('click',()=>void this.load(''));
    find('folder-retry').addEventListener('click',()=>void this.load(this.requestedPath));
    this.drives.addEventListener('change',()=>void this.load(this.drives.value));
  }
  open(path=''){
    if(this.resolve){this.dialog.focus();return Promise.resolve(null);}
    this.dialog.showModal();const result=new Promise(resolve=>this.resolve=resolve);void this.load(path);return result;
  }
  finish(path){if(!this.resolve)return;this.token++;const resolve=this.resolve;this.resolve=null;this.dialog.close();this.onClose();resolve(path);}
  choose(path){
    this.selected=path;this.destination.textContent=path||'请先打开一个文件夹';
    this.confirm.disabled=this.busy||!path;
    for(const row of this.list.querySelectorAll('[data-folder]'))row.classList.toggle('selected',row.dataset.folder===path);
  }
  async load(path){
    const token=++this.token;this.requestedPath=path;this.busy=true;this.confirm.disabled=true;this.location.value=path;
    this.status.textContent='正在读取文件夹…';this.dialog.querySelector('#folder-retry').hidden=true;
    this.list.replaceChildren();this.choose(null);
    try{
      const data=await this.read(path);if(token!==this.token||!this.resolve)return;
      this.path=data.path;this.parent=data.parent;this.location.value=data.path;this.up.disabled=data.root;
      this.drives.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='选择磁盘';this.drives.append(placeholder);
      for(const drive of data.drives){const option=document.createElement('option');option.value=drive.path;option.textContent=drive.name;this.drives.append(option);}
      this.drives.value=data.drives.find(drive=>data.path.toLowerCase().startsWith(drive.path.toLowerCase()))?.path||'';
      for(const folder of data.folders){
        const row=document.createElement('div');row.className='folder-row';row.dataset.folder=folder.path;
        const select=document.createElement('button');select.type='button';select.className='folder-select';select.title='单击选择 · 双击进入';
        const icon=document.createElement('img');icon.src='/repair/icons/folder-open.svg';icon.alt='';const name=document.createElement('span');name.textContent=folder.name;select.append(icon,name);
        select.addEventListener('click',()=>this.choose(folder.path));select.addEventListener('dblclick',()=>void this.load(folder.path));
        const enter=document.createElement('button');enter.type='button';enter.className='folder-enter';enter.textContent='进入';enter.setAttribute('aria-label','进入文件夹 '+folder.name);enter.addEventListener('click',()=>void this.load(folder.path));
        row.append(select,enter);this.list.append(row);
      }
      if(!data.folders.length){const empty=document.createElement('p');empty.className='folder-empty';empty.textContent='这个文件夹没有子文件夹，可以直接选择当前文件夹。';this.list.append(empty);}
      this.busy=false;this.choose(data.path||null);this.status.textContent=data.root?'选择磁盘，或在上方输入完整文件夹路径。':'单击选中子文件夹，双击进入；也可以直接选择当前文件夹。';
    }catch(error){
      if(token!==this.token||!this.resolve)return;this.busy=false;this.up.disabled=false;this.parent='';this.choose(null);this.status.textContent=error.message;
      this.dialog.querySelector('#folder-retry').hidden=false;
    }
  }
}
