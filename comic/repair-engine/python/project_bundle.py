"""Portable project archives: owned files only, hash deduplication, staged import."""
from __future__ import annotations
import argparse, hashlib, json, os, re, shutil, stat, struct, time, uuid, zipfile
from pathlib import Path, PurePosixPath
from PIL import Image

MAX_ARCHIVE=512*1024*1024
MAX_CONTENT=1024*1024*1024
MAX_MANIFEST=16*1024*1024
SOURCE=re.compile(r'^[a-f0-9]{32}$')
JOB=re.compile(r'^\d{8}-\d{6}-[a-f0-9]{8}$')
HASH=re.compile(r'^[a-f0-9]{64}$')
JOB_FILE=re.compile(r'^(?:crop|mask|guide|annotation|base|patch|repaired|repaired_page|resized_patch|image|layer-mask|bubble-sheet|bubble-native|background-coverage|selection|clean-background-selection|transparent-bubble-selection|bubble-review-(?:light|dark|alpha)|native-[12]|bubble-[1-9]|bubble-1[0-2]|reference-\d{1,3})\.(?:png|webp|jpg)$|^(?:prompt\.txt|alignment\.json|early-text\.json|editable-text\.json|bubble-layers\.json|original-bubble-text\.json|bubble-generation\.json|image-generation\.json|native-images\.json|background-coverage\.json|annotation-marks\.json|text-review\.json|confirmed-text\.json|recognition-error\.json|text-cleanup-review\.json|codex-bubble-metadata\.json|native-role-validation\.json|visual-validation\.json|native-bubble-assets-v3\.json|generation-diagnostics\.json)$')
Image.MAX_IMAGE_PIXELS=None

def filesystem_path(value):
    """Portable Python may lack Windows long-path support in its executable manifest."""
    if value is None or os.name!='nt':return value
    absolute=os.path.abspath(value)
    if absolute.startswith('\\\\?\\'):return Path(absolute)
    return Path('\\\\?\\UNC\\'+absolute[2:] if absolute.startswith('\\\\') else '\\\\?\\'+absolute)

def digest(file):
    value=hashlib.sha256()
    with file.open('rb') as stream:
        for part in iter(lambda:stream.read(1024*1024),b''):value.update(part)
    return value.hexdigest()

def owned_file(root,relative):
    parts=PurePosixPath(relative).parts
    if not parts or relative.startswith('/') or '\\' in relative or any(p in ('','..','.') for p in parts):raise ValueError('工程文件路径无效')
    target=root.joinpath(*parts)
    for position in range(len(parts)+1):
        item=root.joinpath(*parts[:position])
        if item.is_symlink():raise ValueError('工程文件不能引用符号链接')
    if not target.resolve().is_relative_to(root.resolve()) or not target.is_file():raise ValueError('工程文件路径或文件无效')
    return target

def valid_logical(relative,sid,jobs,refs):
    p=PurePosixPath(relative).parts
    if '\\' in relative or relative.startswith('/') or any(v in ('..','.','') for v in p):return False
    if len(p)==3 and p[0]=='project-assets':return p[1]==sid and re.fullmatch(r'[a-f0-9]{64}\.png',p[2]) is not None
    if p[:2]==('sources',sid):
        return len(p)==3 and (p[2]=='original.png' or re.fullmatch(r'revision-\d+\.png',p[2]) is not None) or len(p)==4 and p[2]=='submission-images' and re.fullmatch(r'[a-f0-9]{64}\.png',p[3]) is not None
    if p[0:1]==('jobs',) and len(p)>=3 and p[1] in jobs:
        return len(p)==3 and bool(JOB_FILE.fullmatch(p[2])) or len(p)==5 and p[2]=='attempts' and bool(SOURCE.fullmatch(p[3])) and bool(JOB_FILE.fullmatch(p[4]))
    if len(p)==3 and p[0]=='references':return p[1] in refs and p[2]=='reference.png'
    if len(p)==3 and p[:2]==('public','fonts'):return '..' not in p[2] and re.fullmatch(r'[A-Za-z0-9_.-]{1,160}\.(?:otf|ttf|ttc|woff2)',p[2]) is not None
    if len(p)==3 and p[0]=='project-fonts':return p[1]==sid and re.fullmatch(r'[a-f0-9]{64}\.(?:otf|ttf|ttc|woff2)',p[2]) is not None
    if len(p)==5 and (p[:3]==('public','fonts','licenses') or p[:3]==('project-fonts',sid,'licenses')):return re.fullmatch(r'[A-Za-z0-9-]{1,80}',p[3]) is not None and re.fullmatch(r'[A-Za-z0-9_-]{1,80}\.txt',p[4]) is not None
    return False

def validate_images(root,files,metadata):
    for item in files:
        if not item['path'].lower().endswith(('.png','.jpg','.webp')):continue
        file=owned_file(root,item['path'])
        with Image.open(file) as image:
            w,h=image.size
            if w<1 or h<1 or w>32768 or h>1000000 or w*h>1000000000:raise ValueError('工程图片尺寸超出安全范围')
            if item['path'].startswith('project-assets/') and (h>32768 or w*h>40000000):raise ValueError('工程图层图片尺寸无效')
            if item['path']==f"sources/{metadata['id']}/original.png" and (w!=metadata['width'] or h!=metadata['height']):raise ValueError('原图尺寸与工程记录不一致')
            image.verify()

def validate_fonts(root,files):
    for item in files:
        if not item['path'].startswith(('public/fonts/','project-fonts/')) or '/licenses/' in item['path']:continue
        file=owned_file(root,item['path']);size=file.stat().st_size
        with file.open('rb') as stream:
            header=stream.read(48);magic=header[:4]
            if size<12 or magic not in (b'OTTO',b'\x00\x01\x00\x00',b'true',b'typ1',b'ttcf',b'wOF2'):raise ValueError('工程字体格式无效')
            if magic==b'wOF2':
                if len(header)<48 or struct.unpack('>I',header[8:12])[0]!=size or not 0<struct.unpack('>H',header[12:14])[0]<=512:raise ValueError('工程字体文件被截断')
                continue
            offsets=[0]
            if magic==b'ttcf':
                count=struct.unpack('>I',header[8:12])[0]
                if not 0<count<=64 or size<12+count*4:raise ValueError('工程字体集合无效')
                stream.seek(12);offsets=list(struct.unpack('>'+'I'*count,stream.read(count*4)))
            for offset in offsets:
                if offset+12>size:raise ValueError('工程字体集合被截断')
                stream.seek(offset);font_header=stream.read(12);tables=struct.unpack('>H',font_header[4:6])[0]
                if not 0<tables<=512 or offset+12+tables*16>size:raise ValueError('工程字体表无效')
                for _ in range(tables):
                    record=stream.read(16);start,length=struct.unpack('>II',record[8:16])
                    if start+length>size:raise ValueError('工程字体文件被截断')

def prepare_browser_previews(folder,metadata,revisions):
    from png_pages import make_preview
    sizes={}
    for revision in sorted({0,*revisions}):
        if not isinstance(revision,int) or not 0<=revision<=metadata.get('lastRevision',0):raise ValueError('漫画预览版本无效')
        source=folder/('original.png' if revision==0 else f'revision-{revision}.png');preview=folder/f'preview-{revision}.png'
        if source.is_symlink() or preview.is_symlink() or not source.is_file():raise ValueError('漫画预览路径无效')
        ready=False
        if preview.is_file():
            try:
                with Image.open(preview) as image:sizes[revision]=list(image.size);image.verify();ready=True
            except (OSError,ValueError):pass
        if not ready:
            temporary=folder/f'preview-{revision}.{uuid.uuid4().hex}.tmp'
            try:sizes[revision]=list(make_preview(source,temporary,prepare_display=True));temporary.replace(preview)
            finally:temporary.unlink(missing_ok=True)
    thumb=folder/'thumb.png'
    if thumb.is_symlink():raise ValueError('漫画缩略图路径无效')
    ready=False
    if thumb.is_file():
        try:
            with Image.open(thumb) as image:image.verify();ready=True
        except (OSError,ValueError):pass
    if not ready:
        temporary=folder/f'thumb.{uuid.uuid4().hex}.tmp'
        try:
            with Image.open(folder/'preview-0.png') as preview:
                image=preview.crop((0,0,preview.width,min(preview.height,round(preview.width*1.25)))).convert('RGBA');image.thumbnail((180,220));image.save(temporary,'PNG')
            temporary.replace(thumb)
        finally:temporary.unlink(missing_ok=True)
    return {'previewSize':sizes[metadata.get('revision',0)] if metadata.get('revision',0) in sizes else sizes[revisions[0]]}

def prepare_existing_previews(root,sid,revision):
    if not isinstance(sid,str) or not SOURCE.fullmatch(sid):raise ValueError('漫画预览编号无效')
    metadata=json.loads(owned_file(root,f'sources/{sid}/metadata.json').read_text(encoding='utf-8'))
    if metadata.get('id')!=sid or metadata.get('deletedAt'):raise ValueError('漫画项目已删除或编号不一致')
    owned_file(root,f'sources/{sid}/original.png')
    if revision:owned_file(root,f'sources/{sid}/revision-{revision}.png')
    return prepare_browser_previews(root/'sources'/sid,metadata,[revision])

def check_refs(value,sid,job_ids,ref_ids,paths,key=''):
    if isinstance(value,dict):
        for k,v in value.items():
            if k in {'__proto__','constructor','prototype'}:raise ValueError('工程包含不安全对象字段')
            check_refs(v,sid,job_ids,ref_ids,paths,k)
    elif isinstance(value,list):
        for v in value:check_refs(v,sid,job_ids,ref_ids,paths,key)
    elif isinstance(value,str):
        if value.startswith('data:image/'):raise ValueError('工程包含未打包图片')
        if value.startswith(('/project-assets/','/sources/','/jobs/','/references/','/project-fonts/')):
            if value[1:] not in paths:raise ValueError('工程引用缺少媒体文件：'+value[:120])
            if value.startswith(('/project-assets/','/sources/','/project-fonts/')) and value.split('/')[2]!=sid:raise ValueError('工程引用其他漫画资源')
            if value.startswith('/jobs/') and value.split('/')[2] not in job_ids:raise ValueError('工程引用其他任务资源')
            if value.startswith('/references/') and value.split('/')[2] not in ref_ids:raise ValueError('工程参考图归属无效')
        elif key in {'image','imageRef','mask','baseMask','maskEdits','maskImage','annotationImage','baseImageRef','url'} and value and not value.startswith('#'):
            raise ValueError('工程包含本机路径或未打包的外部资源')

def validate_manifest(manifest):
    if not isinstance(manifest,dict) or manifest.get('format')!='patch-studio-project' or manifest.get('schemaVersion')!=1:raise ValueError('不是有效的补图工作台工程文件')
    sid=manifest.get('sourceId');meta=manifest.get('metadata');project=manifest.get('project');jobs=manifest.get('jobs',[]);refs=manifest.get('references',[]);files=manifest.get('files',[])
    if not isinstance(sid,str) or not SOURCE.fullmatch(sid) or not isinstance(meta,dict) or meta.get('id')!=sid or not isinstance(project,dict):raise ValueError('工程漫画编号无效')
    if not isinstance(meta.get('width'),int) or not isinstance(meta.get('height'),int) or not 1<=meta['width']<=32768 or not 1<=meta['height']<=1000000:raise ValueError('工程漫画尺寸无效')
    if not isinstance(jobs,list) or len(jobs)>1000 or not isinstance(refs,list) or len(refs)>500 or not isinstance(files,list) or len(files)>20000:raise ValueError('工程文件数量过多')
    if not isinstance(project.get('layers',[]),list) or len(project.get('layers',[]))>400 or not isinstance(project.get('regions',[]),list) or len(project.get('regions',[]))>200:raise ValueError('工程图层或选区数量无效')
    job_ids=set();ref_ids=set()
    for item in jobs:
        if not isinstance(item,dict) or not JOB.fullmatch(str(item.get('id',''))) or item['id'] in job_ids or item.get('request',{}).get('id')!=item['id'] or item.get('request',{}).get('sourceId')!=sid:raise ValueError('工程任务归属无效')
        job_ids.add(item['id'])
    for item in refs:
        if not isinstance(item,dict) or not SOURCE.fullmatch(str(item.get('id',''))) or item['id'] in ref_ids or item.get('metadata',{}).get('id')!=item['id']:raise ValueError('工程参考图归属无效')
        ref_ids.add(item['id'])
    paths=set();folded=set();sizes={};total=0;restored_bytes=0
    for item in files:
        if not isinstance(item,dict) or not isinstance(item.get('path'),str) or not valid_logical(item['path'],sid,job_ids,ref_ids) or item['path'].casefold() in folded or not HASH.fullmatch(str(item.get('sha256',''))) or not isinstance(item.get('bytes'),int) or not 0<item['bytes']<=MAX_ARCHIVE:raise ValueError('工程媒体清单无效')
        paths.add(item['path']);folded.add(item['path'].casefold());sha=item['sha256']
        restored_bytes+=item['bytes']
        if restored_bytes>MAX_CONTENT:raise ValueError('工程还原资源超限，独立文件总大小不得超过 1 GiB')
        if item['path'].endswith('.json') and item['bytes']>MAX_MANIFEST or item['path'].endswith('.txt') and item['bytes']>1024*1024:raise ValueError('工程文字资源大小超限')
        if item['path'].startswith(('public/fonts/','project-fonts/')) and '/licenses/' not in item['path'] and item['bytes']>64*1024*1024:raise ValueError('工程字体资源大小超限')
        if sha in sizes and sizes[sha]!=item['bytes']:raise ValueError('工程媒体哈希记录不一致')
        if sha not in sizes:total+=item['bytes'];sizes[sha]=item['bytes']
    if total>MAX_CONTENT or f'sources/{sid}/original.png' not in paths:raise ValueError('工程资源超限或缺少原图')
    for item in refs:
        if f"references/{item['id']}/reference.png" not in paths:raise ValueError('工程缺少参考图')
    check_refs(project,sid,job_ids,ref_ids,paths)
    for item in jobs:check_refs(item['request'],sid,job_ids,ref_ids,paths)
    for item in jobs:
        for name in item['request'].get('referenceFiles',[]):
            if not isinstance(name,str) or not re.fullmatch(r'reference-\d{1,3}\.png',name) or f"jobs/{item['id']}/{name}" not in paths:raise ValueError('工程缺少任务参考图')
    for font in manifest.get('fonts',[]):
        if not isinstance(font,dict) or font.get('path') not in paths or not isinstance(font.get('family'),str) or len(font['family'])>200 or not isinstance(font.get('weight'),int) or not 1<=font['weight']<=1000:raise ValueError('工程字体信息无效')
    revision=meta.get('revision',0);last=meta.get('lastRevision',0)
    if not isinstance(revision,int) or not isinstance(last,int) or not 0<=revision<=last<=10000:raise ValueError('工程原图版本无效')
    for index in range(1,last+1):
        if f'sources/{sid}/revision-{index}.png' not in paths:raise ValueError('工程缺少原图历史版本')
    return sizes

def export_bundle(root,snapshot,out):
    manifest=json.loads(snapshot.read_text(encoding='utf-8'));unique={}
    for item in manifest['files']:
        file=owned_file(root,item['path']);info=file.stat();sha=digest(file);latest=file.stat()
        if (info.st_size,info.st_mtime_ns)!=(latest.st_size,latest.st_mtime_ns):raise ValueError('任务正在写入文件，请稍后保存工程')
        item.update(sha256=sha,bytes=info.st_size);unique.setdefault(sha,(file,info.st_size,info.st_mtime_ns))
    validate_manifest(manifest);validate_images(root,manifest['files'],manifest['metadata']);validate_fonts(root,manifest['files']);encoded=json.dumps(manifest,ensure_ascii=False,separators=(',',':')).encode('utf-8')
    if len(encoded)>MAX_MANIFEST:raise ValueError('工程文字清单过大')
    temporary=out.with_name(out.name+'.'+uuid.uuid4().hex+'.tmp');out.parent.mkdir(parents=True,exist_ok=True)
    try:
        with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_STORED,allowZip64=True) as archive:
            archive.writestr('manifest.json',encoded)
            for sha,(file,size,mtime) in unique.items():
                archive.write(file,'blobs/'+sha)
                latest=file.stat()
                if (latest.st_size,latest.st_mtime_ns)!=(size,mtime):raise ValueError('任务文件在保存期间发生变化，请重试')
        if temporary.stat().st_size>MAX_ARCHIVE:raise ValueError('工程文件超过 512 MB，请减少资源或分成多个工程')
        temporary.replace(out)
    finally:temporary.unlink(missing_ok=True)
    return {'file':str(out),'bytes':out.stat().st_size,'blobCount':len(unique),'fileCount':len(manifest['files'])}

def remap(value,mapping):
    if isinstance(value,dict):return {mapping.get(k,k):remap(v,mapping) for k,v in value.items()}
    if isinstance(value,list):return [remap(v,mapping) for v in value]
    if not isinstance(value,str):return value
    if value in mapping:return mapping[value]
    if value.startswith(('/sources/','/project-assets/','/jobs/','/references/','/project-fonts/','text-','bubble-','bubble-link-','ai-')):
        for old,new in mapping.items():value=value.replace(old,new)
    return value

def preserve_job_order(value,job_ids):
    if isinstance(value,list):return [preserve_job_order(v,job_ids) for v in value]
    if not isinstance(value,dict):return value
    result={k:preserve_job_order(v,job_ids) for k,v in value.items()}
    origin=result.get('jobId') or result.get('originJobId')
    if result.get('type') in ('image','text') and origin in job_ids and not result.get('jobOrder'):
        result['jobOrder']=f'{origin[:4]}-{origin[4:6]}-{origin[6:8]}T{origin[9:11]}:{origin[11:13]}:{origin[13:15]}.000Z-{origin[16:]}'
    return result

def clean_audit(value):
    if isinstance(value,list):return [clean_audit(v) for v in value]
    if not isinstance(value,dict):return value
    result={}
    for key,item in value.items():
        if key in {'__proto__','constructor','prototype'}:raise ValueError('工程包含不安全对象字段')
        if key in {'folder','cwd','workerPid','pid','threadId','turnId'} or key.lower().endswith('path'):continue
        result[key]=clean_audit(item)
    return result

def import_bundle(root,bundle):
    if bundle.stat().st_size>MAX_ARCHIVE:raise ValueError('工程文件超过 512 MB')
    temp_root=root/'临时文件';temp_root.mkdir(exist_ok=True)
    if temp_root.is_symlink() or not temp_root.resolve().is_relative_to(root.resolve()):raise ValueError('工程临时目录路径无效')
    stage=temp_root/('project-import-'+uuid.uuid4().hex);stage.mkdir();moved=[]
    try:
        with zipfile.ZipFile(bundle,'r') as archive:
            infos=archive.infolist();seen=set();content=0
            for info in infos:
                if info.filename in seen or not (info.filename=='manifest.json' or re.fullmatch(r'blobs/[a-f0-9]{64}',info.filename)) or info.flag_bits&1 or stat.S_ISLNK(info.external_attr>>16) or info.is_dir():raise ValueError('工程 ZIP 路径、链接或重复文件无效')
                seen.add(info.filename);content+=info.file_size
                if info.file_size>MAX_ARCHIVE or content>MAX_CONTENT+MAX_MANIFEST or info.compress_size and info.file_size/info.compress_size>200:raise ValueError('工程 ZIP 解压大小或压缩率超限')
            if 'manifest.json' not in seen or archive.getinfo('manifest.json').file_size>MAX_MANIFEST:raise ValueError('工程缺少有效清单')
            manifest=json.loads(archive.read('manifest.json').decode('utf-8'));sizes=validate_manifest(manifest)
            if seen!={'manifest.json',*('blobs/'+sha for sha in sizes)}:raise ValueError('工程 ZIP 媒体与清单不一致')
            verified=stage/'verified';verified.mkdir()
            for sha,size in sizes.items():
                info=archive.getinfo('blobs/'+sha)
                if info.file_size!=size:raise ValueError('工程媒体长度不一致')
                file=verified/sha;hash_value=hashlib.sha256();written=0
                with archive.open(info) as source,file.open('xb') as target:
                    for part in iter(lambda:source.read(1024*1024),b''):
                        written+=len(part)
                        if written>size:raise ValueError('工程媒体解压大小超限')
                        hash_value.update(part);target.write(part)
                if written!=size or hash_value.hexdigest()!=sha:raise ValueError('工程媒体哈希校验失败')
        sid=uuid.uuid4().hex;mapping={manifest['sourceId']:sid};now=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());stamp=time.strftime('%Y%m%d-%H%M%S',time.gmtime())
        for item in manifest['jobs']:mapping[item['id']]=stamp+'-'+uuid.uuid4().hex[:8]
        for item in manifest['references']:mapping[item['id']]=uuid.uuid4().hex
        payload=stage/'payload';payload.mkdir();new_files=[];json_hashes={};fonts=[];old_job_ids={job['id'] for job in manifest['jobs']}
        for item in manifest['files']:
            relative=remap('/'+item['path'],mapping)[1:]
            if '/licenses/' in item['path'] and item['path'].startswith(('public/fonts/','project-fonts/')):
                relative=f'project-fonts/{sid}/licenses/'+item['path'].split('/licenses/',1)[1]
            elif item['path'].startswith(('public/fonts/','project-fonts/')):
                ext=Path(item['path']).suffix;relative=f'project-fonts/{sid}/{item["sha256"]}{ext}'
            destination=payload/relative;destination.parent.mkdir(parents=True,exist_ok=True)
            if destination.exists():
                if digest(destination)!=item['sha256']:raise ValueError('工程资源重名且内容不一致')
                continue
            if relative.endswith('.json'):
                value=clean_audit(remap(preserve_job_order(json.loads((verified/item['sha256']).read_text(encoding='utf-8')),old_job_ids),mapping));destination.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8');json_hashes[item['sha256']]=digest(destination)
            else:
                # ZIP blobs deduplicate transport bytes; restored logical files
                # must remain independent. ai-layer rewrites image.png and masks.
                shutil.copyfile(verified/item['sha256'],destination)
            new_files.append({'path':relative})
        meta=remap(manifest['metadata'],mapping);meta.update(id=sid,createdAt=now,deletedAt=None,importedFrom=manifest['sourceId']);meta.pop('archiveFolder',None)
        project=remap(preserve_job_order(manifest['project'],old_job_ids),mapping);project.pop('composite',None);project['version']=1
        for font in manifest.get('fonts',[]):
            source_file=next(item for item in manifest['files'] if item['path']==font['path']);ext=Path(font['path']).suffix;fonts.append({'family':font['family'],'weight':font['weight'],'url':f'/project-fonts/{sid}/{source_file["sha256"]}{ext}'})
        if fonts:project['fontAssets']=fonts
        source_folder=payload/'sources'/sid;source_folder.mkdir(parents=True,exist_ok=True)
        (source_folder/'metadata.json').write_text(json.dumps(meta,ensure_ascii=False),encoding='utf-8');(source_folder/'project.json').write_text(json.dumps(project,ensure_ascii=False),encoding='utf-8')
        for job in manifest['jobs']:
            jid=mapping[job['id']];folder=payload/'jobs'/jid;folder.mkdir(parents=True,exist_ok=True);request=remap(job['request'],mapping);request['editorKey']='';request.setdefault('orderAt',request.get('createdAt') or job['id']);(folder/'request.json').write_text(json.dumps(request,ensure_ascii=False),encoding='utf-8')
            automation=remap(clean_audit(job.get('automation')),mapping)
            if automation is None and request.get('mode')=='auto':automation={'jobId':jid,'status':'failed','phase':'failed','message':'导入的任务尚未完成，请重新提交'}
            if automation is not None:
                automation['jobId']=jid
                if automation.get('status') in ('recognition_queued','recognizing_text','refining_text','awaiting_text_review'):
                    automation.update(status='awaiting_text_review',phase='awaiting_text_review',message='导入的文字草稿需要重新校对确认，不会自动生图')
                elif automation.get('status') in ('queued','running'):automation.update(status='failed',phase='failed',message='导入的任务尚未完成，请重新提交')
                for key,value in list(automation.items()):
                    if isinstance(value,str) and value in json_hashes:automation[key]=json_hashes[value]
                (folder/'automation.json').write_text(json.dumps(automation,ensure_ascii=False),encoding='utf-8')
        for ref in manifest['references']:
            rid=mapping[ref['id']];folder=payload/'references'/rid;folder.mkdir(parents=True,exist_ok=True);metadata=remap(ref['metadata'],mapping);metadata.update(id=rid,createdAt=now,deletedAt=None);(folder/'metadata.json').write_text(json.dumps(metadata,ensure_ascii=False),encoding='utf-8')
        validate_images(payload,new_files,meta);validate_fonts(payload,new_files)
        for key in list(meta):
            if key!='previewSize' and ('cache' in key.lower() or key.lower().startswith(('preview','thumb'))):meta.pop(key)
        revisions=[0,meta.get('revision',0)]
        if isinstance(project.get('sourceRevision'),int):revisions.append(project['sourceRevision'])
        meta.update(prepare_browser_previews(source_folder,meta,revisions));(source_folder/'metadata.json').write_text(json.dumps(meta,ensure_ascii=False),encoding='utf-8')
        # All verification is complete before publishing any new business directory.
        for category in ('project-assets','project-fonts','references','jobs','sources'):
            parent=payload/category
            if not parent.exists():continue
            target_root=root/category;target_root.mkdir(exist_ok=True)
            if target_root.is_symlink():raise ValueError('工程导入目标不能是符号链接')
            for folder in parent.iterdir():
                target=target_root/folder.name
                if target.exists() or target.is_symlink() or not target.resolve().is_relative_to(root.resolve()):raise ValueError('工程导入编号冲突')
                folder.replace(target);moved.append(target)
        return {'ok':True,'sourceId':sid,'metadata':meta,'project':project,'jobCount':len(manifest['jobs']),'referenceCount':len(manifest['references']),'fontCount':len(fonts)}
    except Exception:
        for directory in reversed(moved):
            if directory.resolve().is_relative_to(root.resolve()) and directory.parent.name in {'sources','jobs','references','project-assets','project-fonts'}:shutil.rmtree(directory)
        raise
    finally:
        if stage.resolve().is_relative_to(temp_root.resolve()) and stage.name.startswith('project-import-'):shutil.rmtree(stage)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['export','import','preview']);parser.add_argument('--root',required=True,type=Path);parser.add_argument('--manifest',type=Path);parser.add_argument('--file',type=Path);parser.add_argument('--source-id');parser.add_argument('--revision',type=int,default=0);args=parser.parse_args()
    args.root=filesystem_path(args.root);args.manifest=filesystem_path(args.manifest)
    try:
        result=export_bundle(args.root,args.manifest,args.file) if args.command=='export' else prepare_existing_previews(args.root,args.source_id,args.revision) if args.command=='preview' else import_bundle(args.root,args.file)
        print(json.dumps(result,ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error':str(error)},ensure_ascii=False));raise SystemExit(1)
