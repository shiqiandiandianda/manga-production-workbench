"""Narrative main/support groups, including dialogue and non-dialogue phases.

Prominence and spacing are independent. No number of support frames promotes
one to main; every candidate carries a contiguous original-source anchor.
"""
import re
from native_sequence_layout import positive
from layout_engine.rhythm import scene_change

VERSION='narrative-main-support-v7'

def expand_candidates(shots,fs,book,original):
    candidates=dict(original);cfg=book['runtime']['narrativeGrouping'];last_phase=None
    for i,f in enumerate(fs):
        transition=i and scene_change(shots[i-1],shots[i])
        if transition:last_phase=None
        # Framing instructions may mention later/forbidden evidence (e.g.
        # "末页无十亿字样"). They cannot manufacture a narrative revelation.
        text=positive(f['description'])+'；'+f['speech']
        matched=[r for r in cfg['phaseRules'] if re.search(r['pattern'],text)]
        if transition:
            # Scene establishment is a story role, not a full-shot-only label.
            score=cfg['sceneScore']+(3 if f['base']=='spatial' else 0)
            matched.append({'id':'scene_establishment','score':score,'style':'M01','storyRole':'scene_anchor','meaning':'原地点或时段变化，需要重新建立本段环境与人物关系'})
        if i==len(fs)-1 and (f['question'] or re.search(cfg['hookPattern'],text)):
            matched.append({'id':'chapter_hook','score':cfg['hookScore'],'style':'M03','storyRole':'chapter_hook','meaning':'末格原文留下明确追问、未决去向或身份线索'})
        if not matched:
            last_phase=None
            continue
        best=max(matched,key=lambda r:r['score'])
        # Same semantic phase continues through explanations/reactions; it does
        # not acquire another main merely because a panel number increased.
        if best['id']==last_phase and not transition:continue
        last_phase=best['id']
        value=(best['score'],best['style'],best['storyRole'],best['meaning']+'；原文“'+f['description'][:46]+'”')
        if i and (i not in candidates or value[0]>candidates[i][0]):candidates[i]=value
    if book['runtime'].get('relationGraph'):
        from native_relation_graph import expand_source_mains
        candidates=expand_source_mains(shots,fs,book,candidates)
    return candidates

def build_groups(shots,fs,mains,panels,trace):
    groups=[];current=None
    for i,(shot,f,p,t) in enumerate(zip(shots,fs,panels,trace)):
        if p['role']=='main':
            current={'id':'main-support:'+shot['key'],'mainKey':shot['key'],'mainStyleId':t['styleId'],'storyRole':mains[i][2],'mainReason':mains[i][3],'members':[],
                'sourceAnchor':{'shotCode':shot['key'],'quote':str(shot.get('description') or shot.get('dialogue') or '')[:40]},'prominenceDoesNotCreateBoundary':True}
            groups.append(current)
        if p['role']=='main':relation='narrative_focus'
        elif f['base']=='detail':relation='whole_to_detail'
        elif f['reaction']:relation='focus_to_reaction'
        elif f['action']:relation='action_continuation'
        elif f['speech']:relation='information_development'
        else:relation='scene_or_action_development'
        if f.get('_layoutRelation'):relation=f['_layoutRelation']['relation']
        current['members'].append({'key':shot['key'],'role':p['role'],'styleId':t['styleId'],'relationToMain':relation,'sourceAnchor':{'shotCode':shot['key'],'quote':str(shot.get('description') or shot.get('dialogue') or '')[:40]}})
    return {'version':VERSION,'groups':groups,'coverage':[s['key'] for s in shots],'mainSupportCountQuota':None}
