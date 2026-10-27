"""Build source relations BEFORE geometry; thought, detail and off-screen speech
are different channels. Layout is a consumer of the graph, not its explanation.
"""
import re,copy
from layout_engine.rhythm import scene_change
from native_sequence_layout import positive

def expand_source_mains(shots,fs,book,candidates):
    cfg=book['runtime']['relationGraph'];out=dict(candidates);pending=None;last_topic=None
    for i,f in enumerate(fs):
        if i and scene_change(shots[i-1],shots[i]):pending=None;last_topic=None
        topic=next((r for r in cfg['questionTopics'] if re.search(r['pattern'],f['speech'])),None)
        if topic and f['question']:pending=topic
        # A question alone or "这是第二个问题" is not an answer/revelation.
        actual_answer=bool(f['offscreenSpeakers']) and not f['question'] and not re.search(cfg['deferralPattern'],f['speech'])
        if pending and actual_answer and pending['id']!=last_topic:
            if i:out[i]=max(out.get(i,(0,)),(101,'M03','plot_reveal','原文明确从“'+pending['meaning']+'”追问进入画外回答，答案构成本段信息重心；不把回答者画入当前画面。'),key=lambda x:x[0])
            last_topic=pending['id'];pending=None
    return out

def focus(f,cfg):
    # Composition intent can be a generic template. Actual description and
    # source shot size establish what this particular frame focuses on.
    text=positive(f['description']);mental=bool(re.search(cfg['mentalFocusPattern'],text))
    detail=f['base']=='detail' or bool(re.search(cfg['objectFocusPattern'],text)) and not mental
    actor=f['thoughtSpeakers'][0] if len(f['thoughtSpeakers'])==1 else f['actor']
    if not actor:
        # Resolve only unique abbreviations of explicitly present characters;
        # an off-screen voice must never become a visible actor by fallback.
        names=f['visibleCharacters'];matches=[n for n in names if text.startswith(n) or len(n)>2 and text.startswith(n[-2:])]
        actor=matches[0] if len(matches)==1 else f['speaker'] if f['speaker'] in names else names[0] if len(names)==1 else None
    return {'kind':'detail' if detail else 'person' if actor else 'scene','actor':actor,'detail':detail}

def execute_relations(shots,fs,mains,combos,book,profile):
    cfg=book['runtime']['relationGraph'];choices=copy.deepcopy(combos);nodes=[];owner=0;actor_side={};previous=None
    evidence=next(r['id'] for r in profile['relationships'] if r['relation']=='separated')
    for i,(s,f) in enumerate(zip(shots,fs)):
        fc=focus(f,cfg)
        if i in mains:
            owner=i;actor_side={fc['actor']:'left'} if fc['actor'] else {};previous=None
            node={'key':s['key'],'mainKey':s['key'],'relation':'narrative_focus','role':'main','focusKind':fc['kind'],'consumedByGeometry':True}
        else:
            relation='scene_development';side='center';anchor=shots[owner]['key'];reason='在当前主格建立的场面中承接原画面，居中内收；不把未分组格默认为左列。'
            actor=fc['actor'];main_actor=focus(fs[owner],cfg)['actor']
            if i in choices:
                side=choices[i]['side'];relation='offscreen_question_answer' if f['offscreenSpeakers'] else 'spoken_turn'
                reason=choices[i]['reason']
                if actor and not fc['detail']:actor_side[actor]=side
            elif f['offscreenSpeakers']:
                relation='offscreen_answer_continuation' if previous and previous.get('offscreenSpeakers')==f['offscreenSpeakers'] else 'offscreen_answer_reaction'
                side=previous['side'] if relation=='offscreen_answer_continuation' else 'right' if not previous or previous['side']=='left' else 'left'
                reason='原画外答语由当前画中人物的聆听/反应承接，与前格询问焦点对应；没有把画外说话人补画进本格。'
            elif fc['detail']:
                relation='whole_to_detail';actor=actor or (previous or {}).get('actor') or main_actor
                home=actor_side.get(actor,'left');side='right' if home=='left' else 'left'
                reason='原主格/人物关注点转向本格物件或动作细节，安排在关注方对侧承接；保持纵向分离，未新增物件或阶梯小格。'
            elif actor:
                home=actor_side.setdefault(actor,'left' if not actor_side else 'right')
                if previous and previous['focusKind']=='detail' and previous.get('actor')==actor:
                    relation='detail_to_person_return';side=home;anchor=previous['key'];reason='从原物件/动作细节回到同一人物的思考或反应，返回其本局部位置。'
                elif f['thoughtSpeakers']:
                    relation='same_person_thought';side=home;reason='本格是同一人物心声或思考延续，不冒充两人对答；与所属主格及细节关注点保持对应。'
                else:
                    relation='person_continuation';side=home;reason='原人物动作或叙述继续，维持本局部主体位置；并不按镜号轮换。'
            elif previous and previous['focusKind']=='person':
                relation='person_to_scene_result';side='right' if previous['side']=='left' else 'left';anchor=previous['key'];reason='从前格人物转向原文已有的场面/结果，改变关注区域承接，不强行叠合。'
            # Explicit source composition anchors outrank local relationship sides.
            comp=positive(f['composition'])
            if re.search(book['runtime']['supportGeometry']['signals']['centerAnchor'],comp):side='center';reason+=' 原构图明确居中优先。'
            elif f['rightAnchor']:side='right';reason+=' 原构图明确右侧优先。'
            elif re.search(book['runtime']['supportGeometry']['signals']['leftAnchor'],comp):side='left';reason+=' 原构图明确左侧优先。'
            node={'key':s['key'],'mainKey':shots[owner]['key'],'anchorKey':anchor,'relation':relation,'role':'support','focusKind':fc['kind'],'actor':actor,'side':side,'reason':reason,'compositionField':f['compositionField'],'offscreenSpeakers':f['offscreenSpeakers'],'thoughtSpeakers':f['thoughtSpeakers'],'consumedByGeometry':True}
            if i not in choices:choices[i]={'styleId':'B01','side':side,'inset':.05,'evidence':evidence,'reason':reason,'relationshipMode':relation,'groupStart':shots[owner]['key']}
            else:choices[i]['side']=side
            choices[i]['relationGraphKey']=s['key'];choices[i]['relationshipMode']=relation
            f['_layoutRelation']=node
            previous=node
        nodes.append(node)
    return choices,{'version':cfg['version'],'nodes':nodes,'builtBeforeGeometry':True,'fallbackSide':'center','legacyCoordinatesUsed':False,'producerMainLabelsUsed':False,'producerLayoutAnswersUsed':False,'sourceFactsFormat':'comic-layout-source-facts-v1'}

def validate_relations(packet,fs,book):
    graph=packet['nativeRelationGraph'];nodes=graph['nodes']
    if [n['key'] for n in nodes]!=[p['key'] for p in packet['panels']]:raise ValueError('主副格关系图未覆盖全部原格')
    shapes={g['key']:g for g in packet['nativeSupportGeometry']}
    for p,n,f in zip(packet['panels'],nodes,fs):
        if p['role']!='support':continue
        if shapes[p['key']]['alignment']!=n['side']:raise ValueError(p['key']+'关系判定未进入实际位置求解')
        if n['relation']=='whole_to_detail' and not focus(f,book['runtime']['relationGraph'])['detail']:raise ValueError(p['key']+'缺少原细节关注点依据')
        if n['relation']=='offscreen_question_answer' and not f['offscreenSpeakers']:raise ValueError(p['key']+'画外对答依据缺失')
    # Position/relationship coverage is independent of frame width and height.
    runs=[];run=[]
    def record():
        if len(run)<4:return
        same_person=len({n.get('actor') for n in run})==1 and bool(run[0].get('actor')) and all(n['relation'] in ('person_continuation','same_person_thought') for n in run)
        runs.append({'keys':[n['key'] for n in run],'side':run[0]['side'],'relations':[n['relation'] for n in run],'assessment':'same_person_continuation_with_source' if same_person else 'review_content_relationship','sourceDescriptions':[f['description'] for f in fs if f['key'] in {n['key'] for n in run}]})
    for n in nodes:
        if n['role']=='main' or run and n.get('side')!=run[-1].get('side'):record();run=[]
        if n['role']=='support':run.append(n)
    record()
    packet['nativeRelationQuality']={'allSourcesCovered':True,'allSupportPositionsMatchGraph':True,'checkedIndependentOfFrameSizes':True,'unknownLeftFallbacks':sum(n.get('relation')=='scene_development' and n.get('side')=='left' for n in nodes),'sameSideRuns':runs}
