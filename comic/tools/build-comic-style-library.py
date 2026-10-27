"""Read the team's originals and compile safe numeric contours; never edit originals."""
import json, math, re, zipfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT.parents[1] / '素材库' / '漫画素材'


# 文件名不带下划线结构的字效（例如“透明背景黑色唰字书法-6”）：从名称里取出拟声字本身，长的优先。
SFX_LABEL_WORDS=('咔嚓','轰隆','唰','刷','咔','嗡','嘭','咻','砰','呼','啪','嗖')
def sfx_word_from_label(stem):
    return next((word for word in SFX_LABEL_WORDS if word in stem),stem)

def sample_path(data, remove_tail=False):
    tokens=re.findall(r'[A-Za-z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?',data)
    segments=[]; index=0; point=(0.,0.)
    while index<len(tokens):
        command=tokens[index]; index+=1
        count={'M':2,'L':2,'C':6,'Q':4,'Z':0}.get(command)
        if count is None: raise ValueError('Unsupported SVG command '+command)
        values=[float(value) for value in tokens[index:index+count]];index+=count
        segments.append((command,values,point))
        if count: point=tuple(values[-2:])
    if remove_tail:
        candidates=[]
        for n,(command,values,previous) in enumerate(segments[:-1]):
            next_command,next_values,_=segments[n+1]
            if command=='L' and next_command=='L':
                tip=tuple(values);end=tuple(next_values);base=math.dist(previous,end)
                score=min(math.dist(previous,tip),math.dist(end,tip))/max(base,1)
                if score>1.8: candidates.append((score,n))
        if candidates: segments.pop(max(candidates)[1])
    points=[];point=(0.,0.);start=None
    for command,values,_ in segments:
        if command=='M':point=tuple(values);start=point;points.append(point)
        elif command=='L':point=tuple(values);points.append(point)
        elif command in ('C','Q'):
            begin=point;end=tuple(values[-2:])
            for step in range(1,17):
                t=step/16;s=1-t
                if command=='C':
                    point=tuple(s*s*s*begin[axis]+3*s*s*t*values[axis]+3*s*t*t*values[axis+2]+t*t*t*end[axis] for axis in (0,1))
                else:point=tuple(s*s*begin[axis]+2*s*t*values[axis]+t*t*end[axis] for axis in (0,1))
                points.append(point)
            point=end
        elif command=='Z' and start:points.append(start)
    if len(points)<4:raise ValueError('Empty contour')
    if points[-1]!=points[0]:points.append(points[0])
    lengths=[math.dist(a,b) for a,b in zip(points,points[1:])];total=sum(lengths);out=[]
    for index in range(80):
        distance=total*index/80
        for n,length in enumerate(lengths):
            if distance<=length or n==len(lengths)-1:
                ratio=distance/max(length,.00001);a,b=points[n:n+2];out.append((a[0]+(b[0]-a[0])*ratio,a[1]+(b[1]-a[1])*ratio));break
            distance-=length
    xmin=min(p[0] for p in out);xmax=max(p[0] for p in out);ymin=min(p[1] for p in out);ymax=max(p[1] for p in out)
    return [dict(x=round((x-xmin)/(xmax-xmin),4),y=round((y-ymin)/(ymax-ymin),4)) for x,y in out]

def png_hole(path):
    with Image.open(path) as original:
        image=original.convert('RGBA').resize((256,256));pixels=image.load()
        points=[]
        for index in range(80):
            angle=index*2*math.pi/80;edge=.34
            for radius in range(8,127):
                x=round(128+math.cos(angle)*radius);y=round(128+math.sin(angle)*radius)
                r,g,b,a=pixels[x,y]
                if a>80 and (r+g+b)/3<160:edge=max(.12,(radius-3)/256);break
            points.append(dict(x=round(.5+math.cos(angle)*edge,4),y=round(.5+math.sin(angle)*edge,4)))
        return points

def metadata(path):
    with Image.open(path) as image:
        alpha=image.convert('RGBA').getextrema()[3]
        return dict(width=image.width,height=image.height,hasTransparency=alpha[0]<255)

def build():
    extract=CACHE/'手绘细线对白框'
    with zipfile.ZipFile(CACHE/'手绘细线对话框_18款_PNG+SVG.zip') as archive:
        for item in archive.infolist():
            target=(extract/item.filename).resolve()
            if not target.is_relative_to(extract.resolve()):raise ValueError('Unsafe archive path')
            if item.is_dir():continue
            if target.suffix.lower() not in ('.svg','.png','.txt','.md'):continue
            target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.read(item))
    entries=[]
    for svg in sorted(extract.rglob('*.svg')):
        number=int(svg.name.split('_')[0]);source=svg.read_text(encoding='utf-8');match=re.search(r'<path\b[^>]*\bd="([^"]+)"',source)
        if not match:raise ValueError('SVG outline missing: '+svg.name)
        png=next(path for path in extract.rglob(svg.stem+'.png') if '外部透明' in str(path))
        entries.append(dict(id=f'thin-{number:02d}',kind='bubble',label=svg.stem[3:],family='手绘细线',uses=['speech','thought','caption'],contour=sample_path(match.group(1),remove_tail='尾' in svg.stem),insets=dict(left=.13,right=.13,top=.12,bottom=.12),filePath=str(png),sourceSvgPath=str(svg),sourceUrl='https://drive.google.com/drive/folders/1P5Z8AhBu8CxU2nhKy5fjVA0fwXBwfoTI',texture=False,**metadata(png)))
    manifest=json.loads((CACHE/'source-manifest.json').read_text(encoding='utf-8'))
    for item in manifest['files']:
        path=Path(item['path']);base=dict(id='drive-'+item['id'],label=item['name'].removesuffix('.png'),filePath=str(path),sourceUrl=item['url'],driveId=item['id'],**metadata(path))
        if item['category']=='内心气泡框':
            base.update(kind='bubble',family='内心墨线',uses=['thought','caption'],contour=png_hole(path),insets=dict(left=.28,right=.28,top=.28,bottom=.28),texture=True)
        elif item['category']=='氛围字体':
            parts=path.stem.split('_');word=parts[-1] if parts[0] in ('三风格','蓝紫长尾') else parts[2] if parts[0]=='漫画字效' and len(parts)>2 else sfx_word_from_label(path.stem)
            family=parts[2] if parts[0]=='三风格' else parts[0] if parts[0]=='蓝紫长尾' else parts[3] if len(parts)>3 else '原图字效'
            base.update(kind='sfx',word=word,family=family)
        elif item['category']=='画面情绪氛围':base.update(kind='atmosphere',family='情绪速度线')
        else:base.update(kind='reference',family='原PNG参考')
        entries.append(base)
    catalog=dict(version=1,sourceFolder=manifest['sourceFolder'],items=entries)
    output=ROOT/'public'/'comic-style-data.js';output.write_text('export const COMIC_STYLE_CATALOG = '+json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
    print(json.dumps(dict(items=len(entries),bubble=sum(e['kind']=='bubble' for e in entries),sfx=sum(e['kind']=='sfx' for e in entries),atmosphere=sum(e['kind']=='atmosphere' for e in entries)),ensure_ascii=False))

if __name__=='__main__':build()
