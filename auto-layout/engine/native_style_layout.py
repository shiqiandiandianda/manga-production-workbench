"""Dazhou native style selection and geometry. No model dependency or fallback.

Only registered local styles are executable. Original sources and every style
choice remain traceable. Missing overlap necessity/protection never forces one.
"""
from artwork_framing import frame_artwork
import copy, json, math, re
from pathlib import Path
from layout_engine.core import digest, validate_geometry
from layout_engine.model_pipeline import packet_from_response
from layout_engine.final_contract import bind_learned_packet, learned_metadata_errors, final_packet_errors, raise_issues
from layout_engine.palette import validate_palette_evidence, apply_palette_response
from layout_engine.rhythm import scene_change, intersection

ENGINE='dazhou-native-style-v1'
MODE='native-style-rules'
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))

def style_book(path):
    book=read(path)
    if book.get('projectId')!='dazhou' or book.get('runtime',{}).get('engine')!=ENGINE:
        raise ValueError('大周专用固有规则执行版本无效')
    ids=[s['id'] for name in ('mainStyles','supportStyles','overlapStyles') for s in book[name]]
    if len(ids)!=len(set(ids)) or 'S06' in ids or not book['baseRules'].get('forbidNonOverlappingStaircase'):
        raise ValueError('款式编号重复或仍包含用户禁用的阶梯小格')
    if {s['id'] for s in book['mainStyles']}!={'M01','M02','M03'} or {s['id'] for s in book['supportStyles']}!={'S01','S02','S03','S04','S05'} or {s['id'] for s in book['overlapStyles']}!={f'O{i:02d}' for i in range(1,8)}:
        raise ValueError('大周主格、副格或叠图款式缺失')
    if book['runtime'].get('supportGeometry'):
        count=19 if book['runtime'].get('paragraphFocus') else 18 if book['runtime'].get('combinationPlanner') else 17 if book['runtime'].get('relationGraph',{}).get('localRelationshipBinding') else 16 if book['runtime'].get('readingPlanner') else 15 if book['runtime'].get('relationGraph') else 14 if book['runtime'].get('narrativeGrouping') else 13 if book['runtime'].get('sequencePlanning') else 12 if book['runtime'].get('sourceAnchorPolicy')=='verbatim-original-field-v1' else 11
        if {r['id'] for r in book.get('integratedRequirements',{}).get('items',[])}!={f'IR{i:02d}' for i in range(1,count+1)}:
            raise ValueError('整合规则的执行要求登记不完整')
        selector=book['runtime']['supportGeometry']['version']
        if any(s.get('executionGeometry',{}).get('selector')!=selector for s in book['supportStyles']):
            raise ValueError('副格款式仅登记名称，尚无实际几何执行器')
        if book['runtime'].get('narrativeGrouping'):
            coverage=book.get('learnedRuleCoverage',{});items=coverage.get('items',[])
            if coverage.get('sourceSha256')!=book['sources']['hashes']['learned-style.json'] or coverage.get('count')!=19 or len(items)!=19 or len({x['sourceName'] for x in items})!=19:
                raise ValueError('原学习规则到固有规则的逐条执行映射缺失或来源不符')
            if any(not x.get('transferRule') or not x.get('execution') or x.get('status') not in ('active','evidence-gated','disabled-by-explicit-user') for x in items):
                raise ValueError('原学习规则缺少明确执行方式')
    return book

def facts(shot, config):
    raw=shot.get('sourceFields') or {}
    normalized=None
    if config.get('sourceNormalization'):
        from layout_source_facts import normalize
        normalized=normalize(shot,config['sourceNormalization'])
        raw={'台词':[{'说话人':t['speaker'],'类型':'画外' if t['offscreen'] else '对白' if t['channel']=='spoken' else '心声' if t['channel']=='thought' else '旁白' if t['channel']=='narration' else '未署名台词','文本':t['text']} for t in normalized['utterances']],'独立构图':normalized['composition']}
    texts=raw.get('台词',[])
    if not isinstance(texts,list):texts=[]
    spoken_types=config.get('sourceNormalization',{}).get('spokenTypes',('对白','心声','内心独白'))
    thought_types=config.get('sourceNormalization',{}).get('thoughtTypes',[])
    speakers=list(dict.fromkeys(str(t.get('说话人','')).strip() for t in texts if isinstance(t,dict) and t.get('类型') in spoken_types and t.get('说话人')))
    speaker=speakers[0] if len(speakers)==1 else str(shot.get('speaker',''))
    dialogue=''.join(str(t.get('文本','')) for t in texts if isinstance(t,dict) and t.get('类型') in tuple(spoken_types)+tuple(thought_types)+(('未署名台词',) if normalized else ()))
    if not texts and shot.get('speaker'):dialogue=str(shot.get('dialogue',''))
    desc=str(shot.get('description',''));composition=str(raw.get('独立构图',''));camera=str(shot.get('cameraAngle',''));size=str(shot.get('shotSize',''))
    composition_field='独立构图'
    if config.get('sourceNormalization'):
        composition_field=normalized['fieldProvenance']['composition'];composition=normalized['composition']
        desc=normalized['description'];camera=normalized['cameraAngle'];size=normalized['shotSize']
    signal_text=desc+' '+composition
    if config.get('sequencePlanning'):
        from native_sequence_layout import positive
        signal_text=positive(signal_text)
    def has(name):return bool(re.search(config['signals'][name],signal_text))
    action=has('keyAction');reveal=has('keyReveal');reaction=has('reaction');effect=has('environmentEffect')
    actor=next((str(c).split('(')[0].split('（')[0] for c in (normalized['characters'] if normalized else shot.get('characters',[])) if desc.startswith(str(c).split('(')[0].split('（')[0])),None)
    if '特写' in size:base='detail'
    elif effect:base='effect'
    elif '全景' in size or '远景' in size:base='spatial'
    elif dialogue and ('中景' in size or '双人' in camera and not (config.get('supportSelection',{}).get('version') in ('multi-party-v3','multi-party-v4') and '近景' in size)):base='address'
    else:base='expression'
    topic=''
    for name,pattern in config['topicSignals']:
        if re.search(pattern,dialogue+' '+desc):topic=name;break
    # A name announcement is source speech, not the presence of a cast name.
    if speaker and dialogue.strip('！!。 .')==speaker:topic='name_announcement'
    result={'key':shot['key'],'speaker':speaker,'speakers':speakers,'speech':dialogue,'actor':actor,'description':desc,'composition':composition,'camera':camera,'size':size,'base':base,
        'action':action,'reveal':reveal,'reaction':reaction,'effect':effect,'topic':topic,'shoulder':bool(re.search('过肩|肩后',camera+' '+composition)),
        'rightAnchor':bool(re.search('人物(?:位于|在)右|主体(?:位于|在)右|右侧人物',composition)),
        'question':bool(re.search('[？?]',dialogue)),'load':len(desc)+len(composition)+len(dialogue)*2}
    if config.get('sourceNormalization'):
        result.update(compositionField=composition_field,thoughtSpeakers=list(dict.fromkeys(t.get('说话人') for t in texts if isinstance(t,dict) and t.get('类型') in thought_types and t.get('说话人'))),offscreenSpeakers=list(dict.fromkeys(t.get('说话人') for t in texts if isinstance(t,dict) and t.get('类型') in config['sourceNormalization']['offscreenTypes'] and t.get('说话人'))),visibleCharacters=[str(x) for x in normalized['characters']],sourceFactsFormat=normalized['format'],producerLayoutAnswersUsed=False)
    return result

def paragraph_groups(shots, fs, source_anchor_policy=None):
    groups=[];start=None;last_topic='';boundaries=set()
    for i,f in enumerate(fs):
        speaking=bool(f['speech'])
        transition=i and scene_change(shots[i-1],shots[i])
        if start is not None and (not speaking or transition):
            groups.append((start,i-1));start=None;last_topic=''
        if not speaking:continue
        topic=f['topic']
        # Specific topic changes require source evidence; direct Q/A stays close.
        changed=start is not None and topic and last_topic and topic!=last_topic and not fs[i-1]['question']
        if changed:
            groups.append((start,i-1));boundaries.add(i);start=i
        elif start is None:start=i
        if topic:last_topic=topic
    if start is not None:groups.append((start,len(shots)-1))
    result=[]
    for a,b in groups:
        source=fs[a]['speech'] or fs[a]['description']
        if source_anchor_policy=='verbatim-original-field-v1':
            # Facts may concatenate speakers for recognition. Evidence must be
            # copied from an actual original field, including its separators.
            source=str(shots[a].get('dialogue') or shots[a].get('description') or '')
        topic=source[:30]
        if len(topic)<4:topic=fs[a]['description'][:30]
        result.append({'startShotCode':shots[a]['key'],'endShotCode':shots[b]['key'],'topic':topic,
            'informationRole':'根据原台词与叙事作用分出的局部信息组',
            'sourceAnchors':[{'shotCode':shots[a]['key'],'quote':source[:32]}],
            'reason':'原文“'+source[:30]+'”开启本组信息，问答保持相邻，不按换人或镜号机械分段。'})
    return result,boundaries

def select_mains(shots,fs,book):
    scores={0:(1000,'M02','opening_focus','首格聚焦原镜头，满幅承载开场信息')}
    cfg=book['runtime']
    for i,f in enumerate(fs[1:],1):
        transition=scene_change(shots[i-1],shots[i]);why='';score=0;style='M02';role='scene_anchor'
        if f['action']:score=cfg['mainScores']['action'];style='M03';role='key_action';why='原镜头存在关键动作、冲击或明确动作接触'
        if f['reveal']:score=max(score,cfg['mainScores']['reveal']);style='M03';role='plot_reveal';why='原镜头明确聚焦关键揭示或决定性的接触'
        if transition and f['base']=='spatial' and score<cfg['mainScores']['spatial']:
            score=cfg['mainScores']['spatial'];style='M01';why='真实场景/时段变化且本镜头承担空间建立'
        if re.search(cfg['signals']['characterEntrance'],f['description']) and score<cfg['mainScores']['entrance']:
            score=cfg['mainScores']['entrance'];style='M02';why='原镜头明确承担人物正式出场及其关系建立'
        if score:scores[i]=(score,style,role,why)
    if cfg.get('narrativeGrouping'):
        from native_narrative_groups import expand_candidates
        scores=expand_candidates(shots,fs,book,scores)
    if cfg.get('readingPlanner'):
        from native_reading_rhythm import select_mains as select_reading_mains,main_shape
        selected=select_reading_mains(shots,fs,scores,book)
        for i,v in list(selected.items()):
            g=main_shape(fs[i],book);fs[i]['_mainGeometry']=g
            selected[i]=(v[0],g['styleId'],v[2],v[3]+'；'+g['reason'])
        return selected
    selected={0:scores[0]}
    # Competing adjacent candidates are ranked by narrative purpose, not parity.
    for i,value in sorted(scores.items(),key=lambda item:(-item[1][0],item[0])):
        if i and not any(abs(i-j)<=1 for j in selected):selected[i]=value
    return selected

def select_support_groups(shots,fs,mains,boundaries,book):
    if book['runtime'].get('supportSelection',{}).get('version') in ('multi-party-v3','multi-party-v4'):
        return select_multi_party_groups(shots,fs,mains,boundaries,book)
    choices={};available={s['id']:s for s in book['supportStyles']};i=0
    while i<len(shots):
        if i in mains or not fs[i]['speaker']:i+=1;continue
        end=i
        while end+1<len(shots) and end+1 not in mains and end+1 not in boundaries and not scene_change(shots[end],shots[end+1]) and fs[end+1]['speaker']:
            end+=1
        j=i
        while j<end:
            if fs[j]['speaker']==fs[j+1]['speaker']:j+=1;continue
            n=3 if j+2<=end and fs[j+2]['speaker']==fs[j]['speaker'] else 2
            members=fs[j:j+n]
            if any(f['shoulder'] for f in members):style='S03'
            elif n==3:style='S02' if members[-1]['reaction'] else 'S04'
            elif members[0]['rightAnchor']:style='S05'
            else:style='S01'
            assert style in available
            first_right=style=='S05' or members[0]['rightAnchor']
            sides={members[0]['speaker']:'right' if first_right else 'left',members[1]['speaker']:'left' if first_right else 'right'}
            for k,f in enumerate(members,j):
                if style in ('S03','S05'):inset=.18
                elif style=='S04':inset=0 if k==j else .2
                else:inset=0
                choices[k]={'styleId':style,'groupStart':shots[j]['key'],'side':sides[f['speaker']],'inset':inset,
                    'reason':'原台词明确说话人为'+f['speaker']+'，按'+available[style]['name']+'组织本组位置，不按人物名单或奇偶轮换。',
                    'evidence':available[style]['referenceEvidenceId']}
            j+=n
        i=end+1
    return choices

def select_multi_party_groups(shots,fs,mains,boundaries,book):
    """Group whole panels by explicit dialogue participants, never invent a speaker.

    A two-speaker panel remains one panel. Returning participants and reactions
    determine local groups; no episode-wide left/right alternation is used.
    """
    styles={s['id']:s for s in book['supportStyles']};choices={};i=0
    def people(f):return frozenset(f['speakers'] or ([f['speaker']] if f['speaker'] else []))
    while i<len(fs):
        if i in mains or not people(fs[i]):i+=1;continue
        end=i
        while end+1<len(fs) and end+1 not in mains and end+1 not in boundaries and not scene_change(shots[end],shots[end+1]) and people(fs[end+1]):end+=1
        j=i
        while j<end:
            a,b=people(fs[j]),people(fs[j+1])
            same_group_change=book['runtime']['supportSelection']['version']=='multi-party-v4' and len(a)>1 and (
                fs[j]['speakers'][:1]!=fs[j+1]['speakers'][:1] or
                fs[j]['camera'] and fs[j+1]['camera'] and fs[j]['camera']!=fs[j+1]['camera'])
            if a==b and not same_group_change:j+=1;continue
            returning=j+2<=end and bool(a&people(fs[j+2])) and not bool(a&b)
            n=3 if returning else 2;members=fs[j:j+n]
            multi=any(len(people(f))>1 for f in members)
            reaction=members[-1]['reaction'] or bool(re.search('对望|愣|惊愕|迟疑|停住',members[-1]['description']))
            mixed_question=multi
            if book['runtime']['supportSelection']['version']=='multi-party-v4':
                mixed_question=multi and any(f['question'] or re.search('问|答|解释|说明|供述|说起',f['description']) for f in members)
            style='S03' if any(f['shoulder'] for f in members) else 'S02' if n==3 and reaction else 'S04' if mixed_question or n==3 else 'S05' if members[0]['rightAnchor'] else 'S01'
            first_right=style=='S05' or members[0]['rightAnchor'];first_side='right' if first_right else 'left'
            for k,f in enumerate(members,j):
                local=people(f);returns=bool(a&local) and not bool(b&local)
                side=first_side if k==j or returns else ('left' if first_right else 'right')
                inset=.18 if style in ('S03','S05') else .12 if style=='S04' and k!=j else 0
                choices[k]={'styleId':style,'groupStart':shots[j]['key'],'side':side,'inset':inset,
                    'reason':'原台词明确本格说话人为'+('、'.join(f['speakers']) or f['speaker'])+'；同格多人对白保持完整，以整格参与者与对答/反应关系选用'+styles[style]['name']+'，不把多人格当无说话人。',
                    'evidence':styles[style]['referenceEvidenceId']}
                if book['runtime']['supportSelection']['version']=='multi-party-v4':
                    choices[k].update(memberIndex=k-j,returnsToFirst=k!=j and returns)
            j+=n
        i=end+1
    return choices

def quote(shot):
    value=str(shot.get('description') or shot.get('dialogue') or '')
    return value[:40]

def choose_overlap(a,b,fa,fb,book,previous=None,current=None,earlier=None):
    """Every O01–O07 is dispatchable, but none bypasses necessity/protection.

    Pre-production sources may supply explicit layout evidence. Without it we
    record a candidate and retain separated panels, not invent protected space.
    """
    if book['runtime'].get('overlapSelection',{}).get('version')=='automatic-overlap-v2':
        from native_overlap import choose
        return choose(a,b,fa,fb,book,previous,current,earlier or [])
    hints=b.get('nativeLayoutHints') or (b.get('sourceFields') or {}).get('排版依据') or {}
    if not isinstance(hints,dict):return None,None
    proof=hints.get('overlap')
    candidate=None
    if fa['action'] and fb['reaction']:candidate='O05'
    elif re.search('看|望|观察|锁定',fa['description']) and re.search('伸手|出手|抓住',fb['description']):candidate='O03'
    if not proof:return None,{'candidate':candidate,'accepted':False,'reason':'缺少目标格明确叠合必要性及可保护区域，按原规则分离。'} if candidate else None
    if not isinstance(proof,dict):raise ValueError('叠图依据必须是结构化对象')
    style=next((s for s in book['overlapStyles'] if s['id']==proof.get('styleId')),None)
    if not style:raise ValueError('未登记或用户禁用的叠图款式')
    if proof.get('necessityLevel')!='required' or len(proof.get('separationCost',''))<12:
        return None,{'candidate':style['id'],'accepted':False,'reason':'叠合没有通过相对分离/错位的必要性门槛。'}
    required=('upperProtectedContent','lowerProtectedContent','upperSafeCorner','lowerSafeCorner','depthPixels','corner')
    if any(k not in proof for k in required):return None,{'candidate':style['id'],'accepted':False,'reason':'缺少目标明确保护内容或安全角，保留分离。'}
    if proof['corner'] not in ('lower_left','lower_right') or not isinstance(proof['depthPixels'],int) or not 8<=proof['depthPixels']<=240:
        raise ValueError('叠图安全角或局部叠深无效')
    return {'style':style,'proof':copy.deepcopy(proof)},None

def generate(script,profile,evidence,book):
    if script.get('projectId')!='dazhou':raise ValueError('大周固有款式不能套给其他作品')
    shots=script.get('shots',[])
    if not shots or len({s['key'] for s in shots})!=len(shots):raise ValueError('分镜为空或格号重复')
    if book['sources']['referenceEpisodes']!=[21,22,23,24,25]:raise ValueError('参考范围被改变')
    cfg=book['runtime'];fs=[facts(s,cfg) for s in shots]
    combination_plan=None
    if cfg.get('combinationPlanner'):
        from local_combination_rules import prepare
        prepare(shots,fs,cfg.get('paragraphFocus'))
    groups,boundaries=paragraph_groups(shots,fs,cfg.get('sourceAnchorPolicy'))
    if profile.get('dialoguePlan'):
        # Exact approved source plans take priority over rule-based grouping.
        for sequence in profile['dialoguePlan'].get('sequences',[]):
            key_index={s['key']:i for i,s in enumerate(shots)};lo=key_index[sequence['startShotCode']];hi=key_index[sequence['endShotCode']]
            groups=[g for g in groups if key_index[g['endShotCode']]<lo or key_index[g['startShotCode']]>hi]
            for g in sequence['groups']:
                start=key_index[g['startShotCode']];source=quote(shots[start])
                groups.append({**{k:g[k] for k in ('startShotCode','endShotCode','topic')},'informationRole':'沿用本话已确认信息段落',
                    'sourceAnchors':[{'shotCode':shots[start]['key'],'quote':source}],'reason':'沿用与当前脚本指纹匹配的已确认段落，不复制其他话剧情。'})
            boundaries.update(key_index[g['startShotCode']] for g in sequence['groups'][1:])
        groups.sort(key=lambda g:next(i for i,s in enumerate(shots) if s['key']==g['startShotCode']))
    if cfg.get('combinationPlanner'):
        from local_combination_rules import build,choose_mains
        combination_plan=build(shots,fs,boundaries)
        mains=choose_mains(shots,fs,combination_plan,book)
        boundaries.update(i for i,f in enumerate(fs) if f['_combination']['boundary'] in ('information_boundary','information_reveal'))
    else:mains=select_mains(shots,fs,book)
    combos=select_support_groups(shots,fs,mains,boundaries,book)
    relation_graph=None
    if cfg.get('relationGraph'):
        from native_relation_graph import execute_relations
        combos,relation_graph=execute_relations(shots,fs,mains,combos,book,profile)
        if combination_plan:
            from local_combination_rules import apply_combinations
            combos=apply_combinations(shots,fs,mains,combos,relation_graph,combination_plan)
    sequence_shapes=None
    if cfg.get('sequencePlanning'):
        from native_sequence_layout import plan
        sequence_shapes=plan(shots,fs,mains,combos,book)
    keys=[s['key'] for s in shots];panels=[];main_decisions=[];framing=[];connections=[];overlap_decisions=[];trace=[];rejections=[];overlap_evaluations=[];active_main=None;support_geometry=[];last_support=None
    style_lookup={s['id']:s for name in ('mainStyles','supportStyles','overlapStyles') for s in book[name]}
    ref_ids=list(dict.fromkeys(s['referenceId'] for s in profile['samples']))
    relation_evidence=next(r['id'] for r in profile['relationships'] if r['relation']=='separated')
    valid_connection_evidence={r['id'] for r in profile['relationships']}|{r['id'] for r in profile.get('overlapReviewEvidence',[])}
    for i,(s,f) in enumerate(zip(shots,fs)):
        role='main' if i in mains else 'support';base=cfg['supportSizing'][f['base']]
        ratio=base['ratio'];w=base['width']
        # Information load modifies承载面积, not the shot's content or viewpoint.
        if f['base']=='detail' and re.search('贯通|长轴|纵向',f['composition']):ratio=max(ratio,1.5)
        if len(f['speech'])>30:w+=48
        if len(f['composition'])>28:w+=32
        # Source information differences yield continuous sizes, no +32 triple hack.
        w+=min(48,(len(f['description'])//12)*16)
        if cfg.get('supportSelection',{}).get('version')=='multi-party-v3' and f['base']=='expression' and len(f['speakers'])>1:w=max(w,cfg['supportSelection']['multipleFaceMinimumWidth'])
        style_id='B01';evidence_id=relation_evidence;reason='按原'+f['size']+'与“'+f['composition'][:30]+'”确定承载面积，保留原取景及辨认空间。'
        side='left' if f['base']=='detail' else 'right' if f['base'] in ('effect','expression') else 'left';inset=0 if f['base'] in ('detail','effect') else .16
        if role=='main':
            _,style_id,story_role,why=mains[i];w=1280;ratio=cfg['mainRatios'][style_id]
            if re.search('纵深|完整身体|全景',f['composition']+' '+f['size']):ratio=max(ratio,1.5)
            if f.get('_mainGeometry'):ratio=f['_mainGeometry']['ratio']
            main_decisions.append({'key':s['key'],'storyRole':story_role,'widthMode':'full_bleed','reason':why+'；'+f['description'][:38],
                'compositionException':None,'referenceFrameIds':style_lookup[style_id]['references']})
            reason=why+'；'+reason
        elif i in combos:
            c=combos[i];style_id=c['styleId'];evidence_id=c['evidence'];side=c['side'];inset=c['inset'];reason=c['reason']+'；'+reason
            if evidence_id not in valid_connection_evidence:
                pair='>'.join(evidence_id.split('>')[:2])
                evidence_id=pair if pair in valid_connection_evidence else relation_evidence
        shape=None
        if role=='support' and cfg.get('supportGeometry'):
            from native_support_geometry import select as select_shape
            shape=sequence_shapes[i] if sequence_shapes is not None else select_shape(f,combos.get(i),book,last_support,fs[i-1] if i else None)
            w=shape['width'];ratio=shape['ratio'];reason+='；'+shape['reason']
        if role=='support':w=min(w,cfg['maximumSupportWidth'])
        art=frame_artwork(s)
        if art:
            aw,ah=art.get('width'),art.get('height')
            if not all(type(v) in (int,float) and math.isfinite(v) and v>0 for v in (aw,ah)):raise ValueError('已有图片尺寸无效')
            ratio=ah/aw
        if role=='support' and active_main:w=min(w,math.floor(math.sqrt(active_main['w']*active_main['h']*cfg.get('paragraphFocus',{}).get('maximumSupportAreaRatio',.94)/ratio)))
        if w<480:raise ValueError('为保持已有图比例需要过小副格，当前输入无法安全排版')
        h=round(w*ratio)
        if cfg.get('userConstraints',{}).get('maximumHOverW') and not art:h=max(w,min(h,w*16//9))
        x=0 if role=='main' else round((1280-w)*(inset if side=='left' else 1-inset))
        if shape:
            from native_support_geometry import position
            x=position(shape,w)
        if len(panels)>=2 and all((p['w'],p['h'])==(w,h) for p in panels[-2:]):
            raise ValueError('三格同尺寸仍缺少有效款式区分，停止而不加像素绕过检查')
        if cfg.get('supportSelection') and role=='support' and len(panels)>=2 and all(p['role']=='support' for p in panels[-2:]):
            run=panels[-2:]+[{'w':w,'h':h,'x':x}]
            widths=[p['w'] for p in run];ratios=[p['h']/p['w'] for p in run];centers=[p['x']+p['w']/2 for p in run]
            near=cfg['supportSelection'].get('nearRepeat',{'widthTolerance':cfg['supportSelection'].get('nearRepeatWidthTolerance',.08),'aspectTolerance':.04,'centerToleranceOfCanvas':.12})
            if (max(widths)-min(widths))/max(widths)<near['widthTolerance'] and max(ratios)-min(ratios)<near['aspectTolerance'] and max(centers)-min(centers)<1280*near['centerToleranceOfCanvas']:
                raise ValueError('连续副格近似同宽、同形、同列，缺少有效剧情组合；停止而不以微小像素差绕过检查')
        y=0;selected_overlap=None
        if i:
            transition=scene_change(shots[i-1],s)
            if transition:kind='scene_transition';gap=cfg['spacing']['scene']+min(96,len(str(s.get('location','')))*4)
            elif i in boundaries:kind='information_boundary';gap=cfg['spacing']['information']
            else:
                kind='continuation';gap=cfg['spacing']['dialogue'] if f['speech'] and fs[i-1]['speech'] else cfg['spacing']['action'] if f['action'] or fs[i-1]['action'] else cfg['spacing']['detail'] if f['base']=='detail' else cfg['spacing']['continuation']
            if combination_plan:
                from local_combination_rules import spacing
                kind,gap=spacing(i,shots,fs,combination_plan,cfg['combinationPlanner'])
            prev=panels[-1];bottom=max(p['y']+p['h'] for p in panels);y=bottom+gap;relation='separated'
            if kind=='continuation':
                selected_overlap,rejected=choose_overlap(shots[i-1],s,fs[i-1],f,book,prev,{'x':x,'y':y,'w':w,'h':h},panels[:-1])
                if book['runtime'].get('overlapSelection'):
                    overlap_evaluations.append(rejected)
                    if not selected_overlap and any(r['matched'] for r in rejected['recognition']):rejections.append(rejected)
                elif rejected:rejections.append({'from':shots[i-1]['key'],'to':s['key'],**rejected})
            elif book['runtime'].get('overlapSelection'):
                from native_overlap import recognize,VERSION as OVERLAP_VERSION
                overlap_evaluations.append({'version':OVERLAP_VERSION,'from':shots[i-1]['key'],'to':s['key'],'recognition':recognize(fs[i-1],f,book['runtime']['overlapSelection']),
                    'accepted':False,'reason':'真实转场或信息段落边界禁止叠合','blockedBy':kind,'manualHintsUsed':False})
            if selected_overlap:
                d=selected_overlap['proof'];corner=d['corner']
                x=d.get('xOverride',(1280-w) if corner=='lower_right' else 0)
                if corner=='lower_right' and x<=prev['x'] or corner=='lower_left' and x+w>=prev['x']+prev['w']:
                    raise ValueError('叠图款与当前承载宽度的安全角冲突；未偷偷改小画格')
                y=d.get('yOverride',bottom-d['depthPixels']);relation='overlap';o=selected_overlap['style']
                reason+='；叠接'+o['name']
                purpose={'O01':'immediate_reaction','O02':'immediate_reaction','O03':'action_continuation','O04':'scene_to_person','O05':'immediate_reaction','O06':'scene_to_person','O07':'whole_to_detail'}[o['id']]
                overlap_decisions.append({'fromShotCode':shots[i-1]['key'],'toShotCode':s['key'],'purpose':purpose,
                    'storyReason':'原文相邻格对应'+o['name']+'，'+d['separationCost'],'sourceShotSizes':[str(shots[i-1].get('shotSize','')),f['size']],
                    'scaleReason':'双方保持原景别与足够承载面积，保护原文所列的动作、表情与信息。',
                    'upperProtectedContent':d['upperProtectedContent'],'lowerProtectedContent':d['lowerProtectedContent'],'corner':corner,
                    'cornerReason':('按原构图自动规划的包络比较两侧叠角，“'+str(d['upperSafeCorner'])+'”；不统一右下，实际成图待复核。') if d.get('automaticPlanning') else ('目标明确记录安全角“'+str(d['upperSafeCorner'])+'”，依据保护区选本角，不统一右下。'),
                    'depthReason':('自动求解保护内容与边界后选择局部叠深' if d.get('automaticPlanning') else '目标依据明确允许的局部叠深为')+str(d['depthPixels'])+'像素，不照搬参考候选边界。',
                    'ratioReviewReason':'比例仅辅助提示；以目标必要信息和当前保护区为先，不以叠合比例代替保护。',
                    'referenceEvidenceIds':[o['referenceEvidenceId']],'verificationStatus':'pending_artwork','necessityLevel':'required',
                    'separationCost':d['separationCost'],'sourceAnchors':[{'shotCode':shots[i-1]['key'],'quote':quote(shots[i-1])},{'shotCode':s['key'],'quote':quote(s)}]})
            connections.append({'fromShotCode':shots[i-1]['key'],'toShotCode':s['key'],'kind':kind,'relation':relation,
                'reason':('原地点/时段发生变化' if transition else '原台词信息作用改变，按信息段落分开' if i in boundaries else '同场原文连续接续，按内容承载紧密纵读')+'；'+f['description'][:35],
                'evidenceIds':[evidence_id]})
        panel={'key':s['key'],'shotCode':s['key'],'role':role,'x':x,'y':y,'w':w,'h':h,'beat':f['base'],'placementReason':reason,'referenceIds':ref_ids,'shape':'rectangle','border':2,'feather':0}
        panels.append(panel)
        if shape:
            support_geometry.append({'key':s['key'],'styleId':style_id,**shape,'actualGeometry':{k:panel[k] for k in ('x','y','w','h')},'existingArtworkRatioPreserved':bool(art)})
        last_support=shape
        if role=='main':active_main=panel
        framing.append({'key':s['key'],'sourceShotSize':f['size'],'framingNeeds':reason,'aspectReason':'依据本格原构图“'+f['composition'][:35]+'”选择竖幅承载，保留原取景。',
            'scaleReason':'按'+f['base']+'信息承载与原台词量选择面积，副格保持从属而不统一成相同尺寸。'})
        trace.append({'key':s['key'],'role':role,'styleId':style_id,'combination':combos.get(i),'baseClass':f['base'],'speakerSource':f['speaker'] or None,
            'referenceIds':style_lookup[style_id].get('references',[]) if style_id in style_lookup else [],'reason':reason,
            'overlapStyleId':selected_overlap['style']['id'] if selected_overlap else None})
    height=max(p['y']+p['h'] for p in panels);sections=[];a=0
    for i in range(1,len(shots)+1):
        if i==len(shots) or scene_change(shots[i-1],shots[i]):
            sections.append({'name':str(shots[a].get('location') or '连续叙事段落'),'startShotCode':keys[a],'endShotCode':keys[i-1],
                'beat':'保留原地点与时段的连续剧情','backgroundReason':'主色待确认，不按夜景或地名猜底色'});a=i
    backgrounds=[{'x':0,'y':0,'w':1280,'h':height,'color':'#d9d7d1','endColor':None,'mode':'solid','name':'主色待确认','reason':'本话尚未提供匹配主色证据，使用中性暂定底，不把夜景或阴谋套黑底。'}]
    response={'height':height,'panels':panels,'sections':sections,'backgrounds':backgrounds,'mainDecisions':main_decisions,'framingDecisions':framing,'connections':connections,'dialogueGroups':groups,'overlapDecisions':overlap_decisions}
    packet=packet_from_response(response,script,profile,validate=False)
    validate_palette_evidence(packet,script,profile,evidence)
    palette_response={'backgrounds':backgrounds,'paletteDecisions':[{'startKey':g['startShotCode'],'endKey':g['endShotCode'],'status':'pending','referenceFrameIds':[],'reason':'本段主色依据待确认，保留中性暂定底。'} for g in sections]}
    packet=apply_palette_response(packet,script,palette_response,evidence,validate=False)
    packet=bind_learned_packet(packet,script,profile)
    packet['generator'].update(mode=MODE,provider='local-native-styles',engine=ENGINE,coordinates='local-native-style-geometry',modelCalls=0,
        styleBookVersion=book['version'],styleBookDigest=digest(book),stylesSelected=sorted(set(t['styleId'] for t in trace)),backgrounds='local-palette-pending')
    if cfg.get('userConstraints'):packet['nativeUserConstraints']=copy.deepcopy(cfg['userConstraints'])
    if cfg.get('readingPlanner'):
        from native_reading_rhythm import review
        packet['nativeReadingPlan']=review(packet,fs,book)
        packet['generator']['readingPlannerVersion']=cfg['readingPlanner']['version']
    packet['nativeStyleTrace']=trace;packet['nativeStyleRejectedCandidates']=rejections
    if combination_plan:
        packet['nativeCombinationPlan']=combination_plan
        packet['generator']['combinationPlannerVersion']=combination_plan['version']
    if relation_graph is not None:
        from native_relation_graph import validate_relations
        packet['nativeRelationGraph']=relation_graph
        packet['generator']['relationGraphVersion']=cfg['relationGraph']['version']
    if cfg.get('narrativeGrouping'):
        from native_narrative_groups import build_groups
        packet['nativeNarrativeGroups']=build_groups(shots,fs,mains,panels,trace)
        packet['generator']['narrativeGroupingVersion']=cfg['narrativeGrouping']['version']
    if cfg.get('supportGeometry'):
        packet['nativeSupportGeometry']=support_geometry
        packet['generator'].update(supportGeometryVersion=cfg['supportGeometry']['version'],integratedRequirementsVersion=book['integratedRequirements']['version'])
    if book['runtime'].get('overlapSelection'):
        packet['nativeStyleOverlapEvaluations']=overlap_evaluations
        packet['generator']['overlapSelectionVersion']=book['runtime']['overlapSelection']['version']
    if cfg.get('paragraphFocus'):
        from native_paragraph_focus import validate as validate_focus,visual_review
        packet['nativeParagraphFocus']=copy.deepcopy(combination_plan['paragraphFocus'])
        packet['generator']['paragraphFocusVersion']=cfg['paragraphFocus']['version']
        validate_focus(packet,script,cfg['paragraphFocus']);packet['nativeParagraphVisualReview']=visual_review(packet)
    if relation_graph is not None:validate_relations(packet,fs,book)
    validate_geometry(packet,script);raise_issues(learned_metadata_errors(packet,script,profile));raise_issues(final_packet_errors(packet,script,profile))
    validate_native_result(packet,script,profile,book,rebuild=False)
    return packet

def validate_native_result(packet,script,profile,book,rebuild=True,evidence=None):
    from native_user_constraints import trusted_constraints,dimension_errors
    constraints=trusted_constraints(packet)
    if book['runtime'].get('paragraphFocus'):
        from native_paragraph_focus import validate as validate_focus,visual_review
        validate_focus(packet,script,book['runtime']['paragraphFocus'])
        if packet.get('nativeParagraphVisualReview')!=visual_review(packet):raise ValueError('段落视觉检查与实际主副格几何不一致')
    errors=dimension_errors(packet,script,constraints)
    if errors:raise ValueError('；'.join(errors))
    if book['runtime'].get('combinationPlanner'):
        from local_combination_rules import validate as validate_combinations
        validate_combinations(packet,script)
    if book['runtime'].get('relationGraph',{}).get('localRelationshipBinding'):
        from native_multiparty_relationships import validate as validate_local_relationships
        validate_local_relationships(packet,script,book=book)
    if book['runtime'].get('readingPlanner',{}).get('supportHeightPolicy'):
        from native_reading_rhythm import support_profile
        records=packet.get('nativeSupportGeometry',[]);supports=[p for p in packet['panels'] if p['role']=='support']
        if [g.get('key') for g in records]!=[p['key'] for p in supports]:raise ValueError('副格内容比例决策未完整覆盖')
        shots={s['key']:s for s in script['shots']}
        for p,g in zip(supports,records):
            s=shots[p['key']];expected=support_profile(facts(s,book['runtime']),g,book)
            if g.get('heightProfile')!=expected:raise ValueError('副格内容比例决策与本格原文不一致：'+p['key'])
            if not frame_artwork(s):
                lo,hi=expected['range']
                if p['h']<p['w']*lo-.51 or p['h']>p['w']*hi+.51:raise ValueError('副格高度超出本格内容区间：'+p['key']+' '+str((p['w'],p['h'],lo,hi,g.get('ratio'))))
    g=packet.get('generator',{})
    if g.get('mode')!=MODE or g.get('engine')!=ENGINE or g.get('provider')!='local-native-styles' or g.get('styleBookDigest')!=digest(book):raise ValueError('固有款式版本或来源身份不符')
    if g.get('modelCalls')!=0:raise ValueError('固有规则不能混入模型调用')
    traces=packet.get('nativeStyleTrace',[])
    if [t.get('key') for t in traces]!=[s['key'] for s in script['shots']]:raise ValueError('逐格选款来源未完整覆盖')
    allowed={'B01'}|{s['id'] for n in ('mainStyles','supportStyles','overlapStyles') for s in book[n]}
    for t in traces:
        if t['styleId'] not in allowed or t.get('overlapStyleId') and t['overlapStyleId'] not in allowed:raise ValueError('使用禁用或不存在的款式')
    for i,p in enumerate(packet['panels'][1:],1):
        if packet['connections'][i-1]['relation']!='overlap' and p['y']<max(q['y']+q['h'] for q in packet['panels'][:i]):raise ValueError('禁止横向阶梯细格：分离画格必须整体向下接续')
    if rebuild:
        if evidence is None:raise ValueError('重验缺少固定配色依据')
        expected=generate(script,profile,evidence,book)
        if expected!=packet:raise ValueError('结果与固定分镜、款式选择或本地几何不一致')
    return True
