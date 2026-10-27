"""Project-free card conversion and deterministic image composition."""
import copy
import hashlib
from resource_control import file_hash
import io
import json
from pathlib import Path
import zipfile

TOOL_KINDS={'card_convert','card_outfit_scan','image_combine'}

def signature(job):
    keys=('kind','references','sourceHashes','style','targetSubject','instructions','gestures','includeHands','templateHash')
    data={k:job.get(k) for k in keys}
    if job.get('outfitContext'):data['outfitContext']=job['outfitContext']
    if job.get('kind')=='card_outfit_scan':data['autoConvert']=job.get('autoConvert',False)
    return hashlib.sha256(json.dumps(data,ensure_ascii=False,sort_keys=True).encode()).hexdigest()

def prepare_job(app,job,payload):
    from server import APIError,image_urls,text_value,STYLES
    from PIL import Image
    if any(payload.get(k) for k in ('projectId','characterId','outfitId')):raise APIError('快捷工具结果独立保存，不需要项目编号。')
    style=payload.get('style','source')
    if style not in STYLES|{'source'}:raise APIError('请选择保留原图画风或漫画画风。')
    refs=image_urls(payload.get('references') or ([payload['reference']] if payload.get('reference') else []))
    expected=2 if job['kind']=='image_combine' else 1
    if len(refs)!=expected and not (job['kind']=='card_convert' and payload.get('outfitPlanJobId')):raise APIError('转换每次需要一张角色图。' if expected==1 else '上下拼接需要上图和下图各一张。')
    hashes={}
    for url in refs:
        path=app.file_path(url)
        if not path.is_file() or path.suffix.lower() not in {'.png','.jpg','.jpeg','.webp'}:raise APIError('来源图片不存在或格式错误。',404)
        try:
            with Image.open(path,formats=['PNG','JPEG','WEBP']) as image:image.verify()
        except (OSError,ValueError):raise APIError('来源图片无法读取，请重新上传。')
        hashes[url]=file_hash(path)
    hands=payload.get('includeHands',True)
    if not isinstance(hands,bool):raise APIError('手部选项需要是布尔值。')
    actions=payload.get('gestures',[])
    if not isinstance(actions,list) or len(actions)>8 or any(not isinstance(a,str) or not a.strip() or len(a)>1500 for a in actions):raise APIError('手部动作最多8个，每项需要非空文字。')
    job.update(projectId=None,characterId=None,outfitId=None,count=1,style=style,references=refs,sourceHashes=hashes,
               targetSubject=text_value(payload.get('targetSubject',''),'图中人物与服装选择',2000),
               name=text_value(payload.get('name','') or ('外部角色卡' if expected==1 else '图片上下拼接'),'任务名称',160,True),
               gestures=[a.strip() for a in actions],includeHands=hands if expected==1 else False)
    if job['kind']=='card_outfit_scan':
        if not isinstance(payload.get('autoConvert',False),bool):raise APIError('自动转换选项无效。')
        job['autoConvert']=payload.get('autoConvert',False)
    if payload.get('outfitPlanJobId') or payload.get('sourceOutfitId'):
        if job['kind']!='card_convert':raise APIError('服装清单只能用于角色卡转换。')
        from outfit_conversion import context_for
        scan=app.find(app.state['jobs'],payload.get('outfitPlanJobId'),'服装识别任务')
        original=scan.get('references',[])
        context=context_for(app,payload.get('outfitPlanJobId'),payload.get('sourceOutfitId'),original)
        if refs!=original and refs!=context['references']:raise APIError('转换来源与服装清单不对应。',409)
        job.update(outfitPlanJobId=context['scanJobId'],sourceOutfitId=context['outfitId'],outfitContext=context)
        job['references']=context['references'];job['sourceHashes']={u:file_hash(app.file_path(u)) for u in job['references']}
    job['toolSignature']=signature(job)
    retry=payload.get('retryOf')
    if retry:
        prior=app.find(app.state['jobs'],retry,'原快捷任务')
        if prior.get('kind')!=job['kind'] or prior.get('status') not in {'failed','cancelled'}:raise APIError('只能继续未完成的同类快捷任务。',409)
        if prior.get('toolSignature')!=job['toolSignature']:raise APIError('来源或制作选项已经变化，请重新提交转换。',409)
        if any(j.get('status') in {'queued','running'} and (j.get('id')==retry or j.get('retryOf')==retry) for j in app.state['jobs']):raise APIError('这份结果已经在继续制作，请等待当前任务。',409)
        seed=copy.deepcopy(prior.get('toolResult') or {})
        for component in seed.get('components',{}).values():
            if component.get('status')=='completed':
                path=app.file_path(component.get('image'))
                if not path.is_file() or file_hash(path)!=component.get('sha256'):raise APIError('已完成图片已变化或缺失，请重新转换。',409)
        job.update(retryOf=retry,toolSeed=seed)

def assert_sources(app,job):
    from server import APIError
    for url,digest in job.get('sourceHashes',{}).items():
        path=app.file_path(url)
        if not path.is_file() or file_hash(path)!=digest:raise APIError('原图已变化或缺失，未覆盖原结果，请重新上传。',409)

def validate_result(app,job,receipt):
    from server import APIError
    from PIL import Image
    if job.get('kind') not in TOOL_KINDS or not isinstance(receipt,dict) or receipt.get('jobId')!=job['id'] or receipt.get('signature')!=job.get('toolSignature'):raise APIError('快捷工具结果与任务不对应。',409)
    assert_sources(app,job)
    if job['kind']=='card_outfit_scan':
        from outfit_conversion import validate_plan_files
        if receipt.get('components'):raise APIError('识别清单不能包含生图成品。',409)
        validate_plan_files(app,job,receipt)
        return copy.deepcopy(receipt)
    seed=job.get('toolSeed',{}).get('components',{})
    for name,component in receipt.get('components',{}).items():
        if name not in {'card','hands','combined'}:raise APIError('快捷工具输出类别不正确。')
        if component.get('status')!='completed':continue
        url=component.get('image');path=app.file_path(url)
        directory=(app.data/'generated'/job['id']).resolve()
        reused=seed.get(name,{}).get('image')==url and seed.get(name,{}).get('sha256')==component.get('sha256')
        if not path.is_relative_to(directory) and not reused:raise APIError('结果图片不属于本次任务。',409)
        if not path.is_file() or file_hash(path)!=component.get('sha256'):raise APIError('结果图片已经变化或缺失。',409)
        expected=(1920,2160) if name=='combined' else (1920,1080)
        with Image.open(path) as image:
            if image.size!=expected:raise APIError('结果画布尺寸与统一模板不一致。',409)
    return copy.deepcopy(receipt)

def export_result(app,job_id,output=None):
    from server import APIError,template_info
    job=app.find(app.state['jobs'],job_id,'快捷任务');receipt=job.get('toolResult')
    if job.get('kind') not in TOOL_KINDS or not receipt:raise APIError('这个任务还没有可导出的快捷结果。',404)
    if job['kind']=='card_outfit_scan':
        from outfit_conversion import export_scan
        return export_scan(app,job,output=output)
    # Source files can be missing later; completed output can still be exported.
    buffer=output if output is not None else io.BytesIO();files=[]
    with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('制作记录.json',json.dumps({'job':{k:v for k,v in job.items() if not k.startswith('_')},'result':receipt},ensure_ascii=False,indent=2))
        archive.writestr('格式模板.json',json.dumps(template_info(),ensure_ascii=False,indent=2))
        for name,component in receipt.get('components',{}).items():
            if component.get('status')!='completed':continue
            path=app.file_path(component.get('image'))
            if not path.is_file():continue
            if file_hash(path)!=component.get('sha256'):raise APIError('结果文件已变化，未导出未核验图片。',409)
            archive.write(path,{'card':'01_标准角色卡.png','hands':'02_八格手部卡.png','combined':'03_上下合成图.png'}[name]);files.append(name)
        for i,url in enumerate(job.get('references',[]),1):
            path=app.file_path(url)
            if path.is_file() and file_hash(path)==job.get('sourceHashes',{}).get(url):archive.write(path,f'原图/{i:02d}_参考{path.suffix}')
    if not files:raise APIError('暂时没有已完成的图片可导出。',409)
    return output if output is not None else buffer.getvalue()
