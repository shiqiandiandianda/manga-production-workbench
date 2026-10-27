"""Versioned, reversible identity/string tables and exact Unicode source spans.

This transport never creates narrative text, selects a quote, or changes geometry.
Old requests keep their old codec; the bridge explicitly opts new requests in.
"""
import copy
import json
from collections import Counter
from dataclasses import dataclass
from .core import digest
from .model_pipeline import check_contract, obj, arr, S, N

VERSION = 'identity-values-spans-v1'
UNIT = 'unicode-code-points-zero-based-half-open'
SCALAR_IDS = {'key','shotCode','fromShotCode','toShotCode','startShotCode','endShotCode','startKey','endKey','referenceId','id'}
OUTPUT_IDS = SCALAR_IDS - {'id','referenceId'}
ARRAY_IDS = {'referenceIds','evidenceIds','referenceFrameIds','referenceEvidenceIds','specialFlashbackKeys'}
MARKERS = ('固定输入脚本：\n','\n本次参考关系和偏好：\n','\n新归纳的组合样式：\n','\n本话色彩来源：')


def dump(value): return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)


def scalar_text(text):
    if not isinstance(text,str) or any(0xD800<=ord(c)<=0xDFFF for c in text):
        raise ValueError('编码文本须为有效Unicode标量字符串')
    return text


def prompt_parts(prompt):
    result=[];decoder=json.JSONDecoder()
    for marker in MARKERS:
        if prompt.count(marker)!=1:raise ValueError('编码输入JSON边界缺失或重复：'+marker.strip())
        start=prompt.index(marker)+len(marker)
        value,length=decoder.raw_decode(prompt[start:])
        result.append((start,start+length,value))
    result.sort(key=lambda r:r[0])
    if any(a[1]>b[0] for a,b in zip(result,result[1:])):raise ValueError('编码输入JSON边界交叉')
    return result


@dataclass
class Context:
    script: dict
    identities: list
    prefixes: list
    rows: list
    context_digest: str
    bindings: dict
    allowed: list

    @property
    def index(self): return {s:i for i,s in enumerate(self.identities)}

    def manifest(self):
        return {'codec':VERSION,'context':self.context_digest,'unit':UNIT,
                'prefixes':self.prefixes,'identities':self.rows,
                'identitySyntax':'integer=identities[index]; ~p:s=prefixes[p]+":"+s'}


def build_context(script,profile,evidence,schema,prompt):
    keys=[s['key'] for s in script['shots']]
    if len(keys)!=len(set(keys)):raise ValueError('编码镜号重复')
    sources=[s['id'] for s in profile['sourceFiles']]
    ids=set(keys)|set(sources)
    ids.update(s['referenceId']+':'+s['frameId'] for s in profile['samples'])
    ids.update(r['id'] for r in profile['relationships'])
    ids.update(e['id'] for e in profile.get('overlapReviewEvidence',[]))
    ids.update(e['id'] for e in profile.get('supportRuleEvidence',[]))
    for entry in evidence.get('examples',[]):
        if entry.get('referenceId'):
            ids.update(entry['referenceId']+':'+frame for frame in entry.get('referenceFrameIds',[]))
    def gather(v,field=''):
        if isinstance(v,dict):
            for k,x in v.items():gather(x,k)
        elif isinstance(v,list):
            for x in v:gather(x,field)
        elif isinstance(v,str) and field in SCALAR_IDS|ARRAY_IDS and (v in keys or any(v==s or v.startswith(s+':') for s in sources)):
            ids.add(v)
    for _,_,value in prompt_parts(prompt):gather(value)
    allowed=sorted(scalar_text(v) for v in ids)
    # Frame/pair suffixes are already present in the complete evidence. Compose
    # their source prefix instead of repeating all of them in another table.
    composable={s['referenceId']+':'+s['frameId'] for s in profile['samples']}|{r['id'] for r in profile['relationships']}
    composable={v for v in composable if any(v.startswith(p+':') for p in sources)}
    identities=sorted(ids-composable|set(keys)|set(sources))
    prefixes=sorted(set(sources),key=lambda s:(-len(s),s))
    rows=[]
    for value in identities:
        found=next((i for i,p in enumerate(prefixes) if value==p or value.startswith(p+':')),None)
        rows.append([found,value[len(prefixes[found]):]] if found is not None else value)
    bindings={'scriptDigest':digest(script),'profileDigest':digest(profile),'evidenceDigest':digest(evidence),'schemaDigest':digest(schema),'allowedIdentityDigest':digest(allowed)}
    fingerprint=digest({'codec':VERSION,'unit':UNIT,'bindings':bindings,'prefixes':prefixes,'identities':rows})
    return Context(copy.deepcopy(script),identities,prefixes,rows,fingerprint,bindings,allowed)


def prompt_value(value,ctx,decode=False,field=''):
    table=ctx.index
    def restore(token):
        if isinstance(token,str) and token.startswith('~'):return identity(token,ctx)
        if not isinstance(token,str) or not token.startswith('@') or not token[1:].isdigit():raise ValueError('输入身份标记无效')
        return identity(int(token[1:]),ctx)
    if isinstance(value,dict):
        if field=='byReference':
            return {(restore(k) if decode else '@'+str(table[k])):prompt_value(v,ctx,decode,k) for k,v in value.items()}
        return {k:prompt_value(v,ctx,decode,k) for k,v in value.items()}
    if isinstance(value,list):return [prompt_value(v,ctx,decode,field) for v in value]
    if isinstance(value,str) and field in SCALAR_IDS|ARRAY_IDS:
        if decode and value.startswith(('@@','~~')):return value[1:]
        if decode and value.startswith(('@','~')):return restore(value)
        if not decode and value in ctx.allowed:
            code=identity_code(value,ctx)
            return '@'+str(code) if type(code) is int else code
        if not decode and value.startswith(('@','~')):return value[0]+value
    return copy.deepcopy(value)


def encode_prompt(prompt,ctx):
    for start,end,value in reversed(prompt_parts(prompt)):
        prompt=prompt[:start]+dump(prompt_value(value,ctx))+prompt[end:]
    instruction='''
首轮传输identity-values-spans-v1；前文规则描述的是还原后原语义，全部证据与判断须保留。identities下标为身份编号，字符串行=原ID，数组行[p,s]=prefixes[p]+s。输入身份值@N（含byReference键）及输出整数N均引用identities[N]；组合码~p:s表示prefixes[p]+":"+s，s是证据中精确后缀，禁止编造；@@或~~开头的输入身份字面量去掉首字符；正文不解码。
输出codec/context/texts/layout信封；镜号与各参考/证据ID使用上述身份码。其他字符串原样写或用整数引用texts下标；仅完全相同的值可复用，不合并不同理由、不写模板。坐标仍为坐标；无重复时texts=[]。
sourceAnchors={shotCode:身份码,field:description或dialogue,start:起点,end:终点}。按原字段Unicode码点计数，0基、左闭右开；emoji每码点计1，组合字符逐码点计数，CR/LF各计1。不归一化、不删空白、不跨字段。程序精确切片后继续原文、完整短句及必要性校验。codec/context使用下表原值。
'''
    return prompt+instruction+'\n传输编号表：'+dump(ctx.manifest())


def index_value(v,size,label):
    if type(v) is not int or not 0<=v<size:raise ValueError(label+'必须是范围内的整数编号')
    return v


def identity(v,ctx):
    if isinstance(v,str):
        head,separator,suffix=v[1:].partition(':') if v.startswith('~') else ('','','')
        if not separator or not head.isascii() or not head.isdigit() or str(int(head))!=head or not suffix:raise ValueError('组合身份码无效')
        prefix=ctx.prefixes[index_value(int(head),len(ctx.prefixes),'前缀')]
        original=prefix+':'+suffix
        if original not in ctx.allowed:raise ValueError('组合身份不在冻结资料中')
        return original
    return ctx.identities[index_value(v,len(ctx.identities),'身份')]


def identity_code(value,ctx):
    if value not in ctx.allowed:raise ValueError('引用不在本任务身份表中：'+str(value))
    if value in ctx.index:return ctx.index[value]
    prefix=next((i for i,p in enumerate(ctx.prefixes) if value.startswith(p+':')),None)
    if prefix is None:raise ValueError('身份缺少可逆编号或前缀')
    return '~'+str(prefix)+':'+value[len(ctx.prefixes[prefix])+1:]


def encoded_schema(schema,ctx):
    def visit(node,field='',id_item=False):
        if field=='sourceAnchors':
            return arr(obj({'shotCode':{'type':['number','string']},'field':{'type':'string','enum':['description','dialogue']},'start':copy.deepcopy(N),'end':copy.deepcopy(N)}))
        if node.get('type')=='object':return obj({k:visit(v,k) for k,v in node['properties'].items()})
        if node.get('type')=='array':return arr(visit(node['items'],field,field in ARRAY_IDS))
        if field in OUTPUT_IDS or id_item:return {'type':['number','string']}
        kinds=node.get('type');kinds=[kinds] if isinstance(kinds,str) else kinds
        if kinds and 'string' in kinds:
            out={'type':list(dict.fromkeys(kinds+['number']))}
            if 'enum' in node:out['description']='decoded enum: '+dump(node['enum'])
            return out
        return copy.deepcopy(node)
    return obj({'codec':{'type':'string','enum':[VERSION]},'context':{'type':'string','enum':[ctx.context_digest]},'texts':arr(S),'layout':visit(schema)})


def exact_span(anchor,ctx):
    key=anchor['shotCode'];quote=scalar_text(anchor['quote'])
    shot=next((s for s in ctx.script['shots'] if s['key']==key),None)
    if shot is None or not quote:raise ValueError('原文引用镜号未知或为空')
    for field in ('description','dialogue'):
        text=shot.get(field,'')
        if isinstance(text,str):
            scalar_text(text);start=text.find(quote)
            if start>=0:return {'shotCode':ctx.index[key],'field':field,'start':start,'end':start+len(quote)}
    raise ValueError('原文引用不能精确定位到对应description/dialogue；不允许模糊还原')


def encode_response(response,schema,ctx):
    check_context(ctx,schema)
    check_contract(response,schema)
    counts=Counter()
    def count(v,node,field='',id_item=False):
        if field=='sourceAnchors':return
        if node.get('type')=='object':
            for k,x in v.items():count(x,node['properties'][k],k)
        elif node.get('type')=='array':
            for x in v:count(x,node['items'],field,field in ARRAY_IDS)
        elif isinstance(v,str) and field not in OUTPUT_IDS and not id_item:
            scalar_text(v)
            if len(v)>=4:counts[v]+=1
    count(response,schema)
    texts=[v for v,n in counts.items() if n>1];pool={v:i for i,v in enumerate(texts)}
    def visit(v,node,field='',id_item=False):
        if field=='sourceAnchors':return [exact_span(a,ctx) for a in v]
        if node.get('type')=='object':return {k:visit(x,node['properties'][k],k) for k,x in v.items()}
        if node.get('type')=='array':return [visit(x,node['items'],field,field in ARRAY_IDS) for x in v]
        if field in OUTPUT_IDS or id_item:
            return identity_code(v,ctx)
        return pool[v] if isinstance(v,str) and v in pool else copy.deepcopy(v)
    result={'codec':VERSION,'context':ctx.context_digest,'texts':texts,'layout':visit(response,schema)}
    check_contract(result,encoded_schema(schema,ctx))
    return result


def decode_response(payload,schema,ctx):
    check_context(ctx,schema)
    check_contract(payload,encoded_schema(schema,ctx))
    texts=payload['texts']
    if len(set(texts))!=len(texts):raise ValueError('重复值表不能含重复条目')
    for text in texts:scalar_text(text)
    shots={s['key']:s for s in ctx.script['shots']}
    def anchor(v):
        key=identity(v['shotCode'],ctx)
        if key not in shots:raise ValueError('引用编号不是本话镜号')
        text=shots[key].get(v['field'],'')
        scalar_text(text);a,b=v['start'],v['end']
        if type(a) is not int or type(b) is not int or not 0<=a<b<=len(text):raise ValueError('原文范围必须是原字段内非空Unicode码点整数半开区间')
        return {'shotCode':key,'quote':text[a:b]}
    def visit(v,node,field='',id_item=False):
        if field=='sourceAnchors':return [anchor(a) for a in v]
        if node.get('type')=='object':return {k:visit(v[k],n,k) for k,n in node['properties'].items()}
        if node.get('type')=='array':return [visit(x,node['items'],field,field in ARRAY_IDS) for x in v]
        if field in OUTPUT_IDS or id_item:return identity(v,ctx)
        kinds=node.get('type');kinds=[kinds] if isinstance(kinds,str) else kinds
        if kinds and 'string' in kinds and isinstance(v,(int,float)) and not isinstance(v,bool):return texts[index_value(v,len(texts),'重复值')]
        return scalar_text(v) if isinstance(v,str) else copy.deepcopy(v)
    result=visit(payload['layout'],schema)
    check_contract(result,schema)
    return result


def check_context(ctx,schema):
    if digest(ctx.script)!=ctx.bindings['scriptDigest'] or digest(schema)!=ctx.bindings['schemaDigest'] or digest(ctx.allowed)!=ctx.bindings['allowedIdentityDigest']:
        raise ValueError('编码上下文的冻结脚本、schema或身份集合已改变')
    current=digest({'codec':VERSION,'unit':UNIT,'bindings':ctx.bindings,'prefixes':ctx.prefixes,'identities':ctx.rows})
    rows=[row if isinstance(row,str) else ctx.prefixes[index_value(row[0],len(ctx.prefixes),'前缀')]+row[1] for row in ctx.rows]
    if current!=ctx.context_digest or rows!=ctx.identities or len(set(rows))!=len(rows) or not set(rows).issubset(ctx.allowed):
        raise ValueError('编码编号表或上下文摘要已改变')
