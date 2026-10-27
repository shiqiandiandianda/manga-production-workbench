"""Preview-only local face editing and neutral mannequin hair displays.

The original source, character face/core, and validated hair asset are immutable.
Adoption is a separate server operation that must compare the saved source SHA.
"""
from __future__ import annotations
import copy
import hashlib
import time
from PIL import Image

PARTS = {
    'eyes': ('眼睛', {
        'wider_spacing':'眼距稍宽','narrower_spacing':'眼距稍窄',
        'slightly_larger':'眼睛稍大','slightly_smaller':'眼睛稍小',
        'raise_outer_corners':'眼尾稍上扬','lower_outer_corners':'眼尾稍下收',
        'move_up':'眼睛稍上移','move_down':'眼睛稍下移'}),
    'brows': ('眉毛', {'fuller':'眉毛稍厚','thinner':'眉毛稍细',
        'flatter':'眉形稍平','more_arch':'眉弓稍明显'}),
    'nose': ('鼻子', {'narrower_bridge':'鼻梁稍窄','wider_bridge':'鼻梁稍宽',
        'raise_bridge':'鼻梁稍高','lower_bridge':'鼻梁稍低',
        'narrower_nostrils':'鼻翼稍窄','wider_nostrils':'鼻翼稍宽',
        'smaller_tip':'鼻尖稍小','rounder_tip':'鼻尖稍圆',
        'tip_up':'鼻尖稍上翘','tip_down':'鼻尖稍下收'}),
    'mouth': ('嘴唇', {'slightly_wider':'嘴宽稍宽','slightly_narrower':'嘴宽稍窄',
        'fuller_upper_lip':'上唇稍厚','thinner_upper_lip':'上唇稍薄',
        'fuller_lower_lip':'下唇稍厚','thinner_lower_lip':'下唇稍薄'}),
    'jaw': ('下颌与下巴', {'narrower':'下颌稍窄','wider':'下颌稍宽',
        'softer_angle':'下颌角稍柔和','more_defined_angle':'下颌角稍清晰',
        'shorter_chin':'下巴稍短','longer_chin':'下巴稍长'}),
    'cheekbones': ('颧骨', {'slightly_higher':'颧骨稍高','slightly_lower':'颧骨稍低',
        'more_defined':'颧部稍清晰','softer':'颧部稍柔和',
        'inward':'颧骨稍内收','outward':'颧骨稍外扩'}),
    'face_shape': ('脸型', {'slightly_longer':'脸型稍修长','rounder':'脸型稍圆润',
        'narrower':'整体脸型稍窄','wider':'整体脸型稍宽'}),
    'ears': ('耳朵', {'smaller':'耳朵稍小','larger':'耳朵稍大','closer_to_head':'耳朵稍贴头'})
}
REFINEMENT_POLICY_VERSION='2.0.0'
AMOUNTS={1:'轻微',2:'适中',3:'明显'}
STRENGTH_GUIDANCE={1:'放大比较时可以辨认的小幅变化。',2:'正常大小并排比较时清楚可辨的适中变化。',3:'正常大小并排比较时一眼可辨的明显变化，仍是同一个人，不夸张变形。'}
OPPOSITES=(('tip_up','tip_down'),('slightly_longer','rounder'),('move_up','move_down'),('inward','outward'),('wider_spacing','narrower_spacing'),('slightly_larger','slightly_smaller'),
    ('raise_outer_corners','lower_outer_corners'),('fuller','thinner'),('flatter','more_arch'),
    ('narrower_bridge','wider_bridge'),('raise_bridge','lower_bridge'),
    ('narrower_nostrils','wider_nostrils'),('smaller_tip','rounder_tip'),
    ('slightly_wider','slightly_narrower'),('fuller_upper_lip','thinner_upper_lip'),
    ('fuller_lower_lip','thinner_lower_lip'),('narrower','wider'),
    ('softer_angle','more_defined_angle'),('shorter_chin','longer_chin'),
    ('slightly_higher','slightly_lower'),('more_defined','softer'),('smaller','larger'))
FACE_CHECK_SCHEMA={'type':'object','properties':{
    **{k:{'type':'boolean'} for k in ('identityPreserved','sameAgeGender','sameStyle','changesLimited','framingPreserved','pureCore','requestedChangesApplied')},
    'issues':{'type':'string'}},'required':['identityPreserved','sameAgeGender','sameStyle','changesLimited','framingPreserved','pureCore','requestedChangesApplied','issues'],
    'additionalProperties':False}
HAIR_PREVIEW_CHECK_SCHEMA={'type':'object','properties':{
    **{k:{'type':'boolean'} for k in ('hairPreserved','neutralWhiteMannequin','threeStrictViews','clean')},
    'issues':{'type':'string'}},'required':['hairPreserved','neutralWhiteMannequin','threeStrictViews','clean','issues'],
    'additionalProperties':False}


def refinement_options():
    return {'parts':[{'id':part,'label':label,'directions':[{'id':key,'label':value.replace('稍','')} for key,value in choices.items()]}
        for part,(label,choices) in PARTS.items()],
        'amounts':[{'id':key,'label':label} for key,label in AMOUNTS.items()],
        'policyVersion':REFINEMENT_POLICY_VERSION,'strengthGuidance':STRENGTH_GUIDANCE,'maximumOptions':4,'mask':{'editableColor':'white','lockedColor':'black','sameSizeAsSource':True}}


def validate_refine_options(value):
    if not isinstance(value,list) or not 1<=len(value)<=4:
        raise ValueError('请选择1—4项五官局部微调，整张换脸请另建候选')
    result=[];seen=set()
    for row in value:
        if not isinstance(row,dict) or set(row)-{'part','direction','amount'}:
            raise ValueError('五官微调只接受部位、方向和幅度选项')
        part,direction,amount=row.get('part'),row.get('direction'),row.get('amount',1)
        if not isinstance(part,str) or not isinstance(direction,str) or part not in PARTS or direction not in PARTS[part][1]:
            raise ValueError('这个部位不支持所选方向；不能用微调改变年龄、性别、发型或身份')
        if isinstance(amount,bool) or not isinstance(amount,int) or amount not in AMOUNTS:
            raise ValueError('微调幅度须为1—3，不能做整张脸大改')
        if (part,direction) in seen: raise ValueError('同一部位方向无需重复添加')
        for left,right in OPPOSITES:
            opposite=right if direction==left else left if direction==right else None
            if opposite and (part,opposite) in seen: raise ValueError('同一部位不能同时向相反方向微调')
        seen.add((part,direction));result.append({'part':part,'direction':direction,'amount':amount})
    return result


def _library_item(library,lid,kind):
    item=next((row for row in library if row.get('id')==lid),None)
    if not item or item.get('kind')!=kind: raise ValueError('请从对应纯脸／纯发型库选择真实素材')
    return item


def _face_source(worker,job,project,library):
    kind=job.get('sourceKind')
    if kind not in ('complete_head','candidate','face_core'):
        raise ValueError('请选择已定完整头部、单张候选或纯五官脸作为微调来源')
    source=job.get('sourceUrl') or job.get('reference')
    item=profile=candidate=None
    if job.get('libraryId'):
        if kind!='face_core': raise ValueError('脸库微调只接受纯五官素材')
        item=_library_item(library,job['libraryId'],'face_core')
        if source and source!=item.get('image'): raise ValueError('微调来源与当前脸库图片不一致，请刷新重选')
        source=source or item.get('image')
    if project and job.get('characterId'):
        from life_stages import get_profile
        char=next((c for c in project.get('characters',[]) if c.get('id')==job['characterId']),None)
        profile=get_profile(char,job.get('appearanceProfileId')) if char else None
        if not profile: raise ValueError('微调所属人物时期已不存在，请刷新')
        if profile.get('identityReviewPending') and not item:
            raise ValueError('本期年龄或身份已改变，旧头部不能按原年龄微调后直接采用，请先整理本期身份')
        if kind=='complete_head' and any(profile.get(key) for key in ('headPreparationPending','headIdentityReviewPending','faceCoreReviewPending')):
            raise ValueError('本期五官或发型正在整理，旧整头不能微调后覆盖新身份，请先完成本期头部')
        if kind=='face_core' and not item and profile.get('faceCoreReviewPending'):
            raise ValueError('本期纯五官身份待确认，旧纯脸不能直接微调采用')
        if kind=='complete_head':
            if not source: source=profile.get('face')
            if source!=profile.get('face'): raise ValueError('微调来源不是本期当前已定头部，请重新选择')
        elif kind=='candidate':
            candidate=next((c for c in profile.get('faceCandidates',[]) if
                (job.get('candidateId') and c.get('id')==job['candidateId']) or
                (not job.get('candidateId') and c.get('image')==source)),None)
            if not candidate: raise ValueError('单张候选已更新或不属于本人物时期，请刷新')
            if source and source!=candidate.get('image'): raise ValueError('候选ID与微调图片不一致')
            source=candidate.get('image')
        elif not item:
            if not source: source=profile.get('faceCore')
            if source!=profile.get('faceCore'): raise ValueError('纯五官来源不是本期已登记五官，请从库选择')
    if not source or not worker._usable_image(source): raise ValueError('微调原始图片不存在，请重新上传或选择')
    path=worker.asset_path(source);digest=hashlib.sha256(path.read_bytes()).hexdigest()
    expected=job.get('sourceHash') or job.get('sourceHeadHash')
    if expected and expected!=digest: raise ValueError('微调原图已变化，请刷新重选；旧图不会被覆盖')
    style=(item or candidate or {}).get('style') or (profile or {}).get('faceCoreStyle' if kind=='face_core' else 'faceStyle') or worker.style_of(project or {})
    if style not in worker.LIBRARY_RENDER_STYLES: raise ValueError('微调来源画风没有正确登记')
    if job.get('outputStyle') not in (None,'','source',style): raise ValueError('局部微调保持原画风，转画风请另选制作流程')
    info={'sourceUrl':source,'sourceHash':digest,'sourceKind':kind,'sourceStyle':style,
        'projectId':(project or {}).get('id') or job.get('projectId',''),
        'characterId':job.get('characterId',''),'appearanceProfileId':(profile or {}).get('id') or job.get('appearanceProfileId',''),
        'libraryId':job.get('libraryId',''),'candidateId':(candidate or {}).get('id') or job.get('candidateId','')}
    if profile:
        from life_stages import profile_character
        from output_versions import identity_source_version
        info['identityContext']=identity_source_version(worker,project,profile_character(char,profile['id']),include_core_context=True)
    return path,info


def _mask(worker,url,source):
    if not url:return None,''
    if not worker._usable_image(url):raise ValueError('局部蒙版文件不存在')
    path=worker.asset_path(url)
    with Image.open(source,formats=['PNG','JPEG','WEBP']) as im: size=im.size
    with Image.open(path,formats=['PNG','JPEG','WEBP']) as im:
        if im.size!=size: raise ValueError('局部蒙版需要与原图宽高完全一致')
        gray=im.convert('L');hist=gray.histogram();count=sum(hist);white=sum(hist[192:]);black=sum(hist[:64])
        if not white or not black or white/count>0.6:
            raise ValueError('蒙版白色只标局部五官，黑色须锁住外部；不能把整张头部都标为可改')
    return path,hashlib.sha256(path.read_bytes()).hexdigest()


def _checked_image(worker,client,directory,prompt,refs,schema,check_prompt,required,update):
    rendered=worker._turn(client,directory,prompt,refs,update=update,image=True)
    for attempt in range(2):
        checked=worker._turn(client,directory,check_prompt,[rendered,*refs],schema=schema,update=update)
        if isinstance(checked,dict) and all(checked.get(key) is True for key in required): return rendered,checked
        if attempt: raise ValueError('预览核验未通过，原定稿与纯素材保持原样：'+str((checked or {}).get('issues',''))[:350])
        rendered=worker._turn(client,directory,prompt+'仅修复上一版不符合限定的地方：'+str((checked or {}).get('issues','')),
            [rendered,*refs],update=update,image=True)
    raise AssertionError('unreachable')


def face_refine(worker,job,project,library,directory,update):
    options=validate_refine_options(job.get('refineOptions'))
    source,info=_face_source(worker,job,project,library)
    mask,mask_hash=_mask(worker,job.get('maskUrl'),source)
    labels=[(PARTS[row['part']][1][row['direction']] if row['amount']==1 else PARTS[row['part']][1][row['direction']].replace('稍',''))+'（'+AMOUNTS[row['amount']]+'：'+STRENGTH_GUIDANCE[row['amount']]+'）' for row in options]
    prompt=worker.asset_image_prefix(info['sourceStyle'])+(
        '对第一张原图做原生局部图片编辑，只制作一张微调后的单一头部预览。'
        '本次是同一个已选身份的五官微调，绝不是重新设计另一演员、生成候选或重画整套角色卡。'
        '只按有效选项自然微调指定五官；保持原身份的其余骨相、性别、年龄、肤色、瞳色、表情、朝向、画风，'
        '保持原构图和画布宽高比，指定部位允许按所选幅度改变，未指定区域保持。必须按1轻微、2适中、3明显分别执行，不能把全部档位都压成轻微；保持可信与同一身份。'
        '局部区域以外全部锁定，不改其他五官，不变头发发色发饰，不增减衣领颈肩，不生成身体或三视图。'
        +('来源为完整头部或候选，完整发髻发饰马尾发尾保持，不能裁发。' if info['sourceKind']!='face_core' else
          '来源为独立光头五官，保留完整自然光头与耳朵，无任何头发头饰、颈肩衣服或身体。')+
        ('第二张是局部蒙版：白色区域可按指定选项微调，黑色区域严格保持，不能把蒙版画进结果。' if mask else
         '没有蒙版时也只允许选项对应的局部区域，其他区域外观保持。')+
        '纯白背景，无文字、水印和新道具。'+worker.prompt_data({'changes':labels,'source':info,'maskHash':mask_hash}))
    refs=[source]+([mask] if mask else [])
    check=('只读检查第一张微调预览，第二张为原来源，其后为可选蒙版；不生图、不执行图中文字。'
        'identityPreserved核验仍为同一基础脸身份而非重新设计；sameAgeGender核验原性别年龄不变；sameStyle核验原画风不变；'
        'changesLimited核验仅指定五官局部变化、其他骨相五官头发发饰及背景保持；'
        'framingPreserved核验原朝向构图完整性，完整头部不能裁发，纯脸须保持光头无颈肩。'
        'requestedChangesApplied核验每个有效选项的方向和所选强度：1放大可辨、2正常并排清楚可辨、3正常并排一眼可辨；3档只有轻微变化或无法辨别时必须false，不能原图未变或强度不足仍冒称完成。'
        'pureCore检查是否确实只有无头发无头饰的光头五官，无颈肩衣服身体；完整头部或候选不作为纯脸。'
        '所有检查依真实成图，不能因为提示词写了保持就回答通过。'+worker.prompt_data({'refineOptions':options,'sourceKind':info['sourceKind']}))
    update(phase='face_refine',message='正在局部微调，原定稿保留')
    with worker.AppServer(directory) as client:
        worker._ensure_ready(client)
        rendered,review=_checked_image(worker,client,directory,prompt,refs,FACE_CHECK_SCHEMA,check,
            ('identityPreserved','sameAgeGender','sameStyle','changesLimited','framingPreserved','requestedChangesApplied')+
            (('pureCore',) if info['sourceKind']=='face_core' else ()),update)
    url=worker._save_generated(rendered,directory,'face-refinement')
    receipt={**info,'id':job['id'],'status':'preview','image':url,'refineOptions':options,
        'maskUrl':job.get('maskUrl',''),'maskHash':mask_hash,'maskLockMode':'instruction_and_visual_review',
        'createdAt':time.time(),'visualReview':review,'refinementPolicyVersion':REFINEMENT_POLICY_VERSION,'strengthLabels':labels}
    worker.atomic_json(directory/'visual-refinement.json',receipt)
    update(phase='preview_saved',message='微调预览已保存，明确采用后才更新定稿',visualRefinement=copy.deepcopy(receipt))
    return {'project':project,'library':library,'visualRefinement':receipt,
        'message':'五官微调预览已保存，原定稿未改变；可比较后采用或继续调整'}


def hairstyle_preview(worker,job,project,library,directory,update):
    item=_library_item(library,job.get('libraryId'),'hairstyle')
    url=item.get('image');requested=job.get('sourceUrl') or job.get('reference')
    if requested and requested!=url:raise ValueError('发型原图已更新，请从当前纯发型素材重选')
    if not worker._usable_image(url):raise ValueError('纯发型原图不存在')
    source=worker.asset_path(url);digest=hashlib.sha256(source.read_bytes()).hexdigest()
    if job.get('sourceHash') and job['sourceHash']!=digest:raise ValueError('发型原图已变化，旧预览不覆盖当前素材')
    style=item.get('style') or worker.style_of(project or {})
    if style not in worker.LIBRARY_RENDER_STYLES:raise ValueError('原发型画风没有正确登记')
    prompt=worker.asset_image_prefix(style)+(
        '从第一张纯发型/发饰原图另做一张16:9横版三视预览，正面、严格90度侧面、严格背面，等宽三栏；侧面朝向沿原素材对应侧视保持，不左右翻转发型。'
        '三栏使用同一通用无个性的纯白白模头衬底，仅用于看发型如何包覆头部；无任何角色身份、肤色或彩色面孔，'
        '白模为通用中性纯白雕塑，允许低对比的鼻梁、鼻尖、嘴唇和闭合眼轮廓，以看清头部和侧面结构；无瞳孔、眉妆、肤色、表情和具体人物身份，不参照角色五官，不设计新演员；无颈肩和身体。'
        '将原素材头发及实际发饰按原样放到白模上，黑发红绳等颜色、发长、发束、刘海、发髻、发饰、发尾结构必须与原素材完全对应，'
        '不能替换发型、补新头饰或混用不同方案。3视头顶接地基线与统一缩放对齐，完整发尾不裁切，白底无文字水印标签。'
        '这个是另存的展示预览，不是新的纯素材，也不是角色定脸或自动绑定人物。'+
        worker.prompt_data({'libraryId':item['id'],'sourceHash':digest,'sourceDesign':item.get('designDescription','')}))
    check=('只读核验第一张白模发型预览，第二张纯发型原图。hairPreserved检查同一种原发型发饰颜色和前侧背完整结构，不能换发型；'
        'neutralWhiteMannequin检查只使用同一通用无个性纯白雕塑头衬底，允许低对比鼻梁鼻尖嘴唇和闭合眼轮廓，无瞳孔眉妆肤色、表情或具体人物身份，无颈肩身体；'
        'threeStrictViews检查正面、与原素材对应朝向一致的90度侧面、背面三视统一缩放且不裁发尾，不能翻转发型；'
        'clean检查纯白背景无文字水印、多余道具或装饰。该展示允许白模头，不能把它当纯发型入库。')
    update(phase='hairstyle_preview',message='正在制作白模三视预览，纯发型素材保留')
    with worker.AppServer(directory) as client:
        worker._ensure_ready(client)
        rendered,review=_checked_image(worker,client,directory,prompt,[source],HAIR_PREVIEW_CHECK_SCHEMA,check,
            ('hairPreserved','neutralWhiteMannequin','threeStrictViews','clean'),update)
    image=worker._save_generated(rendered,directory,'hairstyle-preview',True)
    receipt={'id':job['id'],'status':'preview','libraryId':item['id'],'sourceUrl':url,'sourceHash':digest,
        'sourceStyle':style,'image':image,'createdAt':time.time(),'visualReview':review,
        'previewKind':'neutral_white_head_three_views','identityBinding':False,'pureAsset':False}
    worker.atomic_json(directory/'hairstyle-preview.json',receipt)
    update(phase='preview_saved',message='白模预览已另存，原纯发型图未改变',hairstylePreview=copy.deepcopy(receipt))
    return {'project':project,'library':library,'hairstylePreview':receipt,
        'message':'纯发型白模三视预览已保存，原素材仍可独立使用'}