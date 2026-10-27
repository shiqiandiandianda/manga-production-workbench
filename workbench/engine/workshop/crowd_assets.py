"""Five-member casting pool with one immutable full group and two extracts."""
from __future__ import annotations
import copy
import hashlib
import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor,as_completed
from uuid import uuid4

IMAGE_PARTS=('full_group','heads','clothing')
PART_FIELDS={'full_group':'fullGroupImage','heads':'headSheet','clothing':'clothingSheet'}
BASIS=('source','inference','production_design','authorized_adaptation')
EVIDENCE={'type':'array','items':{'type':'object','properties':{'paragraphId':{'type':'string'},'quote':{'type':'string'}},'required':['paragraphId','quote'],'additionalProperties':False}}
MEMBER_PROPS={
    'index':{'type':'integer','minimum':1,'maximum':5},'name':{'type':'string'},
    'gender':{'type':'string','enum':['男','女','通用','未说明']},
    'sourceGender':{'type':'string','enum':['男','女','未说明']},
    'genderBasis':{'type':'string','enum':list(BASIS)},
    'ageStage':{'type':'string'},'sourceDescription':{'type':'string'},'sourceEvidence':EVIDENCE,
    'designDescription':{'type':'string'},'designBasis':{'type':'string','enum':['production_design','authorized_adaptation']},
    'faceDesign':{'type':'string'},'bodyDesign':{'type':'string'},'hairstyleDesign':{'type':'string'},
    'costumeGroupId':{'type':'string'},'costumeDesign':{'type':'string'}}
PLAN_SCHEMA={'type':'object','properties':{
    'name':{'type':'string'},'costumePolicy':{'type':'string','enum':['uniform','mixed','varied']},
    'basis':{'type':'string','enum':list(BASIS)},'sourceEvidence':EVIDENCE,'sourceDescription':{'type':'string'},
    'designDescription':{'type':'string'},'members':{'type':'array','minItems':5,'maxItems':5,
        'items':{'type':'object','properties':MEMBER_PROPS,'required':list(MEMBER_PROPS),'additionalProperties':False}}},
    'required':['name','costumePolicy','basis','sourceEvidence','sourceDescription','designDescription','members'],
    'additionalProperties':False}

def _qc_schema(names,extras=None):
    props={name:{'type':'boolean'} for name in names};props.update(extras or {});props['issues']={'type':'string'}
    return {'type':'object','properties':props,'required':list(props),'additionalProperties':False}
FULL_CHECK=_qc_schema(('exactlyFive','differentFaces','fullBodies','styleConsistent','costumesMatchPolicy','sourceRestrictionsRespected'),
    {'sourceStyle':{'type':'string','enum':['comic','photo','3d','mixed','unknown']}})
HEAD_CHECK=_qc_schema(('exactlyFive','sameMembers','differentFaces','completeHair','noNeckShoulders','layout3plus2','clean'))
CLOTHING_CHECK=_qc_schema(('sameMembers','pureClothing','matchingCostumePolicy','detailVisible','clean'),
    {'setCount':{'type':'integer','minimum':1,'maximum':5}})


def _sha(worker,url):
    return hashlib.sha256(worker.asset_path(url).read_bytes()).hexdigest()


def source_context(worker,job,project,role):
    from chapter_analysis import selected_chapters
    scoped=copy.deepcopy(project or {})
    read=job.get('readScope') or {}
    if read.get('range'):
        scoped['rangeStart'],scoped['rangeEnd']=read['range']
    chapters=selected_chapters(scoped) if scoped.get('chapters') or scoped.get('chapterContents') else []
    numbers=read.get('chapterNumbers')
    if numbers:chapters=[c for c in chapters if c['chapter'] in numbers]
    text='\n\n'.join(c['text'] for c in chapters) if chapters else worker.scoped_script(scoped)[0]
    paragraphs={p['id']:p['text'] for c in chapters for p in c.get('paragraphs',[])}
    paragraph_chapters={p['id']:c['chapter'] for c in chapters for p in c.get('paragraphs',[])}
    eligible=set()
    if role:
        for ch in scoped.get('chapterAnalysis',{}).get('chapters',[]):
            if chapters and ch.get('chapter') not in [c['chapter'] for c in chapters]:continue
            for segment in ch.get('segments',[]):
                for appearance in segment.get('appearances',[]):
                    if appearance.get('characterId')==role.get('id'):
                        eligible.update(e.get('paragraphId') for e in appearance.get('evidence',[]) if e.get('paragraphId'))
    read_scope=copy.deepcopy(read) if read else {'range':[int(scoped.get('rangeStart') or 1),int(scoped.get('rangeEnd') or 10)],
        'chapterNumbers':[c['chapter'] for c in chapters],
        'sourceHashes':sorted({c.get('sourceHash') for c in chapters if c.get('sourceHash')}),
        'scriptHash':hashlib.sha256(json.dumps(chapters,ensure_ascii=False,sort_keys=True).encode()).hexdigest()}
    return {'script':text,'paragraphs':paragraphs,'paragraphChapters':paragraph_chapters,'eligibleParagraphIds':eligible,'readScope':read_scope,
        'role':{'id':(role or {}).get('id',''),'name':(role or {}).get('name') or job.get('selectedRole') or job.get('name','群像素材'),
            'description':(role or {}).get('description',''),
            'sourceHistory':[r for r in (role or {}).get('sourceDescriptionHistory',[]) if not chapters or r.get('chapter') in [c['chapter'] for c in chapters]]}}


def _verified_evidence(items,context):
    result=[]
    for row in items if isinstance(items,list) else []:
        if not isinstance(row,dict):continue
        pid,quote=row.get('paragraphId',''),row.get('quote','')
        paragraph=context['paragraphs'].get(pid)
        if not quote or not paragraph or (context['eligibleParagraphIds'] and pid not in context['eligibleParagraphIds']):continue
        chapter=context.get('paragraphChapters',{}).get(pid)
        if isinstance(chapter,int) and quote in paragraph:
            result.append({'chapter':chapter,'paragraphId':pid,'quote':quote,'claimType':'literal','verified':True})
    return result


def _requested_policy(job):
    value=job.get('costumePolicy')
    return value if value in ('uniform','mixed','varied') and job.get('costumePolicyRequested') is not False else None


def _plan_ready(item):
    return bool(item.get('members') and (item.get('parts',{}).get('plan',{}).get('status')=='completed' or
        item.get('reviewStatus') in ('approved_manual','manual_authorized') or
        all(item.get('parts',{}).get(p,{}).get('review',{}).get('status')=='manual_authorized' for p in IMAGE_PARTS)))


def normalize_plan(plan,context,requested=None):
    from life_stages import AGE_STAGES
    if not isinstance(plan,dict) or len(plan.get('members',[]))!=5 or sorted(m.get('index') for m in plan['members'])!=[1,2,3,4,5]:
        raise ValueError('群像选角池需要5个不同成员，不能把原文人数或同框人数默认改成5')
    policy=plan.get('costumePolicy')
    if policy not in ('uniform','mixed','varied') or plan.get('basis') not in BASIS:raise ValueError('群像服装策略或依据不正确')
    result=copy.deepcopy(plan);warnings=[];requested=requested or {}
    wanted=_requested_policy(requested)
    if wanted and wanted!=policy:raise ValueError('计划没有遵守所选服装策略，请重试，不静默改为其他策略')
    result['sourceEvidence']=_verified_evidence(plan.get('sourceEvidence'),context)
    quoted='；'.join(row['quote'] for row in result['sourceEvidence'])
    explicit_uniform=bool(re.search(r'统一|制式|制服|同款|相同.{0,8}(?:衣|服|袍)|同样.{0,8}(?:衣|服|袍)|一色.{0,8}(?:衣|服|袍)|(?:都|均|所有).{0,12}(?:衣|服|袍)',quoted))
    explicit_varied=bool(re.search(r'(?:衣|服|袍).{0,8}(?:各异|不同)|各自.{0,8}(?:衣|服|袍)',quoted))
    if result['basis']=='source' and (not result['sourceEvidence'] or (policy=='uniform' and not explicit_uniform) or
        (policy in ('mixed','varied') and not explicit_varied)):
        result['basis']='production_design';warnings.append('服装策略没有明确原文证据，已按美术补设登记；机构身份不等于原著制服。')
    result['sourceDescription']='；'.join(row['quote'] for row in result['sourceEvidence'])
    canonical={}
    for member in sorted(result['members'],key=lambda m:m['index']):
        if member.get('gender') not in ('男','女','通用','未说明') or member.get('ageStage') not in AGE_STAGES:
            raise ValueError('群像成员的性别或年龄分类无效')
        member['memberKey']='member_'+str(member['index'])
        member['sourceEvidence']=_verified_evidence(member.get('sourceEvidence'),context)
        if not member['sourceEvidence']:
            member['sourceDescription']='';member['sourceGender']='未说明'
            if member.get('genderBasis')=='source':member['genderBasis']='production_design'
        else:member['sourceDescription']='；'.join(row['quote'] for row in member['sourceEvidence'])
        if member.get('sourceGender') in ('男','女') and member['sourceEvidence']:
            evidence='；'.join(e['quote'] for e in member['sourceEvidence'])
            words=r'女|少女|妇|姑娘|女子' if member['sourceGender']=='女' else r'男|少年|汉子|大汉|男子'
            if not re.search(words,evidence):
                member['sourceGender']='未说明';member['genderBasis']='production_design'
                warnings.append('性别原文未明确，设计选择不冒充源文性别。')
            elif member['gender']!=member['sourceGender']:raise ValueError('群像设计违背明确原文性别，未继续生图')
        if member['sourceEvidence'] and re.search(r'儿童|小孩|孩童|童子|婴儿|婴孩',member['sourceDescription']) and member['ageStage'] not in ('infant','child'):
            raise ValueError('群像设计违背原文明示儿童年龄，未继续生图')
        if requested.get('ageStage') not in (None,'','unspecified') and member['ageStage']!=requested['ageStage']:
            raise ValueError('群像计划没有遵守所选年龄分类，未继续生图')
        if requested.get('gender') in ('男','女') and member['gender']!=requested['gender']:
            raise ValueError('群像计划没有遵守用户所选性别，未继续生图')
        group=member.get('costumeGroupId') or member['memberKey']
        if policy=='uniform':group='costume_1'
        elif policy=='varied':group='costume_'+str(member['index'])
        else:
            if group not in canonical:canonical[group]='costume_'+str(len(canonical)+1)
            group=canonical[group]
        member['costumeGroupId']=group
        if member.get('designBasis') not in ('production_design','authorized_adaptation'):member['designBasis']='production_design'
    result['members'].sort(key=lambda m:m['index'])
    groups=list(dict.fromkeys(m['costumeGroupId'] for m in result['members']))
    if policy=='mixed' and not 1<len(groups)<5:raise ValueError('混合服装策略需要部分成员共用服装、部分不同，请重试计划')
    result.update(castingPoolSize=5,memberCountBasis='production_design',
        sourceFacts={'memberCount':'unknown','sameFrame':'unknown','clothing':'unknown'},
        sourceStatus='unspecified',warnings=list(dict.fromkeys(warnings)),readScope=context['readScope'])
    layout=requested.get('clothingLayout') or '3+2'
    if layout not in ('3+2','1x5'):raise ValueError('服装排布须为3+2或1x5')
    result['clothingLayout']=layout;result['headLayout']='3+2';result['fullGroupLayout']='1x5'
    result['costumePolicyBasis']=result['basis'];result['costumeSourceEvidence']=copy.deepcopy(result['sourceEvidence'])
    result['designBasis']='production_design'
    result['classificationBasis']='production_design'
    result.update(era=requested.get('era') or 'unspecified',gender=requested.get('gender') or '通用',ageStage=requested.get('ageStage') or 'unspecified')
    result['memberIndex']=[{'memberKey':m['memberKey'],'index':m['index'],
        'fullGroupIndex':m['index'],'head':{'row':1 if m['index']<=3 else 2,'col':m['index'] if m['index']<=3 else m['index']-3},
        'clothing':({'row':1,'col':groups.index(m['costumeGroupId'])+1} if layout=='1x5' else
            {'row':1 if groups.index(m['costumeGroupId'])<3 else 2,'col':groups.index(m['costumeGroupId'])%3+1}),
        'costumeGroupId':m['costumeGroupId']} for m in result['members']]
    return result


def _ready(worker,item,part):
    field=PART_FIELDS[part];record=item.get('parts',{}).get(part,{})
    review=record.get('review') or {}
    if record.get('status')!='completed' or review.get('status') not in ('checked','manual_authorized'):return False
    if not worker._usable_image(item.get(field)):return False
    return bool(record.get('sha256') and record['sha256']==_sha(worker,item[field]))


def _status(worker,item):
    ready=all(_ready(worker,item,part) for part in IMAGE_PARTS)
    item.update(image=item.get('headSheet',''),status='ready' if ready else 'partial',
        reviewStatus=('manual_authorized' if ready and any(item.get('parts',{}).get(p,{}).get('review',{}).get('status')=='manual_authorized' for p in IMAGE_PARTS) else 'checked') if ready else 'pending',productionReady=ready)
    return ready


def _qc(worker,client,directory,prompt,refs,schema,requirements,update,expected_sets=None):
    check=worker._turn(client,directory,prompt,refs,schema=schema,update=update)
    if not isinstance(check,dict):raise ValueError('群像图像核验返回无效数据')
    good=all(check.get(key) is True for key in requirements)
    if expected_sets is not None:good=good and check.get('setCount')==expected_sets
    return good,check


def crowd_set(worker,job,project,library,directory,update):
    role=next((r for r in (project or {}).get('characters',[]) if r.get('id')==(job.get('characterId') or job.get('roleId'))),None)
    if (job.get('characterId') or job.get('roleId')) and (not role or role.get('category')!='群像'):
        raise ValueError('五人套组仅绑定群像角色，主角配角身份不能被套组选角覆盖')
    from life_stages import AGE_STAGES
    if job.get('era','unspecified') not in ('ancient','modern','future','unspecified') or job.get('gender','通用') not in ('男','女','通用','未说明') or job.get('ageStage','unspecified') not in AGE_STAGES:
        raise ValueError('群像时代、性别或年龄分类无效')
    context=source_context(worker,job,project,role)
    requested_parts=job.get('parts') or list(IMAGE_PARTS)
    if not isinstance(requested_parts,list) or not requested_parts or any(p not in IMAGE_PARTS for p in requested_parts):
        raise ValueError('请指定全身、五头或服装的有效群像输出项')
    requested_parts=list(dict.fromkeys(requested_parts))
    style=job.get('style') or worker.style_of(project or {})
    if style not in worker.STYLES:raise ValueError('群像套组请选择项目漫画画风')
    item=next((x for x in library if x.get('id')==job.get('crowdSetId')),None)
    if item and item.get('kind')!='crowd_set':raise ValueError('续作来源不是群像套组')
    if not item:
        item={'id':job.get('crowdSetId') or uuid4().hex,'kind':'crowd_set','name':job.get('name') or context['role']['name'],
            'style':style,'createdAt':time.time(),'parts':{},'sourceHashes':{},'sourceFacts':{'memberCount':'unknown','sameFrame':'unknown','clothing':'unknown'},
            'castingPoolSize':5,'memberCountBasis':'production_design','readScope':context['readScope'],'sourceRoleId':(role or {}).get('id',''),
            'sourceProjectId':(project or {}).get('id',''),'sourceCharacterId':(role or {}).get('id',''),
            'era':job.get('era') or 'unspecified','gender':job.get('gender') or '通用','ageStage':job.get('ageStage') or 'unspecified','fullGroupImage':'','headSheet':'','clothingSheet':'','image':''}
        library.append(item)
    else:
        if item.get('style')!=style:raise ValueError('续作画风已变化，请另建套组，原套图保留')
        if job.get('readScope') and item.get('readScope')!=context['readScope']:raise ValueError('续作章节范围已变化，请保留原套组另建新素材')
    if _plan_ready(item) and _requested_policy(job) and item.get('costumePolicy')!=_requested_policy(job):
        raise ValueError('服装策略已经与固定五人源图绑定，改变策略请另建套组，原演员素材保留')
    lock=threading.RLock()
    def checkpoint(message):
        with lock:
            _status(worker,item)
            if role:
                role['crowdSetId']=item['id']
                role['crowdAssets']={key:copy.deepcopy(item.get(key)) for key in ('fullGroupImage','headSheet','clothingSheet','members','memberIndex',
                    'costumePolicy','costumePolicyBasis','clothingLayout','headLayout','fullGroupLayout','era','gender','ageStage','basis','sourceDescription','designDescription','designBasis','costumeSourceEvidence','sourceEvidence','sourceFacts','sourceStatus','reviewStatus','sourceHashes','readScope','parts','style','productionReady')}
                role['crowdAssets']['crowdSetId']=item['id']
            steps=[{'id':p,'status':('completed' if p=='plan' and _plan_ready(item) else item.get('parts',{}).get(p,{}).get('status','pending')),
                'message':item.get('parts',{}).get(p,{}).get('error','')} for p in ('plan',*IMAGE_PARTS)]
            update(phase='crowd_set',message=message,crowdSet=copy.deepcopy(item),
                stepProgress={'completed':sum(r['status']=='completed' for r in steps),'total':4,
                    'currentStep':next((r['id'] for r in steps if r['status']=='running'),''),'steps':steps},
                checkpoint={'project':project,'library':library})
    source=job.get('refGroupImage') or item.get('fullGroupImage')
    if job.get('refGroupImage') and item.get('fullGroupImage') and job['refGroupImage']!=item['fullGroupImage']:
        raise ValueError('续作不能替换已接受的五人源图，避免换演员；请另建套组')
    if item.get('fullGroupImage') and item.get('sourceHashes',{}).get('full_group') and _sha(worker,item['fullGroupImage'])!=item['sourceHashes']['full_group']:
        raise ValueError('五人来源文件已变化，原已成功提取项保留，请另建来源套组')
    if 'full_group' not in requested_parts and not source:
        raise ValueError('请先生成或上传固定五人全身源图，再提取头部与服装')
    checkpoint('群像套组已登记，五人是素材选角池，原著人数未确认')
    if all(_ready(worker,item,p) for p in requested_parts) and _plan_ready(item):
        return {'project':project,'library':library,'crowdSet':copy.deepcopy(item),'needsRetry':False,'partialFailures':[],
            'message':'所选群像素材已实际存在，复用现有图片，不重复生成'}
    with worker.AppServer(directory) as client:
        worker._ensure_ready(client)
        if not _plan_ready(item):
            item['parts']['plan']={'status':'running'};checkpoint('正在按本范围原文规划群像与服装策略')
            plan=worker._turn(client,directory,
                '只分析不生图，规划恰好5个不同长相的群像选角池成员。这5是备选素材数量，不是原著出场/同框人数。'
                '优先原文明示性别年龄服饰硬要求；未知原文sourceDescription留空/sourceGender未说明，合理补设写designDescription/designBasis。'
                '按剧情判断服装策略uniform统一服/mixed部分同服/varied各不同服；机构职务或门派身份本身不能证明原文制服，'
                '无明确同服句则策略basis为production_design。只引用选定范围和本群像原句，不借旁人的性别服饰。'
                '成员脸型眉眼鼻颌至少明显不同；原文明示的相同/不同体型发型优先，其余自然设计。'
                '附图若有是已存在的五个演员及服装，按从左至右index1..5读取，不能另设计身份。'
                +worker.prompt_data({'role':context['role'],'script':context['script'] if not context['paragraphs'] else '',
                    'paragraphs':{k:v for k,v in context['paragraphs'].items() if not context['eligibleParagraphIds'] or k in context['eligibleParagraphIds']},
                    'requestedPolicy':_requested_policy(job),'requestedGender':job.get('gender'),'requestedEra':job.get('era'),'requestedAgeStage':job.get('ageStage'),'requestedLayout':job.get('clothingLayout'),
                    'eligibleParagraphIds':sorted(context['eligibleParagraphIds']),'instructions':job.get('instructions','')}),
                worker.references(source) if source else [],schema=PLAN_SCHEMA,update=update)
            plan=normalize_plan(plan,context,job)
            item.update({k:copy.deepcopy(v) for k,v in plan.items() if k!='parts'})
            item['parts']['plan']={'status':'completed'};checkpoint('五人造型与服装策略计划已保存，补设与原文分开')
        if not _ready(worker,item,'full_group'):
            item['parts']['full_group']={'status':'running'};checkpoint('核对或生成同批五人全身源图')
            full_prompt=worker.image_prefix(style)+(
                '生成一张16:9白底横版五人全身选角池，恰好五位不同演员从左至右对应member1..5，自然直立全身含完整头发鞋底。'
                '不是一个人多视图，五张脸必须在骨相脸型眉眼鼻颌真实区分，不只发型表情不同；同项目画风。'
                '各人物体型发型服装严格跟plan，uniform同一款制服、mixed指定共享、varied五套各不同，饰品鞋袖结构完整。'
                '五人仅素材备选，画面不能有剧情场景、标签、编号、文字、水印，不表示原文五人同时出现。'
                +worker.prompt_data({'plan':{k:item.get(k) for k in ('members','costumePolicy','basis','designDescription','sourceEvidence')}}))
            qc_prompt=('只读检查第一张五人全身素材/原参考，exactlyFive必须恰好5个不同人而非一人重复视图；differentFaces检查五人真实五官骨相不同；'
                'fullBodies检查完整头发到鞋底；styleConsistent核验同一种画风（来源是导入原图时只识别实际风格，不伪标漫画）；'
                'costumesMatchPolicy检查与计划的统一/混合/不同衣服对应；sourceRestrictionsRespected检查有证据的原文硬性要求。'
                'sourceStyle真实识别comic/photo/3d/mixed/unknown。'+worker.prompt_data({'sourceImported':bool(source),'style':style,
                    'costumePolicy':item['costumePolicy'],'members':item['members'],
                    'originalRoleParagraphs':{k:v for k,v in context['paragraphs'].items() if not context['eligibleParagraphIds'] or k in context['eligibleParagraphIds']}}))
            try:
                native=worker.asset_path(source) if source else worker._turn(client,directory,full_prompt,[],update=update,image=True)
                for attempt in range(2):
                    good,review=_qc(worker,client,directory,qc_prompt,[native],FULL_CHECK,
                        ('exactlyFive','differentFaces','fullBodies','styleConsistent','costumesMatchPolicy','sourceRestrictionsRespected'),update)
                    if good:break
                    if source or attempt:raise ValueError('五人源图核验未通过：'+review.get('issues',''))
                    native=worker._turn(client,directory,full_prompt+'仅修复上一图：'+review.get('issues',''),[native],update=update,image=True)
                url=source or worker._save_generated(native,directory,'full-group',True)
                digest=_sha(worker,url)
                item.update(fullGroupImage=url,sourceStyle=review['sourceStyle'])
                item['sourceHashes']['full_group']=digest
                item['parts']['full_group']={'status':'completed','image':url,'sha256':digest,'review':{'status':'checked',**review},'importedOriginal':bool(source)}
                checkpoint('同批五人源图已核验并保存，不再换演员')
            except worker.Cancelled:raise
            except Exception as error:
                item['parts']['full_group']={'status':'failed','error':str(error)[:1000]};checkpoint('五人源图尚未通过，成功记录保留')
    if _ready(worker,item,'full_group'):
        full=item['fullGroupImage'];source_hash=item['sourceHashes']['full_group']
        wanted=[p for p in ('heads','clothing') if p in requested_parts and not _ready(worker,item,p)]
        def extract(part):
            stage=directory/part;stage.mkdir(parents=True,exist_ok=True)
            with lock:item['parts'][part]={'status':'running'};checkpoint('正在提取同批'+('五张完整头部' if part=='heads' else '对应纯服装'))
            groups=list(dict.fromkeys(m['costumeGroupId'] for m in item['members']))
            if part=='heads':
                prompt=worker.image_prefix(style)+(
                    '从第一张固定五人源图一次提取同一批5张完整头部，不重新设计演员。16:9白底横版，3+2五格：第一排成员1、2、3，第二排成员4、5。'
                    '每头正对镜头、双眼水平，完整顶部发髻发饰马尾发尾和两侧头发，不露颈肩衣领身体，无文字标签水印。'
                    '脸型五官发色发型发饰年龄肤色一一对应原五人；真实5个不同人，不能克隆一人或混顺序。不生成光头纯五官和独立发型。')
                schema=HEAD_CHECK;keys=('exactlyFive','sameMembers','differentFaces','completeHair','noNeckShoulders','layout3plus2','clean')
                check_prompt='只读检查5头3+2提取图（第一张）对原五人全身（第二张）：真实5张不同且同源对应脸，完整发型与发饰，无颈肩衣领身体，纯白无字，顺序1..5严格对应。'
                expected=None
            else:
                prompt=worker.image_prefix(style)+(
                    '从第一张固定五人源图一次提取对应服装卡，16:9白底纯衣服无任何人物、脸、头发、皮肤、脖子、手脚、假人头或人台。'
                    '制服同服只有一套完整前后结构，混合服按costumeGroupId去重，各不相同则共五套3+2按成员顺序。'
                    '保留原衣服颜色裁剪层叠、袖口护腕手套、腰带穿戴饰品和鞋，每套结构与原成员对应；衣服内自然留白，不靠透明人体支撑。'
                    '必须加入3—6处必要局部细节放大，保留扣件、纹样、缝线和鞋袖结构，不能简化纹样或漏饰品。无文字编号水印或场景道具。')
                schema=CLOTHING_CHECK;keys=('sameMembers','pureClothing','matchingCostumePolicy','detailVisible','clean')
                expected=len(groups)
                check_prompt='只读检查纯服提取（第一张）与五人原图（第二张）：各costumeGroup原款式配件颜色鞋袖细节对应；无皮肤人体假人；统一服1套，混合服按组，全部不同5套，setCount只数不同整套服装不数局部细节。必须清楚保留3—6必要扣件纹样鞋袖细节，无字白底。'
            if part=='clothing' and item.get('clothingLayout')=='1x5':
                prompt+='五套不同服装采用左至右五栏1x5，每栏下方局部细节；此布局覆盖上面的3+2默认，按成员1..5严格对应。'
            prompt+=worker.prompt_data({'members':item['members'],'memberIndex':item['memberIndex'],'costumePolicy':item['costumePolicy'],'expectedCostumeSets':len(groups)})
            try:
                with worker.AppServer(stage) as client:
                    worker._ensure_ready(client)
                    if _sha(worker,full)!=source_hash:raise ValueError('固定五人来源变了，不能混用旧演员')
                    native=worker._turn(client,stage,prompt,worker.references(full),update=update,image=True)
                    for attempt in range(2):
                        good,review=_qc(worker,client,stage,check_prompt+worker.prompt_data({'members':item['members'],'costumePolicy':item['costumePolicy']}),
                            [native,*worker.references(full)],schema,keys,update,expected)
                        if good:break
                        if attempt:raise ValueError('提取未通过：'+review.get('issues',''))
                        native=worker._turn(client,stage,prompt+'只修复上一图：'+review.get('issues',''),[native,*worker.references(full)],update=update,image=True)
                    if _sha(worker,full)!=source_hash:raise ValueError('固定五人来源变了，未登记混合旧演员的新图')
                    url=worker._save_generated(native,stage,'heads' if part=='heads' else 'clothing',True)
                digest=_sha(worker,url)
                with lock:
                    item[PART_FIELDS[part]]=url;item['sourceHashes'][part]=digest
                    item['parts'][part]={'status':'completed','image':url,'sha256':digest,'sourceHash':source_hash,'review':{'status':'checked',**review}}
                    checkpoint('同批'+('五头' if part=='heads' else '服装')+'已保存，其它缺项可单独补')
            except worker.Cancelled:raise
            except Exception as error:
                with lock:
                    item['parts'][part]={'status':'failed','sourceHash':source_hash,'error':str(error)[:1000]};checkpoint('这一项提取未通过，其它成功图片保留')
        if wanted:
            with ThreadPoolExecutor(max_workers=min(2,len(wanted))) as pool:
                for future in as_completed([pool.submit(extract,part) for part in wanted]):future.result()
    ready=_status(worker,item)
    checkpoint('群像三图已齐，原著人数与衣着事实仍独立待核' if ready else '群像成功项已保留，下次只补缺失图片')
    failures=[{'part':p,'error':item.get('parts',{}).get(p,{}).get('error','未完成')} for p in requested_parts if not _ready(worker,item,p)]
    return {'project':project,'library':library,'crowdSet':copy.deepcopy(item),'needsRetry':bool(failures),'partialFailures':failures,'incompleteParts':[p for p in IMAGE_PARTS if not _ready(worker,item,p)],
        'message':'五人选角池全身/整头/服装已关联入群像库' if ready else '群像部分已保存，仅需重试缺项'}