"""Source integrity and human text approval are distinct, immutable checks."""
import hashlib
import json
import math
from pathlib import Path
from codex_client import CodexError
from bubble_text import validate_bubbles


def frame_hash(request):
    value=json.dumps(request.get('frame') or request['crop'],ensure_ascii=False,separators=(',',':'))
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def load_confirmed_text(job_dir,request):
    path=Path(job_dir)/'confirmed-text.json'
    if path.is_symlink() or not path.is_file():
        raise CodexError('请先校对并确认原文，再进行去字或分离气泡')
    record=json.loads(path.read_text(encoding='utf-8'))
    digest=hashlib.sha256((Path(job_dir)/'crop.png').read_bytes()).hexdigest()
    if record.get('schemaVersion')!=2 or record.get('jobId')!=request['id'] or not record.get('reviewRevision') or not record.get('confirmedAt'):
        raise CodexError('原文确认记录无效，请重新校对')
    if record.get('sourceCropSha256')!=digest or record.get('frameHash')!=frame_hash(request):
        raise CodexError('原图或选区已变化，原文确认已失效，请重新校对')
    bubbles=validate_bubbles({'bubbles':record.get('bubbles')},request)
    crop=request['crop'];frame=request.get('frame') or crop
    for bubble in bubbles:
        boxes=[bubble['box'],bubble.get('bubbleBox',bubble['box'])]
        boxes.extend(item.get('box') if isinstance(item,dict) else item for item in bubble.get('textBoxes',[]))
        for box in boxes:
            if not isinstance(box,list) or len(box)!=4 or any(isinstance(n,bool) or not isinstance(n,(int,float)) or not math.isfinite(n) for n in box):
                raise CodexError('确认文字或气泡坐标无效')
            x,y,w,h=box
            if min(x,y)<0 or min(w,h)<=0 or x+w>1000.001 or y+h>1000.001:
                raise CodexError('确认框超出原始局部图')
            l=crop['x']+x*crop['width']/1000;t=crop['y']+y*crop['height']/1000
            if l<frame['x']-.01 or t<frame['y']-.01 or l+w*crop['width']/1000>frame['x']+frame['width']+.01 or t+h*crop['height']/1000>frame['y']+frame['height']+.01:
                raise CodexError('确认文字或气泡框跨出选区，请修正后确认')
    return bubbles,record
