"""Pure facial identity / hair libraries. Originals are never cropped in place."""
from __future__ import annotations
import copy
import hashlib
import json
import time
from uuid import uuid4

PURE_KINDS = ('face_core','hairstyle')
ERAS = ('ancient','modern','future','unspecified')
GENDERS = ('男','女','通用','未说明')
BASIS = ('source','inference','production_design','authorized_adaptation')
CHECK_SCHEMA = {'type':'object','properties':{'clean':{'type':'boolean'},'identityPreserved':{'type':'boolean'},'matchesOutputStyle':{'type':'boolean'},'issues':{'type':'string'}},
    'required':['clean','identityPreserved','matchesOutputStyle','issues'],'additionalProperties':False}


def pure_metadata(data, previous=None):
    from server import text_value,image_url,text_list,ID_RE,APIError
    from life_stages import AGE_STAGES
    result=copy.deepcopy(previous or {})
    for key in ('name','description','sourceDescription','designDescription'):
        if key in data:result[key]=text_value(data[key],'素材说明',30000,key=='name')
    result.setdefault('era','unspecified');result.setdefault('gender','未说明');result.setdefault('ageStage','unspecified')
    result.setdefault('sourceStyle','unknown');result.setdefault('outputStyle',data.get('style',''))
    for key in ('sourceStyle','outputStyle'):
        if key in data: result[key]=data[key]
    if result['sourceStyle'] not in ('comic','photo','3d','mixed','unknown'): raise APIError('来源图像风格分类无效。')
    result.setdefault('sourceDescription','');result.setdefault('sourceEvidence',[])
    result.setdefault('designDescription',data.get('description',''));result.setdefault('designBasis','production_design')
    for key,allowed in (('era',ERAS),('gender',GENDERS),('ageStage',AGE_STAGES),('designBasis',BASIS)):
        if key in data: result[key]=data[key]
        if result[key] not in allowed:raise APIError('纯脸／发型的时期、性别、年龄或依据分类不正确。')
    if 'sourceEvidence' in data:
        evidence=data['sourceEvidence']
        if not isinstance(evidence,list) or len(evidence)>100:raise APIError('来源证据须为列表。')
        for item in evidence:
            if not isinstance(item,dict) or not isinstance(item.get('quote',''),str):raise APIError('来源证据内容不正确。')
        result['sourceEvidence']=copy.deepcopy(evidence)
    if 'tags' in data:result['tags']=text_list(data['tags'],'素材标签',50,100)
    if 'image' in data:result['image']=image_url(data['image'])
    if 'libraryHairstyleId' in data:
        value=data['libraryHairstyleId']
        if value and (not isinstance(value,str) or not ID_RE.fullmatch(value)):raise APIError('发型素材编号不正确。')
        result['libraryHairstyleId']=value or ''
    if 'reviewPending' in data and not isinstance(data['reviewPending'],bool):raise APIError('发型核验状态需要布尔值。')
    return result


def validate_hairstyle(data, previous=None):
    from server import APIError
    if not isinstance(data,dict):raise APIError('发型资料需要是对象。')
    result=pure_metadata(data,previous or data)
    for key in ('sourceStyle','outputStyle'):
        if key not in data and key not in (previous or {}):result.pop(key,None)
    result.setdefault('image','');result.setdefault('libraryHairstyleId','')
    result.setdefault('reviewPending',False)
    for key in ('name','sourceDescription','sourceEvidence','designDescription','designBasis','era','gender','ageStage','image','libraryHairstyleId','reviewPending'):
        if key in data:result[key]=copy.deepcopy(data[key]) if key in ('sourceEvidence','reviewPending') else result[key]
    return result


def archive_outfit(outfit,reason):
    fields=('card','hands','combined','specials','clothingId','libraryClothingId','clothingImage','reference','style','gestures','gestureSources')
    snapshot={key:copy.deepcopy(outfit.get(key,[] if key in ('specials','gestures','gestureSources') else '')) for key in fields}
    if any(snapshot.get(key) for key in ('card','hands','combined','specials','clothingImage')):
        outfit.setdefault('productionHistory',[]).append({**snapshot,'reason':reason,'createdAt':time.time()})


def mark_head_pending(project, character, profile, reason):
    """Keep old files and active URLs as pending; do not silently change identity."""
    from life_stages import VISUAL_FIELDS
    old={key:profile.get(key,'') for key in ('face','base','faceCore')}
    if any(old.values()) and not profile.get('headPreparationPending'):
        profile.setdefault('identityHistory',[]).append({**old,'reason':reason,'at':time.time()})
    profile.update(headPreparationPending=True,hairReviewPending=True,faceApproved=False,baseApproved=False,headReviewStatus='pending')
    for outfit in character.get('outfits',[]):
        if outfit.get('appearanceProfileId')==profile['id']:
            outfit.update(semanticReviewPending=True,semanticReviewReason=reason,visualIdentityReviewPending=True)
    for reference in project.get('teamReferences',[]):
        if reference.get('asset_id')==profile.get('teamAssetId'):reference['review_status']='pending'
    if profile['id']==character.get('defaultAppearanceProfileId'):
        for key in VISUAL_FIELDS:
            if key in profile:character[key]=copy.deepcopy(profile[key])
        for key in ('headPreparationPending','hairReviewPending'):character[key]=profile[key]


def apply_core(project,character,profile_id,image,library_id='',style='',approved=False,preserve_source_head=False):
    from appearance_identity import refresh_visual_identity,set_face_core
    from life_stages import get_profile
    refresh_visual_identity(project)
    selected=get_profile(character,profile_id)
    if not selected:raise ValueError('没有找到指定人物时期')
    group=selected.get('faceIdentityGroupId')
    affected=[p for p in character.get('appearanceProfiles',[]) if p.get('faceIdentityGroupId')==group]
    for profile in affected:
        if profile.get('faceCore') != image and not (preserve_source_head and profile['id']==selected['id']):
            mark_head_pending(project,character,profile,'已更新纯脸身份，需整理本时期完整头部及相关素材。')
    set_face_core(project,character,selected['id'],image,library_id=library_id,style=style,approved=approved)
    for profile in affected:profile['headIdentityReviewPending']=False
    if any(p['id']==character.get('defaultAppearanceProfileId') for p in affected):
        character['headIdentityReviewPending']=False
        character['faceCoreReviewPending']=False
    return [p['id'] for p in affected]


def library_mutation(app,method,parts,payload):
    from server import APIError,library_record,image_url,now
    from life_stages import ensure_appearance_profiles,get_profile
    from appearance_identity import refresh_visual_identity
    if parts[:2]!=['api','library']:return False,None
    if len(parts)==3 and method=='PATCH':
        item=app.find(app.state['library'],parts[2],'素材')
        if item.get('kind') not in PURE_KINDS:return False,None
        fields={'name','description','style','image','era','gender','ageStage','sourceDescription','sourceEvidence','designDescription','designBasis','tags'}
        validated=library_record({**item,**{k:v for k,v in payload.items() if k in fields}})
        changed='image' in payload and validated['image']!=item.get('image')
        for key in fields:
            if key in payload:item[key]=validated[key]
        if changed:item.update(pureValidated=False,pureReviewStatus='pending')
        item['updatedAt']=now();app.save();return True,copy.deepcopy(item)
    if len(parts)==4 and method=='POST' and parts[3] in {'adopt','wear-hairstyle'}:
        item=app.find(app.state['library'],parts[2],'素材')
        if item.get('kind') not in PURE_KINDS:return False,None
        if (item['kind']=='face_core' and parts[3]!='adopt') or (item['kind']=='hairstyle' and parts[3]!='wear-hairstyle'):
            raise APIError('素材用途不匹配。')
        project=app.project(payload.get('projectId'));app.editable(project['id'],payload.get('characterId'))
        if item.get('style') != project.get('style') and not (payload.get('asReference') or payload.get('convertStyle')):
            raise APIError('素材风格与项目不同，请选择“作为转绘参考”；原始素材风格会保留，最终头部按项目漫画画风制作。')
        image=image_url(item.get('image',''))
        if not image or not app.file_path(image).is_file() or app.file_path(image).suffix.lower() not in {'.png','.jpg','.jpeg','.webp'}:raise APIError('素材图片文件不存在或格式错误。',404)
        char=app.character(project,payload.get('characterId'));ensure_appearance_profiles(project);refresh_visual_identity(project)
        profile=get_profile(char,payload.get('appearanceProfileId') or char.get('defaultAppearanceProfileId'))
        if not profile:raise APIError('未找到该角色的人物时期。',404)
        if item['kind']=='face_core':
            affected=apply_core(project,char,profile['id'],image,item['id'],item['style'],approved=bool(item.get('pureValidated')))
            message='纯脸身份已选用；同脸组共享五官，各时期发型保持独立。整理完整头部后继续制作。'
        else:
            hair=validate_hairstyle({**copy.deepcopy(profile.get('hairstyle') or {}),
                'name':item['name'],'image':image,'libraryHairstyleId':item['id'],'reviewPending':True,
                'designDescription':item.get('designDescription') or item.get('description',''), 'designBasis':'production_design'})
            hair.setdefault('designHistory',[]).append({'libraryId':item['id'],'classification':{key:item.get(key) for key in ('era','gender','ageStage')},
                'librarySourceDescription':item.get('sourceDescription',''),'librarySourceEvidence':copy.deepcopy(item.get('sourceEvidence',[])),
                'basis':'production_design','at':now()})
            profile['hairstyle']=hair;mark_head_pending(project,char,profile,'已选用新发型，旧图保留，需整理本时期头部与相关素材。');affected=[profile['id']]
            message='发型已选用，纯脸身份保留；本时期旧头部、身体和服装卡待核验。'
        project['updatedAt']=now();app.save()
        return True,{'projectId':project['id'],'characterId':char['id'],'appearanceProfileId':profile['id'],'affectedProfileIds':affected,'message':message}
    return False,None


def pure_job(worker,job,project,library,directory,update):
    if job['kind']=='library_hairstyle':
        from hairstyle_material import mannequin_job
        return mannequin_job(worker,job,project,library,directory,update)
    kind='face_core' if job['kind']=='library_face_core' else 'hairstyle'
    requested=job.get('outputStyle') or job.get('style','国漫')
    style=({'photo':'真人','3d':'3D','comic':'漫画原画','mixed':'混合原样','unknown':'未知原样'}.get(job.get('sourceStyle','unknown'),'未知原样') if requested=='source' else requested)
    if style not in worker.LIBRARY_RENDER_STYLES:raise ValueError('纯素材输出风格不正确')
    metadata=pure_metadata({**job,'style':style,'outputStyle':requested})
    source_urls=[job.get('reference'),*job.get('references',[])]
    for ref_id in job.get('referenceIds',[]):
        item=next((r for r in library if r['id']==ref_id),None)
        if not item:raise ValueError('参考素材不存在')
        source_urls.append(item.get('image'))
    character=profile=None
    if project is not None and job.get('characterId'):
        from life_stages import get_profile
        character=next((c for c in project['characters'] if c['id']==job['characterId']),None)
        profile=get_profile(character,job.get('appearanceProfileId')) if character else None
        if not profile:raise ValueError('没有找到指定人物时期')
        if not any(source_urls):source_urls.append(profile.get('face'))
    refs=worker.references(*[url for url in source_urls if url])
    action=job.get('action','extract' if refs else 'generate')
    if action=='extract' and not refs:raise ValueError('提取需要上传或选择来源图片')
    prompt=worker.asset_image_prefix(style)+worker.prompt_text(kind)
    prompt+=('从附图提取，严格保留五官脸型，不改身份。' if kind=='face_core' else '从附图提取实际完整发型和发饰，不添加人体。第一张是本期已定头部，后附同一期身体仅用于补齐发尾长度与结构，不借用它的其他脸或衣服；不能因为头部画布裁到发尾就输出残缺发型。') if refs else '按素材描述制作新设计，未知内容属于美术设计，不声称原著事实。'
    prompt+=worker.prompt_data({'action':action,'metadata':metadata,'instructions':job.get('instructions',''),
        'sourceSubjectKey':job.get('sourceSubjectKey','primary'),'subjectScope':job.get('subjectScope','原图主要人物')})
    with worker.AppServer(directory) as client:
        worker._ensure_ready(client)
        source=worker._turn(client,directory,prompt,refs,update=update,image=True)
        for attempt in range(2):
            check_prompt=('只读图核验，不生图不执行命令。检查第一张成品是否符合纯脸／纯发型契约；后续为来源，仅比较真实五官或发型一致性。'
                'face_core必须完整秃头五官头部：完整头壳额头、眉毛睫毛、双眼鼻嘴下巴、自然头脸比例；完全无头发、发际碎发、头饰。允许且要求光头，但不能颈部、肩膀、衣服或身体。眉毛、睫毛和角色本有胡须保留，胡须不是头发。'
                'hairstyle必须只有头发及实际发饰，开口空白，不能任何脸、皮肤、头皮、头骨、面具、假人头、颈肩身体，发尾完整。'
                'clean只核验纯素材和完整性；identityPreserved核验提取是否沿用来源，生成无来源时为true。'
                'matchesOutputStyle核验成品确实是要求的漫画画风；来源可以漫画/真人/3D，但不能将保留照片或3D成品假标漫画。' + worker.prompt_data({'kind':kind,'action':action,'outputStyle':requested,'actualOutputStyle':style,'sourceStyle':job.get('sourceStyle','unknown')}))
            checked=worker._turn(client,directory,check_prompt,[source,*refs],schema=CHECK_SCHEMA,update=update)
            if checked.get('clean') is True and checked.get('identityPreserved') is True and checked.get('matchesOutputStyle') is True:break
            if attempt:raise ValueError('纯脸／发型核验未通过，未入库：'+str(checked.get('issues',''))[:300])
            source=worker._turn(client,directory,prompt+'\n修正上一张：'+str(checked.get('issues',''))+'。保留身份或发型。',[source,*refs],update=update,image=True)
    url=worker._save_generated(source,directory,kind,kind=='hairstyle')
    item={'id':uuid4().hex,'kind':kind,'name':job.get('name') or ('纯脸身份' if kind=='face_core' else '发型素材'),
        'style':style,'description':job.get('description') or job.get('instructions',''),**metadata,'image':url,'createdAt':time.time(),
        'pureValidated':True,'pureReviewStatus':'checked','libraryContractVersion':worker.library_contract_version(),'sourceStyle':metadata.get('sourceStyle','unknown'),'outputStyle':requested,'creationAction':action,
        'sourceSubjectKey':job.get('sourceSubjectKey','primary'),'subjectScope':job.get('subjectScope','原图主要人物'),
        'sourceProjectId':(project or {}).get('id'),'sourceCharacterId':(character or {}).get('id'),'sourceProfileId':(profile or {}).get('id'),
        'sourceReferences':[u for u in source_urls if u],
        'sha256':hashlib.sha256(worker.asset_path(url).read_bytes()).hexdigest()}
    library.append(item)
    if profile and kind=='face_core':
        valid_sources=[u for u in source_urls if u]
        if job.get('autoCapture'):
            from appearance_identity import set_face_core
            set_face_core(project,character,profile['id'],url,library_id=item['id'],style=style,approved=True)
        else:
            apply_core(project,character,profile['id'],url,item['id'],style,approved=True,
                preserve_source_head=bool(valid_sources and valid_sources[0]==profile.get('face')))
    return {'project':project,'library':library,'message':'纯脸身份已入库' if kind=='face_core' else '纯发型及配饰已入库'}


def head_source(project,char):
    from life_stages import get_profile
    owner=next((c for c in project.get('characters',[]) if c['id']==char.get('id')),None)
    profile=get_profile(owner,char.get('appearanceProfileId')) if owner else None
    continuity=(profile or char).get('faceContinuity') or {}
    source=get_profile(owner,continuity.get('sourceProfileId')) if owner and continuity.get('sourceProfileId') else None
    return owner,profile,source,continuity


def can_prepare_head(worker,project,char):
    owner,profile,source,continuity=head_source(project,char)
    if char.get('identityReviewPending'):return False
    if char.get('faceCoreReviewPending') or char.get('headIdentityReviewPending'):
        raise ValueError('同脸组的五官身份存在待确认差异，请明确重新选用一个纯脸身份，再整理头部；旧文件保留')
    if worker._usable_image(char.get('faceCore')):return True
    if continuity.get('status')=='same':
        from appearance_identity import get_face_core
        info=get_face_core(project,owner,profile['id'])
        if worker._usable_image(info.get('image')) or worker._usable_image(info.get('headReference')):return True
        if source and (worker._usable_image(source.get('faceCore')) or worker._usable_image(source.get('face'))):return True
    if continuity.get('status')=='same' and (worker._usable_image(char.get('face')) or worker._usable_image(char.get('reference'))):return True
    return bool(char.get('headPreparationPending') and worker._usable_image(char.get('face')))


def prepare_head(worker,client,project,char,directory,job,update):
    """A single complete head; hair changes never redesign the fixed face core."""
    owner,profile,source,continuity=head_source(project,char)
    if not profile:raise ValueError('人物时期没有登记')
    if not char.get('identityReviewPending') and (char.get('faceCoreReviewPending') or char.get('headIdentityReviewPending')):
        raise ValueError('同脸组的五官身份存在待确认差异，请明确重新选用一个纯脸身份；旧文件保留')
    from appearance_identity import get_face_core
    core=get_face_core(project,owner,profile['id'])
    core_url=core.get('image') if isinstance(core,dict) else core if isinstance(core,str) else ''
    core_url=core_url or (char.get('faceCore') if not char.get('faceCoreReviewPending') and not char.get('identityReviewPending') else '')
    base_url=core_url or (core.get('headReference') if isinstance(core,dict) else '') or (source.get('face') if source and continuity.get('status')=='same' else '') or char.get('face') or char.get('reference')
    related=continuity.get('status')=='age_related' or bool(char.get('identityReviewPending'))
    if not base_url and related and source:base_url=source.get('face')
    if not worker._usable_image(base_url):raise ValueError('请先定脸、选用纯脸素材或指定可用的同脸来源，再整理头部')
    hair=char.get('hairstyle') or profile.get('hairstyle') or {}
    hair_url=hair.get('image')
    urls=[base_url,hair_url]
    prompt=worker.image_prefix(worker.style_of(project))+worker.prompt_text('same_face_head')
    prompt+='\n第一张参考为五官身份依据。第二张如有则仅为发型结构，忽略通用白模五官，不借用其他脸或人体。'
    if related:
        prompt+='本卡为年龄相关的新面容：来源只是家族／人生连续线索，按本期年龄重建五官与脸型，不得原样复制成年脸到幼年；不将成年纯脸当本期core。'
    prompt+=worker.prompt_data({'name':char['name'],'period':char.get('appearanceProfile',{}),'hairstyle':hair,
        'faceContinuity':continuity,'instructions':job.get('instructions',''),'sourceDescription':char.get('sourceDescription','')})
    old={k:char.get(k,'') for k in ('face','base','faceCore')}
    source_image=worker._turn(client,directory,prompt,worker.references(*urls),update=update,image=True)
    image=worker._save_generated(source_image,directory,'period-complete-head')
    char.setdefault('identityHistory',[]).append({**old,'reason':'纯脸身份与本期发型整理完整头部','at':time.time()})
    worker._set_selected_face(char,{'id':'head-'+uuid4().hex,'image':image,'style':worker.style_of(project),
        'headContractVersion':worker.public_template()['version'],'headReviewStatus':'pending'},mode='auto',reason='保留五官身份，采用本时期发型')
    char.update(headPreparationPending=False,hairReviewPending=False,faceCandidates=[],faceCandidateSheet='')
    if char.get('hairstyle'):char['hairstyle']['reviewPending']=False
    return image
