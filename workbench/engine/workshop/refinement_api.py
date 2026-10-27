"""Preview-only visual refinement and explicitly confirmed adoption."""
import copy
import hashlib
from pathlib import Path

HAIRSTYLE_PREVIEW_ENABLED = True
FACE_CHECKS = ('identityPreserved','sameAgeGender','sameStyle','changesLimited','framingPreserved','requestedChangesApplied')
HAIR_CHECKS = ('hairPreserved','neutralWhiteMannequin','threeStrictViews','clean')


def refinement_options():
    from visual_refinement import refinement_options as worker_options
    result = copy.deepcopy(worker_options())
    result['hairstylePreviewEnabled'] = HAIRSTYLE_PREVIEW_ENABLED
    result['sourceKinds'] = ['candidate','complete_head','face_core']
    result['adoptionRequired'] = True
    return result


def _image(app, url, label):
    from server import APIError, image_url
    from PIL import Image
    url = image_url(url)
    if not url:
        raise APIError('请选择'+label+'。')
    path = app.file_path(url)
    if not path.is_file() or path.suffix.lower() not in {'.png','.jpg','.jpeg','.webp'}:
        raise APIError(label+'图片不存在或格式不正确。',404)
    try:
        with Image.open(path) as picture:
            size=picture.size
            picture.verify()
    except (ValueError,OSError) as exc:
        raise APIError(label+'不是可读取的图片。') from exc
    return url,hashlib.sha256(path.read_bytes()).hexdigest(),size


def _profile(app, project, character, profile_id):
    from server import APIError
    from life_stages import get_profile
    profile=get_profile(character,profile_id or character.get('defaultAppearanceProfileId'))
    if not profile:raise APIError('没有找到这个人物时期。',404)
    return profile


def _identity_version(app,profile):
    if not profile:return None
    core=profile.get('faceCore','')
    core_hash=_image(app,core,'纯脸')[1] if core else ''
    return {key:copy.deepcopy(profile.get(key)) for key in ('id','faceIdentityGroupId','period','ageStage','faceCore','headPreparationPending','headIdentityReviewPending','identityReviewPending','faceCoreReviewPending')} | {'coreHash':core_hash}


def _current_source(app,job):
    from server import APIError
    if job.get('libraryId') and not job.get('characterId'):
        item=app.find(app.state['library'],job['libraryId'],'素材')
        expected='hairstyle' if job['kind']=='hairstyle_preview' else 'face_core'
        if item.get('kind')!=expected:raise APIError('来源素材类型不匹配。')
        return item.get('image',''),item,None
    project=app.project(job.get('projectId'));char=app.character(project,job.get('characterId'))
    profile=_profile(app,project,char,job.get('appearanceProfileId'))
    if job.get('sourceKind')=='candidate':
        candidate=app.find(profile.get('faceCandidates',[]),job.get('candidateId'),'该时期的脸图方案')
        return candidate.get('image',''),profile,candidate
    return profile.get('faceCore' if job.get('sourceKind')=='face_core' else 'face',''),profile,None


def prepare_refinement_job(app,job,payload,project,character):
    from server import APIError,LIBRARY_STYLES
    if job['kind']=='hairstyle_preview' and not HAIRSTYLE_PREVIEW_ENABLED:
        raise APIError('发型展示方案尚未确定；纯发型原图保留，预览功能暂未开放。',409)
    if job['kind']=='hairstyle_preview':
        job['sourceKind']='hairstyle'
        item=app.find(app.state['library'],payload.get('libraryId'),'发型素材')
        if item.get('kind')!='hairstyle':raise APIError('白模预览只能使用纯发型素材。')
        job['libraryId']=item['id'];style=item.get('style','国漫')
    else:
        source_kind=payload.get('sourceKind','complete_head')
        if source_kind not in {'candidate','complete_head','face_core'}:raise APIError('请选择候选脸、完整头部或纯脸来源。')
        job['sourceKind']=source_kind
        if character is None:
            item=app.find(app.state['library'],payload.get('libraryId'),'纯脸素材')
            if source_kind!='face_core' or item.get('kind')!='face_core':raise APIError('独立素材微调仅支持纯脸库；完整头部请从人物时期进入。')
            job['libraryId']=item['id'];style=item.get('style','国漫')
        else:
            profile=_profile(app,project,character,payload.get('appearanceProfileId'))
            job['appearanceProfileId']=profile['id']
            if source_kind=='candidate':
                candidate=app.find(profile.get('faceCandidates',[]),payload.get('candidateId'),'该时期的脸图方案')
                job['candidateId']=candidate['id'];style=candidate.get('style') or profile.get('faceStyle') or project['style']
            else:style=profile.get('faceCoreStyle' if source_kind=='face_core' else 'faceStyle') or project['style']
        from visual_refinement import validate_refine_options
        try:job['refineOptions']=validate_refine_options(payload.get('refineOptions',[]))
        except (ValueError,TypeError) as exc:raise APIError(str(exc)) from exc
    if style not in LIBRARY_STYLES:raise APIError('来源图片的真实画风不正确，不能在微调中转换风格。')
    source,target,_=_current_source(app,job)
    if character is not None:job['refinementIdentityVersion']=_identity_version(app,target)
    if job.get('sourceKind')=='complete_head' and character is not None and any(target.get(key) for key in ('headPreparationPending','headIdentityReviewPending','identityReviewPending','faceCoreReviewPending')):raise APIError('当前完整头部已待整理，请先按现有五官整理头部，再进行微调。',409)
    url,digest,size=_image(app,source,'来源')
    supplied=payload.get('sourceUrl') or payload.get('reference')
    if supplied and supplied!=url:raise APIError('所选来源不属于当前候选、人物时期或素材。',409)
    supplied_hash=payload.get('sourceHash') or payload.get('sourceHeadHash')
    if supplied_hash and supplied_hash!=digest:raise APIError('来源图片已变化，请刷新后重试。',409)
    job.update(sourceUrl=url,reference=url,sourceHash=digest,sourceHeadHash=digest,sourceStyle=style,style=style,count=1)
    if payload.get('maskUrl'):
        mask,mask_hash,mask_size=_image(app,payload['maskUrl'],'局部遮罩')
        if mask_size!=size:raise APIError('局部遮罩必须与来源图片尺寸一致。')
        from PIL import Image
        with Image.open(app.file_path(mask)) as picture:
            if picture.mode in {'RGBA','LA'} and picture.getextrema()[-1]!=(255,255):raise APIError('局部遮罩请用不透明黑白图，白色修改、黑色保留。')
            rgb=picture.convert('RGB')
            if rgb.getextrema()[0]!=rgb.getextrema()[1] or rgb.getextrema()[1]!=rgb.getextrema()[2]:raise APIError('局部遮罩需要使用黑白图。')
            pixels=list(getattr(rgb,'get_flattened_data',rgb.getdata)())
            if any(r!=g or g!=b for r,g,b in pixels):raise APIError('局部遮罩只接受黑白及灰度边缘，不包含其他颜色。')
            white=sum(r>=192 for r,_,_ in pixels);black=sum(r<64 for r,_,_ in pixels)
            if not white or not black or white/len(pixels)>0.6:raise APIError('白色只标局部五官，黑色锁定外部；不能将整张图设为修改区域。')
        job.update(maskUrl=mask,maskHash=mask_hash)


def refinement_superseded(app,job):
    if job.get('kind') not in {'face_refine','hairstyle_preview'}:return False
    try:
        current,_,_=_current_source(app,job)
        url,digest,_=_image(app,current,'来源')
        return url!=job.get('sourceUrl') or digest!=job.get('sourceHash')
    except (ValueError,OSError,__import__('server').APIError):return True


def _receipt(app,job,receipt,hair=False):
    from server import APIError
    if not isinstance(receipt,dict) or receipt.get('status')!='preview':raise APIError('微调预览尚未完成或已失效。',409)
    for field in ('sourceUrl','sourceHash','sourceKind','projectId','characterId','appearanceProfileId','libraryId','candidateId'):
        if hair and field not in ('sourceUrl','sourceHash','libraryId'):continue
        if (receipt.get(field) or None)!=(job.get(field) or None):raise APIError('微调预览与原始目标不一致：'+field,409)
    if not hair:
        for field in ('sourceStyle','refineOptions','maskUrl','maskHash'):
            if (receipt.get(field) or None)!=(job.get(field) or None):raise APIError('微调预览的选项或遮罩与原任务不一致。',409)
    if receipt.get('id')!=job['id']:raise APIError('预览任务编号不一致。',409)
    if not hair and job.get('characterId') and job.get('sourceKind')!='face_core':
        _,profile,candidate=_current_source(app,job)
        updates_head=job.get('sourceKind')=='complete_head' or bool(candidate and profile.get('selectedFaceId')==candidate.get('id') and profile.get('face')==job.get('sourceUrl'))
        if updates_head and (_identity_version(app,profile)!=job.get('refinementIdentityVersion') or any(profile.get(key) for key in ('headPreparationPending','headIdentityReviewPending','identityReviewPending','faceCoreReviewPending'))):raise APIError('人物五官身份或头部状态已变化，此预览已过期；请先整理当前头部。',409)
    if refinement_superseded(app,job):raise APIError('来源图片已更新，此预览已过期，请重新微调。',409)
    checks=HAIR_CHECKS if hair else FACE_CHECKS
    review=receipt.get('visualReview') or {}
    if any(review.get(key) is not True for key in checks):raise APIError('微调预览未通过身份、风格或局部变化核验。',409)
    if not hair and job.get('sourceKind')=='face_core' and review.get('pureCore') is not True:raise APIError('结果未核验为纯脸素材，不能放入五官库。',409)
    image,_,_=_image(app,receipt.get('image',''),'预览')
    if image==job.get('sourceUrl'):raise APIError('预览结果不能直接冒充来源图片。',409)
    return image


def apply_preview_result(app,job,result):
    receipt=result.get('visualRefinement')
    if receipt is not None:
        _receipt(app,job,receipt)
        job['visualRefinement']=copy.deepcopy(receipt)
    hair=result.get('hairstylePreview')
    if hair is not None:
        image=_receipt(app,job,hair,hair=True)
        item=app.find(app.state['library'],job.get('libraryId'),'发型素材')
        if item.get('preview') and item['preview']!=image:item.setdefault('previewHistory',[]).append({'image':item['preview'],'metadata':copy.deepcopy(item.get('previewMeta',{}))})
        item['preview']=image;item['previewMeta']=copy.deepcopy(hair)
        job['hairstylePreview']=copy.deepcopy(hair)


def guard_library_edits(app,method,parts):
    from server import APIError
    if len(parts)>=3 and parts[:2]==['api','library'] and method in {'PATCH','DELETE'}:
        item_id=parts[2]
        if any(j.get('status')=='running' and any(key.endswith('library:'+item_id) for key in j.get('resourceLocks',[])) for j in app.state['jobs']):raise APIError('该素材有预览或微调任务正在运行，请等待完成或取消后再编辑。',409)


def refinement_mutation(app,method,parts,payload):
    from server import APIError,now
    guard_library_edits(app,method,parts)
    role=(len(parts)==6 and parts[:2]==['api','projects'] and parts[3]=='characters' and parts[5]=='adopt-refinement')
    pure=(len(parts)==4 and parts[:2]==['api','library'] and parts[3]=='adopt-refinement')
    if method!='POST' or not(role or pure):return False,None
    job=app.find(app.state['jobs'],payload.get('jobId'),'微调任务')
    if job.get('kind')!='face_refine' or job.get('status')!='completed':raise APIError('请选择已完成的脸部微调预览。',409)
    if job.get('refinementAdoptedAt'):
        expected=(job.get('projectId')==parts[2] and job.get('characterId')==parts[4]) if role else job.get('libraryId')==parts[2]
        if role and payload.get('appearanceProfileId',job.get('appearanceProfileId'))!=job.get('appearanceProfileId'):expected=False
        if not expected:raise APIError('微调预览不属于这个目标。',409)
        return True,{'adopted':True,'duplicate':True,'jobId':job['id'],'message':'该预览已采用，旧图仍保留。'}
    receipt=job.get('visualRefinement');image=_receipt(app,job,receipt)
    affected=[]
    if role:
        if job.get('projectId')!=parts[2] or job.get('characterId')!=parts[4] or payload.get('appearanceProfileId',job.get('appearanceProfileId'))!=job.get('appearanceProfileId'):raise APIError('微调预览不属于这个人物时期。',409)
        project=app.project(parts[2]);app.editable(project['id'],parts[4],allow_readonly_previews=True);char=app.character(project,parts[4]);profile=_profile(app,project,char,job.get('appearanceProfileId'))
        kind=job['sourceKind'];source=job['sourceUrl'];profile.setdefault('refinementHistory',[]).append(copy.deepcopy(receipt))
        if kind=='face_core':
            from identity_library import apply_core
            affected=apply_core(project,char,profile['id'],image,'',job['sourceStyle'],approved=True)
        else:
            update_head=kind=='complete_head'
            if kind=='candidate':
                candidate=app.find(profile.get('faceCandidates',[]),job.get('candidateId'),'脸图方案')
                candidate.setdefault('refinementHistory',[]).append({'image':candidate['image'],'jobId':job['id'],'at':now()});candidate['image']=image
                profile['faceCandidateSheetReviewPending']=True
                if profile['id']==char.get('defaultAppearanceProfileId'):char['faceCandidates']=copy.deepcopy(profile['faceCandidates'])
                update_head=profile.get('face')==source and profile.get('selectedFaceId')==candidate['id']
            if update_head:
                from life_stages import profile_character,commit_profile_character
                from identity_library import archive_outfit
                working=profile_character(char,profile['id']);working.setdefault('identityHistory',[]).append({'face':working.get('face',''),'base':working.get('base',''),'faceCore':working.get('faceCore',''),'reason':'采用脸部局部微调','at':now()})
                working.update(face=image,faceApproved=True,faceStyle=job['sourceStyle'],baseApproved=False,headPreparationPending=False,hairReviewPending=False)
                for outfit in working.get('outfits',[]):archive_outfit(outfit,'采用脸部局部微调');outfit.update(semanticReviewPending=True,semanticReviewReason='完整头部已局部微调，旧服装卡保留待核验。',visualIdentityReviewPending=True)
                commit_profile_character(char,working,profile['id']);affected=[profile['id']]
                from identity_library import mark_head_pending
                group=profile.get('faceIdentityGroupId')
                for member in char.get('appearanceProfiles',[]):
                    if member.get('faceIdentityGroupId')!=group:continue
                    member['faceCoreReviewPending']=True;member['faceCoreApproved']=False
                    if member['id']!=profile['id']:mark_head_pending(project,char,member,'同脸组五官已局部微调，需要整理本时期完整头部。');affected.append(member['id'])
                if group==_profile(app,project,char,char.get('defaultAppearanceProfileId')).get('faceIdentityGroupId'):char.update(faceCoreReviewPending=True,faceCoreApproved=False)
        project['updatedAt']=now()
    else:
        if job.get('libraryId')!=parts[2] or job.get('characterId') or job.get('sourceKind')!='face_core':raise APIError('微调预览不属于这个纯脸素材。',409)
        item=app.find(app.state['library'],parts[2],'纯脸素材')
        if item.get('kind')!='face_core':raise APIError('只有纯脸素材可以采用此结果。')
        linked_projects=[p for p in app.state['projects'] if any(a.get('libraryFaceCoreId')==item['id'] for c in p.get('characters',[]) for a in c.get('appearanceProfiles',[]))]
        for linked in linked_projects:
            for owner in linked.get('characters',[]):
                if any(a.get('libraryFaceCoreId')==item['id'] for a in owner.get('appearanceProfiles',[])):app.editable(linked['id'],owner['id'])
        item.setdefault('refinementHistory',[]).append({'image':item['image'],'receipt':copy.deepcopy(receipt),'at':now()})
        item.update(image=image,pureValidated=True,pureReviewStatus='checked',updatedAt=now(),sha256=hashlib.sha256(app.file_path(image).read_bytes()).hexdigest())
        from identity_library import apply_core
        for project in app.state['projects']:
            for char in project.get('characters',[]):
                for profile in list(char.get('appearanceProfiles',[])):
                    if profile.get('libraryFaceCoreId')==item['id']:
                        affected.extend(apply_core(project,char,profile['id'],image,item['id'],item['style'],approved=True));project['updatedAt']=now()
    receipt['status']='adopted';job['refinementAdoptedAt']=now();app.save()
    capture=None
    if role and job['sourceKind']!='face_core' and profile.get('face')==image and profile.get('faceApproved'):capture=app.capture_face_assets(project,char,profile['id'])
    return True,{'adopted':True,'jobId':job['id'],'image':image,'affectedProfileIds':sorted(set(affected)),'autoCaptureJobId':(capture or {}).get('id'),'message':'微调已采用；旧图保留，相关后续素材按新脸核验。'}
