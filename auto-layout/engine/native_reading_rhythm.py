"""Relative prominence inside content arcs, then source-bounded frame heights.

A meaningful answer is a candidate, not an instruction to add a main frame.
"""
import re,hashlib,json,math
from layout_engine.rhythm import scene_change
from native_sequence_layout import positive

VERSION='arc-screen-rhythm-v10'

def sample(f,label,low,high,seed):
    # Layout-owned content only. Changing producer main flags/old coordinates
    # cannot change the seed; replaying a saved result is exact.
    content={k:f.get(k) for k in ('key','description','composition','camera','size','speech','speakers','thoughtSpeakers')}
    h=hashlib.sha256(json.dumps([seed,label,content],ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    unit=int(h[:12],16)/(16**12-1)
    return low+(high-low)*unit

def select_mains(shots,fs,scores,book):
    cfg=book['runtime']['readingPlanner'];candidates=dict(scores);decisions={};arc=0;arcs=[];start=0
    for i in range(1,len(fs)+1):
        if i==len(fs) or scene_change(shots[i-1],shots[i]):arcs.append((start,i));start=i
    # Add content turns that were lost by the former individual-keyword list.
    for i,f in enumerate(fs):
        if not i:continue
        text=positive(f['description'])+'；'+f['speech']
        for rule in cfg['additionalFocusRules']:
            if rule.get('atEndOnly') and i!=len(fs)-1:continue
            if re.search(rule['pattern'],text):
                value=(rule['score'],rule['style'],rule['storyRole'],rule['reason']+'；原文“'+f['description'][:48]+'”')
                if i not in candidates or value[0]>candidates[i][0]:candidates[i]=value
    selected_candidates={0:candidates[0]};visited=set()
    for a,z in arcs:
        location=str(shots[a].get('location') or '');returning=location in visited;visited.add(location)
        explanation=[];accepted=[];rejected=[]
        for i in range(a,z):
            if not i or i not in candidates:continue
            f=fs[i];v=candidates[i];text=positive(f['description'])+'；'+f['speech']
            matches=[r for r in book['runtime']['narrativeGrouping']['phaseRules'] if re.search(r['pattern'],text)]
            strong=any(r['id'] in cfg['majorPhaseIds'] for r in matches) or f['action'] or f['reveal'] or bool(re.search(cfg['majorEmotionalPattern'],text))
            extra=any(re.search(r['pattern'],text) and (not r.get('atEndOnly') or i==len(fs)-1) for r in cfg['additionalFocusRules'])
            if v[2]=='scene_anchor':
                if f['base']=='detail':rejected.append((i,'局部入场/动作细节不因地点字符串改变而升主'));continue
                if returning and i==a and not extra:rejected.append((i,'回到已经建立过的场景，空间回切不自动再建立主格'));continue
                if i==a and not returning:v=(max(v[0],cfg['newSceneScore']),*v[1:])
                selected_candidates[i]=v;accepted.append(i);continue
            if v[2]=='chapter_hook':
                weak=bool(re.search(cfg['weakHookPattern'],text)) and not re.search(cfg['strongHookPattern'],text)
                if weak:rejected.append((i,'等待接话/脚步停顿是承接，不自动比实际入场揭示更重要'));continue
                selected_candidates[i]=v;accepted.append(i);continue
            if strong or extra:
                selected_candidates[i]=v;accepted.append(i)
            else:explanation.append(i)
        # Related explanations/answers compete inside the same ongoing issue.
        # The introduction establishes the issue; only a source-supported payoff
        # can add a further major focus, not every new sub-question.
        if explanation:
            first=explanation[0];selected_candidates[first]=candidates[first];accepted.append(first)
            payoff=[i for i in explanation[1:] if re.search(cfg['expositionPayoffPattern'],fs[i]['speech']+' '+positive(fs[i]['description']))]
            if payoff:
                chosen=payoff[-1];selected_candidates[chosen]=candidates[chosen];accepted.append(chosen)
            for i in explanation:
                if i not in accepted:rejected.append((i,'同一问题链/案情说明里的补充答案，作为既有重心的副格承接'))
        arcs_meta={'startKey':shots[a]['key'],'endKey':shots[z-1]['key'],'returningLocation':returning,'relativeFocusCandidates':[shots[i]['key'] for i in accepted],
            'subordinateCandidates':[{'key':shots[i]['key'],'reason':reason} for i,reason in rejected]}
        decisions[arc]=arcs_meta;arc+=1
    # Resolve actual adjacent conflicts after contextual candidates were reduced.
    chosen={0:selected_candidates[0]}
    for i,v in sorted(selected_candidates.items(),key=lambda x:(-x[1][0],x[0])):
        if i and not any(abs(i-j)<=1 for j in chosen):chosen[i]=v
    for i,f in enumerate(fs):f['_readingArcs']=decisions
    return chosen

def main_shape(f,book):
    cfg=book['runtime']['readingPlanner'];text=positive(f['description']+'；'+f['composition'])
    if re.search(cfg['bodyPathPattern'],text) or f['base']=='spatial':variant='spatial_body';style='M01'
    elif f['base']=='detail':variant='evidence_focus';style='M03'
    elif '近景' in f['size']:variant='performance_focus';style='M03'
    elif f['action']:variant='action_body';style='M03'
    else:variant='person_relationship';style='M02'
    lo,hi=cfg['mainHeightRanges'][variant]
    if book['runtime'].get('userConstraints',{}).get('maximumHOverW'):
        if compact_content(f,cfg):
            variant='evidence_focus' if f['base']=='detail' else 'performance_focus' if '近景' in f['size'] else 'person_relationship'
            style='M03' if variant!='person_relationship' else 'M02'
            lo,hi=cfg['compactMainRange']
        hi=min(hi,16/9);lo=min(lo,hi)
    ratio=sample(f,'main:'+variant,lo,hi,cfg['heightSeed'])
    return {'version':cfg['version'],'variant':variant,'styleId':style,'ratio':ratio,'range':[lo,hi],
        'reason':'主格权重与几何款式分开判断；按本格原景别、身体/空间/细节承载在允许范围内取高度，非固定主格高度。',
        'heightSelection':'source-bounded-stable-random','minimumHOverW':1.0}

def support_height(f,g,book):
    if book['runtime']['readingPlanner'].get('supportHeightPolicy'):
        profile=support_profile(f,g,book)
        return sample(f,'support:'+g['variant'],*profile['range'],book['runtime']['readingPlanner']['heightSeed'])
    cfg=book['runtime']['readingPlanner'];lo,hi=cfg['supportHeightRanges'][g['variant']]
    if g['informationLoad']['fullBody'] or g['informationLoad']['vertical']:lo=max(lo,1.4)
    if book['runtime'].get('userConstraints',{}).get('maximumHOverW'):
        if compact_content(f,cfg) and not (g['informationLoad']['fullBody'] or g['informationLoad']['vertical']):lo,hi=cfg['compactSupportRange']
        hi=min(hi,16/9);lo=min(lo,hi)
    return sample(f,'support:'+g['variant'],lo,hi,cfg['heightSeed'])

def support_profile(f,g,book):
    cfg=book['runtime']['readingPlanner']['supportHeightPolicy'];load=g['informationLoad'];desc=positive(f['description']);size=f['size']
    if load['fullBody'] or load['vertical'] or f['base']=='spatial':
        kind='vertical';why='原取景需要完整身体、空间纵深或明确纵向路径，保留竖幅承载'
    elif f['base']=='detail':
        kind='detail';why='原特写保留证物或手部接触的局部范围，不因特写标签套长条或近方格'
    elif re.search(cfg['posePattern'],desc):
        kind='performance';why='原文的身体姿态和动作参与表演，不能只按脸部近景压紧'
    elif load['multipleFaces'] or load['spanningSubjects'] or load['overShoulder'] or '中景' in size or '中近景' in size or f['base']=='address':
        kind='relationship';why='原中景、过肩或同框关系保留人物和空间层次，短对白不覆盖关系承载'
    elif re.search(cfg['handActionPattern'],desc):
        kind='relationship';why='本格原文有实际手部或道具动作，表情和动作关系共同决定高度'
    elif '近景' in size or f['base']=='expression':
        kind='face';why='当前局部表情为主，采用紧凑竖幅，紧凑不等于默认接近正方形'
    else:
        kind='relationship';why='当前原文未限定纯脸部取景，保留常规人物关系的竖幅余量'
    return {'version':cfg['version'],'class':kind,'range':cfg['ranges'][kind],
        'reason':why,'sourceShotSize':size,'sourceDescription':f['description'],'minimumIsContentBound':True}

def compact_content(f,cfg):
    text=positive(f['composition']+'；'+f['description'])
    needs_body=bool(re.search(cfg['bodyPathPattern'],text)) or f['base']=='spatial'
    return not needs_body and ('近景' in f['size'] or f['base']=='expression' or bool(f['speech']) and len(f['speech'])<=cfg['compactSpeechMaximum'] and not f['action'])

def review(packet,fs,book):
    ps=packet['panels'];cycles=[]
    roles=''.join('M' if p['role']=='main' else 'S' for p in ps)
    for m in re.finditer('(?:MS){3,}',roles):cycles.append({'keys':[p['key'] for p in ps[m.start():m.end()]],'pattern':'main-support-repeated','reviewRequired':True})
    windows=[]
    for viewport in book['runtime']['readingPlanner']['reviewHeights']:
        top=0
        while top<packet['canvas']['height']:
            visible=[p['key'] for p in ps if p['y']<top+viewport and p['y']+p['h']>top]
            windows.append({'width':1280,'height':viewport,'top':top,'visibleKeys':visible});top+=viewport
    return {'version':book['runtime']['readingPlanner']['version'],'arcs':list(fs[0]['_readingArcs'].values()),'mainGeometry':[{**f['_mainGeometry'],'key':f['key']} for f in fs if f.get('_mainGeometry')],
        'roleCycles':cycles,'readingWindows':windows,'screenReviewIsNotArtworkAcceptance':True,'heightAtLeastWidth':True,'mainFullWidth':True}
