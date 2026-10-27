"""Lossless JSON field-name transport. No layout or narrative decisions are made here."""
import copy,json

def aliases(schema):
    names=set()
    def visit(node):
        if not isinstance(node,dict):return
        for key,value in node.get('properties',{}).items():names.add(key);visit(value)
        visit(node.get('items'))
    visit(schema)
    keep={'key','role','x','y','w','h','height','quote'}
    def code(index):
        out=''
        while True:
            out=chr(97+index%26)+out;index=index//26-1
            if index<0:return out
    available=(code(i) for i in range(10000));result={}
    for name in sorted(names):
        if name in keep:result[name]=name;continue
        short=next(available)
        while short in keep:short=next(available)
        result[name]=short
    return result

def wire_schema(schema):
    table=aliases(schema)
    def visit(node):
        out=copy.deepcopy(node)
        if 'properties' in node:
            out['properties']={table[k]:{**visit(v),'description':k+((': '+v['description']) if v.get('description') else '')} for k,v in node['properties'].items()}
            out['required']=[table[k] for k in node['required']]
        if 'items' in node:out['items']=visit(node['items'])
        return out
    return visit(schema)

def transform(value,schema,decode=False):
    table=aliases(schema)
    def visit(v,node):
        if node.get('type')=='object':
            if not isinstance(v,dict):raise ValueError('输出对象类型无效')
            props=node['properties'];expected={table[k] if decode else k for k in props}
            if set(v)!=expected:raise ValueError('输出字段缺失或多余，不能无损还原')
            return {(k if decode else table[k]):visit(v[table[k] if decode else k],sub) for k,sub in props.items()}
        if node.get('type')=='array':
            if not isinstance(v,list):raise ValueError('输出数组类型无效')
            return [visit(item,node['items']) for item in v]
        return copy.deepcopy(v)
    return visit(value,schema)

def encode_wire(value,schema):return transform(value,schema)
def decode_wire(value,schema):return transform(value,schema,True)

def compact_json_payloads(prompt):
    """Move fixed evidence before the changing script; minify JSON without changing values."""
    markers=('固定输入脚本：\n','\n本次参考关系和偏好：\n','\n新归纳的组合样式：\n')
    if not all(marker in prompt for marker in markers):return prompt
    head,tail=prompt.split(markers[0],1);decoder=json.JSONDecoder()
    script,end=decoder.raw_decode(tail);tail=tail[end:]
    if not tail.startswith(markers[1]):raise ValueError('参考规则边界不符')
    profile,end=decoder.raw_decode(tail[len(markers[1]):]);tail=tail[len(markers[1])+end:]
    if not tail.startswith(markers[2]):raise ValueError('学习样式边界不符')
    style,end=decoder.raw_decode(tail[len(markers[2]):]);suffix=tail[len(markers[2])+end:]
    dump=lambda v:json.dumps(v,ensure_ascii=False,separators=(',',':'),allow_nan=False)
    return head+markers[1]+dump(profile)+markers[2]+dump(style)+suffix+'\n'+markers[0]+dump(script)
