"""Readiness planning and partial-success enqueue for main/support production."""
import copy
import hashlib
import json
from collections import Counter

KINDS={'base','outfit','hands_auto','combine'}


def _exists(app,url,cache):
    if not url:return False
    if url in cache:return cache[url]
    try:
        from PIL import Image
        path=app.file_path(url)
        if not path.is_file():return False
        with Image.open(path) as image:image.verify()
        cache[url]=True
    except (OSError,ValueError,__import__('server').APIError):cache[url]=False
    return cache[url]


def _version_ready(app,project,outfit,field):
    version=outfit.get(field)
    if not version:return True
    try:
        from types import SimpleNamespace
        from output_versions import validate_source_version
        validate_source_version(SimpleNamespace(asset_path=app.file_path,style_of=lambda p:p.get('style','国漫')),project,version)
        return True
    except (ValueError,OSError,__import__('server').APIError):return False


def _same_target(job,pid,cid,profile_id,outfit_id=None):
    return job.get('projectId')==pid and job.get('characterId')==cid and job.get('appearanceProfileId')==profile_id and (outfit_id is None or job.get('outfitId')==outfit_id)


def _producer(app,target,field):
    pid,cid,profile_id,oid=(target.get(k) for k in ('projectId','characterId','appearanceProfileId','outfitId'))
    ordinary={'card':{'outfit','pipeline'},'hands':{'hands','hands_auto','pipeline'},'base':{'base','pipeline'}}[field]
    for job in reversed(app.state['jobs']):
        if job.get('status') not in {'queued','running'} or job.get('projectId')!=pid:continue
        if job.get('kind')=='project_auto':
            owners=job.get('resourceCharacterIds')
            if owners is None or cid in owners:return job
        if job.get('kind') not in ordinary or not _same_target(job,pid,cid,profile_id,oid if field!='base' else None):continue
        return job
    return None


def _enumerate(project,kind,items,character_ids,profile_ids,outfit_ids):
    if items is not None:return items
    result=[]
    for char in project.get('characters',[]):
        if character_ids is not None and char['id'] not in character_ids:continue
        profiles=char.get('appearanceProfiles',[])
        for profile in profiles:
            if profile_ids is not None and profile['id'] not in profile_ids:continue
            if kind=='base':result.append({'characterId':char['id'],'appearanceProfileId':profile['id']})
            else:
                for outfit in char.get('outfits',[]):
                    if outfit.get('appearanceProfileId')!=profile['id']:continue
                    if outfit_ids is not None and outfit['id'] not in outfit_ids:continue
                    result.append({'characterId':char['id'],'appearanceProfileId':profile['id'],'outfitId':outfit['id']})
    return result


def _request(app,payload):
    from server import APIError
    kind=payload.get('kind')
    if not isinstance(kind,str) or kind not in KINDS:raise APIError('批量制作请选择身体底稿、服装卡、手部动作或合成。')
    project=app.project(payload.get('projectId'))
    force=payload.get('force',False)
    if not isinstance(force,bool):raise APIError('重做选项需要布尔值。')
    items=payload.get('items')
    if items is not None and (not isinstance(items,list) or len(items)>500):raise APIError('批量选择需要列表，最多500项。')
    filters=[]
    for name in ('characterIds','appearanceProfileIds','outfitIds'):
        value=payload.get(name)
        if value is not None and (not isinstance(value,list) or any(not isinstance(x,str) for x in value) or len(set(value))!=len(value)):raise APIError('筛选编号需要不重复的列表。')
        filters.append(value)
    selected=_enumerate(project,kind,items,*filters)
    if len(selected)>500:raise APIError('批量目标超过500项，请缩小人物或服装范围。')
    return project,kind,force,selected


def plan_batch(app,payload):
    from server import APIError,text_value,template_info
    from life_stages import get_profile
    project,kind,force,selected=_request(app,payload)
    cache={};result=[];seen=set()
    instructions=text_value(payload.get('instructions',''),'批量任务说明',30000)
    for index,item in enumerate(selected):
        entry={'key':'invalid_'+str(index),'target':{},'status':'error','reason':'','dependsOn':[],'payload':None}
        try:
            if not isinstance(item,dict):raise APIError('每个目标需要包含人物、时期和服装编号。')
            char=app.character(project,item.get('characterId'))
            profile_id=item.get('appearanceProfileId')
            outfit=app.outfit(char,item.get('outfitId')) if kind!='base' else None
            profile=get_profile(char,profile_id or (outfit or {}).get('appearanceProfileId') or char.get('defaultAppearanceProfileId'))
            if not profile:raise APIError('未找到所选人物时期。',404)
            if kind=='base' and item.get('outfitId'):raise APIError('身体底稿按人物时期制作，不需要服装编号。')
            if outfit and outfit.get('appearanceProfileId')!=profile['id']:raise APIError('服装不属于所选人物时期。')
            target={'projectId':project['id'],'characterId':char['id'],'characterName':char['name'],'category':char.get('category','配角'),
                'appearanceProfileId':profile['id'],'profileName':profile.get('name','当前时期')}
            if outfit:target.update(outfitId=outfit['id'],outfitName=outfit['name'])
            key=':'.join([kind,char['id'],profile['id'],(outfit or {}).get('id','')]);entry.update(key=key,target=target)
            if key in seen:entry.update(status='excluded',reason='同一批次目标重复，已保留前一项。');result.append(entry);continue
            seen.add(key)
            job_payload={'kind':kind,'projectId':project['id'],'characterId':char['id'],'appearanceProfileId':profile['id'],'style':project['style'],'instructions':instructions}
            if outfit:job_payload['outfitId']=outfit['id']
            if item.get('clientRequestId') is not None:job_payload['clientRequestId']=item['clientRequestId']
            entry['payload']=job_payload
            if char.get('category')=='群像':entry.update(status='excluded',reason='群像流程需先完成示范并确认，本批次只制作主角和配角。');result.append(entry);continue
            active=next((j for j in reversed(app.state['jobs']) if j.get('status') in {'queued','running'} and j.get('kind')==kind and _same_target(j,project['id'],char['id'],profile['id'],(outfit or {}).get('id'))),None)
            if active:entry.update(status='active',reason='同一目标已有等待或运行任务。',job=copy.deepcopy(active));result.append(entry);continue
            head_pending=any(profile.get(k) for k in ('identityReviewPending','headIdentityReviewPending','headPreparationPending','hairReviewPending','legacyHeadReviewPending'))
            head_ready=_exists(app,profile.get('face'),cache) and profile.get('faceApproved') is True and not head_pending and profile.get('faceStyle',project['style'])==project['style'] and profile.get('headContractVersion')==template_info()['version']
            body_ready=_exists(app,profile.get('base'),cache) and profile.get('baseApproved') is True and profile.get('baseStyle',project['style'])==project['style'] and head_ready
            card_ready=bool(outfit and _exists(app,outfit.get('card'),cache) and not outfit.get('semanticReviewPending') and not outfit.get('appearanceProfileReviewPending') and (not outfit.get('cardAppearanceProfileId') or outfit['cardAppearanceProfileId']==profile['id']) and not head_pending and _version_ready(app,project,outfit,'cardSourceVersion'))
            hands_ready=bool(outfit and card_ready and _exists(app,outfit.get('hands'),cache) and _version_ready(app,project,outfit,'handsSourceVersion'))
            completed={'base':body_ready,'outfit':card_ready,'hands_auto':hands_ready,'combine':bool(hands_ready and _exists(app,outfit.get('combined'),cache) and _version_ready(app,project,outfit,'combinedSourceVersion'))}[kind]
            if completed and not force:entry.update(status='completed',reason='当前目标已完成，默认跳过；可选择重做。');result.append(entry);continue
            reasons=[];dependencies=[]
            if kind=='base' and not head_ready:reasons.append('请先确认并整理本时期完整头部；批量操作不会自动选脸或确认旧图。')
            if kind=='outfit' and not body_ready:reasons.append('请先完成并确认本时期身体底稿和完整头部。')
            if kind in {'hands_auto','combine'}:
                card_job=_producer(app,target,'card')
                if card_job:dependencies.append(card_job['id'])
                elif not card_ready:reasons.append('缺少可用的服装角色卡；先生成或加入服装卡制作任务。')
            if kind=='combine':
                hands_job=_producer(app,target,'hands')
                if hands_job:dependencies.append(hands_job['id'])
                elif not hands_ready:reasons.append('缺少配套手部图；先生成或加入手部制作任务。')
            if reasons:entry.update(status='missing',reason=' '.join(reasons))
            else:
                dependencies=list(dict.fromkeys(dependencies));job_payload['dependsOn']=dependencies
                entry.update(status='waiting' if dependencies else 'ready',dependsOn=dependencies,reason='前置任务完成后自动开始。' if dependencies else '前置素材可用，可以加入制作队列。')
        except (APIError,ValueError,TypeError) as exc:entry.update(status='error',reason=str(exc))
        result.append(entry)
    return {'projectId':project['id'],'kind':kind,'force':force,'items':result,'summary':dict(Counter(row['status'] for row in result)),
        'maximumConcurrency':app.settings().get('maxConcurrentJobs',8),'crowdNote':'本次批量入口仅适用于主角和配角；群像流程等待示范确认。'}


def enqueue_batch(app,payload):
    from server import APIError,ID_RE
    plan=plan_batch(app,payload);result=[]
    batch_id=payload.get('batchId')
    if batch_id is not None and (not isinstance(batch_id,str) or not ID_RE.fullmatch(batch_id)):raise APIError('批次编号格式不正确。')
    for row in plan['items']:
        response={'key':row['key'],'target':copy.deepcopy(row['target']),'status':'skipped','planStatus':row['status'],'reason':row['reason']}
        if row['status']=='error':response['status']='error'
        elif row['status'] in {'ready','waiting'}:
            try:
                job_payload=copy.deepcopy(row['payload'])
                if batch_id and not job_payload.get('clientRequestId'):job_payload['clientRequestId']='batch_'+hashlib.sha256((batch_id+':'+row['key']).encode()).hexdigest()[:48]
                job=app.enqueue(job_payload);response.update(status='duplicate' if job.get('duplicate') else 'enqueued',job=job,reason='同一请求已存在。' if job.get('duplicate') else '已分别加入队列。')
            except (APIError,ValueError,TypeError,OSError) as exc:response.update(status='error',reason=str(exc))
        elif row.get('job'):response['job']=copy.deepcopy(row['job'])
        result.append(response)
    return {'projectId':plan['projectId'],'kind':plan['kind'],'items':result,'summary':dict(Counter(row['status'] for row in result)),
        'maximumConcurrency':plan['maximumConcurrency'],'crowdNote':plan['crowdNote']}
