"""Source-cited paragraph cores before geometry; no panel-count or actor quota."""
import copy,re
from native_sequence_layout import positive
VERSION='paragraph-core-priority-v1'

def source_events(f,policy):
    text=positive(f['description']);events=[]
    for rule in policy['events']:
        for match in re.finditer(rule['pattern'],text):
            prefix=re.split(r'[，。；;]',text[:match.start()])[-1]
            if re.search(r'(?:尚未|并未|没有|未曾|不曾|不会|不能|并非|未|没|不).{0,4}$',prefix):continue
            events.append({'kind':rule['kind'],'quote':match.group(0),'priority':rule['priority'],'function':rule['function'],'milestone':rule.get('milestone',False)})
            break
    return events

def core_candidates(group,shots,fs,book,fallback):
    """One focus per source-supported development, reversal, control or resolution."""
    policy=book['runtime']['paragraphFocus'];members=group['members']
    if group['kind']!='action_result':
        return [{'index':fallback,'kind':group['kind'],'priority':0,'quote':shots[fallback]['description'],'basis':'原场景/信息/关系分组的重心候选'}]
    significant=[]
    for m in members:
        i=m['index'];events=fs[i].get('_paragraphEvents',[])
        eligible=[e for e in events if e['milestone'] and (fs[i]['base']!='detail' or e['kind'] in ('resolution','revelation'))]
        if eligible:
            best=max(eligible,key=lambda e:e['priority'])
            if significant and significant[-1]['kind']==best['kind']:
                if best['priority']>significant[-1]['priority']:significant[-1]={**best,'index':i}
            else:significant.append({**best,'index':i})
    if not significant:
        scored=[(max((e['priority'] for e in fs[m['index']].get('_paragraphEvents',[])),default=0),m['index']) for m in members if fs[m['index']]['base']!='detail']
        index=max(scored,key=lambda p:(p[0],-p[1]))[1] if scored else fallback
        best=max(fs[index].get('_paragraphEvents',[]),key=lambda e:e['priority'],default={'kind':'action_development','priority':0,'quote':shots[index]['description']})
        significant=[{**best,'index':index}]
    # Consecutive candidates compete later under the existing global non-adjacent-main constraint.
    return [{**c,'priority':min(c['priority'],policy['maximumScoreBoost']),'basis':'原画面明确的动作转折/控制/结果依据；无固定主格数'} for c in significant]

def bind(plan,shots,fs,mains,policy=None):
    paragraphs=[];selected=sorted(mains)
    for group in plan['groups']:
        candidates=group.get('paragraphCoreCandidates',[])
        cores=[c for c in candidates if c['index'] in mains]
        if not cores:
            prior=[i for i in selected if i<=group['startIndex']]
            index=prior[-1] if prior else selected[0]
            cores=[{'index':index,'kind':'inherited_focus','quote':shots[index]['description'],'priority':0,'basis':'本组从属已建立的剧情重心，不为格数新增主格'}]
        starts=[group['startIndex']]
        for previous,current in zip(cores,cores[1:]):
            lo=max(group['startIndex'],previous['index']+1);hi=current['index'];start=hi
            completed=[j for j in range(lo,hi) if any(e['kind'] in ('consequence','control') for e in fs[j].get('_paragraphEvents',[]))]
            if completed:
                start=next((j for j in range(completed[-1]+1,hi+1) if any(e['function'] in ('action','response') for e in fs[j].get('_paragraphEvents',[]))),hi)
            starts.append(start)
        for n,(start,core) in enumerate(zip(starts,cores)):
            end=starts[n+1]-1 if n+1<len(starts) else group['endIndex'];index=core['index'];members=[]
            for i in range(start,end+1):
                f=fs[i];events=f.get('_paragraphEvents',[])
                relation='core' if i==index else 'detail' if f['base']=='detail' else 'reaction' if f['reaction'] else 'setup' if i<index else 'aftermath' if any(e['function']=='result' for e in events) else 'development'
                record={'key':shots[i]['key'],'relationToCore':relation,'sourceDescription':f['description']};members.append(record)
                f['_paragraphFocus']={'paragraphId':'paragraph-'+str(len(paragraphs)+1),'coreKey':shots[index]['key'],'relationToCore':relation}
            paragraphs.append({'id':'paragraph-'+str(len(paragraphs)+1),'combinationId':group['id'],'startKey':shots[start]['key'],'endKey':shots[end]['key'],'coreKey':shots[index]['key'],'coreKind':core['kind'],'coreSource':{'key':shots[index]['key'],'quote':shots[index]['description'],'signalQuote':core['quote']},'basis':core['basis'],'inheritedCore':not start<=index<=end,'members':members})
    result={'version':VERSION,'builtBeforeGeometry':True,'fixedGroupSize':None,'mainQuota':None,'sameActorRunAllowed':True,'sourceDescriptionsChanged':False,'visualPolicy':{'maximumSupportAreaRatio':(policy or {}).get('maximumSupportAreaRatio',.8),'thresholdStatus':'trial-parameter-not-artwork-acceptance'},'paragraphs':paragraphs}
    plan['paragraphFocus']=result
    return result

def validate(packet,script,policy=None):
    data=packet.get('nativeParagraphFocus');plan=packet.get('nativeCombinationPlan',{})
    if not data or data.get('version')!=VERSION or not data.get('builtBeforeGeometry') or data!=plan.get('paragraphFocus'):raise ValueError('叙事段落重心决策缺失或生成/校验来源不一致')
    limit=data.get('visualPolicy',{}).get('maximumSupportAreaRatio')
    if not isinstance(limit,(int,float)) or not 0<limit<1 or policy and limit!=policy['maximumSupportAreaRatio']:raise ValueError('段落主副层次参数与冻结规则不一致')
    shots={s['key']:s for s in script['shots']};panels={p['key']:p for p in packet['panels']};covered=[]
    for paragraph in data['paragraphs']:
        key=paragraph['coreKey'];source=paragraph['coreSource']
        if key not in shots or panels[key]['role']!='main' or source['key']!=key or source['quote']!=shots[key]['description'] or source['signalQuote'] not in source['quote']:raise ValueError('段落核心缺少实际主格或原文依据：'+key)
        members=paragraph['members'];covered.extend(m['key'] for m in members)
        if members[0]['key']!=paragraph['startKey'] or members[-1]['key']!=paragraph['endKey']:raise ValueError('叙事段落边界不一致')
        for member in members:
            if member['sourceDescription']!=shots[member['key']]['description']:raise ValueError('段落依据改变了原分镜')
            frame=panels[member['key']];core=panels[key]
            if frame['role']=='support' and frame['w']*frame['h']>core['w']*core['h']*limit+core['w']:raise ValueError('副格视觉面积压过本段重心：'+member['key'])
    if covered!=[s['key'] for s in script['shots']]:raise ValueError('叙事段落未按原读序完整覆盖')
    return True

def visual_review(packet):
    lookup={p['key']:p for p in packet['panels']};reviews=[]
    for paragraph in packet['nativeParagraphFocus']['paragraphs']:
        core=lookup[paragraph['coreKey']];members=[lookup[m['key']] for m in paragraph['members']]
        support=[p for p in members if p['role']=='support'];run=[];repeats=[]
        for p in members:
            signature=(p['role'],p['x'],p['w'],p['h'])
            if run and signature!=run[-1][1]:run=[]
            run.append((p['key'],signature))
            if len(run)>=3:repeats.append([x[0] for x in run])
        reviews.append({'paragraphId':paragraph['id'],'coreKey':core['key'],'coreArea':core['w']*core['h'],'supportAreaRatios':[{'key':p['key'],'ratio':round(p['w']*p['h']/(core['w']*core['h']),4)} for p in support],'threeIdenticalFrames':repeats,'artworkAcceptance':False})
    return {'version':VERSION,'paragraphs':reviews,'focusCheckedOnActualGeometry':True}
