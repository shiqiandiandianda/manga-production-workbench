"""Conservative dependency scopes for repairs; validation remains whole-episode.

Only diagnosed metadata fields can be edited locally. Unknown or geometric
dependencies fall back to the original full prompt. No layout decisions here.
"""
import copy
import json
import math
from .core import digest
from .model_pipeline import check_contract
from .value_wire import prompt_parts, dump

VERSION = 'dependency-repair-v1'


def full_prompt(prompt,response,schema,error,compressed=False,value_encoding=False,last_patch_error=None):
    repair=prompt+'\n现有紧凑响应：'+dump(response)
    repair+='\n仅修以下校验问题，返回changes补丁，不重写整话；path是JSON指针，valueJson是新值的合法JSON字符串。只replace现有字段；可替换整个dialogueGroups等元数据数组，禁止替换panels数组、key、数量或顺序。相关坐标需要联动时逐字段列出，每处仍由你决定。错误：'+str(error)
    repair+='\n替换后的完整对象必须严格遵守下列原结果schema，不能新增字段；sourceAnchors仅包含shotCode和quote。原结果schema：'+dump(schema)
    if compressed:repair+='\n本次修正使用标准changes/path/valueJson补丁协议，不使用首轮短字段名；所有path指向上方已还原的原字段，禁止指向短名。'
    if value_encoding:repair+='\n返修输出协议覆盖首轮编码要求：本次只返回标准changes/path/valueJson，不返回codec/context/texts/layout信封，不用身份编号或texts编号；补丁值必须使用当前已还原响应中的原ID、原字符串、sourceAnchors原shotCode/quote字段。完整冻结输入、当前整话和完整schema均保留。'
    if last_patch_error:repair+='\n上一补丁被拒绝，原布局仍保留。请纠正补丁格式：'+last_patch_error
    return repair


def diagnoses(response,script):
    """Map exact validator messages to defects independently verified in this data.

    This is not another accepting validator: an unrecognized message forces full
    context. Necessity/protection/corner/depth and any geometry stay global.
    """
    found={};shots={s['key']:s for s in script['shots']}
    def add(message,path,keys):
        entry=found.setdefault(message,{'paths':set(),'keys':set()})
        entry['paths'].add(path);entry['keys'].update(keys)
    def quote_ok(anchor):
        shot=shots.get(anchor['shotCode']);quote=anchor['quote']
        if not shot:return False
        fields=[str(shot.get(k,'')) for k in ('description','dialogue')]
        return bool(quote) and any(quote in f for f in fields) and (len(quote)>=4 or quote in fields and any(c.isalnum() for c in quote))
    for i,d in enumerate(response.get('framingDecisions',[])):
        for field in ('framingNeeds','aspectReason','scaleReason'):
            if len(d[field].strip())<16:add(d['key']+'缺少具体景别、比例或面积依据',f'/framingDecisions/{i}/{field}',[d['key']])
    for i,d in enumerate(response.get('overlapDecisions',[])):
        pair=[d['fromShotCode'],d['toShotCode']];anchors=d.get('sourceAnchors')
        if anchors is not None and len(anchors)==2 and [a['shotCode'] for a in anchors]==pair and all(k in shots for k in pair):
            if any(not quote_ok(a) for a in anchors):
                add(pair[1]+'叠格必要性：原文引用不属于对应画格或短句被截断',f'/overlapDecisions/{i}/sourceAnchors',pair)
    for i,g in enumerate(response.get('dialogueGroups',[])):
        keys=[g['startShotCode'],g['endShotCode']]
        for field,minimum in [('topic',4),('reason',16)]:
            if len(g[field].strip())<minimum:add('信息段落缺少具体话题和分段依据',f'/dialogueGroups/{i}/{field}',keys)
        if not g['sourceAnchors']:add('信息段落缺少原文依据',f'/dialogueGroups/{i}/sourceAnchors',keys)
        for a in g['sourceAnchors']:
            key=a['shotCode']
            if key in shots and not quote_ok(a):
                fields=[str(shots[key].get(k,'')) for k in ('description','dialogue')]
                suffix='不是本格description或dialogue中的连续原文' if not a['quote'] or not any(a['quote'] in f for f in fields) else '不足4字时必须引用本格完整短句，不能截取片段或仅用标点'
                add('信息段落引用 '+key+'：'+suffix,f'/dialogueGroups/{i}/sourceAnchors',keys+[key])
    for i,c in enumerate(response.get('connections',[])):
        pair=[c['fromShotCode'],c['toShotCode']]
        # Identity membership is checked against the full frozen evidence in plan().
        if not c['reason'].strip():add(pair[1]+'缺少本次参考组合证据或具体衔接依据',f'/connections/{i}/reason',pair)
        if c['kind']=='information_reveal' and len(c['reason'].strip())<16:add(pair[1]+'线索揭示缺少原剧情解释',f'/connections/{i}/reason',pair)
    for i,d in enumerate(response.get('mainDecisions',[])):
        if not d['reason'].strip():add(d['key']+'缺少具体剧情选主依据',f'/mainDecisions/{i}/reason',[d['key']])
    for i,d in enumerate(response.get('paletteDecisions',[])):
        if not d['reason'].strip():add('缺少色彩依据说明',f'/paletteDecisions/{i}/reason',[d['startKey'],d['endKey']])
    return found


def plan(response,script,profile,schema,error,last_patch_error=None):
    result={'version':VERSION,'mode':'full','fallbackReason':None,'allowedPaths':[],
        'sourceDigest':digest(script),'responseDigest':digest(response),'allReferencesRetained':True}
    def fallback(reason):result['fallbackReason']=reason;return result
    if last_patch_error:return fallback('previous_patch_rejected_or_full_context_requested')
    try:
        check_contract(response,schema)
        n=len(script['shots']);keys=[s['key'] for s in script['shots']];index={k:i for i,k in enumerate(keys)}
        if not n or len(index)!=n or [p['key'] for p in response['panels']]!=keys:return fallback('panel_identity_or_order_uncertain')
        if len(response['connections'])!=n-1 or any((c['fromShotCode'],c['toShotCode'])!=(keys[i],keys[i+1]) for i,c in enumerate(response['connections'])):return fallback('connection_identity_or_coverage_uncertain')
        known=diagnoses(response,script)
        evidence_ids={r['id'] for r in profile['relationships']}|{e['id'] for e in profile.get('overlapReviewEvidence',[])}
        for i,c in enumerate(response['connections']):
            if not c['evidenceIds'] or not set(c['evidenceIds']).issubset(evidence_ids):
                label=c['toShotCode']+'缺少本次参考组合证据或具体衔接依据'
                entry=known.setdefault(label,{'paths':set(),'keys':set()});entry['paths'].add(f'/connections/{i}/evidenceIds');entry['keys'].update([c['fromShotCode'],c['toShotCode']])
        raw=getattr(error,'issues',None)
        if raw and any(i['layer'] not in ('native_complete','palette_decisions') for i in raw):return fallback('nonlocal_validation_layer')
        messages=set(part for part in str(error).split('；') if part)
        if not messages or not messages.issubset(known):
            result['unmappedMessages']=sorted(messages-set(known));return fallback('unknown_or_global_dependency')
        allowed=set();seed=set()
        for message in messages:
            allowed.update(known[message]['paths']);seed.update(known[message]['keys'])
        if not allowed or not seed.issubset(index):return fallback('unresolved_error_location')
        def spans(items,start='startShotCode',end='endShotCode'):
            out=[]
            for d in items:
                a,b=index[d[start]],index[d[end]]
                if a>b:raise ValueError('invalid span')
                out.append(set(range(a,b+1)))
            return out
        sections=spans(response['sections'])
        if [j for section in sections for j in sorted(section)]!=list(range(n)):return fallback('section_coverage_uncertain')
        groups=spans(response.get('dialogueGroups',[]))
        if any(a & b or max(a)>=min(b) for a,b in zip(groups,groups[1:])):return fallback('dialogue_span_order_uncertain')
        confirmed=spans(profile.get('dialoguePlan',{}).get('sequences',[]))
        mains=[i for i,p in enumerate(response['panels']) if p['role']=='main']
        if not mains or mains[0]!=0:return fallback('main_group_uncertain')
        blocks=[set(range(a,b)) for a,b in zip(mains,mains[1:]+[n])]
        overlaps=[]
        for i,p in enumerate(response['panels']):
            if any(not isinstance(p[k],(int,float)) or not math.isfinite(p[k]) for k in ('x','y','w','h')):return fallback('geometry_uncertain')
            for j,q in enumerate(response['panels'][:i]):
                if min(p['x']+p['w'],q['x']+q['w'])>max(p['x'],q['x']) and min(p['y']+p['h'],q['y']+q['h'])>max(p['y'],q['y']):overlaps.append({i,j})
        closed={index[k] for k in seed};relations=sections+groups+confirmed+blocks+overlaps;rounds=0
        while True:
            expanded=set(closed)
            for span in relations:
                if span & closed:expanded.update(span)
            rounds+=1
            if expanded==closed:break
            closed=expanded
            if len(closed)==n:return fallback('dependency_closure_is_whole_episode')
        if len(closed)==n:return fallback('dependency_closure_is_whole_episode')
        included=set(closed)
        for i in closed:
            if i:included.add(i-1)
            if i+1<n:included.add(i+1)
        top=min(response['panels'][i]['y'] for i in included);bottom=max(response['panels'][i]['y']+response['panels'][i]['h'] for i in included)
        backgrounds={i for i,bg in enumerate(response['backgrounds']) if bg['y']<bottom and bg['y']+bg['h']>top}
        for i in list(backgrounds):
            if i:backgrounds.add(i-1)
            if i+1<len(response['backgrounds']):backgrounds.add(i+1)
        result.update(mode='local',allowedPaths=sorted(allowed),seedKeys=sorted(seed),closureIndices=sorted(closed),includedIndices=sorted(included),
            sectionIndices=[i for i,s in enumerate(sections) if s & included],dialogueIndices=[i for i,g in enumerate(groups) if g & included],
            backgroundIndices=sorted(backgrounds),closureRounds=rounds,geometricFieldsFrozen=True,
            note='metadata-only; model may return changes=[] to request full context instead of inventing evidence')
        return result
    except (ValueError,KeyError,TypeError,IndexError,ZeroDivisionError):return fallback('schema_or_dependency_graph_uncertain')


def local_prompt(base_prompt,response,script,schema,error,scope):
    included=set(scope['includedIndices']);parts=prompt_parts(base_prompt)
    original=[copy.deepcopy(v) for _,_,v in parts];replaced=False
    script_start=base_prompt.index('固定输入脚本：\n')+len('固定输入脚本：\n')
    script_part=next(i for i,(start,_,_) in enumerate(parts) if start==script_start)
    for start,end,value in reversed(parts):
        if start==script_start:
            if not isinstance(value,dict) or not isinstance(value.get('shots'),list) or any(not isinstance(s,dict) for s in value['shots']) or [s.get('key') for s in value['shots']]!=[s['key'] for s in script['shots']]:raise ValueError('fixed script identity boundary uncertain')
            value=copy.deepcopy(value);value['shots']=[s for i,s in enumerate(value['shots']) if i in included]
            value['repairScriptScope']={'wholeEpisodeCount':len(script['shots']),'includedIndices':sorted(included),'otherShotsFrozen':True}
            base_prompt=base_prompt[:start]+dump(value)+base_prompt[end:];replaced=True
    if not replaced:raise ValueError('missing fixed script boundary')
    after=[v for _,_,v in prompt_parts(base_prompt)]
    for i,(before,current) in enumerate(zip(original,after)):
        if i!=script_part and before!=current:raise ValueError('reference evidence changed')
    keys={script['shots'][i]['key'] for i in included}
    def rows(field,predicate):return [{'index':i,'value':copy.deepcopy(v)} for i,v in enumerate(response.get(field,[])) if predicate(i,v)]
    sliced={
        'panels':rows('panels',lambda i,v:i in included),
        'sections':rows('sections',lambda i,v:i in scope['sectionIndices']),
        'connections':rows('connections',lambda i,v:v['fromShotCode'] in keys or v['toShotCode'] in keys),
        'mainDecisions':rows('mainDecisions',lambda i,v:v['key'] in keys),
        'framingDecisions':rows('framingDecisions',lambda i,v:v['key'] in keys),
        'overlapDecisions':rows('overlapDecisions',lambda i,v:v['fromShotCode'] in keys or v['toShotCode'] in keys),
        'dialogueGroups':rows('dialogueGroups',lambda i,v:i in scope['dialogueIndices']),
        'backgrounds':rows('backgrounds',lambda i,v:i in scope['backgroundIndices']),
        'paletteDecisions':rows('paletteDecisions',lambda i,v:i in scope['sectionIndices'])}
    global_state={'height':response['height'],'panels':[{k:p[k] for k in ('key','role','x','y','w','h')} for p in response['panels']],
        'frozenResponseDigest':scope['responseDigest'],'frozenScriptDigest':scope['sourceDigest']}
    instructions='''
本轮是dependency-repair-v1局部元数据补丁，不是新的整话排版；前文JSON整话输出要求由本轮changes协议覆盖。完整规则、全部已提供参考/配色证据及完整结果schema均保留，部分原脚本和响应仅提供依赖闭包。下列index为原全话数组下标，禁止按切片内次序重新编号。
只replace allowedPaths逐字列出的字段；其他字段、坐标、主副格、段落边界及未展示响应全部冻结。不用身份编号或texts编号，不返回编码信封；原ID/字符串及sourceAnchors的shotCode/quote保持原协议。
先判断已给原文和完整证据是否足以修正。若必须重新决定坐标、叠格必要性、保护方案、段落/背景或需要更多原文，请返回changes=[]请求完整上下文；不为保住冻结布局编造理由。补丁合回后会再次全话完整校验；全任务仍最多两次返修，不增加次数。
'''
    return base_prompt+instructions+'\nallowedPaths：'+dump(scope['allowedPaths'])+'\n全话只读几何与摘要：'+dump(global_state)+'\n关联响应（index为原下标）：'+dump(sliced)+'\n错误：'+str(error)+'\n原结果schema：'+dump(schema)


def build_repair(prompt,base_prompt,response,script,profile,schema,error,compressed=False,value_encoding=False,last_patch_error=None):
    full=full_prompt(prompt,response,schema,error,compressed,value_encoding,last_patch_error)
    scope=plan(response,script,profile,schema,error,last_patch_error)
    repair=full
    if scope['mode']=='local':
        try:
            candidate=local_prompt(base_prompt,response,script,schema,error,scope)
            if len(candidate.encode('utf-8'))<len(full.encode('utf-8')):repair=candidate
            else:scope.update(mode='full',fallbackReason='localized_input_not_smaller',allowedPaths=[])
        except (ValueError,KeyError,TypeError,IndexError):scope.update(mode='full',fallbackReason='prompt_dependency_boundary_uncertain',allowedPaths=[])
    scope.update(fullPromptBytes=len(full.encode('utf-8')),selectedPromptBytes=len(repair.encode('utf-8')))
    return repair,scope


def enforce_patch_scope(patch,scope,before=None,after=None):
    if scope['mode']!='local':return
    if not patch['changes']:raise ValueError('局部返修请求完整上下文：changes为空，原响应保留')
    def at(document,path):
        for part in path.split('/')[1:]:document=document[int(part)] if isinstance(document,list) else document[part]
        return document
    for change in patch['changes']:
        path=change['path']
        if any(path==p or path.startswith(p+'/') or p.startswith(path+'/') for p in scope['allowedPaths']):continue
        # Retain existing safe citation-alias normalization: an out-of-scope
        # replacement that becomes exactly unchanged is a no-op, not an edit.
        if before is not None and after is not None:
            try:
                if at(before,path)==at(after,path):continue
            except (KeyError,IndexError,TypeError,ValueError):pass
        raise ValueError('局部补丁超出依赖字段白名单，需完整上下文：'+path)


def enforce_frozen_response(before,after,scope):
    if scope['mode']!='local':return
    if digest(before)!=scope['responseDigest']:raise ValueError('返修期间原响应摘要变化，拒绝局部合回')
    masked=copy.deepcopy(after)
    for path in scope['allowedPaths']:
        parts=path.split('/')[1:];old=before;target=masked
        for part in parts[:-1]:
            old=old[int(part)] if isinstance(old,list) else old[part]
            target=target[int(part)] if isinstance(target,list) else target[part]
        key=int(parts[-1]) if isinstance(target,list) else parts[-1]
        target[key]=copy.deepcopy(old[key])
    if masked!=before:raise ValueError('局部合回改变了冻结响应，补丁未采用')
