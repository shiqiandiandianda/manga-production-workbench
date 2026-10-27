"""Resource-aware queue selection, truthful progress and checkpoint delta merge."""
from __future__ import annotations
import copy
from datetime import datetime,timezone
import json

_MISSING=object()
PROJECT_EXCLUSIVE={'analyze','project_auto'}
APPEND_FIELDS={'productionHistory','identityHistory','faceCoreHistory','sourceDescriptionHistory','mergeHistory','warnings','analysisWarnings','importWarnings','semanticReviewLog','semanticReviews'}


def _copy(value):return value if value is _MISSING else copy.deepcopy(value)
def _same(left,right):return left is right if left is _MISSING or right is _MISSING else left==right

def _row_key(row,path):
    if not isinstance(row,dict):return None
    if row.get('id') is not None:return ('id',row['id'])
    if row.get('reference_id') is not None:return ('ref',row['reference_id'])
    if row.get('chapter') is not None:
        if path and path[-1]=='availableChapters':return ('chapter',row['chapter'],row.get('sourceHash'),row.get('member'))
        return ('chapter',row['chapter'])
    return None


def _merge(base,updated,live,path,conflicts):
    if _same(updated,base):return _copy(live)
    if _same(live,base) or _same(updated,live):return _copy(updated)
    if updated is _MISSING:
        conflicts.append({'path':'.'.join(map(str,path)),'reason':'删除时现有内容已变化，保留现有内容'})
        return _copy(live)
    if isinstance(updated,dict) and isinstance(live,dict) and (isinstance(base,dict) or base is _MISSING):
        baseline=base if isinstance(base,dict) else {};result={}
        for key in set(baseline)|set(updated)|set(live):
            value=_merge(baseline.get(key,_MISSING),updated.get(key,_MISSING),live.get(key,_MISSING),(*path,key),conflicts)
            if value is not _MISSING:result[key]=value
        return result
    if isinstance(updated,list) and isinstance(live,list) and (isinstance(base,list) or base is _MISSING):
        baseline=base if isinstance(base,list) else []
        rows=baseline+updated+live
        if rows and all(_row_key(row,path) is not None for row in rows):
            bm={_row_key(row,path):row for row in baseline};um={_row_key(row,path):row for row in updated};lm={_row_key(row,path):row for row in live}
            order=list(lm)+[key for key in um if key not in lm]
            result=[]
            for key in order:
                value=_merge(bm.get(key,_MISSING),um.get(key,_MISSING),lm.get(key,_MISSING),(*path,str(key)),conflicts)
                if value is not _MISSING:result.append(value)
            return result
        if path and (path[-1] in APPEND_FIELDS or path[-1] in {'episodes','aliases','identityNames'}):
            merged=copy.deepcopy(live)
            for row in updated:
                if row not in merged:merged.append(copy.deepcopy(row))
            return merged
        if len(updated)>=len(baseline) and len(live)>=len(baseline) and updated[:len(baseline)]==baseline and live[:len(baseline)]==baseline:
            merged=copy.deepcopy(live)
            for row in updated[len(baseline):]:
                if row not in merged:merged.append(copy.deepcopy(row))
            return merged
    if len(path)>=2 and path[-2]=='teamIdCounters' and all(isinstance(value,int) and not isinstance(value,bool) for value in (updated,live)):
        return max(updated,live)
    conflicts.append({'path':'.'.join(map(str,path)),'reason':'同时修改同一资料，保留当前值','current':'<removed>' if live is _MISSING else _copy(live),'attempted':_copy(updated)})
    return _copy(live)


def merge_project_delta(baseline,updated,live):
    if not all(isinstance(p,dict) for p in (baseline,updated,live)) or updated.get('id')!=live.get('id') or baseline.get('id')!=live.get('id'):
        raise ValueError('检查点项目编号不一致')
    conflicts=[];merged=_merge(baseline,updated,live,(),conflicts)
    # Each task analyzes its submitted scope, but never changes the user's
    # current scope solely because that older scope was supplied to the worker.
    for key in ('rangeStart','rangeEnd','readRange','rangeVerified','script'):
        if live.get(key)!=baseline.get(key):
            if key in live:merged[key]=copy.deepcopy(live[key])
            else:merged.pop(key,None)
    if merged.get('chapters'):
        start,end=merged.get('rangeStart',1),merged.get('rangeEnd',20)
        merged['script']='\n\n'.join(row.get('text','') for row in merged['chapters'] if start<=row['chapter']<=end)
    return {'project':merged,'conflicts':conflicts}


def concurrency_limit(settings):
    value=settings.get('maxConcurrentJobs',8)
    if isinstance(value,bool) or not isinstance(value,int) or not 1<=value<=8:return 8
    return value


def project_exclusive(job):
    return bool(job.get('projectId') and (job.get('kind')=='analyze' or job.get('kind')=='project_auto' and job.get('resourceMode')!='production'))


def _rw(mode,resource):return mode+':'+resource


def resource_keys(state,job):
    pid,cid,oid=job.get('projectId'),job.get('characterId'),job.get('outfitId')
    kind=job.get('kind')
    keys=[]
    if kind=='crowd_set':
        if job.get('crowdSetId'):keys.append(_rw('write','library:'+job['crowdSetId']))
        if pid and cid:keys.extend([_rw('write','crowdrole:'+pid+':'+cid),_rw('read','identity:'+pid+':'+cid)])
        return keys
    if job.get('libraryId') and kind in {'face_refine','hairstyle_preview'}:
        keys.append(_rw('write' if kind=='hairstyle_preview' else 'read','library:'+job['libraryId']))
    if not pid:return keys
    if project_exclusive(job):return keys+[_rw('write','project:'+pid)]
    project=next((p for p in state.get('projects',[]) if p['id']==pid),None)
    if kind=='project_auto':
        ids=job.get('resourceCharacterIds')
        ids=ids if isinstance(ids,list) else [c['id'] for c in (project or {}).get('characters',[]) if c.get('category')!='群像']
        for owner in ids:
            keys.extend(resource_keys(state,{**job,'kind':'pipeline','characterId':owner,'resourceMode':'production'}))
        return sorted(set(keys))
    if not cid:return keys
    char=next((c for c in (project or {}).get('characters',[]) if c['id']==cid),None)
    identity='identity:'+pid+':'+cid
    groups=['facegroup:'+pid+':'+p['faceIdentityGroupId'] for p in (char or {}).get('appearanceProfiles',[]) if p.get('faceIdentityGroupId')]
    identity_writers={'face','base','head_prepare','hair_apply','pipeline','library_face_core','library_hairstyle'}
    if kind=='extract_assets' and 'face_core' in job.get('parts',[]) and not job.get('autoCapture'):identity_writers.add('extract_assets')
    if kind=='extract_assets' and job.get('autoCapture'):keys.append(_rw('write','corestore:'+pid+':'+cid))
    profile=next((p for p in (char or {}).get('appearanceProfiles',[]) if p.get('id')==(job.get('appearanceProfileId') or (char or {}).get('defaultAppearanceProfileId'))),{})
    if kind in {'outfit','gestures','combine'} and (not profile.get('face') or any(profile.get(key) for key in ('headPreparationPending','legacyHeadReviewPending','identityReviewPending'))):identity_writers.add(kind)
    if kind=='base' and profile.get('face') and profile.get('faceApproved') is True and not any(profile.get(key) for key in ('headPreparationPending','legacyHeadReviewPending','identityReviewPending','headIdentityReviewPending','hairReviewPending')):
        identity_writers.discard('base')
    mode='write' if kind in identity_writers else 'read'
    keys.extend([_rw(mode,identity),*[_rw(mode,group) for group in groups]])
    profile_id=profile.get('id') or job.get('appearanceProfileId') or (char or {}).get('defaultAppearanceProfileId')
    body='body:'+pid+':'+cid+':'+str(profile_id)
    if kind=='base':keys.append(_rw('write',body))
    elif kind in {'outfit','hands','hands_auto','special','combine','clothing_extract'}:keys.append(_rw('read',body))
    target='outfit:'+pid+':'+cid+':'+str(oid)
    if kind=='outfit':keys.append(_rw('write',target+':card'))
    elif kind in {'hands','hands_auto'}:
        keys.extend([_rw('read',target+':card'),_rw('write',target+':hands')])
        if kind=='hands_auto':keys.extend([_rw('write',target+':gestures'),_rw('write',target+':combined')])
    elif kind=='special':keys.extend([_rw('read',target+':card'),_rw('write',target+':special:'+str(job.get('id','new')))])
    elif kind=='gestures':keys.append(_rw('write',target+':gestures'))
    elif kind=='combine':keys.extend([_rw('read',target+':card'),_rw('read',target+':hands'),_rw('write',target+':combined')])
    elif kind=='clothing_extract':keys.extend([_rw('read',target+':card'),_rw('write',target+':clothing')])
    if project and project.get('styleMode')!='manual' and not project.get('script') and not project.get('inputStyleResolved') and kind not in {'extract_assets','library_face_core','library_hairstyle','face_refine','hairstyle_preview'}:
        return [_rw('write','project:'+pid)]
    return sorted(set(keys))


def _parsed(key):
    if key.startswith(('read:','write:')):return key.split(':',1)
    return 'write',key


def resources_conflict(state,left,right):
    lk=left.get('resourceLocks') or resource_keys(state,left);rk=right.get('resourceLocks') or resource_keys(state,right)
    if left.get('projectId') and left.get('projectId')==right.get('projectId'):
        project='project:'+left['projectId']
        if any(_parsed(key)[1]==project for key in lk+rk):return True
    for a in lk:
        am,ar=_parsed(a)
        for b in rk:
            bm,br=_parsed(b)
            if (ar==br or ar.startswith(br+':') or br.startswith(ar+':')) and (am=='write' or bm=='write'):return True
    return False


def validate_dependencies(jobs,job_id,dependencies):
    if not isinstance(dependencies,list) or len(dependencies)>100 or any(not isinstance(x,str) for x in dependencies) or len(set(dependencies))!=len(dependencies):raise ValueError('依赖任务须为不重复的编号列表，最多100项')
    by_id={j['id']:j for j in jobs}
    for dep in dependencies:
        if dep not in by_id:raise ValueError('依赖任务不存在：'+dep)
    def visit(node,path):
        if node==job_id:raise ValueError('任务依赖形成循环，无法排队')
        if node in path:return
        for dep in by_id.get(node,{}).get('dependsOn',[]):visit(dep,path|{node})
    for dep in dependencies:visit(dep,set())
    return list(dependencies)


def _is_dependency(job,target_id,by_id,seen=None):
    seen=set() if seen is None else seen
    for dep in job.get('dependsOn',[]):
        if dep==target_id:return True
        if dep not in seen:
            seen.add(dep)
            if _is_dependency(by_id.get(dep,{}),target_id,by_id,seen):return True
    return False


def blocked_reason(state,job,limit=8):
    by_id={j['id']:j for j in state.get('jobs',[])}
    for dep_id in job.get('dependsOn',[]):
        dep=by_id.get(dep_id)
        if dep is None:return '前置任务不存在，请调整依赖'
        if dep.get('status') in {'failed','cancelled'}:return '前置任务失败或已取消，请先重试或调整依赖'
        if dep.get('status')!='completed':return '等待前置任务完成'
    running=[j for j in state.get('jobs',[]) if j.get('status')=='running' and j['id']!=job['id']]
    for active in running:
        if resources_conflict(state,job,active):
            if project_exclusive(job) or project_exclusive(active) or any(_parsed(key)[1].startswith('project:') for key in active.get('resourceLocks',resource_keys(state,active))):return '同项目正在分析或全流程制作，等待项目资料可用'
            if any(_parsed(key)[1].startswith('library:') for key in set(resource_keys(state,job)) & set(active.get('resourceLocks') or resource_keys(state,active))):return '同一库素材正在预览或微调，等待该素材完成'
            return '同一人物或关联五官正在制作，等待该素材完成'
    for earlier in state.get('jobs',[]):
        if earlier['id']==job['id']:break
        if earlier.get('status')=='queued' and project_exclusive(earlier) and earlier.get('projectId')==job.get('projectId') and not _is_dependency(earlier,job['id'],by_id):
            if all(by_id.get(dep,{}).get('status')=='completed' for dep in earlier.get('dependsOn',[])):
                return '等待排在前面的项目分析或全流程任务'
    if len(running)>=limit:return '并发名额已满，等待空闲位置'
    return ''


def next_job(state,limit):
    if sum(j.get('status')=='running' for j in state.get('jobs',[]))>=limit:return None
    return next((j for j in state.get('jobs',[]) if j.get('status')=='queued' and not blocked_reason(state,j,limit)),None)


def _timestamp(value):
    try:return datetime.fromisoformat(str(value).replace('Z','+00:00')).timestamp()
    except (ValueError,TypeError):return None


def progress_snapshot(job,utc_now=None):
    utc_now=datetime.now(timezone.utc).timestamp() if utc_now is None else utc_now
    started=_timestamp(job.get('startedAt'));finished=_timestamp(job.get('finishedAt'))
    elapsed=max(0,int((finished or utc_now)-started)) if started else 0
    details=copy.deepcopy(job.get('stepProgress') or {'completed':0,'total':None,'currentStep':job.get('phase','queued'),'steps':[]})
    completed,total=details.get('completed'),details.get('total')
    valid=isinstance(completed,int) and not isinstance(completed,bool) and isinstance(total,int) and not isinstance(total,bool) and total>0 and 0<=completed<=total
    return {'elapsedSeconds':elapsed,'stepProgress':details,'progressPercent':round(100*completed/total) if valid else None}


def source_input_version(app,job):
    """Pin read-only image sources, keeping the submitted chapter scope separate."""
    import hashlib
    if not job.get('projectId') or not job.get('characterId'):return None
    kind=job.get('kind')
    if kind not in {'base','outfit','gestures','hands','hands_auto','special','combine','clothing_extract'}:return None
    project=app.project(job['projectId']);char=app.character(project,job['characterId'])
    from life_stages import get_profile
    profile=get_profile(char,job.get('appearanceProfileId'))
    if not profile:return None
    def image(url):
        if not url:return {'url':'','sha256':''}
        try:
            path=app.file_path(url)
            digest=hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else 'missing'
        except (OSError,ValueError,__import__('server').APIError):digest='missing'
        return {'url':url,'sha256':digest}
    result={'projectId':project['id'],'characterId':char['id'],'appearanceProfileId':profile['id'],
        'faceIdentityGroupId':profile.get('faceIdentityGroupId'),'style':project.get('style'),
        'period':profile.get('period'),'ageStage':profile.get('ageStage'),
        'identityReviewPending':bool(profile.get('identityReviewPending')),'headPreparationPending':bool(profile.get('headPreparationPending')),
        'headIdentityReviewPending':bool(profile.get('headIdentityReviewPending')),'legacyHeadReviewPending':bool(profile.get('legacyHeadReviewPending')),
        'head':image(profile.get('face','')),'body':image(profile.get('base',''))}
    if kind in {'hands','hands_auto','special','combine','clothing_extract'}:
        outfit=app.outfit(char,job.get('outfitId'));result['card']=image(outfit.get('card') or (outfit.get('reference') if kind=='clothing_extract' else ''))
        if kind=='combine':result['hands']=image(outfit.get('hands'))
    result['hash']=hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()
    return result


def validate_output_delta(app,baseline,updated,merged):
    """Verify only newly written production outputs; legacy files stay retained."""
    from types import SimpleNamespace
    from output_versions import validate_source_version
    adapter=SimpleNamespace(asset_path=app.file_path,style_of=lambda project:project.get('style','国漫'))
    old_outfits={o['id']:o for c in baseline.get('characters',[]) for o in c.get('outfits',[])}
    for character in updated.get('characters',[]):
        for outfit in character.get('outfits',[]):
            previous=old_outfits.get(outfit['id'],{})
            for image_field,version_field in (('card','cardSourceVersion'),('hands','handsSourceVersion'),('combined','combinedSourceVersion')):
                version=outfit.get(version_field)
                if version and outfit.get(image_field) and (outfit.get(image_field)!=previous.get(image_field) or version!=previous.get(version_field)):
                    validate_source_version(adapter,merged,version)
            old_specials={special.get('id') or special.get('image'):special for special in previous.get('specials',[])}
            for special in outfit.get('specials',[]):
                version=special.get('sourceVersion')
                key=special.get('id') or special.get('image')
                if version and special.get('image') and special!=old_specials.get(key):validate_source_version(adapter,merged,version)
