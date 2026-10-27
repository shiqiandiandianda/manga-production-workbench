"""Resolve immutable source images without per-task whole-page copies."""
from pathlib import Path
import re

def base_image(job: Path, request: dict) -> Path:
    legacy=job/'base.png'
    if legacy.is_file():
        if legacy.is_symlink():raise ValueError('任务图片路径无效')
        return legacy
    reference=request.get('baseImageRef','')
    match=re.fullmatch(r'/sources/([a-f0-9]{32})/(original\.png|revision-\d+\.png|submission-images/[a-f0-9]{64}\.png)',reference) if isinstance(reference,str) else None
    if not match or match[1]!=request.get('sourceId') or job.parent.name!='jobs':raise ValueError('任务原图引用无效')
    root=job.parent.parent;folder=root/'sources'/match[1];file=root/reference.lstrip('/')
    for candidate in [root/'sources',folder,file.parent,file]:
        if candidate.is_symlink():raise ValueError('任务原图路径无效')
    if not file.is_file():raise ValueError('任务原图不存在')
    return file
