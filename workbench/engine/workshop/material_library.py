"""Local material favorites, recoverable removal and reference-based assembly."""
import copy
import hashlib
import json

VISIBLE_KINDS={'face_core','hairstyle','body','clothing','crowd_set','character_card'}

def urls(value):
    if isinstance(value,str):return {value} if value.startswith('/files/') else set()
    if isinstance(value,dict):return set().union(*(urls(v) for v in value.values())) if value else set()
    if isinstance(value,list):return set().union(*(urls(v) for v in value)) if value else set()
    return set()

def mentions(value,identities):
    if isinstance(value,str):return value in identities
    if isinstance(value,dict):return any(mentions(v,identities) for v in value.values())
    if isinstance(value,list):return any(mentions(v,identities) for v in value)
    return False

def revision(item):
    return hashlib.sha256(json.dumps(item,sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def preview(app,item_id):
    item=app.find(app.state['library'],item_id,'素材')
    identities={item_id}|urls(item)
    refs=[{'id':p['id'],'name':p['name']} for p in app.state['projects'] if
          mentions(p.get('characters',[]),identities) or mentions(p.get('teamReferences',[]),identities)]
    active=[]
    for job in app.state['jobs']:
        if job.get('status') not in {'queued','running'}:continue
        direct=mentions({k:job.get(k) for k in ('libraryId','crowdSetId','referenceIds','sources','sourceUrl','reference','references')},identities)
        project=next((p for p in app.state['projects'] if p['id']==job.get('projectId')),None)
        chars=[c for c in (project or {}).get('characters',[]) if not job.get('characterId') or c['id']==job['characterId']]
        if direct or mentions(chars,identities):active.append({'id':job['id'],'kind':job['kind']})
    return {'item':copy.deepcopy(item),'version':revision(item),'references':refs,'activeJobs':active,'canDelete':not active,
            'message':'移入回收站，保留项目引用和图片文件。'}

def file_hashes(app,item):
    result={}
    for url in urls(item):
        try:
            path=app.file_path(url)
            result[url]=hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
        except (OSError,ValueError):result[url]=None
    return result

def material_mutation(app,method,parts,payload):
    from server import APIError,now,new_id
    if method!='POST' or parts[:2]!=['api','library']:return False,None
    if len(parts)==4 and parts[3] in {'favorite','trash'}:
        item=app.find(app.state['library'],parts[2],'素材')
        if parts[3]=='favorite':
            value=payload.get('favorite')
            if not isinstance(value,bool):raise APIError('收藏状态需要是布尔值。')
            item['favorite']=value;item['favoriteUpdatedAt']=now();app.save()
            return True,copy.deepcopy(item)
        current=preview(app,item['id'])
        if current['activeJobs']:raise APIError('此素材正在被任务使用，请任务完成后再删除。',409)
        if payload.get('version')!=current['version']:raise APIError('素材内容已经变化，请重新查看删除窗口。',409)
        entry={'id':new_id('material_trash'),'deletedAt':now(),'item':copy.deepcopy(item),'fileHashes':file_hashes(app,item)}
        app.state.setdefault('materialRecycleBin',[]).append(entry)
        app.state['library']=[r for r in app.state['library'] if r['id']!=item['id']]
        app.save();return True,{'deleted':True,'entry':copy.deepcopy(entry),'retainedFiles':True,'references':current['references']}
    if len(parts)==4 and parts[2]=='recycle-bin':
        entry=app.find(app.state.get('materialRecycleBin',[]),parts[3],'回收站素材')
        if payload.get('action')!='restore':raise APIError('请选择恢复素材。')
        item=copy.deepcopy(entry['item'])
        if any(r['id']==item['id'] for r in app.state['library']):raise APIError('素材编号已存在，未覆盖现有素材。',409)
        changed=file_hashes(app,item)!=entry.get('fileHashes',{})
        if changed:
            item.update(pureValidated=False,hairstyleValidated=False,qualityValidated=False,pureReviewStatus='pending',detailReviewStatus='pending',restoreWarning='图片文件已变化或缺失，恢复后需重新核验。')
            item.pop('previewMeta',None)
        app.state['library'].append(item)
        app.state['materialRecycleBin']=[r for r in app.state['materialRecycleBin'] if r['id']!=entry['id']]
        app.save();return True,{'restored':True,'item':item,'needsReview':changed}
    if parts==['api','library','assemble']:
        return True,assemble(app,payload)
    return False,None

def assemble(app,payload):
    from server import APIError,character_record,outfit_record,now,ID_RE,text_value
    from life_stages import ensure_appearance_profiles,get_profile
    from identity_library import apply_core,validate_hairstyle
    request=payload.get('clientRequestId')
    if not isinstance(request,str) or not ID_RE.fullmatch(request):raise APIError('组装请求编号不正确。')
    fingerprint=hashlib.sha256(json.dumps({k:v for k,v in payload.items() if k!='clientRequestId'},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    receipts=app.state.get('materialAssemblies',[])
    existing=next((r for r in receipts if r['requestId']==request),None)
    if existing:
        if existing['fingerprint']!=fingerprint:raise APIError('这个组装编号已经用于其他选项。',409)
        return {**copy.deepcopy(existing['result']),'duplicate':True}
    project=app.project(payload.get('projectId'))
    name=text_value(payload.get('name',''),'角色名称',120,True)
    category=payload.get('category','配角')
    if category not in {'主角','配角'}:raise APIError('素材组装用于主角或配角；群像请使用套组流程。')
    items={}
    for field,kind in [('faceId','face_core'),('hairId','hairstyle'),('clothingId','clothing'),('bodyId','body')]:
        value=payload.get(field)
        if field=='bodyId' and not value:continue
        item=app.find(app.state['library'],value,{'faceId':'五官','hairId':'发型','clothingId':'服装','bodyId':'身体'}[field])
        if item.get('kind')!=kind:raise APIError('选择的素材类别不匹配。')
        image=item.get('image')
        if not image or not app.file_path(image).is_file() or app.file_path(image).suffix.lower() not in {'.png','.jpg','.jpeg','.webp'}:raise APIError('选中的素材图片缺失，请先补齐。',409)
        if any(j.get('status') in {'queued','running'} and j.get('libraryId')==item['id'] for j in app.state['jobs']):raise APIError('选中的素材正在更新，请任务完成后组装。',409)
        items[field]=copy.deepcopy(item)
    body=items.get('bodyId');face,hair,cloth=(items[k] for k in ('faceId','hairId','clothingId'))
    recipe={'createdAt':now(),'basis':'production_design','materials':{k:{'id':v['id'],'name':v['name'],'image':v['image'],'kind':v['kind'],'style':v.get('style'),'sha256':file_hashes(app,{'image':v['image']})[v['image']]} for k,v in items.items()}}
    if body:
        from body_library import metadata
        recipe['materials']['bodyId']['classification']={**metadata(body),'gender':body.get('gender','未说明'),'ageStage':body.get('ageStage','unspecified')}
    description=text_value(payload.get('description',''),'组装补充说明',20000)
    char=character_record({'name':name,'category':category,'description':description,'hairstyle':{'name':hair['name'],'image':hair['image'],'libraryHairstyleId':hair['id'],'designDescription':hair.get('description',''),'designBasis':'production_design'}})
    app.editable(project['id'],char['id'])
    char['materialRecipe']=recipe
    before=copy.deepcopy(app.state)
    try:
        project['characters'].append(char);ensure_appearance_profiles(project)
        profile=get_profile(char,char['defaultAppearanceProfileId'])
        profile.update(era=face.get('era','unspecified'),ageStage=face.get('ageStage','unspecified'),basis='production_design')
        apply_core(project,char,profile['id'],face['image'],face['id'],face.get('style',''),approved=True)
        profile['hairstyle']=validate_hairstyle(char['hairstyle']);profile['headPreparationPending']=True;char['headPreparationPending']=True
        if body:char['libraryBodyId']=body['id'];profile['libraryBodyId']=body['id']
        outfit=outfit_record({'name':cloth['name'],'description':cloth.get('description',''),'reference':cloth['image'],'libraryClothingId':cloth['id'],'clothingId':cloth['id'],'clothingImage':cloth['image'],'appearanceProfileId':profile['id']})
        char['outfits'].append(outfit);project['updatedAt']=now()
        instructions='按素材组装配方固定五官、发型、身体比例与服装，统一为项目画风。发型白模只提供发型结构，不借用白模五官。全部头发露全；带头正侧背统一模板。'+description
        job=app.enqueue({'kind':'pipeline','projectId':project['id'],'characterId':char['id'],'appearanceProfileId':profile['id'],'outfitId':outfit['id'],'instructions':instructions,'clientRequestId':'assemble-'+request})
        result={'projectId':project['id'],'characterId':char['id'],'appearanceProfileId':profile['id'],'outfitId':outfit['id'],'job':job,'recipe':recipe}
        app.state.setdefault('materialAssemblies',[]).append({'requestId':request,'fingerprint':fingerprint,'result':copy.deepcopy(result)})
        app.save();return result
    except Exception:
        app.state=before;app.save();raise
