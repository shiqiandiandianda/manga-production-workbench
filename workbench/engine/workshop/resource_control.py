"""Bounded previews, memory admission, disk monitoring and compact integration data."""
import copy
import ctypes
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import tempfile
import threading
import time
from uuid import uuid4

DEFAULTS={'enabled':True,'previewsEnabled':True,'reserveMemoryMB':1024,'estimatedWorkerMB':256,'minimumFreeDiskGB':2,'thumbnailCacheMB':256}
THUMB_LOCK=threading.Lock()
STATS_LOCK=threading.Lock()
STATS={}


def validate_settings(value,base=None):
    if not isinstance(value,dict) or set(value)-set(DEFAULTS):raise ValueError('资源控制设置不正确')
    result={**DEFAULTS,**(base or {}),**value}
    for key in ('enabled','previewsEnabled'):
        if not isinstance(result[key],bool):raise ValueError('资源控制开关需要是布尔值')
    for key,low,high in [('reserveMemoryMB',256,8192),('estimatedWorkerMB',64,2048),('minimumFreeDiskGB',1,100),('thumbnailCacheMB',32,2048)]:
        v=result[key]
        if isinstance(v,bool) or not isinstance(v,int) or not low<=v<=high:raise ValueError('资源阈值超出允许范围：'+key)
    return result


class MemoryStatus(ctypes.Structure):
    _fields_=[('length',ctypes.c_uint32),('load',ctypes.c_uint32)]+[(n,ctypes.c_ulonglong) for n in ['total','available','totalPage','availablePage','totalVirtual','availableVirtual','extended']]

class MemoryCounters(ctypes.Structure):
    _fields_=[('cb',ctypes.c_uint32),('faults',ctypes.c_uint32)]+[(n,ctypes.c_size_t) for n in ['peakWS','ws','peakPaged','paged','peakNonpaged','nonpaged','page','peakPage','private']]

def system_memory():
    if os.name!='nt':return {'availableMB':None,'totalMB':None,'serviceMB':None}
    from ctypes import wintypes
    status=MemoryStatus();status.length=ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):return {'availableMB':None,'totalMB':None,'serviceMB':None}
    info=MemoryCounters();info.cb=ctypes.sizeof(info);kernel=ctypes.windll.kernel32;kernel.GetCurrentProcess.restype=wintypes.HANDLE
    psapi=ctypes.windll.psapi;psapi.GetProcessMemoryInfo.argtypes=[wintypes.HANDLE,ctypes.POINTER(MemoryCounters),wintypes.DWORD]
    ok=psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(),ctypes.byref(info),info.cb)
    return {'availableMB':round(status.available/1048576,1),'totalMB':round(status.total/1048576,1),'serviceMB':round(info.ws/1048576,1) if ok else None}


def admission(data,settings,active=0):
    config=settings.get('resourceControl')
    if not config or not config.get('enabled'):return {'allowed':True,'reason':''}
    config=validate_settings({},config);mem=system_memory();free=shutil.disk_usage(data).free/1073741824
    needed=config['reserveMemoryMB']+config['estimatedWorkerMB']*(max(0,active)+1)
    if mem['availableMB'] is not None and mem['availableMB']<needed:
        return {'allowed':False,'reason':f"等待内存余量：可用约{mem['availableMB']/1024:.1f} GB，已在进行的任务继续完成",'memory':mem}
    if free<config['minimumFreeDiskGB']:
        return {'allowed':False,'reason':f'等待磁盘空间：数据盘可用约{free:.1f} GB','memory':mem}
    return {'allowed':True,'reason':'','memory':mem}


def folder_size(root):
    size=0
    if not root.is_dir() or root.is_symlink():return size
    for parent,dirs,files in os.walk(root,followlinks=False):
        dirs[:]=[d for d in dirs if not (Path(parent)/d).is_symlink()]
        for name in files:
            p=Path(parent)/name
            if p.is_symlink():continue
            try:size+=p.stat().st_size
            except OSError:pass
    return size


def cache_root(data):
    root=Path(data)/'cache/thumbnails'
    if root.is_symlink() or not root.resolve().is_relative_to(Path(data).resolve()):raise ValueError('预览缓存目录位置无效')
    root.mkdir(parents=True,exist_ok=True);return root


def clean_previews(data,maximum_mb=0):
    root=cache_root(data);rows=[]
    for p in root.glob('*.webp'):
        if not re.fullmatch(r'[a-f0-9]{64}\.webp',p.name) or p.is_symlink() or not p.is_file() or not p.resolve().is_relative_to(root.resolve()):continue
        stat=p.stat();rows.append((stat.st_mtime,stat.st_size,p))
    total=sum(row[1] for row in rows);deleted=0;freed=0
    for _,size,path in sorted(rows,key=lambda r:r[0]):
        if total<=maximum_mb*1048576:break
        path.unlink();total-=size;freed+=size;deleted+=1
    with STATS_LOCK:STATS.clear()
    return {'deleted':deleted,'freedMB':round(freed/1048576,2)}


def thumbnail(app,url,size=512):
    from PIL import Image,ImageOps
    from server import APIError
    path=app.file_path(url)
    if not path.is_file() or path.suffix.lower() not in {'.png','.jpg','.jpeg','.webp'}:raise APIError('预览图片不存在。',404)
    if isinstance(size,bool) or not isinstance(size,int) or not 64<=size<=768:raise APIError('预览尺寸需要为64—768。')
    root=cache_root(app.data);stat=path.stat();key=hashlib.sha256(f'{url}|{stat.st_size}|{stat.st_mtime_ns}|{size}'.encode()).hexdigest();target=root/(key+'.webp')
    with THUMB_LOCK:
        if target.is_file():
            if time.time()-target.stat().st_mtime>3600:os.utime(target,None)
            return target
        config=app.settings().get('resourceControl') or DEFAULTS
        with Image.open(path,formats=['PNG','JPEG','WEBP']) as raw:
            raw.draft('RGB',(size,size));raw=ImageOps.exif_transpose(raw);raw.thumbnail((size,size),Image.Resampling.LANCZOS)
            temp=root/(key+'.tmp');raw.save(temp,format='WEBP',quality=82,method=3);os.replace(temp,target)
        clean_previews(app.data,config.get('thumbnailCacheMB',256))
        return target


def overview(app,force=False):
    key=str(app.root.resolve())
    with STATS_LOCK:
        cached=STATS.get(key)
        if force or not cached or time.monotonic()-cached['at']>30:
            folders={k:round(folder_size(app.root/k)/1048576,1) for k in ['data/assets','data/generated','data/cache/thumbnails','data/temp','work','runtime']}
            STATS[key]={'at':time.monotonic(),'folders':folders}
        folders=copy.deepcopy(STATS[key]['folders'])
    disk=shutil.disk_usage(app.data);config=app.settings().get('resourceControl') or DEFAULTS
    with app.lock:
        jobs=app.state['jobs'];active=sum(j['status']=='running' for j in jobs)
        archives=copy.deepcopy(app.state.get('detachedCharacters',[]))
    return {'memory':system_memory(),'disk':{'freeGB':round(disk.free/1073741824,1),'totalGB':round(disk.total/1073741824,1),'foldersMB':folders,'dataDirectory':str(app.data)},'settings':config,'admission':admission(app.data,app.settings(),active),'activeJobs':active,'maximumConcurrentImages':app.settings().get('maxConcurrentJobs',8),'detachedCharacters':archives}


def compact_state(app):
    with app.lock:
        projects=[{k:p.get(k) for k in ['id','name','style','rangeStart','rangeEnd','updatedAt']}|{'characterCount':len(p.get('characters',[]))} for p in app.state['projects']]
        recent={j['id'] for j in app.state['jobs'][-10:]}
        jobs=[{k:copy.deepcopy(j.get(k)) for k in ['id','kind','name','projectId','status','phase','message','stepProgress','startedAt','finishedAt']}|{'components':{k:v.get('image') for k,v in (j.get('toolResult') or {}).get('components',{}).items() if v.get('status')=='completed'}} for j in app.state['jobs'] if j.get('status') in {'queued','running'} or j['id'] in recent]
        counts={}
        for i in app.state['library']:counts[i.get('kind','other')]=counts.get(i.get('kind','other'),0)+1
    return {'projects':projects,'jobs':jobs,'libraryCounts':counts,'settings':app.settings(),'origin':'http://127.0.0.1:4326','projectDetailEndpoint':'GET /api/projects/{id}'}


def state_etag(app):
    file=app.data/'state.json';stat=file.stat()
    active=sum(j['status']=='running' for j in app.state['jobs']);pressure=admission(app.data,app.settings(),active)['allowed']
    value=[stat.st_mtime_ns,stat.st_size,app.runtime,app.settings(),pressure]
    return '"'+hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()+'"'


def export_temp(app):
    root=app.data/'temp/exports'
    if root.is_symlink() or not root.resolve().is_relative_to(app.data.resolve()):raise ValueError('导出临时目录无效')
    root.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(prefix='export-',suffix='.zip',dir=root);os.close(fd)
    return Path(name)


def file_hash(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()

def store_upload(app,raw,extension):
    from server import new_id
    from worker import atomic_json
    digest=hashlib.sha256(raw).hexdigest();index_path=app.data/'asset-hashes.json'
    with app.lock:
        try:index=json.loads(index_path.read_text(encoding='utf-8'))
        except (OSError,ValueError):
            index={}
            for p in (app.data/'assets').iterdir():
                if p.is_file() and not p.is_symlink() and p.suffix.lower() in {'.png','.jpg','.jpeg','.webp'}:index[file_hash(p)]=p.name
        name=index.get(digest)
        if isinstance(name,str) and Path(name).name==name:
            existing=app.data/'assets'/name
            if existing.is_file() and not existing.is_symlink() and file_hash(existing)==digest:return '/files/assets/'+name
        target=app.data/'assets'/(new_id('image')+extension);target.write_bytes(raw);index[digest]=target.name;atomic_json(index_path,index)
        return '/files/assets/'+target.name
