"""Project-independent, deterministic narrative combinations.

Inputs are source facts, never producer layout answers. Lexical evidence is
reported as such; an unclassified passage stays conservative, not 'understood'.
Project dimensions, reference IDs and permitted styles remain in the adapter.
"""
import copy
import re
from layout_engine.rhythm import scene_change
from native_sequence_layout import positive

VERSION = 'source-combinations-v1'
SIGNALS = {
    'entrance': r'走入|走进|进入|入场|到场|推门而入|现身|加入|赶到|来到|迈入|离场|离开|退出|退下',
    'action': r'挥刀|挥剑|出拳|击中|击向|刺向|刺中|斩向|砍向|踢向|踢中|撞向|撞上|抓住|扣住|掐住|跃起|扑向|挡住|接住|截住|震开|推开|拔出|拔剑|拔刀|冲向|甩出|掷出',
    'result': r'倒地|倒下|摔落|坠落|碎裂|断裂|被击退|被震退|失去平衡|动作停住|收回.{0,4}(?:手|脚|刀|剑)',
    'reaction': r'惊讶|惊愕|震惊|愣住|一愣|怔住|难以置信|脸色.{0,6}(?:变|沉)|皱眉|瞪大|低下头|后仰|颤抖|落泪|笑意褪去',
    'reveal': r'认出|看清.{0,10}(?:字|脸|面容|身份|名字|内容)|揭开.{0,10}(?:秘密|真相|面纱)|揭示|暴露.{0,8}身份|露出.{0,8}(?:真容|面容)|证实|确认.{0,8}(?:身份|真相)|发现.{0,10}(?:线索|证据|秘密)',
    'decision': r'决定|下令|命令|吩咐|作出选择|定下|宣布|答应.{0,8}(?:请求|条件)|拒绝.{0,8}(?:请求|条件)',
    'pivot': r'转移话题|话锋一转|换个话题|另一件事|另一个问题|说起另一|转而谈|转入.{0,8}(?:话题|问题)|接下来.{0,8}(?:说|谈|解释)',
    'pause': r'沉默|停顿|良久|片刻无言|欲言又止|陷入思考|静默|久久未语',
    'emotion': r'情绪失控|泪流|痛哭|突然大笑|放声大笑|怒不可遏|笑意褪去|神情骤变|猛地起身|豁然起身',
}
LABELS = {
    'scene_establishment': '首次场景建立',
    'scene_reestablishment': '转场后重新建立',
    'relationship_change': '人物入场与关系变化',
    'action_result': '动作与结果承接',
    'information_development': '信息展开与问答',
    'information_reveal': '关键识别与信息揭示',
    'whole_to_detail': '整体收向细节',
    'emotional_turn': '情绪转折',
    'decision': '决定与行动方向',
    'continuation': '保守连续承接',
}


def evidence(f):
    text = positive(f['description'])
    hits={}
    for key,pattern in SIGNALS.items():
        for match in re.finditer(pattern,text):
            prefix=re.split(r'[，。；;]',text[:match.start()])[-1]
            if re.search(r'(?:尚未|并未|没有|未曾|不曾|不会|不能|并非|未|没|不).{0,3}$',prefix):continue
            hits[key]=match.group(0);break
    return hits


def prepare(shots, fs, paragraph_policy=None):
    """No novel-specific phrase lists participate in the new decision path."""
    for s, f in zip(shots, fs):
        hits = evidence(f)
        if paragraph_policy:
            from native_paragraph_focus import source_events
            f['_paragraphEvents']=source_events(f,paragraph_policy)
            for event in f['_paragraphEvents']:
                if event['function'] in ('action','response'):hits.setdefault('action',event['quote'])
                if event['function']=='result':hits.setdefault('result',event['quote'])
        f['_combinationSignals'] = hits
        f['action'] = 'action' in hits
        f['reveal'] = 'reveal' in hits
        f['reaction'] = 'reaction' in hits
        f['topic'] = ''


def build(shots, fs, confirmed_boundaries=()):
    groups = []
    visited = set()
    location_members={}
    scene_seen = set()
    group = None
    scene_id = 0
    previous = None
    for i, (s, f) in enumerate(zip(shots, fs)):
        changed = bool(i and scene_change(shots[i-1], s))
        start_scene = i == 0 or changed
        location = str(s.get('location') or '')
        hits = f['_combinationSignals']
        visible = set(f['visibleCharacters'])
        new_people = visible - scene_seen
        kind = None
        boundary = None
        source = []
        if start_scene:
            scene_id += 1
            kind = 'scene_reestablishment' if location in visited else 'scene_establishment'
            visited.add(location)
            scene_seen = set()
            boundary = 'scene_transition' if i else 'opening'
            source = ['location', 'time', 'shotSize', 'visibleCharacters']
        elif i in confirmed_boundaries:
            kind = 'information_development'; boundary = 'information_boundary'
            source = ['confirmed-dialogue-plan']
        elif 'entrance' in hits and (new_people or len(visible) > 1):
            kind = 'relationship_change'; source = ['description', 'visibleCharacters']
        elif 'reveal' in hits:
            kind = 'information_reveal'; source = ['description']
            if not previous['question']:
                boundary = 'information_reveal'
        elif 'decision' in hits and not previous['question']:
            kind = 'decision'; source = ['description']
        elif 'emotion' in hits:
            kind = 'emotional_turn'; source = ['description']
        elif 'action' in hits and not previous['action'] and not (group and group['kind']=='action_result' and 'result' in previous['_combinationSignals']):
            kind = 'action_result'; source = ['description']
        elif 'pivot' in hits and not previous['question']:
            kind = 'information_development'; boundary = 'information_boundary'
            source = ['description']
        # An isolated detail needs a parent, not an invented new narrative focus.
        if group is None or kind and (kind != group['kind'] or boundary or kind == 'relationship_change'):
            group = {'id': 'combination-'+str(len(groups)+1), 'kind': kind or 'continuation',
                     'label': LABELS[kind or 'continuation'], 'sceneId': scene_id,
                     'startIndex': i, 'endIndex': i, 'members': [], 'boundary': boundary,
                     'basisFields': source, 'signalQuotes': dict(hits),
                     'confidence': 'source-fields' if start_scene else 'explicit-text-cue' if hits else 'unresolved',
                     'uncertainty': '文字信号不等于完整剧情理解；保留原镜头，不新增场景或画格。'}
            groups.append(group)
            if start_scene:
                group['priorSceneMembers']=sorted(location_members.get(location,set()))
                group['returningRelationshipChanged']=bool(visible-location_members.get(location,visible))
        group['endIndex'] = i
        role = ('environment' if f['base']=='spatial' else 'detail' if f['base']=='detail'
                else 'reaction' if f['reaction'] else 'action' if f['action']
                else 'dialogue' if f['speech'] else 'continuation')
        group['members'].append({'key': s['key'], 'index': i, 'phase': role,
                                 'sourceDescription': f['description']})
        f['_combination'] = {'id': group['id'], 'kind': group['kind'], 'phase': role,
                             'memberIndex': len(group['members'])-1,
                             'boundary': boundary, 'sceneId': scene_id}
        scene_seen.update(visible)
        location_members[location]=set(scene_seen)
        previous = f
    links=[]
    for i in range(1,len(shots)):
        if scene_change(shots[i-1],shots[i]):continue
        a,f=fs[i-1],fs[i]
        relation=('whole_to_detail' if f['base']=='detail' and a['base']!='detail'
                  else 'direct_answer' if a['question'] and f['speech']
                  else 'action_to_result' if a['action'] and 'result' in f['_combinationSignals']
                  else 'immediate_reaction' if f['reaction']
                  else 'dialogue_turn' if a['speech'] and f['speech']
                  else 'scene_development')
        links.append({'fromKey':shots[i-1]['key'],'toKey':shots[i]['key'],'relation':relation,
                      'sourceDescriptions':[a['description'],f['description']]})
    return {'version': VERSION, 'groups': groups, 'links':links, 'builtBeforeGeometry': True,
            'modelCalls': 0, 'fixedGroupSize': None, 'projectSpecificPhrasesUsed': False}


def choose_mains(shots, fs, plan, book):
    """Select combination anchors, not dialogue turns or every lexical hit."""
    candidates = {0: (1000, 'M02', 'opening_focus', '原首格满幅；保持原取景，不补造建立镜头')}
    roles = {'scene_establishment': ('M01','scene_anchor',90),
             'scene_reestablishment': ('M01','scene_anchor',86),
             'relationship_change': ('M02','scene_anchor',88),
             'action_result': ('M03','key_action',94),
             'information_reveal': ('M03','plot_reveal',96),
             'decision': ('M02','plot_reveal',89),
             'emotional_turn': ('M03','emotional_peak',92),
             'information_development': ('M02','plot_reveal',74)}
    for group in plan['groups']:
        kind = group['kind']
        if kind not in roles: continue
        members = group['members']
        # Existing source shots collectively establish a scene. A leading detail
        # remains a detail; choose the first actual spatial/relationship frame.
        if kind.startswith('scene_'):
            eligible = [m['index'] for m in members if fs[m['index']]['base']!='detail' and (
                fs[m['index']]['base']=='spatial' or len(fs[m['index']]['visibleCharacters'])>1)]
            if not eligible:
                group['anchorStatus']='no-source-establishing-frame'; continue
            if kind=='scene_reestablishment' and not group.get('returningRelationshipChanged') and not any(fs[j]['base']=='spatial' for j in eligible):
                group['anchorStatus']='same-relationship-return-no-new-main';continue
            index = eligible[0]
        else:
            index = group['startIndex']
        style, role, score = roles[kind]
        if kind.startswith('scene_') and fs[index]['base']=='spatial':score+=10
        # A pivot cue creates an information group but not automatically a main.
        if kind=='information_development' and group['boundary']!='information_boundary':continue
        if book['runtime'].get('paragraphFocus'):
            from native_paragraph_focus import core_candidates
            cores=core_candidates(group,shots,fs,book,index);group['paragraphCoreCandidates']=cores
            for core in cores:
                j=core['index']
                if j:candidates[j]=(score+core['priority'],style,role,group['label']+'；段落核心依据原文“'+core['quote']+'”；'+core['basis'])
        elif index:
            candidates[index] = (score,style,role,group['label']+'由本组现有画格承载；依据原字段及明确文字信号，不按副格数量升主')
        group['candidateAnchorKey']=shots[index]['key']
    # Maximum-weight independent set honours the adjacency constraint globally.
    states = {False:(0, {})}
    for i in range(len(shots)):
        nxt = {}
        for occupied,(score,chosen) in states.items():
            if i:
                proposal=(score,chosen)
                if False not in nxt or proposal[0]>nxt[False][0]:nxt[False]=proposal
            if i in candidates and not occupied:
                proposal=(score+candidates[i][0],{**chosen,i:candidates[i]})
                if True not in nxt or proposal[0]>nxt[True][0]:nxt[True]=proposal
        states=nxt
    selected=max(states.values(),key=lambda item:item[0])[1]
    from native_reading_rhythm import main_shape
    for i,value in list(selected.items()):
        geometry=main_shape(fs[i],book)
        fs[i]['_mainGeometry']=geometry
        selected[i]=(value[0],geometry['styleId'],value[2],value[3])
    arcs=[]
    for group in plan['groups']:
        group['selectedMainKeys']=[shots[i]['key'] for i in selected if group['startIndex']<=i<=group['endIndex']]
        group['anchorStatus']='selected' if group['selectedMainKeys'] else group.get('anchorStatus','subordinate-under-existing-main')
        arcs.append({'startKey':group['members'][0]['key'],'endKey':group['members'][-1]['key'],
                     'returningLocation':group['kind']=='scene_reestablishment',
                     'relativeFocusCandidates':group['selectedMainKeys'],'subordinateCandidates':[]})
    for f in fs:f['_readingArcs']={i:a for i,a in enumerate(arcs)}
    if book['runtime'].get('paragraphFocus'):
        from native_paragraph_focus import bind
        bind(plan,shots,fs,selected,book['runtime']['paragraphFocus'])
    return selected


def apply_combinations(shots,fs,mains,choices,graph,plan):
    """Non-dialogue phases join the same plan as dialogue, before dimensions."""
    turns={t['key']:t for g in graph['localRelationships']['groups'] for t in g['turns']}
    nodes={n['key']:n for n in graph['nodes']}
    for i,(s,f) in enumerate(zip(shots,fs)):
        node=nodes[s['key']];node['combinationId']=f['_combination']['id']
        node['combinationSceneId']=f['_combination']['sceneId']
        if i in mains:continue
        c=choices[i];c['combination']=copy.deepcopy(f['_combination'])
        if f.get('_paragraphFocus'):
            node['paragraphFocus']=copy.deepcopy(f['_paragraphFocus']);c['paragraphFocus']=copy.deepcopy(f['_paragraphFocus'])
            c['reason']+=' 本格作为段落核心 '+f['_paragraphFocus']['coreKey']+' 的'+f['_paragraphFocus']['relationToCore']+'承接。'
        # Side remains the validated N-person relation's decision; composition
        # anchors and same-person continuation are never overridden for variety.
        c['reason']+=' 本格属于“'+LABELS[f['_combination']['kind']]+'”，尺寸与间距按组内阶段共同求解。'
    return choices


def shape_preference(f, shape, cfg):
    c=f['_combination'];phase=c['phase'];kind=c['kind']
    rules=cfg['phaseGeometry']
    target=rules.get(phase,rules['continuation'])
    # Source-safe minimums always outrank group preferences.
    shape['width']=max(shape['width'],round(cfg['canvasWidth']*target['preferredWidth']))
    shape['edgeInset']=0 if shape['alignment']!='center' and phase=='environment' else shape['edgeInset']
    shape['combination']={**c,'preferredWidth':target['preferredWidth'],
                          'preferredRatio':target['preferredRatio']}
    if f.get('_paragraphFocus'):shape['paragraphFocus']=copy.deepcopy(f['_paragraphFocus'])
    shape['reason']+=' 组合阶段“'+phase+'”参与宽度候选选择；不新增画面、不改变景别。'
    return shape


def candidate_cost(f,p,base,cfg):
    target=base['combination'];w=p['w']/cfg['canvasWidth'];r=p['h']/p['w']
    return (abs(w-target['preferredWidth'])*cfg['widthWeight']+
            abs(r-target['preferredRatio'])*cfg['ratioWeight'])


def spacing(i, shots, fs, plan, cfg):
    f=fs[i];a=fs[i-1];c=f['_combination']
    if scene_change(shots[i-1],shots[i]):kind='scene_transition'
    elif c['boundary'] in ('information_boundary','information_reveal'):kind=c['boundary']
    elif 'pause' in f['_combinationSignals'] and not a['question'] and not f['action']:kind='beat_pause'
    else:kind='continuation'
    if kind!='continuation':
        lo,hi=cfg['gapRanges'][kind]
        # Pause candidates only every >=5 source frames within a scene; no
        # paragraph quota and no gap caused merely by a main panel.
        if kind=='beat_pause':
            last=max((j for j in range(i) if fs[j].get('_resolvedGapKind') in ('beat_pause','scene_transition')),default=0)
            if i-last<5:kind='continuation'
        if kind!='continuation':gap=round((lo+hi)/2)
    if kind=='continuation':
        phase=c['phase']
        if a['question'] and f['speech']:gap=cfg['continuation']['directAnswer']
        elif phase in ('action','reaction') or a['action']:gap=cfg['continuation']['actionReaction']
        elif phase=='detail':gap=cfg['continuation']['detail']
        elif c['kind'].startswith('scene_') and phase in ('environment','continuation'):gap=cfg['continuation']['establishing']
        elif a['speech'] and f['speech']:gap=cfg['continuation']['dialogue']
        else:gap=cfg['continuation']['ordinary']
    f['_resolvedGapKind']=kind
    return kind,gap


def validate(packet,script):
    plan=packet.get('nativeCombinationPlan')
    if not plan or plan.get('version')!=VERSION or not plan.get('builtBeforeGeometry'):raise ValueError('本地组合规划缺失')
    members=[m for g in plan['groups'] for m in g['members']]
    if [m['key'] for m in members]!=[s['key'] for s in script['shots']]:raise ValueError('组合未按原阅读顺序完整覆盖')
    for m,s in zip(members,script['shots']):
        if m['sourceDescription']!=s.get('description',''):raise ValueError('组合原文依据已改变')
    lookup={p['key']:p for p in packet['panels']}
    for g in plan['groups']:
        if any(k not in lookup or lookup[k]['role']!='main' for k in g['selectedMainKeys']):raise ValueError('组合主格未实际落位')
    return True
