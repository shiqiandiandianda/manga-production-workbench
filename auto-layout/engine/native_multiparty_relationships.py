"""N-person interaction contexts and per-frame placement, before geometry."""
import re
from native_sequence_layout import positive
from layout_engine.rhythm import scene_change

VERSION='multiparty-context-v1'

def assess_run(selected):
    actors={t['actor'] for t in selected if t['actor']};targets={a for t in selected for a in t['targets']}
    if len(actors)==1:return 'same_visible_focus_with_source','逐格原文关注对象相同；画格形态另由近似重复校验控制。'
    if len(targets)==1 and not (actors & targets) and all(t['kind'] in ('shared_dialogue','directed_interaction','continuation','thought_continuation') for t in selected):return 'parallel_address_to_same_target','不同人物共同向同一对象发问/说明，依据本组实际声画关系保持同侧。'
    focus_sets=[frozenset(t['focusActors']) for t in selected]
    if focus_sets and focus_sets[0] and len(set(focus_sets))==1:return 'same_group_focus_with_source','原分镜持续关注同一可见人物组，形态另做重复检查。'
    if all(t['explicitSide']==selected[0]['side'] for t in selected):return 'explicit_source_anchor','各格原构图明确指定同侧。'
    return None

def explicit_side(f,book):
    text=positive(f['composition']);signals=book['runtime']['supportGeometry']['signals']
    if re.search(signals['centerAnchor'],text):return 'center'
    if f['rightAnchor']:return 'right'
    if re.search(signals['leftAnchor'],text):return 'left'
    return None

def context_turn(f,node,previous,cfg):
    visible=list(dict.fromkeys(f['visibleCharacters']));text=positive(f['description'])
    actor=node.get('actor') if node.get('actor') in visible else None
    spoken=[a for a in f['speakers'] if a in visible]
    focus=[actor] if actor else spoken if node.get('focusKind') not in ('scene','reaction_group') else visible
    named=[a for a in visible if a in text];others=[a for a in named if a!=actor]
    kind='continuation';targets=[];anchor=None
    exchange=bool(re.search(cfg['exchangePattern'],text));interruption=bool(re.search(cfg['interruptionPattern'],text))
    if node.get('focusKind')=='detail' and interruption and previous and previous.get('actor') and previous['actor']!=actor and previous['actor'] in visible:
        kind='interruption_detail';targets=[previous['actor']];anchor=previous
    elif node.get('focusKind')=='detail':kind='detail'
    elif node.get('relation') in ('detail_to_person_return','handover_interaction','listener_to_speaker_return'):kind=node['relation']
    elif node.get('focusKind') in ('scene','reaction_group') or not actor and len(focus)>1:kind='group_focus'
    elif interruption and previous and previous.get('actor') and previous['actor']!=actor and previous['actor'] in visible:
        kind='interruption';targets=[previous['actor']];anchor=previous
    elif actor and exchange and len(others)==1:kind='directed_interaction';targets=others
    elif actor and exchange and len(others)>1:kind='group_address';targets=others
    elif actor and len(spoken)>1:kind='shared_dialogue';targets=[a for a in spoken if a!=actor]
    elif previous and actor and previous.get('actor') and actor!=previous['actor'] and (spoken or previous.get('spokenActors') or exchange or node.get('relation')=='visible_subject_response'):
        kind='focus_response';targets=[previous['actor']];anchor=previous
    elif f['thoughtSpeakers']:kind='thought_continuation'
    elif node.get('relation')=='listener_group_reaction':kind='group_focus'
    return {'visibleActors':visible,'focusActors':focus,'spokenActors':spoken,'offscreenSpeakers':list(f['offscreenSpeakers']),
        'actor':actor,'targets':targets,'kind':kind,'interruption':interruption,'anchor':anchor}

def rebind(shots,fs,mains,choices,nodes,book,focus):
    cfg=book['runtime']['relationGraph']['localRelationshipBinding'];groups=[];group=None;previous=None;recent={}
    for i,(s,f,node) in enumerate(zip(shots,fs,nodes)):
        if group is None or i and scene_change(shots[i-1],s):
            group={'id':'interaction-'+str(len(groups)+1),'startKey':s['key'],'endKey':s['key'],'members':[],'turns':[],'edges':[]};groups.append(group);previous=None;recent={}
        group['endKey']=s['key']
        for a in f['visibleCharacters']:
            if a not in group['members']:group['members'].append(a)
        if i in mains:
            actor=focus(f,book['runtime']['relationGraph'])['actor'];actor=actor if actor in f['visibleCharacters'] else None
            turn={'key':s['key'],'actor':actor,'focusActors':[actor] if actor else list(f['visibleCharacters']),'visibleActors':list(f['visibleCharacters']),'spokenActors':[a for a in f['speakers'] if a in f['visibleCharacters']],'offscreenSpeakers':list(f['offscreenSpeakers']),'targets':[],'kind':'main_focus','side':'full','sourceDescription':s['description'],'explicitSide':None,'anchorKey':None,'anchorSide':None,'separationRequired':False}
            group['turns'].append(turn);node['interactionGroupId']=group['id'];previous=None;continue
        t=context_turn(f,node,previous,cfg);actor=t['actor'];explicit=explicit_side(f,book);legacy=node['side'];anchor=t.pop('anchor')
        if anchor is None:
            anchors=[recent[a] for a in t['targets'] if a in recent and recent[a].get('key')!=s['key']]
            anchor=max(anchors,key=lambda a:a['index']) if anchors else None
        changing=bool(actor and anchor and anchor.get('actor')!=actor and t['kind'] in ('directed_interaction','focus_response','interruption','interruption_detail','shared_dialogue'))
        multi_focus=len(t['focusActors'])>1 or t['kind'] in ('group_focus','group_address')
        old=recent.get(actor) if actor else None;candidates=[explicit] if explicit else ['left','right','center'];scores={}
        for side in candidates:
            cost=0 if side==legacy else .4
            if old and side!=old['side']:cost+=.2
            if t['kind'] in ('continuation','thought_continuation') and previous and actor==previous.get('actor') and side!=previous['side']:cost+=3
            if changing:
                if side==anchor['side']:cost+=8
                if side=='center':cost+=1
            if multi_focus:cost+=0 if side=='center' else 1.8
            elif side=='center':cost+=.7
            if t['kind'] in ('interruption','interruption_detail') and len(group['members'])>=3:cost+=0 if side=='center' else 4
            tail=[]
            for prior in reversed(group['turns']):
                if prior['side']!=side:break
                tail.insert(0,prior)
            trial=tail+[{**t,'side':side,'explicitSide':explicit}]
            if len(trial)>=4 and assess_run(trial) is None:cost+=12
            scores[side]=cost
        side=min(candidates,key=lambda x:(scores[x],['left','right','center'].index(x)))
        if t['kind']=='detail':
            if not book['runtime'].get('paragraphFocus'):side=explicit or legacy
            changing=False
        separation=changing and explicit is None and anchor['side'] in ('left','right') and not multi_focus
        turn={**t,'key':s['key'],'index':i,'side':side,'legacySide':legacy,'explicitSide':explicit,'anchorKey':anchor['key'] if anchor else None,'anchorSide':anchor['side'] if anchor else None,'separationRequired':separation,'sourceDescription':s['description'],'scores':scores}
        group['turns'].append(turn)
        if anchor and (t['targets'] or changing):group['edges'].append({'fromKey':anchor['key'],'toKey':s['key'],'focus':list(t['focusActors']),'targets':list(t['targets']),'kind':t['kind']})
        node.update(side=side,interactionGroupId=group['id'],interactionKind=t['kind'],interactionFocus=list(t['focusActors']),interactionTargets=list(t['targets']),interactionAnchorKey=turn['anchorKey'])
        node['reason']='当前多人互动组按本格实际关注对象、回应/插话及动作关系重新选择摆放侧；人物旧位置仅作软参考，同人续说不机械换边。'+(' 原构图明确锚点优先。' if explicit else '')
        choices[i]['side']=side;choices[i]['reason']=node['reason'];choices[i]['interactionGroupId']=group['id'];f['_layoutRelation']=node
        if actor and t['kind']!='detail':recent[actor]=turn
        previous=turn
    return choices,{'version':VERSION,'groups':groups,'maxParticipants':max((len(g['members']) for g in groups),default=0),'participantLimit':None,'historicalSidesAreSoftPreferences':True,'builtBeforeGeometry':True,'sourceContentChanged':False}

def validate(packet,script,fs=None,book=None):
    data=packet['nativeRelationGraph'].get('localRelationships');nodes={n['key']:n for n in packet['nativeRelationGraph']['nodes']};shots={s['key']:s for s in script['shots']}
    if not data or data.get('version')!=VERSION or not data.get('builtBeforeGeometry') or data.get('participantLimit') is not None:raise ValueError('多人局部关系记录缺失或仍有人数限制')
    if fs is None:
        from native_style_layout import facts
        fs=[facts(s,book['runtime']) for s in script['shots']]
    facts_by={f['key']:f for f in fs};shapes={g['key']:g for g in packet['nativeSupportGeometry']};seen=[];turns={}
    for group in data['groups']:
        actual_members=[]
        for turn in group['turns']:
            key=turn['key'];seen.append(key);turns[key]=turn
            if key not in shots or turn['sourceDescription']!=shots[key]['description']:raise ValueError('多人关系原文依据不符')
            f=facts_by[key]
            if turn['visibleActors']!=f['visibleCharacters'] or turn['spokenActors']!=[a for a in f['speakers'] if a in f['visibleCharacters']] or turn['offscreenSpeakers']!=f['offscreenSpeakers']:raise ValueError('多人关系改变了出镜人物或对白通道')
            if any(a not in turn['visibleActors'] for a in turn['focusActors']):raise ValueError('画外声音不能变成出镜焦点')
            for a in turn['visibleActors']:
                if a not in actual_members:actual_members.append(a)
            if turn['kind']=='main_focus':continue
            node=nodes[key]
            if node['side']!=turn['side'] or shapes[key]['alignment']!=turn['side']:raise ValueError('多人互动决策未进入实际位置求解：'+key)
            if turn['explicitSide'] is not None and turn['side']!=turn['explicitSide']:raise ValueError('多人求解覆盖了原构图明确锚点')
            if turn['separationRequired']:
                anchor=turns.get(turn['anchorKey'])
                if not anchor or anchor['side']!=turn['anchorSide'] or turn['side']==anchor['side']:raise ValueError('当前回应/交锋焦点仍错误继承同侧位置：'+key)
        if group['members']!=actual_members or len(set(group['members']))!=len(group['members']):raise ValueError('多人互动组成员遗漏或重复')
    if seen!=[s['key'] for s in script['shots']]:raise ValueError('多人互动关系未逐格覆盖原分镜')
    for run in packet.get('nativeRelationQuality',{}).get('sameSideRuns',[]):
        assessment=assess_run([turns[k] for k in run['keys']])
        if assessment is None:raise ValueError('连续同侧跨关注对象缺少已验证关系，停止输出：'+','.join(run['keys']))
        run['assessment'],run['resolvedBy']=assessment
    return True
