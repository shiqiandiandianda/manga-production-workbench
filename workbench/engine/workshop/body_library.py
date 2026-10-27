"""Reusable age-aware neutral bodies with structured height and build facets."""
import copy
import time
from uuid import uuid4

VERSION='neutral-body-1'
HEIGHTS={'unspecified':'身高未分类','short':'矮','average':'中等身高','tall':'高'}
BUILDS={'unspecified':'体型未分类','slim':'瘦','average':'匀称','heavy':'胖','strong':'健壮'}
CHECKS=('neutralBaseClothes','bodyMatchesClassification','threeStrictViews','noCharacterIdentity','consistentScale','clean')
CHECK_SCHEMA={'type':'object','properties':{**{key:{'type':'boolean'} for key in CHECKS},'issues':{'type':'string'}},'required':[*CHECKS,'issues'],'additionalProperties':False}

def metadata(data,previous=None):
    from server import APIError
    result={}
    previous=previous or {}
    for field,choices in (('heightClass',HEIGHTS),('buildClass',BUILDS)):
        value=data.get(field,previous.get(field,'unspecified'))
        if not isinstance(value,str) or value not in choices:raise APIError('身体模板的高矮／胖瘦分类不正确。')
        result[field]=value
    height=data.get('heightCm',previous.get('heightCm'))
    if height in (None,''):result['heightCm']=None
    elif isinstance(height,bool) or not isinstance(height,(int,float)) or not 30<=height<=250:raise APIError('身高厘米数请填写30至250之间的数字，或留空。')
    else:result['heightCm']=height
    return result

def describe(data):
    from life_stages import AGE_LABELS
    values=metadata(data)
    return ' · '.join([AGE_LABELS.get(data.get('ageStage','unspecified'),'年龄未说明'),data.get('gender','未说明'),HEIGHTS[values['heightClass']],BUILDS[values['buildClass']]]+([f"{values['heightCm']:g} cm"] if values['heightCm'] else []))

def generate(worker,job,library,directory,update):
    from identity_library import pure_metadata
    from visual_refinement import _checked_image
    standard={**pure_metadata(job),**metadata(job)}
    style=job.get('style') if job.get('style') in worker.STYLES else '国漫'
    name=job.get('name') or describe(standard)
    description=job.get('instructions','')
    prompt=(f'使用内置生图工具，只生成一张{style}可复用中性素体身体模板，16:9横版，纯白无缝背景。'
      '从左到右三个等宽视图：正面全身、面朝画面右方的严格90°侧面全身、严格背面全身；头顶到脚底全部呈现。'
      '同一身体、统一缩放、平视镜头，肩部、腰部、膝盖和脚底对齐，正常站姿，双臂自然下垂。'
      '统一穿简单贴身、不透的纯白短袖基础T恤与纯白及大腿中段的基础短裤，平整无图案、无标识、无装饰。'
      '身体轮廓和四肢比例清晰，衣服是基础遮盖层；不得使用具体角色的服装、盔甲、制服、鞋靴、手套、护腕、饰品或道具。'
      '赤足，完整呈现脚部结构。头部为无头发的通用简化中性头，不沿用具体角色的五官、发型或头饰。身体使用自然肤色。'
      '男女、年龄、高矮胖瘦严格按classification，身高类别相对对应年龄；厘米数只指导设定比例，不画标尺文字。'
      '婴幼儿采用自然坐姿或适龄姿态，不强求成年人的站姿。儿童采用儿童的头身比例、肩胯和四肢；青年、成年、中年、老年采用各自自然结构，不把儿童缩小成年身体，也不把老年直接换为青年。'
      '原文未指定年龄时制作普通成年人体型，并把这一项当作制作补设。classification优先于自由描述中的冲突，基础白衣和中性身份规范固定。'
      '附图若存在仅用来估计年龄、性别与肤色，不复制脸、头发、原衣服或配饰。无标题、无文字、无水印，无装饰框。')
    if standard.get('ageStage')!='unspecified':prompt=prompt.replace('原文未指定年龄时制作普通成年人体型，并把这一项当作制作补设。','')
    prompt+=worker.prompt_data({'classification':standard,'bodyStructureNotes':description})
    with worker.AppServer(directory) as client:
        worker._ensure_ready(client)
        path,review=_checked_image(worker,client,directory,prompt,worker.references(job.get('faceReference')),CHECK_SCHEMA,
              '核对这张身体模板：白色基础T恤短裤、无角色服装配饰；无发中性头、没有角色五官；年龄性别及高矮胖瘦符合classification；正面、朝右严格90°侧面、背面完整三视，同一身体同一比例且脚底对齐；纯白无字。'+worker.prompt_data({'classification':standard}),required=CHECKS,update=update)
        url=worker._save_generated(path,directory,'body',True)
    library.append({'id':uuid4().hex,'kind':'body','name':name[:160],'style':style,'description':description or describe(standard),
                    **standard,'image':url,'createdAt':time.time(),'bodyTemplateVersion':VERSION,'bodyTemplateValidated':True,
                    'bodyTemplateReview':review,'basicClothes':'white_plain_tshirt_shorts','identityMode':'generic_hairless_head'})
    return {'library':library,'message':'白色基础衣着素体已存入身体模板库'}

def mutation(app,method,parts,payload):
    from server import APIError,library_record,now
    if method!='PATCH' or len(parts)!=3 or parts[:2]!=['api','library']:return False,None
    item=app.find(app.state['library'],parts[2],'素材')
    if item.get('kind')!='body':return False,None
    active=[j for j in app.state['jobs'] if j.get('status') in {'running','queued'} and (j.get('libraryId')==item['id'] or j.get('bodyId')==item['id'])]
    if active:raise APIError('此身体模板正在制作，请完成后再编辑。',409)
    fields={'name','description','style','image','era','gender','ageStage','heightClass','buildClass','heightCm'}
    validated=library_record({**item,**{k:v for k,v in payload.items() if k in fields}})
    changed='image' in payload and validated['image']!=item.get('image')
    classification_changed=any(k in payload and validated[k]!=item.get(k) for k in ('gender','ageStage','heightClass','buildClass','heightCm','style'))
    for field in fields:
        if field in payload:item[field]=validated[field]
    if changed or classification_changed:item.update(bodyTemplateValidated=False,bodyTemplateReviewStatus='pending')
    item['updatedAt']=now();app.save();return True,copy.deepcopy(item)
