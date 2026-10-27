"""Final integration constraints shared by first-pass, patch and outer validation.

Structured overlap acceptance is available only with the frozen learned profile;
the caller must also run learned_metadata_errors and the full native validator.
"""
from artwork_framing import frame_artwork
import copy
import math
import re
from .core import digest


class ValidationIssues(ValueError):
    def __init__(self, issues):
        self.issues = issues
        super().__init__('；'.join(dict.fromkeys(i['message'] for i in issues)))


def collect_check(issues, layer, action, timer=None):
    def run():
        try:
            return action()
        except (ValueError, KeyError, IndexError, TypeError, ZeroDivisionError) as exc:
            if isinstance(exc, ValidationIssues):
                issues.extend(exc.issues)
            else:
                issues.append({'layer': layer, 'message': str(exc)})
    if timer is None:
        return run()
    with timer.phase('validation', layer=layer) as entry:
        before = len(issues)
        result = run()
        entry['passed'] = len(issues) == before
        return result


def raise_issues(issues):
    if issues:
        raise ValidationIssues(issues)


def contract_for(script):
    c = script.get('layoutRuleContract')
    if not isinstance(c, dict) or c.get('format') != 'comic-unified-layout-rules' or c.get('contractVersion') != 1:
        raise ValueError('缺少统一排版规则')
    value = copy.deepcopy(c)
    expected = value.pop('digest', None)
    if digest(value) != expected:
        raise ValueError('统一排版规则摘要不符')
    return c


def bind_learned_packet(packet, script, profile):
    result = copy.deepcopy(packet)
    c = contract_for(script)
    result['profileVersion'] = c['version']
    result['layoutRuleDigest'] = c['digest']
    result['generator'].update(engine='unified-rule-layout-v2-native', ruleName=c['name'],
        ruleId=c['id'], ruleDigest=c['digest'], nativeProfileVersion=profile['version'],
        completeLearnedRules=True, overlapVerification='pending-artwork-review')
    return result


def learned_metadata_errors(packet, script, profile):
    errors = []
    required = ['sections','connections','mainDecisions','framingDecisions','overlapDecisions']
    if profile.get('policy',{}).get('dialogueMode') == 'information_paragraphs_v1': required.append('dialogueGroups')
    if any(k not in packet for k in required): errors.append('旧接入版缺少原助手完整学习规则校验元数据；旧结果保留')
    if packet.get('rhythmPolicy') != profile['policy']: errors.append('排版节奏政策与原助手冻结学习规则不一致')
    g = packet.get('generator',{})
    if g.get('mode') not in ('model-generated','native-style-rules') or g.get('rhythmVersion') != 'relationships-v1': errors.append('缺少原助手完整排版流程与节奏校验标记')
    if g.get('mode')=='native-style-rules' and (g.get('engine')!='dazhou-native-style-v1' or g.get('provider')!='local-native-styles' or g.get('modelCalls')!=0 or g.get('coordinates')!='local-native-style-geometry'):
        errors.append('固有款式排版缺少明确的本地执行来源')
    allowed = {r['id'] for r in profile['relationships']} | {e['id'] for e in profile.get('overlapReviewEvidence',[])}
    if packet.get('learningRelationshipIds') != sorted(allowed): errors.append('排版引用的学习证据与冻结版本不一致')
    if packet.get('learningOverlapEvidence') != profile.get('overlapReviewEvidence',[]): errors.append('叠格学习证据与冻结版本不一致')
    if profile.get('policy',{}).get('dialogueMode') == 'information_paragraphs_v1' and packet.get('dialoguePlan') != profile.get('dialoguePlan',{}): errors.append('信息段落未沿用原助手已确认方案')
    return [{'layer':'learned_metadata','message':e} for e in errors]


def final_packet_errors(packet, script, profile=None):
    user_constraints=None
    if packet.get('nativeUserConstraints') is not None or packet.get('generator',{}).get('mode')=='native-style-rules':
        from native_user_constraints import trusted_constraints
        user_constraints=trusted_constraints(packet)
    c = contract_for(script)
    issues = []
    def error(message): issues.append({'layer':'final_contract','message':message})
    from native_user_constraints import dimension_errors
    for message in dimension_errors(packet,script,user_constraints):error(message)
    def number(v): return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
    shots = script['shots']; keys = [s['key'] for s in shots]; panels = packet.get('panels',[])
    if not isinstance(panels,list) or any(not isinstance(p,dict) for p in panels):
        error('画格应为对象数组'); return issues
    if packet.get('format') != 'comic-layout-geometry' or packet.get('version') != 1 or packet.get('sourcePanelKeys') != keys or [p.get('key') for p in panels] != keys or len(set(keys)) != len(keys): error('格号、数量或阅读顺序改变')
    if packet.get('scriptContentDigest') != digest(shots) or packet.get('source') != script['source']: error('来源分镜版本已改变')
    if packet.get('layoutRuleDigest') != c['digest'] or packet.get('profileVersion') != c['version']: error('前后排版规则版本不一致')
    canvas = packet.get('canvas',{}); height = canvas.get('height')
    height_ok = type(height) is int and 20 <= height <= 1000000
    if canvas.get('width') != 1280 or not height_ok: error('画布无效：须1280宽，高度为20至1000000的整数')
    learned = c.get('kind') == 'learned-project'
    structured = learned and profile is not None and profile.get('policy',{}).get('overlapDecisionMode') == 'story_framing_composition_v2'
    if learned and profile is None: error('缺少已校验的冻结学习资料，不能接受学习协议叠格')
    valid_panels = []
    previous = -1
    for i,p in enumerate(panels):
        if i >= len(shots): break
        s = shots[i]; label = s['key']
        if p.get('sourceShotCode') != str(s['code']) or p.get('readingOrder') != i+1 or p.get('shape') != 'rectangle' or p.get('role') not in ('main','support'): error(label+'画格身份或类型改变')
        if any(not number(p.get(k)) for k in ('x','y','w','h','border','feather')):
            error(label+'非有限画格坐标'); continue
        x,y,w,h = [p[k] for k in ('x','y','w','h')]
        if min(x,y)<0 or min(w,h)<20 or x+w>1280.01 or height_ok and y+h>height+.01 or y<=previous or p['border']<0 or p['feather']<0: error(label+'画格越界、边长不足20或阅读位置倒序')
        previous=y
        art = frame_artwork(s)
        if art:
            aw,ah=art.get('width'),art.get('height')
            if not all(number(n) and n>0 for n in (aw,ah)): error(label+'已有裁图尺寸无效')
            elif abs(h-w*ah/aw)>1.01: error(label+'必须保持已有图片原比例')
        elif w>0 and h/w<(user_constraints['minimumHOverW'] if user_constraints else c['rules']['minimumNewPanelHOverW'])-1e-6: error(label+'新格型不符合所选规则的竖幅底线')
        for j,q in valid_panels:
            if min(x+w,q['x']+q['w'])>max(x,q['x']) and min(y+h,q['y']+q['h'])>max(y,q['y']):
                if j != i-1: error(label+'叠到非相邻画格，其他交叠请分离')
                elif not structured:
                    reason=p.get('placementReason','')
                    if not isinstance(reason,str) or '叠' not in reason or len(reason)<16: error(label+'旧协议仅允许相邻画格有明确叠格目的的交叠，须写明保护内容')
                # Learned overlaps are accepted only by the complete native checks:
                # connection, corner/depth, protection, necessity, exact quotes and frozen evidence.
        valid_panels.append((i,p))
    end=0; bgs=packet.get('backgrounds',[])
    if not isinstance(bgs,list) or not bgs or len(bgs)>200:
        error('背景分段无效'); return issues
    for i,bg in enumerate(bgs):
        label='背景'+str(i+1)
        if not isinstance(bg,dict) or any(not number(bg.get(k)) for k in ('x','y','w','h')):
            error(label+'坐标无效'); continue
        if bg['x']!=0 or bg['w']!=1280 or abs(bg['y']-end)>.01 or bg['h']<=0: error(label+'未连续覆盖画布')
        if not re.fullmatch(r'#[0-9a-fA-F]{6}',str(bg.get('color'))) or bg.get('mode') not in ('solid','linear'): error(label+'底色无效')
        if bg.get('mode')=='solid' and bg.get('endColor') is not None: error(label+'纯色结束色应为空')
        if bg.get('mode')=='linear':
            if not re.fullmatch(r'#[0-9a-fA-F]{6}',str(bg.get('endColor'))): error(label+'渐变色无效')
            if any(min(bg['y']+bg['h'],p['y']+p['h'])>max(bg['y'],p['y']) for _,p in valid_panels): error(label+'渐变不得穿过画格')
        end=bg['y']+bg['h']
    if number(height) and abs(end-height)>.01: error('背景高度不符')
    return issues
