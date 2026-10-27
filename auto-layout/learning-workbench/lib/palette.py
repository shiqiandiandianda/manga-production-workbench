"""Model-only background refinement from explicitly matched reference scenes."""
import copy,json
from pathlib import Path
from .core import digest,validate_geometry
from .model_pipeline import obj,arr,S,BG_SCHEMA,call_codex,save,check_contract

PALETTE_SCHEMA=obj({'backgrounds':arr(BG_SCHEMA),'paletteDecisions':arr(obj({'startKey':S,'endKey':S,'status':{'type':'string','enum':['anchored','episode_reference','script_color','pending']},'referenceFrameIds':arr(S),'reason':S}))})

def matching_examples(packet,evidence,start,end):
    order={p['key']:i for i,p in enumerate(packet['panels'])}
    return [e for e in evidence['examples'] if order[e['targetStartKey']]<=order[start]<=order[end]<=order[e['targetEndKey']]]

def validate_palette_evidence(packet,script,profile,evidence):
    selected={s['id']:s['sourceSha256'] for s in profile['sourceFiles']};keys={p['key'] for p in packet['panels']};shots={s['key']:s for s in script['shots']}
    if evidence['projectId']!=script['projectId'] or str(evidence['episode'])!=str(script['episode']):raise ValueError('色彩参考不属于本话')
    if evidence.get('scriptContentDigest') and evidence['scriptContentDigest']!=digest(script['shots']):raise ValueError('脚本色彩依据对应的正文版本已变化')
    for e in evidence['examples']:
        if e['targetStartKey'] not in keys or e['targetEndKey'] not in keys:raise ValueError('色彩参考目标镜号不匹配')
        if e.get('basisType')=='script_color':
            if not e.get('sourceQuotes'):raise ValueError('脚本色彩依据为空')
            for quote in e['sourceQuotes']:
                if quote['key'] not in shots or not quote['quote'] or quote['quote'] not in str(shots[quote['key']].get(quote['field'],'')):raise ValueError('脚本色彩依据与原文不符')
        elif selected.get(e['referenceId'])!=e['sourceSha256']:raise ValueError('色彩参考不在本次学习集或来源版本不匹配')

def apply_palette_response(packet,script,response,evidence):
    check_contract(response,PALETTE_SCHEMA)
    expected=[(s['startShotCode'],s['endShotCode']) for s in packet['sections']]
    decisions=response['paletteDecisions']
    if [(d['startKey'],d['endKey']) for d in decisions]!=expected:raise ValueError('色彩决策必须覆盖原有剧情段落且同序')
    for d in decisions:
        examples=matching_examples(packet,evidence,d['startKey'],d['endKey'])
        refs={e['referenceId']+':'+f for e in examples if e.get('basisType') not in ('script_color','episode_reference') for f in e['referenceFrameIds']}
        episode_refs={e['referenceId']+':'+f for e in examples if e.get('basisType')=='episode_reference' for f in e['referenceFrameIds']}
        script_colors=[e for e in examples if e.get('basisType')=='script_color']
        if refs:
            if d['status']!='anchored' or not d['referenceFrameIds'] or not set(d['referenceFrameIds']).issubset(refs):raise ValueError('已提供同场景色彩参考的段落仍未使用有效依据')
        elif script_colors:
            if d['status']!='script_color' or d['referenceFrameIds']:raise ValueError('脚本明确颜色应使用原文依据，不能伪造参考画格')
        elif episode_refs:
            if d['status']=='episode_reference':
                if not d['referenceFrameIds'] or not set(d['referenceFrameIds']).issubset(episode_refs):raise ValueError('同话成品色彩推定缺少有效参考框')
            elif d['status']!='pending' or d['referenceFrameIds']:raise ValueError('同话成品未逐镜匹配，不能冒充已核对同场景颜色')
        elif d['status']!='pending' or d['referenceFrameIds']:raise ValueError('缺少对应色彩参考的段落不能伪造主色来源')
        if not d['reason'].strip():raise ValueError('缺少色彩依据说明')
    if not evidence.get('specialFlashbackKeys') and any(str(bg.get(k,'')).lower()=='#000000' for bg in response['backgrounds'] for k in ('color','endColor')):raise ValueError('本话没有特殊回忆依据，不能使用黑底')
    result=copy.deepcopy(packet);result['backgrounds']=copy.deepcopy(response['backgrounds']);result['paletteDecisions']=copy.deepcopy(decisions)
    result['generator'].update(backgrounds='codex-cli-scene-palette',paletteResponseDigest=digest(response))
    validate_geometry(result,script)
    assert result['panels']==packet['panels'] and result['canvas']==packet['canvas'] and result['connections']==packet['connections']
    return result

def refine_backgrounds(packet,script,profile,evidence,data,folder):
    validate_palette_evidence(packet,script,profile,evidence)
    examples=evidence['examples']
    folder=Path(folder);save(folder/'frozen-palette-evidence.json',evidence)
    gaps=[]
    for i,p in enumerate(packet['panels'][1:],1):
        bottom=max(q['y']+q['h'] for q in packet['panels'][:i])
        if p['y']>bottom:gaps.append({'from':packet['panels'][i-1]['key'],'to':p['key'],'top':bottom,'bottom':p['y']})
    prompt=f'''只返回规定JSON，不调用工具或生图。你负责在已完成且通过校验的第{script['episode']}话布局上补充底图颜色与渐变。画格位置、尺寸、顺序、总高度、构图、机位全部固定，禁止修改。你的输出仅含backgrounds与paletteDecisions。
来源范围补充：basisType=episode_reference是当前话的原成品缩览与已核对框清单，不是逐镜一一匹配。可结合当前脚本、原镜顺序、框清单和可见取景定位相应剧情主体颜色；明确说明这是同话原图推定，status=episode_reference并引用实际参考框，不能伪称已核对同场景或精确取色。不取整话缩览的平均色替代各段主色；定位不清的段落用pending。若没有任何适用依据，则明确主色待确认并用中性暂定底。即使附图里有旧黑底，也不能据此认定目标脚本是特殊回忆。
排版风格只参考21—25话。配色依据分为两类：默认basisType的同场景原图局部，或basisType=script_color的本话原脚本明确颜色。所附依据区间完全覆盖某个section时，应使用该依据；没有依据的段落才待确认。同场景参考按画面内部主体/环境色彩设计低饱和衬底，排除标题、辅助线、气泡和外围承载区，不能把参考书房的外围深底直接搬来。script_color必须说明原脚本哪个人物明确穿什么颜色，人物未更衣的连续场景可据人物主色衔接；不能把衣装颜色说成原文未给出的建筑或场景颜色。所有色值是参考配色方案，不声称对本话尚未生成的画面实测。
用户规则：渐变根据漫画主体颜色衔接。黑色代表特殊回忆；当前材料未标明特殊回忆，不能以夜景、阴谋、心声、联想或悬念使用黑底或近黑底。按真实给定的主色关系选择适当衬底，具体色值由你决定；不能继续把有色彩依据的所有段落都置为统一灰白。未知主色使用中性暂定底，reason明确标主色待确认。
paletteDecisions按既有sections的startShotCode/endShotCode逐段同序列出，字段名startKey/endKey。同场景原图依据status=anchored，referenceFrameIds只用该例子的referenceId:frameId；脚本明确色彩依据status=script_color、referenceFrameIds=[]，reason引用原文颜色；无依据段status=pending、referenceFrameIds=[]。每段说明来源，并依照本段内容确定衔接，不改原脚本或画格。
背景x=0、w=1280，连续无缝覆盖0至原height。不同底色之间仅在下列已有正留白做短linear过渡，不与任何画框相交，不为渐变制造新间隙。solid.endColor=null；渐变结束色必须等于下一段起色。背景reason说明对应镜号、原图色彩与渐变依据。
既有布局：\n'''+json.dumps(packet,ensure_ascii=False)+'\n已有正留白：\n'+json.dumps(gaps,ensure_ascii=False)+'\n本轮场景配色依据（不是参考格与原脚本镜号的一一映射）：\n'+json.dumps(evidence,ensure_ascii=False)
    images=[Path(data)/'palette-evidence'/e['image'] for e in examples if e.get('image')]
    if not images:images=[Path(data)/'references'/(s['id']+'-overview.jpg') for s in profile['sourceFiles']]
    for attempt in range(1,3):
        response=call_codex(prompt,PALETTE_SCHEMA,folder/f'palette-{attempt}',images)
        try:
            result=apply_palette_response(packet,script,response,evidence)
            result['generator']['paletteAttempt']=attempt
            return result
        except ValueError as exc:
            save(folder/f'palette-validation-{attempt}.json',{'passed':False,'error':str(exc)})
            prompt+='\n上次色彩响应校验失败，请完整修正，仅输出规定JSON。错误：'+str(exc)+'\n上次响应：'+json.dumps(response,ensure_ascii=False)
    raise ValueError('两次色彩响应未通过检查；保留原格子布局，未伪造配色成功')
