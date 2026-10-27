"""Narrative boundaries and actual two-dimensional panel relationships."""
import statistics
from .selective_overlap import validate_selective_overlap

def time_phase(value):
    text=str(value or '')
    for words,phase in ((('上午','早','晨'),'morning'),(('下午','午后'),'afternoon'),(('黄昏','傍晚'),'evening'),(('夜','晚'),'night'),(('中午','午间'),'noon')):
        if any(word in text for word in words):return phase
    return text

def scene_change(previous,current):
    if previous.get('location')!=current.get('location'):return True
    a,b=time_phase(previous.get('time')),time_phase(current.get('time'))
    if a and b and a!=b:return True
    old,new=str(previous.get('time','')),str(current.get('time',''))
    return any(w in new and w not in old for w in ('次日','翌日','数日后'))

def intersection(a,b):
    return max(0,min(a['x']+a['w'],b['x']+b['w'])-max(a['x'],b['x']))*max(0,min(a['y']+a['h'],b['y']+b['h'])-max(a['y'],b['y']))


def validate_overlap_decisions(packet,script):
    panels=packet['panels'];links=packet.get('connections',[]);decisions=packet.get('overlapDecisions',[]);errors=[]
    expected=[(c['fromShotCode'],c['toShotCode']) for c in links if c['relation']=='overlap']
    if [(d.get('fromShotCode'),d.get('toShotCode')) for d in decisions]!=expected:errors.append('叠格目的与构图决策必须按顺序覆盖全部真实叠格')
    lookup={p['key']:p for p in panels};shots={s['key']:s for s in script['shots']} if script else {}
    valid={e['id'] for e in packet.get('learningOverlapEvidence',[]) if e['status'].startswith('confirmed_overlap')}
    for d in decisions:
        a,b=lookup.get(d.get('fromShotCode')),lookup.get(d.get('toShotCode'))
        if not a or not b:errors.append('叠格决策引用未知画格');continue
        if intersection(a,b)<=0:errors.append(b['key']+'叠格决策与实际二维相交不符')
        if d.get('purpose') not in ('immediate_reaction','action_continuation','scene_to_person','whole_to_detail'):errors.append(b['key']+'叠格缺少具体叙事目的')
        for field in ('storyReason','scaleReason','cornerReason','depthReason','ratioReviewReason'):
            if not isinstance(d.get(field),str) or len(d[field].strip())<12:errors.append(b['key']+'叠格缺少剧情、景别、叠角或叠深依据')
        for field in ('upperProtectedContent','lowerProtectedContent'):
            if not isinstance(d.get(field),str) or len(d[field].strip())<6:errors.append(b['key']+'叠格未说明必要信息保护区')
        if script and d.get('sourceShotSizes')!=[str(shots[a['key']].get('shotSize','')),str(shots[b['key']].get('shotSize',''))]:errors.append(b['key']+'叠格引用的景别与原脚本不一致')
        if not d.get('referenceEvidenceIds') or not set(d['referenceEvidenceIds']).issubset(valid):errors.append(b['key']+'叠格未引用已目视确认的真实叠格案例')
        corner=d.get('corner')
        if corner=='lower_right':aligned=b['x']>a['x']+.01
        elif corner=='lower_left':aligned=b['x']+b['w']<a['x']+a['w']-.01
        else:aligned=False
        if not aligned:errors.append(b['key']+'叠角声明与左右坐标不符')
        if d.get('verificationStatus')!='pending_artwork':errors.append(b['key']+'未取得成图时不能声称实际主体避让已通过')
    if errors:raise ValueError('；'.join(dict.fromkeys(errors)))
    if packet.get('rhythmPolicy',{}).get('overlapNecessityMode')=='selective_v1':validate_selective_overlap(packet,script)
    return True

def validate_rhythm(packet,script):
    panels=packet['panels'];links=packet.get('connections',[]);policy=packet['rhythmPolicy'];errors=[]
    if policy.get('framingMode')=='source_shot_and_composition':
        decisions=packet.get('framingDecisions',[])
        if [d.get('key') for d in decisions]!=[p['key'] for p in panels]:errors.append('景别承载决策必须逐一按顺序覆盖全部画格')
        for i,d in enumerate(decisions):
            if script and (i>=len(script['shots']) or d.get('sourceShotSize')!=str(script['shots'][i].get('shotSize',''))):errors.append(str(d.get('key'))+'景别与原脚本不一致')
            for field in ('framingNeeds','aspectReason','scaleReason'):
                if not isinstance(d.get(field),str) or len(d[field].strip())<16:errors.append(str(d.get('key'))+'缺少具体景别、比例或面积依据')
    if policy.get('mainWidthMode') in ('full_bleed_default','project_reference'):
        mains=[p for p in panels if p['role']=='main'];decisions=packet.get('mainDecisions',[])
        if [d.get('key') for d in decisions]!=[p['key'] for p in mains]:errors.append('主格剧情决策必须逐一按顺序覆盖所有主格')
        for p,d in zip(mains,decisions):
            full=abs(p['x'])<=.01 and abs(p['w']-1280)<=.01
            if not d.get('reason','').strip() or d.get('storyRole') not in ('opening_focus','scene_anchor','key_action','plot_reveal','emotional_peak','chapter_hook'):errors.append(p['key']+'缺少具体剧情选主依据')
            if d.get('widthMode')=='full_bleed':
                if not full or d.get('compositionException') is not None:errors.append(p['key']+'声明满幅但未铺满1280画布')
            elif d.get('widthMode')=='inset_exception':
                reason=d.get('compositionException')
                if full or not isinstance(reason,str) or len(reason.strip())<16:errors.append(p['key']+'内收例外缺少具体构图依据')
            else:errors.append(p['key']+'主格占幅模式无效')
            if p is panels[0] and not full and policy.get('mainWidthMode')=='full_bleed_default':errors.append('首格主画面必须铺满画布')
    if len(links)!=max(0,len(panels)-1):raise ValueError('节奏连接必须覆盖全部相邻画格')
    allowed=set(packet['learningRelationshipIds']);continuation_gaps=[];beats=0;segment_length=1
    for i,p in enumerate(panels):
        if p['h']/p['w']<policy.get('minimumAspectHOverW',0):errors.append(p['key']+'不符合用户取消横向扁矮格的要求')
        if not i:continue
        a=panels[i-1];link=links[i-1]
        if (link['fromShotCode'],link['toShotCode'])!=(a['key'],p['key']):errors.append('节奏连接镜号或顺序错误')
        if not link['reason'].strip() or not link['evidenceIds'] or not set(link['evidenceIds']).issubset(allowed):errors.append(p['key']+'缺少本次参考组合证据或具体衔接依据')
        bottom=max(q['y']+q['h'] for q in panels[:i]);gap=p['y']-bottom
        area=intersection(a,p);relation='overlap' if area>0 else 'staggered' if p['y']<a['y']+a['h'] else 'separated'
        if link['relation']!=relation:errors.append(p['key']+'声明的叠格/错位关系与二维坐标不符')
        actual_transition=scene_change(script['shots'][i-1],script['shots'][i]) if script else link['kind']=='scene_transition'
        if actual_transition!=(link['kind']=='scene_transition'):errors.append(p['key']+'转场标记与原脚本地点/时间衔接不符')
        if actual_transition:
            if beats>max(1,segment_length//5):errors.append('连续同场剧情被过度切成大停顿')
            beats=0;segment_length=1
        else:segment_length+=1
        if link['kind']=='continuation':
            if relation=='separated':
                lo,hi=policy['continuationGapRange']
                if not lo-.01<=gap<=hi+.01:errors.append(p['key']+'连续剧情间隙不在所选紧凑范围内')
                continuation_gaps.append(gap)
        elif link['kind'] in ('beat_pause','scene_transition','information_boundary','information_reveal'):
            range_key={'beat_pause':'beatPauseGapRange','scene_transition':'transitionGapRange','information_boundary':'informationGapRange','information_reveal':'informationRevealGapRange'}[link['kind']]
            lo,hi=policy.get(range_key,(float('inf'),float('inf')))
            if relation!='separated' or not lo-.01<=gap<=hi+.01:errors.append(p['key']+'段落/转场间隙与声明不符')
            if link['kind']=='beat_pause':beats+=1
        else:errors.append(p['key']+'未知的剧情连接类型')
        if area:
            if link['kind']!='continuation':errors.append(p['key']+'跨转场或新剧情叠格')
            ratio=area/min(a['w']*a['h'],p['w']*p['h'])
            if policy.get('overlapRatioMode')!='advisory' and (ratio>.00001+policy['maximumOverlapAreaRatio'] or ratio<.015):errors.append(p['key']+'叠格覆盖过大或仅为无意义擦边')
        for earlier in panels[:i-1]:
            if intersection(earlier,p)>0:errors.append(p['key']+'叠到非相邻画格，超出已声明的连接关系')
    if beats>max(1,segment_length//5):errors.append('连续同场剧情被过度切成大停顿')
    if continuation_gaps and statistics.median(continuation_gaps)>policy.get('continuationMedianMaximum',180):errors.append('连续剧情间隙中位数仍过大，应体现本项目的连续节奏')
    if policy.get('overlapDecisionMode')=='story_framing_composition_v2':
        try:validate_overlap_decisions(packet,script)
        except ValueError as exc:errors.append(str(exc))
    if policy.get('dialogueMode')=='information_paragraphs_v1':
        from .dialogue import validate_dialogue_groups
        try:validate_dialogue_groups(packet,script)
        except ValueError as exc:errors.append(str(exc))
    if errors:raise ValueError('；'.join(dict.fromkeys(errors)))
    if packet.get('rhythmPolicy',{}).get('overlapNecessityMode')=='selective_v1':validate_selective_overlap(packet,script)
    return True
