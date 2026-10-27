"""Opt-in local recycling maintenance with reference and file-version protection."""
import copy
import hashlib
import json
import re
from datetime import datetime,timedelta,timezone
from pathlib import Path
from urllib.parse import unquote

DEFAULTS={'enabled':False,'retentionDays':30,'time':'09:00'}
TZ=timezone(timedelta(hours=8))

def config(app):return {**DEFAULTS,**app.state.get('materialRecycleSettings',{})}

def update_settings(app,payload):
    from server import APIError
    if not isinstance(payload,dict) or set(payload)-set(DEFAULTS):raise APIError('回收站设置不正确。')
    values={**config(app),**payload}
    if not isinstance(values['enabled'],bool):raise APIError('定期清理开关需要是布尔值。')
    days=values['retentionDays']
    if isinstance(days,bool) or not isinstance(days,int) or not 1<=days<=3650:raise APIError('保留天数请填写1至3650的整数。')
    if not isinstance(values['time'],str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',values['time']):raise APIError('清理时间请使用HH:MM格式。')
    app.state['materialRecycleSettings']=values;app.save();app.wake.set();return copy.deepcopy(values)

def _time(value):
    try:
        result=datetime.fromisoformat(value.replace('Z','+00:00'))
        return result if result.tzinfo else result.replace(tzinfo=TZ)
    except (AttributeError,TypeError,ValueError):return None

def _safe_path(app,url):
    from server import APIError
    if not isinstance(url,str) or not url.startswith('/files/'):raise APIError('文件路径不正确。',409)
    data=app.data.resolve();raw=data/unquote(url[len('/files/'):]);path=app.file_path(url)
    if not any(path.is_relative_to(data/folder) for folder in ('assets','generated')):raise APIError('文件不在本工具图片目录内。',409)
    # Never follow filesystem links or Windows junctions, including directory ancestors.
    if raw.is_symlink() or raw.is_junction():raise APIError('链接文件不会清理。',409)
    for parent in raw.parents:
        if parent==data:break
        if parent.is_symlink() or parent.is_junction():raise APIError('链接目录不会清理。',409)
    if path.suffix.lower() not in {'.png','.jpg','.jpeg','.webp'}:raise APIError('只清理回收站关联的图片文件。',409)
    return path

def _protected(app,selected_ids):
    from material_library import urls
    result=urls({k:v for k,v in app.state.items() if k not in {'materialRecycleBin','materialCleanupHistory'}})
    result|=urls([entry for entry in app.state.get('materialRecycleBin',[]) if entry['id'] not in selected_ids])
    # Detached-character and other live archives may preserve references outside state.json.
    archives=app.data/'archives'
    if archives.exists():
        for path in archives.rglob('*.json'):
            if path.is_symlink():continue
            try:result|=urls(json.loads(path.read_text(encoding='utf-8-sig')))
            except (OSError,ValueError):
                # Unknown archive contents mean no physical deletion, rather than a guessed reference graph.
                return None
    return result

def plan(app,mode='expired',local_time=None):
    from server import APIError
    from material_library import urls,revision
    from resource_control import file_hash
    if mode not in {'expired','all'}:raise APIError('请选择清理到期素材或清空回收站。')
    current=local_time or datetime.now(TZ);cutoff=current-timedelta(days=config(app)['retentionDays'])
    entries=[]
    for entry in app.state.get('materialRecycleBin',[]):
        deleted=_time(entry.get('deletedAt'))
        if mode=='all' or deleted and deleted<=cutoff:entries.append(entry)
    selected={e['id'] for e in entries};protected=_protected(app,selected)
    candidates=set().union(*(urls(e['item']) for e in entries)) if entries else set()
    protected_paths=set()
    if protected is not None:
        for url in protected:
            try:protected_paths.add(str(app.file_path(url)).casefold())
            except (OSError,ValueError,APIError):pass
    files=[];retained=[]
    for url in sorted(candidates):
        try:
            path=_safe_path(app,url)
            if not path.is_file():continue
            if protected is None or str(path).casefold() in protected_paths:
                retained.append({'url':url,'reason':'项目、素材、制作记录或归档仍在引用'});continue
            hashes=[e.get('fileHashes',{}).get(url) for e in entries if url in urls(e['item'])]
            digest=file_hash(path)
            if not hashes or any(h!=digest for h in hashes):
                retained.append({'url':url,'reason':'删除后图片内容已变化或未记录校验值'});continue
            files.append({'url':url,'sha256':digest,'bytes':path.stat().st_size})
        except (OSError,ValueError,APIError):retained.append({'url':url,'reason':'文件路径不可安全清理'})
    from material_library import mentions
    active=[j['id'] for j in app.state['jobs'] if j.get('status') in {'running','queued'} and
            (mentions(j,{e['item']['id'] for e in entries}|candidates) or
             j.get('projectId') and any(mentions(p,candidates|{e['item']['id'] for e in entries}) for p in app.state['projects'] if p['id']==j['projectId']))]
    version=revision({'entries':entries,'files':files,'retained':retained,'active':active,'settings':config(app)})
    return {'mode':mode,'version':version,'entryIds':sorted(selected),'count':len(entries),'files':files,'fileCount':len(files),
            'bytes':sum(f['bytes'] for f in files),'retainedFiles':retained,'activeJobs':active,'canClean':not active}

def clean(app,mode='expired',version=None,local_time=None,scheduled=False):
    from server import APIError,now
    from resource_control import file_hash
    with app.lock:
        preview=plan(app,mode,local_time)
        if not scheduled and version!=preview['version']:raise APIError('回收站或图片引用已变化，请重新预览清理范围。',409)
        if preview['activeJobs']:raise APIError('回收站素材正在被任务使用，请完成后再清理。',409)
        selected=set(preview['entryIds']);previous=app.state.get('materialRecycleBin',[])
        app.state['materialRecycleBin']=[e for e in previous if e['id'] not in selected]
        # Persist removal first. If interrupted afterwards, files remain as harmless orphans.
        try:app.save()
        except Exception:app.state['materialRecycleBin']=previous;raise
        removed=0;freed=0;errors=[]
        for item in preview['files']:
            try:
                path=_safe_path(app,item['url'])
                if path.is_file() and file_hash(path)==item['sha256']:
                    path.unlink();removed+=1;freed+=item['bytes']
            except (OSError,ValueError,APIError):errors.append('有图片暂时无法清理，已保留文件。')
        record={'at':now(),'mode':mode,'scheduled':scheduled,'removedEntries':preview['count'],'removedFiles':removed,
                'freedBytes':freed,'retainedFiles':len(preview['retainedFiles']),'errors':errors[:10]}
        app.state.setdefault('materialCleanupHistory',[]).append(record)
        app.state['materialCleanupHistory']=app.state['materialCleanupHistory'][-20:]
        app.save();return copy.deepcopy(record)

def schedule(app,local_time=None):
    local_time=local_time or datetime.now(TZ)
    with app.lock:
        values=config(app)
        if not values['enabled'] or local_time.strftime('%H:%M')<values['time']:return None
        day=local_time.strftime('%Y-%m-%d')
        if app.state.get('materialCleanupDate')==day:return None
        result=clean(app,local_time=local_time,scheduled=True)
        app.state['materialCleanupDate']=day;app.save();return result
