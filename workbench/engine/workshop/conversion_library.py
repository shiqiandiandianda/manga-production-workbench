"""Save verified conversion outputs as reusable cards, without generating images."""
import copy
from pathlib import Path

def save_result(app,job_id):
    from server import APIError,library_record,now
    from resource_control import file_hash
    from PIL import Image
    with app.lock:
        job=app.find(app.state['jobs'],job_id,'转换任务')
        result=job.get('toolResult',{})
        if job.get('kind')!='card_convert' or result.get('jobId')!=job_id or result.get('signature')!=job.get('toolSignature'):
            raise APIError('请选择已有标准角色图的转换任务。',409)
        components={}
        for key,component in result.get('components',{}).items():
            if key not in {'card','hands','combined'} or component.get('status')!='completed':continue
            path=app.file_path(component.get('image'))
            own=(app.data/'generated'/job_id).resolve()
            seed=job.get('toolSeed',{}).get('components',{}).get(key,{})
            reused=seed.get('image')==component.get('image') and seed.get('sha256')==component.get('sha256')
            if not path.is_relative_to(own) and not reused:raise APIError('结果图片与任务不对应。',409)
            if not path.is_file() or file_hash(path)!=component.get('sha256'):raise APIError('成品图片已变化或缺失，请重新核验。',409)
            try:
                with Image.open(path) as image:
                    if image.size!=((1920,2160) if key=='combined' else (1920,1080)):raise APIError('成品尺寸不符合角色卡模板。',409)
                    image.verify()
            except (OSError,ValueError) as error:raise APIError('成品图片无法读取。',409) from error
            components[key]=copy.deepcopy(component)
        if 'card' not in components:raise APIError('标准角色图尚未完成，暂时不能存入素材库。',409)
        existing=next((item for item in app.state['library'] if item.get('kind')=='character_card' and item.get('sourceToolJobId')==job_id),None)
        trashed=next((entry for entry in app.state.get('materialRecycleBin',[]) if entry['item'].get('sourceToolJobId')==job_id and entry['item'].get('kind')=='character_card'),None)
        if not existing and trashed:raise APIError('这张角色卡已在回收站，请先恢复，避免重复入库。',409)
        item=existing or library_record({'kind':'character_card','name':job.get('name') or '转换角色卡','style':job.get('style','source') if job.get('style')!='source' else '未知原样'})
        old=copy.deepcopy(item)
        source_info=result.get('sourceInfo',{})
        item.update(image=components['card']['image'],card=components['card']['image'],components=components,
                    hands=components.get('hands',{}).get('image',''),combined=components.get('combined',{}).get('image',''),
                    sourceToolJobId=job_id,sourceOutfitId=job.get('sourceOutfitId',''),sourcePlanJobId=job.get('outfitPlanJobId',''),
                    sourceReferences=copy.deepcopy(job.get('references',[])),sourceInfo=copy.deepcopy(source_info),
                    description=source_info.get('outfit',''),templateVersion=result.get('templateVersion'),
                    gestures=copy.deepcopy(result.get('gestures',[])),updatedAt=now(),styleLabel='保持原图画风' if job.get('style')=='source' else job.get('style'))
        duplicate=bool(existing and {k:v for k,v in old.items() if k!='updatedAt'}=={k:v for k,v in item.items() if k!='updatedAt'})
        if not existing:app.state['library'].append(item)
        try:app.save()
        except Exception:
            if existing:existing.clear();existing.update(old)
            else:app.state['library'].remove(item)
            raise
        return {'saved':True,'duplicate':duplicate,'item':copy.deepcopy(item)}
