"""Single output hairstyle material: hair on a neutral white head, three views."""
import hashlib
import time
from uuid import uuid4

CHECKS=('hairPreserved','neutralWhiteMannequin','threeStrictViews','clean','matchesOutputStyle')
SCHEMA={'type':'object','properties':{**{k:{'type':'boolean'} for k in CHECKS},'issues':{'type':'string'}},'required':[*CHECKS,'issues'],'additionalProperties':False}

def mannequin_job(worker,job,project,library,directory,update):
    from identity_library import pure_metadata
    from visual_refinement import _checked_image
    requested=job.get('outputStyle') or job.get('style','国漫')
    style=({'photo':'真人','3d':'3D','comic':'漫画原画','mixed':'混合原样','unknown':'未知原样'}.get(job.get('sourceStyle','unknown'),'未知原样') if requested=='source' else requested)
    if style not in worker.LIBRARY_RENDER_STYLES:raise ValueError('发型输出风格不正确')
    metadata=pure_metadata({**job,'style':style,'outputStyle':requested})
    source_urls=[job.get('reference'),*job.get('references',[])]
    for item_id in job.get('referenceIds',[]):
        item=next((i for i in library if i['id']==item_id),None)
        if not item:raise ValueError('参考素材不存在')
        source_urls.append(item.get('image'))
    character=profile=None
    if project and job.get('characterId'):
        from life_stages import get_profile
        character=next((c for c in project.get('characters',[]) if c['id']==job['characterId']),None)
        profile=get_profile(character,job.get('appearanceProfileId')) if character else None
        if not profile:raise ValueError('没有找到人物时期')
        if not any(source_urls):source_urls.append(profile.get('face'))
    refs=worker.references(*[u for u in source_urls if u]);action=job.get('action','extract' if refs else 'generate')
    if action=='extract' and not refs:raise ValueError('提取发型需要参考图')
    prompt=worker.asset_image_prefix(style)+(
        '生成一张16:9横版发型素材，等宽三栏为正面、严格90°侧面、严格背面，统一缩放。'
        '同一发型与实际头饰放在同一通用中性纯白白模头上。白模仅展示头部结构，允许低对比鼻尖嘴唇和闭合眼轮廓，'
        '无瞳孔、眉妆、肤色、表情或具体人物五官；没有颈部、肩膀、衣服、身体。'
        '完整头发、发尾与实际头饰全部露出，不裁切、不省略，前侧背保持同一发型；白底无文字、标签或水印。'
        '只输出这一张白模三视图，不另外制作纯发型图。')
    prompt+=('附图是本期已定人物或发型参考，只提取它的实际发型和头饰，不借用脸或身份，后附身体图仅补全发尾结构。' if refs else '按描述设计新发型，未知部分为制作补设，不冒称原文事实。')
    prompt+=worker.prompt_data({'metadata':metadata,'instructions':job.get('instructions',''),'action':action,'subjectScope':job.get('subjectScope','原图主要人物')})
    check='只读核验第一张发型白模三视成品。hairPreserved：与后附参考保持同一发型发饰；无参考的新设计则三视自洽。neutralWhiteMannequin：通用纯白中性白模，没有具体演员五官或肤色，无颈肩身体。threeStrictViews：正、90度侧、背，统一尺寸，完整头发发尾不裁切。clean：白底无文字水印或多余物件。matchesOutputStyle：头发及头饰符合指定画风。'+worker.prompt_data({'outputStyle':style})
    with worker.AppServer(directory) as client:
        worker._ensure_ready(client)
        image,review=_checked_image(worker,client,directory,prompt,refs,SCHEMA,check,CHECKS,update)
    url=worker._save_generated(image,directory,'hairstyle-white-head-three-views',True)
    item={'id':uuid4().hex,'kind':'hairstyle','name':job.get('name') or '白模发型三视','style':style,**metadata,
          'description':job.get('description') or job.get('instructions',''),'image':url,'preview':url,
          'storageForm':'neutral_white_head_three_views','hairstyleValidated':True,'pureValidated':False,'pureReviewStatus':'checked',
          'visualReview':review,'libraryContractVersion':worker.library_contract_version(),'createdAt':time.time(),
          'sourceReferences':[u for u in source_urls if u],'creationAction':action,'sha256':hashlib.sha256(worker.asset_path(url).read_bytes()).hexdigest(),
          'sourceProjectId':(project or {}).get('id'),'sourceCharacterId':(character or {}).get('id'),'sourceProfileId':(profile or {}).get('id')}
    library.append(item)
    return {'project':project,'library':library,'message':'白模发型三视图已入库，只输出一版'}
