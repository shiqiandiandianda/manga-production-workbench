"""Information paragraphs are layout policy, separate from reference learning."""
import copy
from .core import digest
from .rhythm import scene_change


def apply_dialogue_rules(script, learning_profile, rules):
    profile=copy.deepcopy(learning_profile)
    project=rules.get('projects',{}).get(script['projectId'])
    if not project:return profile
    profile['policy'].update(project['policy'])
    profile['dialogueLayoutRules']={k:copy.deepcopy(v) for k,v in project.items() if k!='plans'}
    plan=project.get('plans',{}).get(script['id'])
    if plan:
        if plan['scriptContentDigest']!=digest(script['shots']):raise ValueError('长对话段落方案与原脚本版本不一致')
        profile['dialoguePlan']=copy.deepcopy(plan)
    return profile


def validate_dialogue_groups(packet, script):
    if not script:raise ValueError('信息段落校验需要固定原脚本')
    panels=packet['panels'];shots=script['shots'];groups=packet.get('dialogueGroups',[])
    index={s['key']:i for i,s in enumerate(shots)};errors=[];spans=[];last=-1
    for group in groups:
        start=index.get(group.get('startShotCode'),-1);end=index.get(group.get('endShotCode'),-1)
        if start<0 or end<start or start<=last:errors.append('长对话信息段落镜号无效、重叠或顺序错误');continue
        last=end;spans.append((start,end,group))
        if any(scene_change(shots[i-1],shots[i]) for i in range(start+1,end+1)):errors.append('信息段落不能跨真实时空转场')
        if len(group.get('topic','').strip())<4 or len(group.get('reason','').strip())<16:errors.append('信息段落缺少具体话题和分段依据')
        anchors=group.get('sourceAnchors',[])
        if not anchors:errors.append('信息段落缺少原文依据')
        for anchor in anchors:
            pos=index.get(anchor.get('shotCode'),-1);quote=anchor.get('quote','')
            if not start<=pos<=end or len(quote)<4 or quote not in (str(shots[pos].get('description',''))+'\n'+str(shots[pos].get('dialogue',''))):errors.append('信息段落引用并非对应范围内的原脚本原文')
    plan=packet.get('dialoguePlan',{})
    if plan and plan.get('scriptContentDigest')!=digest(shots):errors.append('信息段落方案的脚本指纹不符')
    for sequence in plan.get('sequences',[]):
        start=index[sequence['startShotCode']];end=index[sequence['endShotCode']]
        actual=[(shots[a]['key'],shots[b]['key']) for a,b,g in spans if not (b<start or a>end)]
        expected=[(g['startShotCode'],g['endShotCode']) for g in sequence['groups']]
        if actual!=expected:errors.append('长对话未按已确认的信息段落完整覆盖：'+sequence['startShotCode']+'—'+sequence['endShotCode'])
    boundaries={(b,c) for (a,b,g),(c,d,h) in zip(spans,spans[1:]) if c==b+1 and not scene_change(shots[b],shots[c])}
    links=packet['connections'];required_reveals={(index[r['fromShotCode']],index[r['toShotCode']]) for r in plan.get('revealBoundaries',[])}
    for i,link in enumerate(links):
        pair=(i,i+1);kind=link['kind']
        if pair in boundaries and kind!='information_boundary':errors.append(shots[i+1]['key']+'新信息段落必须单独留出间隙，不能继续接话或叠格')
        if kind=='information_boundary' and pair not in boundaries:errors.append(shots[i+1]['key']+'信息边界必须对应两个相邻信息段落')
        if pair in required_reveals and kind!='information_reveal':errors.append(shots[i+1]['key']+'关键线索识别缺少独立理解停顿')
        if kind=='information_reveal':
            if not any(a<=i<i+1<=b for a,b,g in spans):errors.append(shots[i+1]['key']+'线索揭示须属于已声明的信息段落')
            if len(link.get('reason','').strip())<16:errors.append(shots[i+1]['key']+'线索揭示缺少原剧情解释')
            if pair in required_reveals and i:
                gap=panels[i+1]['y']-max(p['y']+p['h'] for p in panels[:i+1])
                prior=panels[i]['y']-max(p['y']+p['h'] for p in panels[:i])
                if gap<prior:errors.append(shots[i+1]['key']+'关键识别停顿不应弱于前一信息边界')
    if errors:raise ValueError('；'.join(dict.fromkeys(errors)))
    return True
