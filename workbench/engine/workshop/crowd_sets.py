"""Five-person crowd sets: three linked sheets, never a single actor identity."""
import copy
import hashlib
import json
import re

PARTS=('full_group','heads','clothing')
FIELDS={'full_group':'fullGroupImage','heads':'headSheet','clothing':'clothingSheet'}
BASES={'source','inference','production_design','authorized_adaptation'}
UNIFORM=re.compile(r'(统一|同款|相同|一样|均穿|都穿|皆穿|一律).{0,16}(服|衣|袍|甲|装)|(服|衣|袍|甲|装).{0,16}(统一|同款|相同|一样)')


def member_index(members=None,clothing_layout='3+2'):
    mapping= [{'memberKey':'member_'+str(i),'index':i,'fullGroupIndex':i,'head':{'row':1 if i<=3 else 2,'col':i if i<=3 else i-3},'clothing':{'row':1 if i<=3 else 2,'col':i if i<=3 else i-3}} for i in range(1,6)]
    if members:
        groups=[]
        for row,member in zip(mapping,members):
            group=member.get('costumeGroupId','costume_'+str(member['index']))
            if group not in groups:groups.append(group)
            index=groups.index(group)+1
            row['costumeGroupId']=group;row['clothing']=({'row':1,'col':index} if clothing_layout=='1x5' else {'row':1 if index<=3 else 2,'col':index if index<=3 else index-3})
    return mapping


def _evidence(value,label):
    from server import APIError,text_value,integer
    if not isinstance(value,list) or len(value)>100:raise APIError(label+'需要段落证据列表，最多100项。')
    result=[]
    for item in value:
        if not isinstance(item,dict):raise APIError(label+'格式不正确。')
        result.append({'chapter':integer(item.get('chapter'),'证据章号'),'paragraphId':text_value(item.get('paragraphId',''),'证据段落',200,True),'quote':text_value(item.get('quote',''),'原文证据',12000,True),'claimType':'literal'})
    return result


def _classification(data):
    from server import APIError
    from identity_library import ERAS,GENDERS
    from life_stages import AGE_STAGES
    values={key:data.get(key,default) for key,default in (('era','unspecified'),('gender','未说明'),('ageStage','unspecified'))}
    for key,allowed in (('era',ERAS),('gender',GENDERS),('ageStage',AGE_STAGES)):
        if not isinstance(values[key],str) or values[key] not in allowed:raise APIError('群像素材的时代、性别或年龄分类不正确。')
    # Library filters are art-production labels, not novel appearance facts.
    return {**values,'classificationBasis':'production_design'}


def crowd_record(data):
    from server import APIError,text_value,new_id,now,image_url,LIBRARY_STYLES
    style=data.get('style','国漫')
    if not isinstance(style,str) or style not in LIBRARY_STYLES:raise APIError('群像素材画风不正确。')
    raw_policy=data.get('costumePolicy');policy='mixed' if raw_policy in (None,'auto') else raw_policy
    requested=data.get('costumePolicyRequested',raw_policy is not None and raw_policy!='auto')
    if not isinstance(requested,bool):raise APIError('群像服装策略是否指定需为布尔值。')
    if raw_policy in (None,'auto'):requested=False
    basis=data.get('costumePolicyBasis','production_design')
    if not isinstance(policy,str) or not isinstance(basis,str) or policy not in {'uniform','mixed','varied'} or basis not in BASES:raise APIError('群像服装方案或依据不正确。')
    members=data.get('members')
    if members is None:members=[{'memberKey':'member_'+str(i),'index':i,'name':'群像人物'+str(i),'designBasis':'production_design'} for i in range(1,6)]
    if not isinstance(members,list) or len(members)!=5:raise APIError('标准群像套组固定为5个人物。')
    head_layout=data.get('headLayout','3+2');clothing_layout=data.get('clothingLayout','3+2')
    if head_layout!='3+2' or clothing_layout not in {'3+2','1x5'}:raise APIError('五头总览使用3+2，服装总览可使用3+2或1x5布局。')
    normalized=[];keys=set()
    for i,item in enumerate(members,1):
        if not isinstance(item,dict):raise APIError('群像人物方案格式不正确。')
        index=item.get('index',i);key=item.get('memberKey','member_'+str(index))
        if isinstance(index,bool) or not isinstance(index,int) or index not in range(1,6) or key!='member_'+str(index) or key in keys:raise APIError('群像成员编号须为member_1至member_5，索引1至5且不重复。')
        keys.add(key)
        member=copy.deepcopy(item);member.update(memberKey=key,index=index,name=text_value(item.get('name','群像人物'+str(index)),'群像成员名称',160,True),sourceDescription=text_value(item.get('sourceDescription',''),'原著成员说明',12000),sourceEvidence=_evidence(item.get('sourceEvidence',[]),'成员来源'),designDescription=text_value(item.get('designDescription',''),'群像成员设计',20000),designBasis=item.get('designBasis','production_design'))
        if member['designBasis'] not in {'production_design','authorized_adaptation'}:raise APIError('成员美术补设需标明production_design或authorized_adaptation。')
        member['costumeGroupId']=text_value(item.get('costumeGroupId','costume_1' if policy=='uniform' else 'costume_'+str(index)),'服装分组',100,True)
        normalized.append(member)
    normalized.sort(key=lambda x:x['index'])
    mapping=data.get('memberIndex',member_index(normalized,clothing_layout))
    if mapping!=member_index(normalized,clothing_layout):raise APIError('五人映射固定：完整头部和服装总览均按上3下2对应member_1至member_5。')
    result={'id':data.get('id') or new_id('library'),'kind':'crowd_set','name':text_value(data.get('name','五人群像套组'),'素材名称',160,True),'style':style,**_classification(data),
        'description':text_value(data.get('description',''),'群像说明',20000),'sourceDescription':text_value(data.get('sourceDescription',''),'群像原著说明',20000),
        'sourceEvidence':_evidence(data.get('sourceEvidence',[]),'群像来源'),'designDescription':text_value(data.get('designDescription',''),'群像设计',20000),'designBasis':data.get('designBasis','production_design'),
        'members':normalized,'memberIndex':mapping,'headLayout':head_layout,'clothingLayout':clothing_layout,'fullGroupLayout':'1x5','memberCount':5,'memberCountBasis':'production_design','castingPoolSize':5,'sourceFacts':{'memberCount':'unknown','sameFrame':'unknown','clothing':'unknown'},'sourceStatus':'unknown','costumePolicy':policy,'costumePolicyRequested':requested,'costumePolicyBasis':basis,
        'costumeSourceEvidence':_evidence(data.get('costumeSourceEvidence',data.get('sourceEvidence',[])),'服装方案来源'),'createdAt':data.get('createdAt') or now()}
    if result['designBasis'] not in {'production_design','authorized_adaptation'}:raise APIError('群像补设方案需要明确设计依据。')
    for field in FIELDS.values():result[field]=image_url(data.get(field,''))
    if data.get('image') and image_url(data['image'])!=result['headSheet']:raise APIError('群像image必须是对应的五头完整头部总览，不能用单人脸。')
    result['image']=result['headSheet'];result['missingParts']=[part for part,field in FIELDS.items() if not result[field]]
    result['parts']={part:{'status':'pending' if part in result['missingParts'] else 'uploaded','image':result[FIELDS[part]]} for part in PARTS}
    result.update(reviewStatus='pending',visualReview={'status':'pending'},qualityValidated=False)
    for field in ('sourceProjectId','sourceCharacterId','sourceProfileId','readScope','provenance','sourceHashes','warnings'):
        if field in data:result[field]=copy.deepcopy(data[field])
    return result


def _image_hash(app,url):
    from server import APIError
    from PIL import Image
    path=app.file_path(url)
    if not path.is_file() or path.suffix.lower() not in {'.png','.jpg','.jpeg','.webp'}:raise APIError('群像素材图片不存在或格式不正确。',404)
    try:
        with Image.open(path) as image:image.verify()
    except (ValueError,OSError) as exc:raise APIError('群像素材不是有效图片。') from exc
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _scope(project,scope=None):
    from server import read_range
    span=read_range((scope or {}).get('range') or [project.get('rangeStart',1),project.get('rangeEnd',20)])
    chapters=[c for c in project.get('chapters',[]) if span[0]<=c['chapter']<=span[1]]
    return {'range':span,'chapterNumbers':[c['chapter'] for c in chapters],'sourceHashes':sorted({c.get('sourceHash') for c in chapters if c.get('sourceHash')}),
        'scriptHash':hashlib.sha256(json.dumps(chapters,ensure_ascii=False,sort_keys=True).encode()).hexdigest()}


def verify_sources(app,item,project=None):
    from server import APIError
    evidence=item.get('sourceEvidence',[])+item.get('costumeSourceEvidence',[])
    for member in item.get('members',[]):evidence+=member.get('sourceEvidence',[])
    if not evidence:
        if item.get('costumePolicyBasis')=='source':raise APIError('服装方案没有原文证据，不能标为source；同一组织不代表原文统一制服。')
        if item.get('sourceDescription') or any(m.get('sourceDescription') for m in item.get('members',[])):raise APIError('原著说明须有可回源段落；未知外观请放在designDescription。')
        return
    project=project or (app.project(item['sourceProjectId']) if item.get('sourceProjectId') else None)
    if not project:raise APIError('原著证据需要关联来源项目；全局美术素材请标production_design。')
    scope=_scope(project,item.get('readScope'));span=scope['range'];by_id={(c['chapter'],p['id']):p['text'] for c in project.get('chapters',[]) if span[0]<=c['chapter']<=span[1] for p in c.get('paragraphs',[])}
    for e in evidence:
        raw=by_id.get((e['chapter'],e['paragraphId']))
        if not raw or e['quote'] not in raw:raise APIError('群像来源证据不能在固定读取范围内回源：'+e['paragraphId'])
        e['verified']=True
    if item.get('costumePolicy')=='uniform' and item.get('costumePolicyBasis')=='source' and not any(UNIFORM.search(e['quote']) for e in item.get('costumeSourceEvidence',[])):
        raise APIError('原文仅有组织身份不能当作统一制服事实；请标为production_design。')
    item['sourceProjectId']=project['id'];item['readScope']=scope


def refresh_hashes(app,item):
    item['sourceHashes']={part:_image_hash(app,item[field]) for part,field in FIELDS.items() if item.get(field)}
    return item


def _assets(item):
    return {key:copy.deepcopy(item.get(key)) for key in ('fullGroupImage','headSheet','clothingSheet','members','memberIndex','headLayout','clothingLayout','fullGroupLayout','costumePolicy','costumePolicyRequested','costumePolicyBasis','sourceEvidence','costumeSourceEvidence','sourceDescription','designDescription','designBasis','sourceHashes','readScope','reviewStatus','visualReview','missingParts','sourceFacts','sourceStatus','memberCountBasis','castingPoolSize','parts','productionReady','provenance','style','name','era','gender','ageStage','classificationBasis')} | {'crowdSetId':item['id']}


def bind_crowd(app,item,project,char,profile_id=None):
    from server import APIError
    if char.get('category')!='群像':raise APIError('群像套组仅关联群像角色，主配角仍使用独立角色卡。')
    char['crowdSetId']=item['id'];char['crowdAssets']=_assets(item)
    if profile_id:char['crowdAssets']['appearanceProfileId']=profile_id
    return char


def crowd_mutation(app,method,parts,payload):
    from server import APIError,now,ID_RE
    if parts[:2]!=['api','library']:return False,None
    manual=parts==['api','library','crowd-sets'] and method=='POST'
    upload=parts==['api','library'] and method=='POST' and payload.get('kind')=='crowd_set'
    if manual or upload:
        item=crowd_record(payload);project=app.project(payload['sourceProjectId']) if payload.get('sourceProjectId') else None
        verify_sources(app,item,project);refresh_hashes(app,item)
        if manual:
            if payload.get('approvalBasis')!='authorized_adaptation' or not isinstance(payload.get('approvalNote'),str) or not payload['approvalNote'].strip():raise APIError('登记已批准群像示范需明确人工授权与审核说明。')
            if item['missingParts']:raise APIError('人工批准的群像套组需要五人全身、五头总览和纯服装三张图。')
            item.update(reviewStatus='approved_manual',visualReview={'status':'manual_authorized','basis':'authorized_adaptation','note':payload['approvalNote'].strip(),'approvedAt':now(),'approvedHashes':copy.deepcopy(item['sourceHashes'])})
            for part in PARTS:item['parts'][part].update(status='completed',sha256=item['sourceHashes'][part],sourceHash=item['sourceHashes']['full_group'],review={'status':'manual_authorized','basis':'authorized_adaptation','note':payload['approvalNote'].strip()})
            item['productionReady']=True
        if not ID_RE.fullmatch(item['id']):raise APIError('群像素材编号格式不正确。')
        existing=next((i for i in app.state['library'] if i['id']==item['id']),None)
        if existing:
            if existing.get('kind')=='crowd_set' and existing.get('sourceHashes')==item['sourceHashes']:
                if manual:
                    item['createdAt']=existing.get('createdAt',item['createdAt']);existing.clear();existing.update(item);app.save()
                return True,{**copy.deepcopy(existing),'duplicate':True}
            raise APIError('这个素材编号已存在且对应不同图片。',409)
        app.state['library'].append(item);app.save();return True,copy.deepcopy(item)
    if len(parts)==4 and parts[3]=='adopt-crowd' and method=='POST':
        item=app.find(app.state['library'],parts[2],'群像套组')
        if item.get('kind')!='crowd_set':raise APIError('请选择五人群像套组。')
        project=app.project(payload.get('projectId'));char=app.character(project,payload.get('characterId'));app.editable(project['id'],char['id'])
        if item.get('style')!=project.get('style'):raise APIError('群像套组需与项目画风一致。')
        if char.get('category')!='群像':raise APIError('群像套组只关联群像角色。')
        checked=refresh_hashes(app,copy.deepcopy(item))
        if checked.get('sourceHashes')!=item.get('sourceHashes'):raise APIError('群像图片已变化，需要重新确认这组三图。',409)
        bind_crowd(app,item,project,char,payload.get('appearanceProfileId'));project['updatedAt']=now();app.save()
        return True,{'projectId':project['id'],'characterId':char['id'],'crowdSetId':item['id'],'crowdAssets':copy.deepcopy(char['crowdAssets']),'message':'五人群像套组已关联，三图保持成组；单人脸和身体字段未改。'}
    if len(parts)==3 and method=='PATCH':
        item=next((i for i in app.state['library'] if i['id']==parts[2] and i.get('kind')=='crowd_set'),None)
        if item is None:return False,None
        if any(j.get('status')=='running' and j.get('crowdSetId')==item['id'] for j in app.state['jobs']):raise APIError('群像套组正在补图，请等待完成或取消后再编辑。',409)
        editable={'name','era','gender','ageStage','description','sourceDescription','sourceEvidence','designDescription','designBasis','costumePolicy','costumePolicyRequested','costumePolicyBasis','costumeSourceEvidence','members','headLayout','clothingLayout',*FIELDS.values()}
        edit_data={**item,**{k:v for k,v in payload.items() if k in editable},'image':payload.get('headSheet',item.get('headSheet',''))}
        if 'costumePolicy' in payload and 'costumePolicyRequested' not in payload:edit_data['costumePolicyRequested']=payload['costumePolicy']!='auto'
        updated=crowd_record(edit_data)
        verify_sources(app,updated);refresh_hashes(app,updated);updated['createdAt']=item['createdAt'];updated['history']=copy.deepcopy(item.get('history',[]))+[copy.deepcopy(item)]
        item.clear();item.update(updated)
        for project in app.state['projects']:
            for char in project.get('characters',[]):
                if char.get('crowdSetId')==item['id']:bind_crowd(app,item,project,char,char.get('crowdAssets',{}).get('appearanceProfileId'))
        app.save();return True,copy.deepcopy(item)
    return False,None


def prepare_crowd_job(app,job,payload,project,char):
    from server import APIError,image_url,text_value
    from life_stages import get_profile
    if char is not None and char.get('category')!='群像':raise APIError('群像制作只适用于群像角色；主配角使用角色卡流程。')
    if payload.get('count',5)!=5:raise APIError('群像标准套组固定5人。')
    item=app.find(app.state['library'],payload['crowdSetId'],'群像套组') if payload.get('crowdSetId') else None
    if item and item.get('kind')!='crowd_set':raise APIError('群像续作需要选择对应的整套素材。')
    if item and item.get('style')!=job['style']:raise APIError('续作需沿用原群像套组画风。')
    requested=payload.get('parts',list(PARTS))
    if not isinstance(requested,list) or not requested or any(not isinstance(part,str) or part not in PARTS for part in requested) or len(set(requested))!=len(requested):raise APIError('群像部位请选择full_group、heads或clothing。')
    metadata_input={**(item or {}),**payload,'style':job['style'],'image':(item or {}).get('headSheet','')}
    if 'costumePolicy' in payload and 'costumePolicyRequested' not in payload:metadata_input['costumePolicyRequested']=payload['costumePolicy']!='auto'
    if item and 'costumePolicy' not in payload and (item.get('visualReview',{}).get('status')=='manual_authorized' or item.get('parts',{}).get('plan',{}).get('status')=='completed'):metadata_input['costumePolicyRequested']=True
    metadata=crowd_record(metadata_input)
    verify_sources(app,metadata,project)
    job.update(name=metadata['name'],description=metadata['description'],costumePolicyRequested=metadata['costumePolicyRequested'],era=metadata['era'],gender=metadata['gender'],ageStage=metadata['ageStage'],classificationBasis='production_design',headLayout=metadata['headLayout'],clothingLayout=metadata['clothingLayout'],fullGroupLayout='1x5',count=5,crowdSetId=(item or metadata)['id'],members=metadata['members'],memberIndex=metadata['memberIndex'],costumePolicy=metadata['costumePolicy'],costumePolicyBasis=metadata['costumePolicyBasis'],costumeSourceEvidence=metadata['costumeSourceEvidence'],sourceDescription=metadata['sourceDescription'],sourceEvidence=metadata['sourceEvidence'],designDescription=metadata['designDescription'],designBasis=metadata['designBasis'])
    if not job['costumePolicyRequested']:job.pop('costumePolicy',None)
    full=payload.get('refGroupImage') or (item or {}).get('fullGroupImage')
    if full:
        job['refGroupImage']=image_url(full);job['sourceGroupHash']=_image_hash(app,job['refGroupImage'])
        if payload.get('sourceGroupHash') and payload['sourceGroupHash']!=job['sourceGroupHash']:raise APIError('群像来源图片已更新，请刷新后续作。',409)
    if item:
        job['existingCrowdVersion']=hashlib.sha256(json.dumps({k:item.get(k) for k in ('fullGroupImage','members','memberIndex','headLayout','clothingLayout','fullGroupLayout','costumePolicy','costumePolicyBasis','costumePolicyRequested','era','gender','ageStage')},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        job['parts']=[part for part in requested if not item.get(FIELDS[part]) or item.get('parts',{}).get(part,{}).get('status')!='completed']
        if not job['parts']:raise APIError('群像套组所选部位已经完成，无需重复生成。',409)
    else:job['parts']=[part for part in requested if part!='full_group' or not full]
    if not full and 'full_group' not in job['parts']:raise APIError('先提供五人全身图或制作full_group，才能提取同组头部和服装。')
    if project:job['readScope']=_scope(project,payload.get('readScope') or (item or {}).get('readScope') or job.get('readScope'))
    if char:
        profile=get_profile(char,payload.get('appearanceProfileId') or char.get('defaultAppearanceProfileId'))
        if not profile:raise APIError('没有找到该群像角色的时期。',404)
        job['appearanceProfileId']=profile['id']


def crowd_superseded(app,job):
    if job.get('kind')!='crowd_set':return False
    try:
        if job.get('refGroupImage') and _image_hash(app,job['refGroupImage'])!=job.get('sourceGroupHash'):return True
        if job.get('projectId') and job.get('readScope') and _scope(app.project(job['projectId']),job['readScope'])!=job['readScope']:return True
        if job.get('existingCrowdVersion'):
            item=app.find(app.state['library'],job['crowdSetId'],'群像套组')
            version=hashlib.sha256(json.dumps({k:item.get(k) for k in ('fullGroupImage','members','memberIndex','headLayout','clothingLayout','fullGroupLayout','costumePolicy','costumePolicyBasis','costumePolicyRequested','era','gender','ageStage')},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
            return version!=job['existingCrowdVersion']
    except (OSError,ValueError,__import__('server').APIError):return True
    return False


def _crowd_version(item):
    return hashlib.sha256(json.dumps({k:item.get(k) for k in ('fullGroupImage','members','memberIndex','headLayout','clothingLayout','fullGroupLayout','costumePolicy','costumePolicyBasis','costumePolicyRequested','era','gender','ageStage')},sort_keys=True,ensure_ascii=False).encode()).hexdigest()


def guard_crowd_update(app,job,baseline,updated):
    if job.get('kind')!='crowd_set':return
    from server import APIError
    if crowd_superseded(app,job):raise APIError('群像来源图或固定剧本范围已变化，旧结果仅保留任务文件，请刷新后重试。',409)
    fields=('face','base','faceCore','libraryFaceCoreId','hairstyle','faceCandidates','faceCandidateSheet','faceApproved','baseApproved')
    old={c['id']:c for c in (baseline or {}).get('characters',[])}
    for current in (updated or {}).get('characters',[]):
        previous=old.get(current['id'])
        if previous is None:raise APIError('群像套组任务不能新增单人角色记录。',409)
        for field in fields:
            if (current.get(field) or None)!=(previous.get(field) or None):raise APIError('群像套组不能修改单人脸、身体或拆分五官/发型字段。',409)
        profiles={p['id']:p for p in previous.get('appearanceProfiles',[])}
        for profile in current.get('appearanceProfiles',[]):
            before=profiles.get(profile['id'],{})
            for field in fields:
                if (profile.get(field) or None)!=(before.get(field) or None):raise APIError('群像任务不能覆盖人物时期的单人素材。',409)


def advance_crowd_source(app,job):
    if job.get('kind')=='crowd_set' and job.get('existingCrowdVersion'):
        item=next((r for r in app.state['library'] if r['id']==job['crowdSetId']),None)
        if item:job['existingCrowdVersion']=_crowd_version(item)


def copy_crowd_character_fields(result,data):
    from server import APIError,text_value,image_url
    if data.get('crowdSetId'):result['crowdSetId']=text_value(data['crowdSetId'],'群像套组编号',180,True)
    assets=data.get('crowdAssets')
    if assets is not None:
        if not isinstance(assets,dict):raise APIError('群像套组关联数据需要对象。')
        result['crowdAssets']=copy.deepcopy(assets)
        for field in FIELDS.values():
            if field in assets:result['crowdAssets'][field]=image_url(assets[field])
    return result
