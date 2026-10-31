"""Inspect bounded rendered strips, then write five lossless deliverables without a full-height bitmap."""
import hashlib, json, math, os, sys, zipfile
from PIL import Image, ImageStat
from strip_png import write_strip

def inspect(spec):
    group=spec['groups']['body'];width,height=group['width'],group['height']
    step=max(1,math.ceil(height/200000)); flags=bytearray(math.ceil(height/step))
    scale=min(220/width,1200/height);thumb=Image.new('RGB',(max(1,round(width*scale)),max(1,round(height*scale))),'white')
    try:
        import numpy as np
    except ImportError:
        np=None
    for part in group['parts']:
        with Image.open(part['path']) as source:
            if source.size!=(width,part['height']):raise ValueError('正文分段尺寸不一致')
            rgba=source.convert('RGBA');rgb=Image.new('RGB',rgba.size,'white');rgb.paste(rgba,mask=rgba.getchannel('A'));rgba.close()
            # Fixed global sample centres keep inspection independent of upload boundaries.
            first=(part['y']+step-1)//step;last=min(len(flags),(part['y']+part['height']+step-1)//step)
            sample=rgb.resize((min(width,256),rgb.height),Image.Resampling.BOX)
            if np is not None:
                values=np.asarray(sample,dtype=np.int16)
                uniform=((values.max(axis=1)-values.min(axis=1)).max(axis=1)<=18)
                for index in range(first,last):flags[index]=bool(uniform[min(rgb.height-1,index*step-part['y'])])
            else:
                for index in range(first,last):
                    y=min(rgb.height-1,index*step-part['y']);extrema=sample.crop((0,y,sample.width,y+1)).getextrema()
                    flags[index]=all(hi-lo<=18 for lo,hi in extrema)
            top=round(part['y']*scale);bottom=round((part['y']+part['height'])*scale)
            if bottom>top:thumb.paste(rgb.resize((thumb.width,bottom-top),Image.Resampling.LANCZOS),(0,top))
            rgb.close();sample.close()
    for r in spec.get('protectedRanges',[]):
        start=max(0,math.floor(r['start']/step));end=min(len(flags),math.ceil(r['end']/step)+1)
        flags[start:end]=b'\0'*(end-start)
    gaps=[];start=None;minimum=max(32,round(width*.035))
    for i in range(len(flags)+1):
        empty=i<len(flags) and flags[i]
        if empty and start is None:start=i
        if not empty and start is not None:
            a=min(height,start*step+step);b=min(height,i*step-step)
            if b-a>=minimum and a>0 and b<height:gaps.append({'start':a,'end':b,'size':b-a})
            start=None
    preview=os.path.join(spec['directory'],'overview.png');thumb.save(preview);thumb.close()
    return {'gaps':gaps,'sampleStep':step,'minimumGap':minimum,'width':width,'height':height}

def write_range(group,start,end,output):
    prepared=[];temporary=[]
    try:
        for index,part in enumerate(group['parts']):
            a=max(start,part['y']);b=min(end,part['y']+part['height'])
            if b<=a:continue
            if a==part['y'] and b==part['y']+part['height']:file=part['path']
            else:
                file=output+'.crop-'+str(index)+'.png';temporary.append(file)
                with Image.open(part['path']) as image:
                    image.crop((0,a-part['y'],group['width'],b-part['y'])).save(file)
            prepared.append({'path':file,'y':a-start,'height':b-a})
        return write_strip({'width':group['width'],'height':end-start,'parts':prepared,'output':output})
    finally:
        for file in temporary:
            if os.path.exists(file):os.remove(file)

def complete(spec):
    directory=spec['directory'];files=[];height=spec['groups']['body']['height'];cuts=spec['cuts'];prefix=spec['prefix']
    for kind,label in [('cover','封面'),('body','正文'),('tail','尾图')]:
        if kind not in spec['groups']:continue
        group=spec['groups'][kind];edges=[0]+cuts+[height] if kind=='body' else [0,group['height']]
        for i,(a,b) in enumerate(zip(edges,edges[1:])):
            name=prefix+'_'+label+('_'+str(i+1).zfill(2) if kind=='body' else '')+'.png'
            result=write_range(group,a,b,os.path.join(directory,name));files.append({'name':name,'kind':kind,'index':i+1,'start':a,'end':b,**result})
    manifest={'format':'comic-client-delivery/1','episode':spec['episode'],'projectId':spec['projectId'],'revision':spec['revision'],'cuts':cuts,'files':files}
    with open(os.path.join(directory,'交付清单.json'),'w',encoding='utf-8') as f:json.dump(manifest,f,ensure_ascii=False,indent=2)
    output=os.path.join(directory,'delivery.zip');temporary=output+'.tmp'
    try:
        with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_STORED,allowZip64=True) as archive:
            for item in files:archive.write(os.path.join(directory,item['name']),item['name'])
            archive.write(os.path.join(directory,'交付清单.json'),'交付清单.json')
        os.replace(temporary,output)
    finally:
        if os.path.exists(temporary):os.remove(temporary)
    return manifest

if __name__=='__main__':
    try:
        spec=json.load(sys.stdin);json.dump(inspect(spec) if spec['action']=='analyze' else complete(spec),sys.stdout,ensure_ascii=False)
    except Exception as error:
        print(str(error),file=sys.stderr);sys.exit(1)
