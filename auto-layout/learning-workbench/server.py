"""Local-only layout workbench. Does not connect to or modify Comic Agent."""
import argparse
import os
import hmac
import base64
import hashlib
import io
import json
import re
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
import unified_layout as unified
from PIL import Image
Image.MAX_IMAGE_PIXELS=250_000_000
from lib.core import learned_profile, public_profile, plan_layout, validate_geometry, backgrounds
from lib.importers import import_scripts
from lib.model_pipeline import call_codex,STYLE_SCHEMA,LAYOUT_SCHEMA,RHYTHM_LAYOUT_SCHEMA,MAIN_LAYOUT_SCHEMA,layout_schema,style_prompt,layout_prompt,packet_from_response,validate_style_references,save as model_save

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('AUTO_LAYOUT_DATA_DIR',str(ROOT/'data')))
for _directory in ('scripts','references','drafts','runs','history'):
    (DATA/_directory).mkdir(parents=True,exist_ok=True)
LOCK = threading.RLock()
ID = re.compile(r'^[a-zA-Z0-9_-]{1,90}$')
ACTIVE_JOBS={}
from model_requests import ModelRequests
MODEL_REQUESTS=ModelRequests(DATA)
from script_archive import ScriptArchive
SCRIPT_ARCHIVE=ScriptArchive(DATA)


def model_worker(job_id,script,profile):
    folder=DATA/'runs'/job_id
    from lib.timing import PhaseTimer
    timer=PhaseTimer()
    def update(**fields):
        job=read(folder/'job.json');job.update(fields)
        job['timing']=timer.snapshot(job.get('phase','queued'),job.get('status') in ('done','failed'))
        model_save(folder/'job.json',job)
    try:
        model_save(folder/'frozen-test-script.json',script)
        model_save(folder/'frozen-learning-profile.json',profile)
        saved_profile=read(DATA/'learning-profile.json') if (DATA/'learning-profile.json').exists() else {}
        if script['projectId']=='dazhou' and saved_profile.get('version')==profile['version'] and (DATA/'learned-style.json').exists() and (DATA/'learned-style-source.json').exists():
            style=read(DATA/'learned-style.json')
            source_file=DATA/'learned-style-source.json'
            source=read(source_file) if source_file.exists() else {}
            from lib.core import digest
            if source.get('profileVersion')!=profile['version'] or source.get('styleDigest')!=digest(style):raise ValueError('缓存样式缺少对应调用来源，未继续排版')
            source_folder=DATA/'runs'/source['runId']
            if read(source_folder/'frozen-learning-profile.json')!=profile or read(source_folder/'learn/response.json')!=style:raise ValueError('缓存样式来源与当前证据不一致')
            update(phase='layout',message='复用与当前案例版本对应的样式归纳，正在调用Codex排版')
        else:
            update(phase='learning',message='正在调用Codex归纳当前项目的已核对案例')
            selected_ids={s['id'] for s in profile['sourceFiles']}
            images=[DATA/'references'/(name+'-overview.jpg') for name in sorted(selected_ids) if (DATA/'references'/(name+'-overview.jpg')).exists()]
            images += [DATA/'rhythm-evidence'/e['image'] for e in profile.get('verifiedRelationships',[]) if (DATA/'rhythm-evidence'/e['image']).exists()]
            images += [DATA/'support-evidence'/e['image'] for e in profile.get('supportRuleEvidence',[]) if (DATA/'support-evidence'/e['image']).exists()]
            images += [DATA/'overlap-evidence'/e['image'] for e in profile.get('overlapReviewEvidence',[])]
            unique={}
            for image_path in images:unique.setdefault(hashlib.sha256(image_path.read_bytes()).hexdigest(),image_path)
            images=list(unique.values())
            style=call_codex(style_prompt(profile),STYLE_SCHEMA,folder/'learn',images)
            from lib.core import digest
            source={'runId':job_id,'profileVersion':profile['version'],'styleDigest':digest(style)}
        validate_style_references(style,profile)
        model_save(folder/'learning-source.json',source)
        model_save(folder/'frozen-style.json',style)
        from lib.dialogue import apply_dialogue_rules
        rules_file=DATA/'dialogue-layout-rules.json'
        layout_profile=apply_dialogue_rules(script,profile,read(rules_file)) if rules_file.exists() else profile
        model_save(folder/'frozen-layout-profile.json',layout_profile)
        prompt=layout_prompt(script,layout_profile,style)
        packet=None
        for attempt in range(1,4):
            update(phase='layout',attempt=attempt,message='Codex正在生成完整布局，第'+str(attempt)+'次调用')
            schema=layout_schema(layout_profile)
            result=call_codex(prompt,schema,folder/('layout-'+str(attempt)))
            try:
                packet=packet_from_response(result,script,layout_profile);break
            except ValueError as exc:
                model_save(folder/('validation-'+str(attempt)+'.json'),{'passed':False,'errors':str(exc)})
                update(message='程序校验未通过，已保留错误并交回模型修正')
                prompt=layout_prompt(script,layout_profile,style)+'\n上次校验失败。请完整修正JSON，错误：'+str(exc)+'\n上次响应：'+json.dumps(result,ensure_ascii=False)
        if packet is None:raise ValueError('三次结果均未通过校验；未导出为成功布局，详见任务记录')
        packet['generator'].update(runId=job_id,attempt=attempt,learningSourceRunId=source['runId'])
        palette_file=DATA/f"palette-evidence-{script['id']}.json"
        if not palette_file.exists():palette_file=DATA/'palette-evidence.json'
        if profile.get('policy',{}).get('mainWidthMode')=='full_bleed_default' and palette_file.exists():
            palette_evidence=read(palette_file)
            if palette_evidence.get('projectId')==script['projectId'] and str(palette_evidence.get('episode'))==str(script['episode']):
                from lib.palette import refine_backgrounds
                update(phase='palette',message='正在根据同场景参考画面衔接底色，画格布局保持不变')
                model_save(folder/'before-palette-geometry.json',packet)
                packet=refine_backgrounds(packet,script,profile,palette_evidence,DATA,folder)
        with LOCK:
            if read(file_for('scripts',script['id']))!=script:raise ValueError('模型运行期间脚本版本变化，未覆盖布局')
            write(file_for('drafts',script['id']),packet)
        model_save(folder/'verified-geometry.json',packet)
        update(status='done',phase='done',message='模型布局已通过程序校验，等待人工查看阅读效果')
    except Exception as exc:
        update(status='failed',phase='failed',message=str(exc))
    finally:
        ACTIVE_JOBS.pop(script['id'],None)


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def file_for(kind, name):
    if kind not in ('references','scripts','drafts') or not ID.fullmatch(name):
        raise ValueError('无效资料ID')
    return DATA/kind/(name+'.json')


def records(kind):
    return [read(p) for p in sorted((DATA/kind).glob('*.json'))]


def write(path, value):
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():
        stamp = time.time_ns()
        history=DATA/'history';history.mkdir(parents=True,exist_ok=True)
        (history/f'{path.parent.name}-{path.stem}-{stamp}.json').write_bytes(path.read_bytes())
    temp=path.with_suffix('.tmp')
    temp.write_text(text,encoding='utf-8')
    temp.replace(path)


def selected_references(project):
    refs=[r for r in records('references') if r['projectId']==project]
    path=DATA/'reference-selections.json'
    selected=read(path).get(project) if path.exists() else None
    if selected is None:return refs
    if not isinstance(selected,list) or any(not isinstance(value,str) for value in selected) or len(set(selected))!=len(selected):
        raise ValueError('学习参考选择无效')
    if not set(selected).issubset({r['id'] for r in refs}):raise ValueError('学习参考选择包含不存在的案例')
    return [r for r in refs if r['id'] in selected]


def reference_episode(reference):
    value=reference.get('episode')
    if isinstance(value,int) and not isinstance(value,bool) and value>0:return value
    if isinstance(value,str) and value.isdigit() and int(value)>0:return int(value)
    name=str(reference.get('name',''))
    match=re.search(r'(?:第\s*)?(\d+)\s*[话話]',name) or re.search(r'(?<![A-Za-z0-9])(?:ep|episode)[\s_-]*(\d+)\b',name,re.I) or re.search(r'(?:^|-)ep(\d+)$',str(reference.get('id','')),re.I)
    return int(match[1]) if match and int(match[1])>0 else None


def profile_for(project):
    refs=selected_references(project)
    profile=learned_profile(refs)
    profile['referenceEpisodes']=sorted({reference_episode(r) for r in refs if reference_episode(r) is not None})
    profile['sourceFiles']=[{k:r.get(k) for k in ('id','sourceSha256','revisionId','sourceWidth','sourceHeight')} for r in refs]
    preferences=DATA/'learning-preferences.json'
    if preferences.exists() and project in read(preferences):
        profile['userPreferences']=read(preferences)[project]
        profile['policy'].update(profile['userPreferences']['policy'])
    evidence=DATA/'relationship-evidence.json'
    if evidence.exists():profile['verifiedRelationships']=[e for e in read(evidence)['examples'] if e['referenceId'] in {r['id'] for r in refs}]
    support_evidence=DATA/'support-rule-evidence.json'
    if support_evidence.exists():profile['supportRuleEvidence']=[e for e in read(support_evidence)['examples'] if e['referenceId'] in {r['id'] for r in refs}]
    overlap_evidence=DATA/'overlap-review-v2.json'
    if overlap_evidence.exists() and profile.get('policy',{}).get('overlapDecisionMode')=='story_framing_composition_v2':
        selected={r['id']:r['sourceSha256'] for r in refs};examples=[e for e in read(overlap_evidence)['examples'] if e['referenceId'] in selected]
        for e in examples:
            if selected.get(e['referenceId'])!=e['sourceSha256']:raise ValueError('叠格复核引用未选中的话数或来源版本')
            known_frames={f['referenceFrameId'] for r in refs if r['id']==e['referenceId'] for f in r['frames']}
            if not set(e['referenceFrameIds']).issubset(known_frames):raise ValueError('叠格复核引用不存在的参考框')
            image_path=DATA/'overlap-evidence'/e['image']
            if Path(e['image']).name!=e['image'] or not image_path.is_file() or hashlib.sha256(image_path.read_bytes()).hexdigest()!=e['imageSha256']:raise ValueError('叠格复核局部图片校验不符')
        profile['overlapReviewEvidence']=examples
    from lib.core import digest
    profile['version']=digest({k:v for k,v in profile.items() if k!='version'})[:12]
    return profile


def check_project(project):
    if project==unified.BUILTIN:return
    if project not in [p['id'] for p in read(DATA/'projects.json')]:
        raise ValueError('项目不存在')


from project_library import ProjectLibrary
LIBRARY=ProjectLibrary(ROOT,DATA,profile_for)


def validate_reference(ref):
    if not isinstance(ref.get('frames'),list) or len(ref['frames'])>2000:
        raise ValueError('参考画格数组无效')
    keys=[]
    for p in ref['frames']:
        keys.append(p.get('referenceFrameId'))
        if not isinstance(keys[-1],str) or not ID.fullmatch(keys[-1]):
            raise ValueError('参考画格ID无效')
        if p.get('review') not in ('pending','checked') or p.get('role') not in ('main','support'):
            raise ValueError('参考核对状态或主副格无效')
        x,y,w,h=(p.get(k) for k in ('x','y','w','h'))
        import math
        if any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in (x,y,w,h)) or x<0 or y<0 or w<=0 or h<=0 or x+w>ref['sourceWidth']+1 or y+h>ref['sourceHeight']+1:
            raise ValueError('参考画格超出原图范围')
    if len(set(keys))!=len(keys):
        raise ValueError('参考画格ID重复')


class Handler(BaseHTTPRequestHandler):
    server_version='LayoutWorkbench/0.2'

    def send(self, status, value, mime='application/json; charset=utf-8'):
        raw = json.dumps(value,ensure_ascii=False,allow_nan=False).encode() if mime.startswith('application/json') else value
        self.send_response(status)
        self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(raw)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors http://127.0.0.1:18924")
        self.end_headers()
        self.wfile.write(raw)

    def origin_ok(self):
        host=self.headers.get('Host','')
        allowed={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
        return host in allowed and (not self.headers.get('Origin') or self.headers['Origin'] in ('http://'+host,))

    def do_GET(self):
        try:
            if not self.origin_ok():
                return self.send(403,{'error':'仅允许本机访问'})
            path=unquote(urlparse(self.path).path)
            if path=='/api/integration/status':
                return self.send(200,{'app':'comic-layout-learning-workbench','root':str(ROOT),'busy':bool(ACTIVE_JOBS or LIBRARY.active_learning or MODEL_REQUESTS.unresolved()),'version':'10.24-integrated','requestRecovery':'durable-request-v1','editorOrigin':os.environ.get('LAYOUT_PARENT_ORIGIN','http://127.0.0.1:18924')})
            if path=='/api/health':
                return self.send(200,{'app':'comic-layout-learning-workbench','version':'0.3.0','root':str(ROOT)})
            if path=='/api/integration/rules':return self.send(200,{'entries':unified.catalog(ROOT,LIBRARY,read(DATA/'projects.json'))})
            if path=='/api/library':
                result=LIBRARY.status();preset=unified.builtin(ROOT);result['projects'].append({'id':unified.BUILTIN,'name':preset['name'],'activeVersion':preset['version'],'versions':[{'id':preset['version'],'label':'原工作台规则快照','status':'active','trialPassed':True}]});return self.send(200,result)
            library_match=re.fullmatch(r'/api/library/version/([\w-]+)/([\w-]+)',path)
            if library_match:
                if library_match[1]==unified.BUILTIN:
                    p=unified.builtin(ROOT)
                    if library_match[2]!=p['version']:raise ValueError('规则版本不存在')
                    return self.send(200,{'project':{'referenceIds':[]},'policy':{},'parameterOrigin':'原工作台规则快照','style':{'summary':p['name'],'patterns':[{'name':'原版设计判据','transferRule':p['rules']['designCriteria']}]}})
                return self.send(200,LIBRARY.version_details(*library_match.groups()))
            if path=='/api/script-archive':return self.send(200,{'entries':list(SCRIPT_ARCHIVE.entries().values())})
            if path=='/api/state':
                refs=records('references'); scripts=[s for s in records('scripts') if s['id'] not in SCRIPT_ARCHIVE.entries()]; projects=read(DATA/'projects.json')
                profiles={p['id']:profile_for(p['id']) for p in projects}
                projects.append({'id':unified.BUILTIN,'name':unified.BUILTIN_NAME})
                profiles[unified.BUILTIN]={'sourceFiles':[],'checkedCount':0,'candidateCount':0,'referenceCount':0,'referenceEpisodes':[]}
                active={s['id'] for profile in profiles.values() for s in profile['sourceFiles']}
                return self.send(200,{'projects':projects,'references':[{k:r[k] for k in ('id','projectId','name','sourceWidth','sourceHeight')}|{'episode':reference_episode(r),'checked':sum(f['review']=='checked' for f in r['frames']),'candidates':len(r['frames']),'learningSelected':r['id'] in active} for r in refs], 'scripts':[{'id':s['id'],'projectId':s['projectId'],'episode':s['episode'],'title':s['title'],'count':len(s['shots'])} for s in scripts], 'profiles':{key:public_profile(profile) for key,profile in profiles.items()}})
            match=re.fullmatch(r'/api/(references|scripts|drafts)/([\w-]+)',path)
            if match:
                return self.send(200,read(file_for(*match.groups())))
            match=re.fullmatch(r'/api/jobs/([a-zA-Z0-9_-]{1,90})',path)
            if match:return self.send(200,read(DATA/'runs'/match[1]/'job.json'))
            match=re.fullmatch(r'/assets/([\w-]+)\.jpg',path)
            if match:
                name=match[1]
                file_for('references',name)
                return self.send(200,(DATA/'references'/(name+'.jpg')).read_bytes(),'image/jpeg')
            match=re.fullmatch(r'/review/(26|26-ref21-25|26-rhythm|26-main|26-batch|27-batch|batch21-30|efficiency)/(.+)',path)
            if match:
                folder=(DATA/'reviews'/({'26':'episode26','26-ref21-25':'episode26-ref21-25','26-rhythm':'episode26-rhythm','26-main':'episode26-main','26-batch':'episode26-batch','27-batch':'episode27-batch','batch21-30':'batch21-30','efficiency':'efficiency'}[match[1]])).resolve();target=(folder/match[2]).resolve()
                if not target.is_relative_to(folder) or not target.is_file():return self.send(404,{'error':'验收文件不存在'})
                if target.suffix=='.json':return self.send(200,read(target))
                mime={'.html':'text/html; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.txt':'text/plain; charset=utf-8','.js':'text/javascript; charset=utf-8'}.get(target.suffix,'application/octet-stream')
                return self.send(200,target.read_bytes(),mime)
            static={'/studio-bridge.js':'studio-bridge.js','/':'index.html','/app.js':'app.js','/library.js':'library.js','/script-library.js':'script-library.js','/style.css':'style.css','/preview-zoom.js':'preview-zoom.js'}
            if path in static:
                name=static[path]
                mime='text/html; charset=utf-8' if name.endswith('html') else 'text/javascript; charset=utf-8' if name.endswith('js') else 'text/css; charset=utf-8'
                return self.send(200,(ROOT/'public'/name).read_bytes(),mime)
            self.send(404,{'error':'不存在的路径'})
        except FileNotFoundError:
            self.send(404,{'error':'资料尚未生成或不存在'})
        except (ValueError,TypeError,KeyError) as exc:
            self.send(400,{'error':str(exc)})

    def do_POST(self):
        try:
            if not self.origin_ok():
                return self.send(403,{'error':'仅接受本机同源操作'})
            if urlparse(self.path).path=='/api/integration/stop':
                if not os.environ.get('LAYOUT_CONTROL_TOKEN') or not hmac.compare_digest(self.headers.get('X-Layout-Control',''),os.environ['LAYOUT_CONTROL_TOKEN']):return self.send(403,{'error':'停止凭据无效'})
                if ACTIVE_JOBS or LIBRARY.active_learning or MODEL_REQUESTS.unresolved():return self.send(409,{'error':'排版任务仍在运行'})
                self.send(200,{'stopped':True});threading.Thread(target=self.server.shutdown,daemon=True).start();return
            if urlparse(self.path).path=='/api/import/reference-binary':
                return self.send(200,self.import_binary_reference())
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>160*1024*1024:
                return self.send(413,{'error':'请求超过160MB或为空'})
            value=json.loads(self.rfile.read(size),parse_constant=lambda x: (_ for _ in ()).throw(ValueError('不接受NaN或Infinity')))
            path=urlparse(self.path).path
            if path=='/api/integration/apply':
                from manual_apply import apply_selection
                # The editor validates/exports via this service; do not hold LOCK across that callback.
                result=apply_selection(DATA,value,os.environ.get('LAYOUT_PARENT_ORIGIN',''),ACTIVE_JOBS,read)
            else:
                with LOCK:
                    result=self.mutate(path,value)
            self.send(200,result)
        except FileNotFoundError:
            self.send(404,{'error':'找不到所需资料'})
        except (ValueError,TypeError,KeyError,IndexError) as exc:
            self.send(400,{'error':str(exc),'preDispatch':bool(getattr(exc,'pre_dispatch',False))})
        except Exception as exc:
            print(type(exc).__name__,str(exc),file=sys.stderr,flush=True)
            self.send(500,{'error':'处理失败；请查看服务日志，原文件未被修改'})

    def import_binary_reference(self):
        size=int(self.headers.get('Content-Length','0'))
        if size<=0 or size>350*1024*1024:raise ValueError('参考图需小于350MB')
        project=self.headers.get('X-Project-Id','');check_project(project)
        if project==unified.BUILTIN:raise ValueError('内置规则为固定快照；请在自己的学习项目中添加参考')
        filename=Path(unquote(self.headers.get('X-File-Name',''))).name
        suffix=Path(filename).suffix.lower()
        if suffix not in ('.png','.jpg','.jpeg'):raise ValueError('只支持PNG/JPG成品长图')
        upload=DATA/('upload-'+uuid.uuid4().hex+suffix)
        try:
            remaining=size;sha=hashlib.sha256()
            with upload.open('wb') as output:
                while remaining:
                    chunk=self.rfile.read(min(4*1024*1024,remaining))
                    if not chunk:raise ValueError('图片上传未完整传输')
                    output.write(chunk);sha.update(chunk);remaining-=len(chunk)
            with Image.open(upload) as source:
                if source.width*source.height>250_000_000:raise ValueError('参考图超过2.5亿像素，需先制作等比例查看副本')
            name=f'{project}-{sha.hexdigest()[:16]}'
            from lib.measure import measure,preview
            ref,small=measure(upload)
            ref.update(id=name,projectId=project,name=filename,revisionId=None,reviewNote='整话自动候选，待核对边界不参与数值统计。封面和尾图不计入正文参考格。')
            for p in ref['frames']:p.update(role='main' if p['w']>.88*ref['sourceWidth'] and p['h']>p['w'] else 'support',review='pending')
            with LOCK:
                target=file_for('references',name)
                if not target.exists():write(target,ref)
                small.convert('RGB').save(DATA/'references'/(name+'.jpg'),quality=87)
                preview(ref,small,DATA/'references'/(name+'-overview.jpg'))
            return {'id':name}
        finally:upload.unlink(missing_ok=True)

    def mutate(self,path,v):
        if path=='/api/script/archive':return SCRIPT_ARCHIVE.archive(v['id'],v['script'],v.get('packet'),v['id'] in ACTIVE_JOBS)
        if path=='/api/script/restore':return SCRIPT_ARCHIVE.restore(v['id'])
        if path=='/api/integration/rules/resolve':return unified.resolve(ROOT,LIBRARY,v)
        if path=='/api/integration/import':
            project=v['learningProjectId'];check_project(project)
            if not re.fullmatch(r'project_[0-9a-f-]{36}',v['projectId']):raise ValueError('原工程ID无效')
            raw=json.dumps({'title':v['title'],'episode':v['episode'],'shots':v['shots']},ensure_ascii=False,sort_keys=True).encode('utf-8')
            source={'kind':'studio-snapshot','filename':v['title']+'.json','sha256':hashlib.sha256(raw).hexdigest(),'projectId':v['projectId'],'revision':v['revision']}
            from lib.importers import normalize_script
            script=normalize_script(v,source)
            if len(script['shots'])>800:raise ValueError('最多800格')
            name=project+'-studio-'+hashlib.sha256(raw+str(v['revision']).encode()+str(v.get('reflowBatchId','')).encode()).hexdigest()[:16]
            studio_source={'projectId':v['projectId'],'revision':v['revision']}
            if v.get('reflowBatchId'):
                if not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',v['reflowBatchId']):raise ValueError('重排批次无效')
                studio_source.update(reflowBatchId=v['reflowBatchId'],mode='screen-crop-reflow');source.update(mode='screen-crop-reflow',reflowBatchId=v['reflowBatchId'])
            if v.get('planningBatchId'):
                if not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',v['planningBatchId']):raise ValueError('规划批次无效')
                studio_source.update(planningBatchId=v['planningBatchId'],mode='preproduction-layout');source.update(mode='preproduction-layout')
            if v.get('layoutRuleContract'):
                contract=unified.resolve(ROOT,LIBRARY,{'contract':v['layoutRuleContract']})
                if contract['id']!=project:raise ValueError('规则与所选项目不一致')
                script['layoutRuleContract']=contract
                name=project+'-studio-'+hashlib.sha256(raw+str(v['revision']).encode()+str(v.get('reflowBatchId',v.get('planningBatchId',''))).encode()+contract['digest'].encode()).hexdigest()[:16]
            script.update(id=name,projectId=project,studioSource=studio_source)
            write(file_for('scripts',name),script);SCRIPT_ARCHIVE.restore(name);return {'id':name}
        if path=='/api/projects':
            if str(v.get('name','')).strip()==unified.BUILTIN_NAME:raise ValueError('这是内置规则名称，请为新学习项目使用其他名称')
            project=LIBRARY.create(v.get('name'))
            target=DATA/'reference-selections.json';selections=read(target) if target.exists() else {}
            selections[project['id']]=[];write(target,selections)
            return project
        if path=='/api/library/learn':
            check_project(v['projectId'])
            if v['projectId']==unified.BUILTIN:raise ValueError('原规则已经内置，无需学习；请选择自己的作品项目学习新风格')
            if not selected_references(v['projectId']):raise ValueError('请先在“选择学习参考范围”中保存至少一份本项目参考')
            return LIBRARY.learn(v['projectId'])
        if path=='/api/library/activate':return LIBRARY.activate(v['projectId'],v['version'])
        if path=='/api/library/select':
            project=v['projectId'];check_project(project)
            refs={r['id'] for r in records('references') if r['projectId']==project};chosen=v['referenceIds']
            if not isinstance(chosen,list) or any(not isinstance(value,str) for value in chosen) or len(set(chosen))!=len(chosen) or not set(chosen).issubset(refs):raise ValueError('学习范围只能包含本项目的参考，且不能重复')
            target=DATA/'reference-selections.json';selections=read(target) if target.exists() else {};selections[project]=chosen;write(target,selections);return {'saved':True,'referenceIds':chosen,'selectedCount':len(chosen)}
        if path in ('/api/model/generate','/api/model/resolve'):
            if v['id'] in SCRIPT_ARCHIVE.entries():raise ValueError('这份分镜已删除，旧结果保留，不自动恢复')
            script=read(file_for('scripts',v['id']))
            if path.endswith('/resolve'):
                def validate_preview(packet,fixed):
                    if fixed.get('layoutRuleContract'):
                        unified.resolve(ROOT,LIBRARY,{'contract':fixed['layoutRuleContract']})
                        unified.validate_packet(packet,fixed,ROOT)
                    else:validate_geometry(packet,fixed)
                    if packet.get('generator',{}).get('mode') not in ('model-generated','native-style-rules'):raise ValueError('该稿不是已验证的排版预览')
                return MODEL_REQUESTS.resolve(script,ACTIVE_JOBS,v.get('requestId'),bool(v.get('allowPreview')),validate_preview,v.get('resumeJob'))
            if script['projectId']==unified.BUILTIN and not script.get('layoutRuleContract'):
                script['layoutRuleContract']=unified.freeze(ROOT,LIBRARY,unified.BUILTIN);write(file_for('scripts',script['id']),script)
            # Preflight failure is definitive: no receipt, worker or model was created.
            if script.get('layoutRuleContract'):
                try:unified.resolve(ROOT,LIBRARY,{'contract':script['layoutRuleContract']})
                except (ValueError,KeyError,TypeError) as exc:
                    exc.pre_dispatch=True
                    raise
            def launch(job_id,on_finish):
                if script.get('layoutRuleContract'):
                    unified.resolve(ROOT,LIBRARY,{'contract':script['layoutRuleContract']})
                    return unified.start_job(ROOT,DATA,script,job_id,on_finish,v.get('reasoningEffort','high'))
                return LIBRARY.generate(script,job_id,on_finish,v.get('styleVersion'),v.get('reasoningEffort','high'))
            return MODEL_REQUESTS.dispatch(script,ACTIVE_JOBS,launch,request_id=v.get('requestId'),
                effort=v.get('reasoningEffort','high'),force_new=v.get('forceNew',False),busy_learning=bool(LIBRARY.active_learning))
        if path=='/api/reference/save':
            target=file_for('references',v['id']); original=read(target)
            ref=dict(original,frames=v['frames'])
            validate_reference(ref)
            write(target,ref)
            return {'saved':True,'profile':public_profile(profile_for(ref['projectId']))}
        if path=='/api/generate':
            script=read(file_for('scripts',v['id']))
            if script.get('layoutRuleContract'):raise ValueError('统一规则任务请使用Codex自动排版，不能用另一套试排规则替换')
            packet=plan_layout(script,profile_for(script['projectId']),script['projectId'],int(v.get('variant',0)))
            write(file_for('drafts',v['id']),packet)
            return packet
        if path in ('/api/draft/save','/api/export'):
            script=read(file_for('scripts',v['id'])); packet=v['packet']
            # User edits coordinates; derived scene bands follow the edited positions.
            if len(packet.get('panels',[]))!=len(script['shots']):
                raise ValueError('格数改变，拒绝保存或导出')
            if packet.get('generator',{}).get('mode')=='native-style-rules':unified.validate_packet(packet,script,ROOT)
            elif packet.get('generator',{}).get('mode')!='model-generated':packet['backgrounds']=backgrounds(packet,script)
            validate_geometry(packet,script)
            write(file_for('drafts',v['id']),packet)
            return {'saved':True,'packet':packet}
        if path in ('/api/import/script','/api/import/reference'):
            project=v['projectId']; check_project(project)
            if project==unified.BUILTIN and path.endswith('/reference'):raise ValueError('内置规则不可追加参考，请选择自己的学习项目')
            filename=Path(v['filename']).name
            raw=base64.b64decode(v['base64'],validate=True)
            if path.endswith('/script'):
                scripts=import_scripts(raw,filename)
                ids=[]
                for i,script in enumerate(scripts):
                    name=f'{project}-{hashlib.sha256(raw).hexdigest()[:12]}-{i}'
                    script.update(id=name,projectId=project)
                    write(file_for('scripts',name),script);SCRIPT_ARCHIVE.restore(name); ids.append(name)
                return {'ids':ids}
            if Path(filename).suffix.lower() not in ('.png','.jpg','.jpeg'):
                raise ValueError('参考只支持PNG/JPG长图')
            from lib.measure import measure
            sha=hashlib.sha256(raw).hexdigest()
            name=f'{project}-{sha[:16]}'
            # Temporary upload exists only inside this tool. Never alter the source.
            upload=DATA/(name+Path(filename).suffix.lower())
            try:
                upload.write_bytes(raw)
                ref,small=measure(upload)
                ref.update(id=name,projectId=project,name=filename,revisionId=None,reviewNote='新导入图片的自动候选，全部待核对；封面尾图不应标为正文参考格。')
                for p in ref['frames']:
                    p['role']='main' if p['w']>.88*ref['sourceWidth'] and p['h']>p['w'] else 'support'
                    p['review']='pending'
                # Reimport does not erase a previous manual annotation.
                target=file_for('references',name)
                if not target.exists(): write(target,ref)
                small.convert('RGB').save(DATA/'references'/(name+'.jpg'),quality=87)
                return {'id':name}
            finally:
                upload.unlink(missing_ok=True)
        raise ValueError('不支持的操作')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description='项目排版学习工作台（仅本机）')
    parser.add_argument('--port',type=int,default=19847)
    args=parser.parse_args()
    try:
        server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    except OSError:
        print(f'端口{args.port}已被占用。请先检查是否已启动本工具，或用--port指定其他端口。',file=sys.stderr)
        sys.exit(1)
    print(f'排版工作台 http://127.0.0.1:{args.port}/',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: server.server_close()
