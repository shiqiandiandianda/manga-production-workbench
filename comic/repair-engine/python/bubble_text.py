"""Extract bubble text before cleanup and create real editable project text layers."""
import json
import math
import re
import hashlib
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from codex_client import CodexError

BOX_SCHEMA={'type':'array','items':{'type':'number'},'minItems':4,'maxItems':4}
def result_schema(placement=False,separated=False):
    properties={'box':BOX_SCHEMA}
    if separated:properties['bubbleBox']=BOX_SCHEMA
    if separated and placement:properties['empty']={'type':'boolean'}
    if not placement:
        properties.update(text={'type':'string'},fontSize={'type':'number'},direction={'type':'string','enum':['horizontal','vertical-rl','vertical-lr']},align={'type':'string','enum':['left','center','right']})
    top={'bubbles':{'type':'array','items':{'type':'object','properties':properties,'required':list(properties),'additionalProperties':False},'maxItems':12}}
    if separated and placement:top['backgroundClean']={'type':'boolean'}
    return {'type':'object','properties':top,'required':list(top),'additionalProperties':False}

def vision_json(client,job_dir,image,prompt,timeout,cancelled,placement=False,separated=False,additional_images=None):
    if cancelled and cancelled():raise CodexError('修图任务已取消')
    thread_response=client.request('thread/start',{'cwd':str(job_dir),'ephemeral':True,'approvalPolicy':'on-request','sandbox':'read-only'})
    thread=thread_response['thread']['id']
    params={'threadId':thread,'cwd':str(job_dir),'input':[{'type':'text','text':prompt},{'type':'localImage','path':str(image)}]+[{'type':'localImage','path':str(p)} for p in additional_images or []],'outputSchema':result_schema(placement,separated)}
    choose_effort=getattr(client,'simple_vision_effort',None)
    effort=choose_effort(thread_response) if callable(choose_effort) else None
    if effort is not None:params['effort']=effort
    if cancelled and cancelled():raise CodexError('修图任务已取消')
    turn=client.request('turn/start',params)['turn']['id']
    final=None;completed=False
    try:
        for event in client.events(timeout,cancelled=cancelled):
            p=event.get('params') or {}
            if p.get('threadId') not in [None,thread] or p.get('turnId') not in [None,turn]:continue
            item=p.get('item') or {}
            if event.get('method')=='item/completed':
                if item.get('type') in ['imageGeneration','commandExecution','fileChange']:raise CodexError('文字识别阶段执行了额外操作，已停止')
                if item.get('type')=='agentMessage' and item.get('phase') in [None,'final_answer']:final=item.get('text')
            if event.get('method')=='turn/completed' and p.get('turn',{}).get('id')==turn:
                if p['turn'].get('status')!='completed':raise CodexError((p['turn'].get('error') or {}).get('message','气泡文字识别未完成'))
                completed=True;break
        if not completed or not final:raise CodexError('未收到气泡文字识别结果，原图未去字')
        try:return json.loads(final)
        except (ValueError,TypeError):raise CodexError('气泡识别结果格式无效，原图未去字')
    except Exception:
        try:client.request('turn/interrupt',{'threadId':thread,'turnId':turn},timeout=5)
        except Exception:pass
        raise

def validate_bubbles(value,request,placement=False,original=None,separated=False):
    bubbles=value.get('bubbles') if isinstance(value,dict) else None
    if not isinstance(bubbles,list) or not 1<=len(bubbles)<=12:raise CodexError('选区内未识别到气泡原文，请框住有文字的原始气泡重新提交')
    if placement and len(bubbles)!=len(original):raise CodexError('去字后的气泡位置数量不一致，未创建错误文字图层')
    if placement and separated and value.get('backgroundClean') is not True:raise CodexError('背景中仍有原气泡残留，请重新分离，未接回不完整图层')
    crop=request['crop'];frame=request.get('frame') or crop;result=[]
    for index,item in enumerate(bubbles):
        box=item.get('box') if isinstance(item,dict) else None
        if not isinstance(box,list) or len(box)!=4 or any(isinstance(n,bool) or not isinstance(n,(float,int)) or not math.isfinite(n) for n in box):raise CodexError('气泡文字位置无效')
        x,y,w,h=box
        if min(x,y)<0 or min(w,h)<=0 or x+w>1001 or y+h>1001:raise CodexError('气泡文字位置超出图片')
        cx=crop['x']+(x+w/2)*crop['width']/1000;cy=crop['y']+(y+h/2)*crop['height']/1000
        if not (frame['x']<=cx<=frame['x']+frame['width'] and frame['y']<=cy<=frame['y']+frame['height']):raise CodexError('识别到了选区外的气泡，已停止，避免修改其他对白')
        if separated:
            if placement and item.get('empty') is not True:raise CodexError('透明气泡内仍有原文字，未接回重复对白')
            shape=item.get('bubbleBox')
            if not isinstance(shape,list) or len(shape)!=4 or any(isinstance(n,bool) or not isinstance(n,(int,float)) or not math.isfinite(n) for n in shape):raise CodexError('完整气泡框位置无效')
            sx,sy,sw,sh=shape
            if min(sx,sy)<0 or min(sw,sh)<=0 or sx+sw>1000 or sy+sh>1000 or x<sx or y<sy or x+w>sx+sw+1 or y+h>sy+sh+1:raise CodexError('文字框不在完整气泡内')
            left=crop['x']+sx*crop['width']/1000;top=crop['y']+sy*crop['height']/1000
            if left<frame['x']-1 or top<frame['y']-1 or left+sw*crop['width']/1000>frame['x']+frame['width']+1 or top+sh*crop['height']/1000>frame['y']+frame['height']+1:raise CodexError('请把气泡边框和尾巴完整框进选区后再分离')
        if placement:entry={**original[index],'box':box,**({'bubbleBox':shape} if separated else {})}
        else:
            text=item.get('text');size=item.get('fontSize')
            if not isinstance(text,str) or not text.strip() or len(text)>2000:raise CodexError('气泡原文为空或过长，已停止去字')
            if not isinstance(size,(int,float)) or isinstance(size,bool) or not math.isfinite(size) or not 6<=size<=512:raise CodexError('气泡字号识别无效')
            if item.get('direction') not in ['horizontal','vertical-rl','vertical-lr'] or item.get('align') not in ['left','center','right']:raise CodexError('气泡排版识别无效')
            entry={**item,'text':text.replace('\r\n','\n').replace('\r','\n').strip()}
        result.append(entry)
    return result

def _pixel_box(box, size):
    if not isinstance(box, (list, tuple)) or len(box) != 4 or any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) for n in box):
        raise CodexError('本地 OCR 文字坐标无效，原图未去字')
    x, y, w, h = box
    if min(x, y) < 0 or min(w, h) <= 0 or x+w > size[0]+1 or y+h > size[1]+1:
        raise CodexError('本地 OCR 文字坐标超出局部图，原图未去字')
    return [float(x), float(y), float(w), float(h)]


def _union_boxes(boxes):
    left=min(b[0] for b in boxes);top=min(b[1] for b in boxes)
    return [left,top,max(b[0]+b[2] for b in boxes)-left,max(b[1]+b[3] for b in boxes)-top]


def bubbles_from_ocr(value, request):
    """Group local OCR lines conservatively; OCR bounds describe text, never bubble outlines."""
    from local_ocr import normalize_text
    crop=request['crop'];frame=request.get('frame') or crop
    if not isinstance(value,dict) or value.get('width')!=crop['width'] or value.get('height')!=crop['height'] or not isinstance(value.get('lines'),list):
        raise CodexError('本地 OCR 图片尺寸或返回格式不一致，原图未去字')
    fx,fy=frame['x']-crop['x'],frame['y']-crop['y'];right,bottom=fx+frame['width'],fy+frame['height']
    segments=[]
    for line in value['lines']:
        if not isinstance(line,dict) or not isinstance(line.get('words'),list):raise CodexError('本地 OCR 行格式无效')
        selected=[]
        for word in line['words']:
            if not isinstance(word,dict) or not isinstance(word.get('text'),str):raise CodexError('本地 OCR 字词格式无效')
            box=_pixel_box(word.get('box'),(crop['width'],crop['height']));x,y,w,h=box
            if not word['text'].strip():continue
            inside=fx<=x and fy<=y and x+w<=right and y+h<=bottom
            overlaps=x<right and x+w>fx and y<bottom and y+h>fy
            if overlaps and not inside:raise CodexError('文字跨越选区边缘，请完整框住原文后重试，原图未去字')
            if inside:selected.append({'text':word['text'],'box':box})
        if not selected:continue
        all_box=_union_boxes([w['box'] for w in selected]);vertical=all_box[3]>all_box[2]*1.6 and len(selected)>1
        selected.sort(key=lambda w:(w['box'][1],w['box'][0]) if vertical else (w['box'][0],w['box'][1]))
        groups=[];group=[]
        for word in selected:
            if group:
                previous=group[-1]['box'];current=word['box']
                gap=current[1]-(previous[1]+previous[3]) if vertical else current[0]-(previous[0]+previous[2])
                unit=max(previous[2],current[2]) if vertical else max(previous[3],current[3])
                if gap>unit*1.8:groups.append(group);group=[]
            group.append(word)
        groups.append(group)
        for words in groups:
            box=_union_boxes([w['box'] for w in words]);text=normalize_text(' '.join(w['text'] for w in words))
            if text:segments.append({'text':text,'box':box,'vertical':vertical})
    if not segments:raise CodexError('本地 OCR 未识别到选区内原文，原图未去字；请检查原图和选区')
    # Single-character vertical OCR often arrives as one horizontal line per glyph.
    for segment in segments:
        x,y,w,h=segment['box']
        if len(segment['text'].strip())==1 and any(other is not segment and abs(other['box'][0]-x)<max(w,other['box'][2])*.45 and 0<abs(other['box'][1]-y)<h*2.8 for other in segments):segment['vertical']=True
    groups=[]
    for segment in sorted(segments,key=lambda s:(s['box'][1],s['box'][0])):
        candidates=[]
        x,y,w,h=segment['box']
        for group in groups:
            if group[0]['vertical']!=segment['vertical']:continue
            gx,gy,gw,gh=_union_boxes([s['box'] for s in group])
            if segment['vertical']:
                overlap=min(y+h,gy+gh)-max(y,gy)
                same_column=any(abs(x-other['box'][0])<max(w,other['box'][2])*.45 and 0<=y-(other['box'][1]+other['box'][3])<=max(h,other['box'][3])*1.5 for other in group)
                next_column=overlap>=min(h,gh)*.5 and 0<=x-(gx+gw)<=max(w,gw/len(group))*.9
                match=same_column or next_column
            else:
                overlap=min(x+w,gx+gw)-max(x,gx)
                match=overlap>=min(w,gw)*.45 and 0<=y-(gy+gh)<=max(h,gh/len(group))*1.35
            if match:candidates.append(group)
        if len(candidates)>1:raise CodexError('本地 OCR 的相邻文字归属不明确，请缩小为单个完整气泡后重试')
        if candidates:candidates[0].append(segment)
        else:groups.append([segment])
    # Bubble spikes can look like a tiny isolated comma to OCR. Filter only a
    # detached single dot/comma next to substantially larger reliable text;
    # short dialogue, ellipses and punctuation attached to a text row survive.
    anchors=[]
    for group in groups:
        if sum(char.isalnum() for s in group for char in s['text'])<4:continue
        sizes=sorted(min(s['box'][2],s['box'][3]) if s['vertical'] else s['box'][3] for s in group)
        anchors.append((_union_boxes([s['box'] for s in group]),sizes[len(sizes)//2]))
    filtered=[]
    for group in groups:
        text=''.join(s['text'] for s in group).strip();x,y,w,h=_union_boxes([s['box'] for s in group]);noise=False
        if len(text)==1 and text in '、，,。．.·：:；;':
            for (gx,gy,gw,gh),size in anchors:
                if max(w,h)>size*.2:continue
                dx=max(gx-(x+w),x-(gx+gw),0);dy=max(gy-(y+h),y-(gy+gh),0)
                if (dx==0 or dy==0) and size*.5<math.hypot(dx,dy)<=size*3:
                    noise=True;break
        if not noise:filtered.append(group)
    groups=filtered
    if len(groups)>12:raise CodexError('本地 OCR 文字块过多，请缩小选区后重试')
    result=[]
    for group in sorted(groups,key=lambda g:(min(s['box'][1] for s in g),min(s['box'][0] for s in g))):
        vertical=group[0]['vertical'];box=_union_boxes([s['box'] for s in group])
        rows=sorted(group,key=lambda s:(-s['box'][0],s['box'][1]) if vertical else (s['box'][1],s['box'][0]))
        if vertical and all(len(s['text'])==1 for s in rows):
            columns=[]
            for row in rows:
                if not columns or abs(columns[-1][0]['box'][0]-row['box'][0])>=max(columns[-1][0]['box'][2],row['box'][2])*.45:columns.append([])
                columns[-1].append(row)
            text='\n'.join(''.join(s['text'] for s in sorted(column,key=lambda s:s['box'][1])) for column in columns)
        else:text='\n'.join(s['text'] for s in rows)
        size=sorted(min(s['box'][2],s['box'][3]) if vertical else s['box'][3] for s in group)[len(group)//2]
        result.append({'text':text,'box':[box[0]*1000/crop['width'],box[1]*1000/crop['height'],box[2]*1000/crop['width'],box[3]*1000/crop['height']],
                       'fontSize':max(6,min(512,size)), 'direction':'vertical-rl' if vertical else 'horizontal','align':'center',
                       'ocrEngine':value.get('engine','Windows.Media.Ocr'),'ocrLanguage':value.get('language','zh-Hans-CN'), 'geometrySource':'local-ocr-text'})
    return validate_bubbles({'bubbles':result},request)


def extract_bubbles(client,job_dir,request,timeout,cancelled,image=None):
    from local_ocr import recognize_image
    if cancelled and cancelled():raise CodexError('修图任务已取消')
    value=recognize_image(image or job_dir/'crop.png',cancelled=cancelled,timeout=min(timeout,30))
    return bubbles_from_ocr(value,request)


def extract_original_bubbles(client,job_dir,request,timeout,cancelled):
    """Recover text only from a hash-verified submission owned by the same region."""
    try:return extract_bubbles(None,job_dir,request,timeout,cancelled)
    except CodexError as error:
        if '未识别' not in str(error):raise
        previous=(request.get('region') or {}).get('jobId')
        if not isinstance(previous,str) or not re.fullmatch(r'\d{8}-\d{6}-[a-f0-9]{8}',previous) or not request.get('sourceId'):raise
        folder=job_dir.parent/previous;file=folder/'crop.png';request_file=folder/'request.json'
        if folder.is_symlink() or file.is_symlink() or request_file.is_symlink() or not file.is_file() or not request_file.is_file() or folder.resolve().parent!=job_dir.parent.resolve():raise
        old=json.loads(request_file.read_text(encoding='utf-8'))
        if old.get('id')!=previous or old.get('sourceId')!=request['sourceId'] or old.get('regionId')!=request.get('regionId'):raise
        expected=(old.get('inputSnapshot') or {}).get('sha256')
        if not isinstance(expected,str) or not re.fullmatch(r'[a-f0-9]{64}',expected):raise CodexError('上次提交缺少可验证的局部原图哈希，不能恢复原文')
        if hashlib.sha256(file.read_bytes()).hexdigest()!=expected:raise CodexError('上次提交的局部原图已变化，不能恢复原文')
        try:bubbles=extract_bubbles(None,job_dir,old,timeout,cancelled,image=file)
        except CodexError as prior_error:
            if '未识别' not in str(prior_error):raise
            automation_file=folder/'automation.json'
            if automation_file.is_symlink() or not automation_file.is_file():raise prior_error
            automation=json.loads(automation_file.read_text(encoding='utf-8'))
            attempt=automation.get('attemptId');record_hash=automation.get('originalTextRecordSha256')
            if automation.get('status')!='completed' or not isinstance(attempt,str) or not re.fullmatch(r'[a-f0-9]{32}',attempt) or not isinstance(record_hash,str) or not re.fullmatch(r'[a-f0-9]{64}',record_hash):raise prior_error
            record_file=folder/'attempts'/attempt/'original-bubble-text.json'
            if record_file.is_symlink() or not record_file.is_file() or record_file.resolve().parent!= (folder/'attempts'/attempt).resolve():raise prior_error
            if hashlib.sha256(record_file.read_bytes()).hexdigest()!=record_hash:raise CodexError('历史本地 OCR 记录哈希不一致，不能恢复原文')
            record=json.loads(record_file.read_text(encoding='utf-8'))
            if record.get('schemaVersion')!=1 or record.get('jobId')!=previous or record.get('attemptId')!=attempt or record.get('sourceCropSha256')!=expected or record.get('verifiedLocalOCR') is not True or record.get('ocrEngine')!='Windows.Media.Ocr':raise CodexError('历史识字记录缺少已验证的本地 OCR 来源，不能恢复原文')
            bubbles=validate_bubbles({'bubbles':record.get('bubbles')},old)
            for bubble in bubbles:bubble['recoveredFromVerifiedRecord']=True
        a=old['crop'];b=request['crop'];old_frame=old.get('frame') or a;frame=request.get('frame') or b
        dx=frame['x']-old_frame['x'];dy=frame['y']-old_frame['y']
        for bubble in bubbles:
            x,y,w,h=bubble['box'];bubble['box']=[(a['x']+x*a['width']/1000+dx-b['x'])*1000/b['width'],(a['y']+y*a['height']/1000+dy-b['y'])*1000/b['height'],w*a['width']/b['width'],h*a['height']/b['height']]
            bubble['recoveredFromJobId']=previous;bubble['recoveredSourceHash']=expected
        return validate_bubbles({'bubbles':bubbles},request)


def check_no_text(image_path,request,timeout,cancelled,label='去字图片',all_canvas=False):
    from local_ocr import recognize_image
    value=recognize_image(image_path,cancelled=cancelled,timeout=min(timeout,30))
    check_request={**request,'frame':request['crop']} if all_canvas else request
    try:bubbles_from_ocr(value,check_request)
    except CodexError as error:
        if '未识别' in str(error):return {'engine':value.get('engine'),'language':value.get('language'),'clean':True,'scope':'crop' if all_canvas else 'selected-frame','semanticReview':'manual'}
        raise
    raise CodexError(f'{label}仍识别到残留文字，未接回重复对白；请重试或人工检查')


def locate_clean_bubbles(client,job_dir,request,bubbles,timeout,cancelled,image=None):
    check_no_text(image or job_dir/'repaired.png',request,timeout,cancelled)
    geometry_request=bool(re.search(r'(?:气泡|bubble).{0,30}(?:缩|放|大|小|移|resize|scal|mov)|(?:resize|scale|move).{0,30}bubble',request.get('prompt',''),re.I))
    if not geometry_request:return validate_bubbles({'bubbles':[{'box':b['box']} for b in bubbles]},request,True,bubbles)
    from bubble_separation import _safe_interior
    from bubble_geometry import locate_bubble_geometry
    with Image.open(image or job_dir/'repaired.png') as raw:clean=raw.convert('RGBA')
    crop=request['crop'];frame=request.get('frame') or crop;positioned=[];used=set()
    for b in bubbles:
        x,y,w,h=b['box'];center=((x+w/2)*clean.width/1000,(y+h/2)*clean.height/1000)
        fx,fy=frame['x']-crop['x'],frame['y']-crop['y']
        geometry=locate_bubble_geometry(clean,[x*clean.width/1000,y*clean.height/1000,(x+w)*clean.width/1000,(y+h)*clean.height/1000],
                                       [max(0,fx),max(0,fy),min(clean.width,fx+frame['width']),min(clean.height,fy+frame['height'])],require_text_bounds=False)
        component=geometry['interior'];key=tuple(component['box'])
        if key in used:raise CodexError('气泡调整后无法可靠定位文字，请开启分离气泡或逐个完整框选重试')
        used.add(key)
        # Open spikes still connect the original pale pixels to the page. Restrict
        # the fitting image to the recovered interior, not its bounding box.
        fitting=clean.copy();alpha=Image.new('L',clean.size);draw=ImageDraw.Draw(alpha)
        for row,start,end in component['runs']:draw.line((start,row,end-1,row),fill=255)
        fitting.putalpha(alpha)
        safe=_safe_interior(fitting,component,center)
        positioned.append({'box':[safe[0]*1000/clean.width,safe[1]*1000/clean.height,safe[2]*1000/clean.width,safe[3]*1000/clean.height]})
    return validate_bubbles({'bubbles':positioned},request,True,bubbles)


def make_layers(job_dir,request,bubbles,font_root):
    font_file=Path(font_root)/'SourceHanSansSC-Regular.otf'
    if not font_file.is_file():raise CodexError('内置思源黑体缺失，无法创建文字图层')
    crop=request['crop'];layers=[]
    for index,b in enumerate(bubbles):
        x,y,w,h=b['box'];width=max(16,round(w*crop['width']/1000)-8);height=max(16,round(h*crop['height']/1000));size=max(6,min(512,round(b['fontSize'])))
        def arrange(size):
            font=ImageFont.truetype(str(font_file),size);rows=[]
            vertical=b['direction']!='horizontal';limit=height if vertical else width
            for paragraph in b['text'].split('\n'):
                row=''
                for char in paragraph:
                    extent=(len(row)+1)*size if vertical else font.getlength(row+char)
                    if row and extent>limit:rows.append(row);row=''
                    row+=char
                rows.append(row)
            used=(max((len(r)*size for r in rows),default=size),len(rows)*size*1.35) if vertical else (max((font.getlength(r) for r in rows),default=size),len(rows)*size*1.35)
            return font,rows,used
        font,rows,used=arrange(size)
        while size>6 and ((used[0]>height or used[1]>width) if b['direction']!='horizontal' else (used[0]>width or used[1]>height)):
            size-=1;font,rows,used=arrange(size)
        if (used[0]>height or used[1]>width) if b['direction']!='horizontal' else (used[0]>width or used[1]>height):raise CodexError('气泡过小，原文无法完整放入，请扩大气泡后重试')
        top=round(y*crop['height']/1000)+(0 if b['direction']!='horizontal' else max(0,round((height-used[1])/2)))
        layer={'id':f"text-{request['id']}-{index+1}",'type':'text','name':' '.join(b['text'].split()),'text':b['text'],'x':crop['x']+round(x*crop['width']/1000),'y':crop['y']+top,'coordinateSpace':request.get('coordinateSpace','source'),'fontFamily':'Source Han Sans SC','fontSize':size,'fontWeight':400,'color':'#111111','textDirection':b['direction'],'textAlign':b['align'],'textWrap':True,'textMode':'paragraph','textBoxWidth':width,'textBoxHeight':0 if b['direction']=='horizontal' else height,'lineHeight':1.35,'letterSpacing':0,'paragraphSpacing':0,'scale':1,'angle':0,'opacity':1,'visible':True,'locked':False,'originJobId':request['id'],'originRegionId':request.get('regionId'),'jobOrder':request.get('orderAt') or request.get('createdAt')}
        layers.append(layer)
    return {'schemaVersion':1,'jobId':request['id'],'bubbles':bubbles,'layers':layers}

def render_initial_text(layer,font_root):
    size=layer['fontSize'];font=ImageFont.truetype(str(Path(font_root)/'SourceHanSansSC-Regular.otf'),size);vertical=layer['textDirection']!='horizontal';rows=[];limit=layer['textBoxHeight'] if vertical else layer['textBoxWidth']
    for paragraph in layer['text'].split('\n'):
        row=''
        for char in paragraph:
            if row and (len(row+char)*size if vertical else font.getlength(row+char))>limit:rows.append(row);row=''
            row+=char
        rows.append(row)
    width=max(layer['textBoxWidth'],math.ceil(len(rows)*size*1.35) if vertical else 0)+8
    height=max(layer['textBoxHeight'],math.ceil(max((len(r)*size for r in rows),default=1)) if vertical else math.ceil(len(rows)*size*1.35))+size//3+4
    image=Image.new('RGBA',(width,height));draw=ImageDraw.Draw(image)
    for i,row in enumerate(rows):
        used=len(row)*size if vertical else font.getlength(row);available=layer['textBoxHeight'] if vertical else layer['textBoxWidth'];offset=(available-used)/2 if layer['textAlign']=='center' else available-used if layer['textAlign']=='right' else 0
        if vertical:
            x=4+(len(rows)-1-i if layer['textDirection']=='vertical-rl' else i)*size*1.35
            for j,char in enumerate(row):draw.text((x,offset+j*size),char,font=font,fill=layer['color'],anchor='lt')
        else:draw.text((4+offset,i*size*1.35),row,font=font,fill=layer['color'],anchor='lt')
    return image

def prepare_text_tiles(job_dir,font_root):
    file=job_dir/'editable-text.json'
    if not file.is_file():return []
    value=json.loads(file.read_text(encoding='utf-8'));result=[]
    for index,layer in enumerate(value['layers']):
        image=render_initial_text(layer,font_root);tiles=[];directory=job_dir/'text-tiles';directory.mkdir(exist_ok=True)
        for y in range(0,image.height,512):
            for x in range(0,image.width,512):
                from repair_pipeline import atomic_png
                tile=Image.new('RGBA',(512,512));tile.paste(image.crop((x,y,min(x+512,image.width),min(y+512,image.height))),(0,0));file=directory/f'{index}-{x}-{y}.png';atomic_png(tile,file);tiles.append({'x':layer['x']+x,'y':layer['y']+y,'file':str(file),'width':512,'height':512,'coordinateSpace':layer['coordinateSpace']})
        result.append({'layer':layer,'tiles':tiles})
    return result
