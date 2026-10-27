"""Compact Codex layout decisions, local invariant assembly and bounded patches."""
import argparse
import copy
import hashlib
import json
import re
import time
from pathlib import Path
from layout_engine.core import digest, validate_geometry
from layout_engine.dialogue import apply_dialogue_rules
from layout_engine.rhythm import scene_change
from layout_engine.model_pipeline import (call_codex, layout_schema, layout_prompt,
    packet_from_response, check_contract, save, obj, arr, S)
from layout_engine.palette import PALETTE_SCHEMA, apply_palette_response, validate_palette_evidence

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
read = lambda p: json.loads(Path(p).read_text(encoding='utf-8-sig'))


def project_id():
    config = DATA.parent / 'project.json'
    return read(config)['id'] if config.exists() else 'dazhou'


def compact_profile(profile):
    """Retain approved rules and traceable examples; omit duplicated raw metadata."""
    result = {k: copy.deepcopy(profile[k]) for k in ('version', 'referenceEpisodes', 'policy', 'dialoguePlan', 'dialogueLayoutRules') if k in profile}
    result['userPreferences'] = {'confirmed': True}
    result['sourceFiles'] = [{'id': s['id']} for s in profile['sourceFiles']]
    result['samples'] = [{k: s[k] for k in ('referenceId', 'frameId', 'role', 'w', 'h')} for s in profile['samples']]
    selected = []
    for source in profile['sourceFiles']:
        group = [r for r in profile['relationships'] if r['referenceId'] == source['id']]
        for relation in ('separated', 'staggered', 'overlap'):
            selected.extend([r for r in group if r['relation'] == relation][:2])
    result['relationships'] = [{k: r[k] for k in ('id', 'relation', 'gapRatio', 'horizontalShiftRatio', 'intersectionAreaRatioOfSmaller')} for r in selected]
    result['overlapReviewEvidence'] = [{k: e[k] for k in ('id', 'referenceId', 'referenceFrameIds', 'status', 'title', 'observation', 'interpretationBoundary') if k in e} for e in profile.get('overlapReviewEvidence', [])]
    result['supportRuleEvidence'] = [{k: e[k] for k in ('id', 'title', 'observation', 'transferRule')} for e in profile.get('supportRuleEvidence', [])]
    return result


def compact_schema(profile):
    schema = copy.deepcopy(layout_schema(profile))
    drops = {'panels': ['shotCode', 'shape', 'border', 'feather'], 'framingDecisions': ['sourceShotSize'], 'overlapDecisions': ['sourceShotSizes', 'verificationStatus']}
    for field, names in drops.items():
        item = schema['properties'][field]['items']
        for name in names:
            del item['properties'][name]
            item['required'].remove(name)
    schema['properties']['paletteDecisions'] = copy.deepcopy(PALETTE_SCHEMA['properties']['paletteDecisions'])
    schema['required'].append('paletteDecisions')
    return schema


def expand_response(response, script):
    result = copy.deepcopy(response)
    result.pop('paletteDecisions')
    shots = {s['key']: s for s in script['shots']}
    for panel in result['panels']:
        panel.update(shotCode=panel['key'], shape='rectangle', border=2, feather=0)
    for decision in result['framingDecisions']:
        decision['sourceShotSize'] = str(shots[decision['key']].get('shotSize', ''))
    for decision in result['overlapDecisions']:
        decision['sourceShotSizes'] = [str(shots[decision[k]].get('shotSize', '')) for k in ('fromShotCode', 'toShotCode')]
        decision['verificationStatus'] = 'pending_artwork'
    return result


def approved_script(request):
    if 'script' in request:
        script = copy.deepcopy(request['script'])
    else:
        episode = request['episode']
        number = str(episode['number'])
        script = {'id': f'{project_id()}-ep{number}', 'projectId': project_id(), 'episode': number,
            'title': episode.get('title', f'第{number}话'), 'source': request.get('source', {}),
            'shots': [{**s, 'key': f'E{int(number):02d}-P{i:03d}'} for i, s in enumerate(episode['shots'], 1)]}
    if script.get('projectId') != project_id():
        raise ValueError('脚本与所选项目学习库不一致，不能借用其他项目')
    if not script.get('shots') or len({s['key'] for s in script['shots']}) != len(script['shots']):
        raise ValueError('分镜为空或ID重复')
    return script


def profile_for(script):
    profile = read(DATA / 'learning-profile.json')
    if project_id() == 'dazhou' and profile['referenceEpisodes'] != [21, 22, 23, 24, 25] and DATA == ROOT / 'data':
        raise ValueError('学习参考范围不符')
    rules = read(DATA / 'dialogue-layout-rules.json')
    plan = rules.get('projects', {}).get(project_id(), {}).get('plans', {}).get(script['id'])
    if plan and plan['scriptContentDigest'] != digest(script['shots']):
        reference = DATA / 'approved-scripts' / (script['id'] + '.json')
        if not reference.exists():
            raise ValueError('已确认对话方案的原脚本不在本包，不能沿用旧方案')
        original = read(reference)
        fields = ['code', 'description', 'dialogue', 'shotSize', 'cameraAngle', 'location', 'time', 'weather', 'note', 'sfx']
        semantic = lambda shots: [{**{k: str(s.get(k, '')) for k in fields}, 'cast': str(s.get('characters', s.get('participants', '')))} for s in shots]
        if semantic(script['shots']) != semantic(original['shots']):
            raise ValueError('第27话脚本已变更，不能静默沿用旧信息分段')
        plan['scriptContentDigest'] = digest(script['shots'])
    return apply_dialogue_rules(script, profile, rules)


def palette_for(script):
    specific = DATA / f"palette-evidence-{script['id']}.json"
    default = DATA / 'palette-evidence.json'
    evidence = read(specific) if specific.exists() else read(default)
    if str(evidence.get('episode')) != str(script['episode']):
        evidence = {'projectId': project_id(), 'episode': script['episode'], 'examples': [], 'specialFlashbackKeys': []}
    # Rebind only exact raw quotations to the current content fingerprint.
    if evidence.get('scriptContentDigest') != digest(script['shots']):
        keys = {s['key']: s for s in script['shots']}
        for entry in evidence.get('examples', []):
            if entry.get('basisType') == 'script_color':
                if not all(q['key'] in keys and q['quote'] in str(keys[q['key']].get(q['field'], '')) for q in entry.get('sourceQuotes', [])):
                    raise ValueError('原文色彩依据已经变化')
        evidence['scriptContentDigest'] = digest(script['shots'])
    return evidence


def make_prompt(script, profile, evidence):
    compact = compact_profile(profile)
    style = read(DATA / 'learned-style.json')
    style = {**style, 'patterns': [{'name': p['name'], 'referenceIds': p['referenceIds'], 'transferRule': p['transferRule']} for p in style['patterns']]}
    prompt_script = {k: copy.deepcopy(script[k]) for k in ('id', 'projectId', 'episode', 'title')}
    fields = ('key', 'code', 'description', 'dialogue', 'shotSize', 'cameraAngle', 'location', 'time', 'note', 'characters', 'participants')
    prompt_script['shots'] = [{k: s[k] for k in fields if k in s} for s in script['shots']]
    prompt = layout_prompt(prompt_script, compact, style)
    if project_id() != 'dazhou':
        head,body=prompt.split('固定输入脚本：',1)
        references=[s['id'] for s in profile['sourceFiles']]
        head=head.replace('21—25话','本次已选成熟参考').replace('dazhou-ep24:overlap-review-v2-C05',(profile.get('overlapReviewEvidence') or [{'id':references[0]+':实际证据ID'}])[0]['id'])
        for number in range(21,26):head=head.replace('dazhou-ep'+str(number),references[(number-21)%len(references)])
        policy=profile['policy']
        ranges={before:'—'.join(str(v) for v in policy[key]) for before,key in [('64—220','continuationGapRange'),('240—360','beatPauseGapRange'),('400—720','transitionGapRange'),('280—440','informationGapRange'),('360—520','informationRevealGapRange')]}
        head=re.sub('|'.join(re.escape(v) for v in ranges),lambda match:ranges[match.group()],head)
        head=head.replace('不超过180','不超过'+str(policy.get('continuationMedianMaximum',180))).replace('可用80/120/160等变化','在本项目continuationGapRange内按剧情变化')
        if policy.get('mainWidthMode')=='project_reference':
            head=head.replace('main默认x=0、w=1280铺满画布。','main占幅依据本项目参考和当前原构图，不套用其他项目默认满幅。')
            head=head.replace('首格必须满幅。','首格必须是竖幅主格，占幅按本项目参考判断。')
            head=head.replace('只有原脚本确有画面构图限制才能用inset_exception，给出具体对象/关系和满幅为何不成立；','本项目主格可依已学留边风格使用inset_exception，compositionException说明具体参考与本格原构图承载依据；')
        prompt=head+'固定输入脚本：'+body
    transitions = [[a['key'], b['key']] for a, b in zip(script['shots'], script['shots'][1:]) if scene_change(a, b)]
    prompt += '\n紧凑协议优先：所有理由通常18—32个汉字，至少16字；叠格保护对象至少6字。具体指出本镜头内容，避免长篇重复。framingNeeds/aspectReason/scaleReason各用一句。不要复述整句脚本，原构图由程序原样保留。省略的shotCode/shape/border/feather/sourceShotSize/sourceShotSizes/verificationStatus由程序按原文及固定常量补齐，不由模型重写。坐标、尺寸、主副格、段落、衔接、叠角叠深仍全部由模型决定。'
    prompt += '\n当前实现按地点与时段原字段检查，以下相邻对须scene_transition，其他对不得标scene_transition：' + json.dumps(transitions, ensure_ascii=False)
    prompt += '\n每个information_reveal的前后两格都必须处于同一已声明dialogueGroup内，包括末格线索揭示。每个information_boundary必须位于两个相邻dialogueGroup之间。此要求只完善元数据，不改变格数与原构图。'
    prompt += '\n本次同时完成底色，不再追加一次调色调用。paletteDecisions按sections起止镜号同序。依据完全覆盖section才可使用；无依据status=pending、referenceFrameIds=[]、中性暂定底、reason写主色待确认。basisType=script_color用script_color且引用脚本原文颜色，不能编参考框；默认同场景参考用anchored；episode_reference是同话原图推定，不是精确映射。纯黑只用于已确认specialFlashbackKeys；本轮为空则禁止黑底。backgrounds覆盖整张画布，不同底色仅在真实正留白渐变，渐变不穿正文格。不得为配色增加留白。'
    prompt += '\n本话色彩来源：' + json.dumps(evidence, ensure_ascii=False, separators=(',', ':'))
    return prompt


PATCH_SCHEMA = obj({'changes': arr(obj({'path': S, 'valueJson': S}))})


def apply_patch(response, patch):
    check_contract(patch, PATCH_SCHEMA)
    result = copy.deepcopy(response)
    allowed_top = {'height', 'sections', 'backgrounds', 'connections', 'mainDecisions', 'framingDecisions', 'overlapDecisions', 'dialogueGroups', 'paletteDecisions'}
    for change in patch['changes']:
        parts = change['path'].split('/')[1:]
        if not parts or not change['path'].startswith('/'):
            raise ValueError('补丁路径无效')
        if parts[0] == 'panels':
            if len(parts) != 3 or not parts[1].isdigit() or parts[2] not in {'x', 'y', 'w', 'h', 'role', 'beat', 'placementReason', 'referenceIds'}:
                raise ValueError('补丁禁止更换分镜ID、数量和顺序')
        elif parts[0] not in allowed_top:
            raise ValueError('补丁字段超出排版职责')
        target = result
        for part in parts[:-1]:
            target = target[int(part)] if isinstance(target, list) else target[part]
        key = int(parts[-1]) if isinstance(target, list) else parts[-1]
        if isinstance(target, dict) and key not in target:
            raise ValueError('补丁不可添加未知字段')
        target[key] = json.loads(change['valueJson'])
    return result


def validate(response, script, profile, evidence):
    check_contract(response, compact_schema(profile))
    expanded = expand_response(response, script)
    packet = packet_from_response(expanded, script, profile)
    validate_palette_evidence(packet, script, profile, evidence)
    packet = apply_palette_response(packet, script, {'backgrounds': response['backgrounds'], 'paletteDecisions': response['paletteDecisions']}, evidence)
    validate_geometry(packet, script)
    assert [[p[k] for k in ('x', 'y', 'w', 'h')] for p in packet['panels']] == [[p[k] for k in ('x', 'y', 'w', 'h')] for p in response['panels']]
    return packet


def generate(request, folder):
    start = time.monotonic()
    manifest = read(DATA / 'manifest.json')
    for relative, expected in manifest['files'].items():
        if hashlib.sha256((DATA / relative).read_bytes()).hexdigest() != expected:
            raise ValueError('学习资料版本校验失败：' + relative)
    folder = Path(folder).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    script = approved_script(request)
    profile = profile_for(script)
    evidence = palette_for(script)
    prompt = make_prompt(script, profile, evidence)
    schema = compact_schema(profile)
    save(folder / 'fixed-script.json', script)
    save(folder / 'frozen-profile.json', profile)
    save(folder / 'palette-evidence.json', evidence)
    images = [DATA / 'palette-evidence' / e['image'] for e in evidence['examples'] if e.get('image')]
    images = list(dict.fromkeys(images))
    effort=request.get('reasoningEffort','high')
    if effort not in ('high','inherit'):raise ValueError('排版速度设置无效')
    effort=None if effort=='inherit' else effort
    response = call_codex(prompt, schema, folder / 'decision-1', images,reasoning_effort=effort)
    save(folder / 'compact-response-1.json', response)
    for attempt in range(3):
        try:
            packet = validate(response, script, profile, evidence)
            break
        except (ValueError, KeyError, IndexError) as exc:
            save(folder / f'validation-{attempt + 1}.json', {'error': str(exc), 'passed': False})
            if attempt == 2:
                raise ValueError('局部修正仍未通过全部规则，保留失败结果，不使用模板兜底') from exc
            repair = prompt + '\n现有紧凑响应：' + json.dumps(response, ensure_ascii=False, separators=(',', ':'))
            repair += '\n仅修以下校验问题，返回changes补丁，不重写整话；path是JSON指针，valueJson是新值的合法JSON字符串。只replace现有字段；可替换整个dialogueGroups等元数据数组，禁止替换panels数组、key、数量或顺序。相关坐标需要联动时逐字段列出，每处仍由你决定。错误：' + str(exc)
            patch = call_codex(repair, PATCH_SCHEMA, folder / f'repair-{attempt + 1}',reasoning_effort=effort)
            response = apply_patch(response, patch)
            save(folder / f'compact-response-{attempt + 2}.json', response)
    packet['generator'].update(engine='compact-layout-agent-v1', compactResponseDigest=digest(response), learningSourceRunId=read(DATA / 'learned-style-source.json')['runId'], corrections=attempt,learningReferenceIds=[s['id'] for s in profile['sourceFiles']],projectStyleVersion=profile['version'])
    packet['generator']['backgrounds'] = 'codex-cli-integrated-palette'
    save(folder / 'geometry.json', packet)
    timing = {'elapsedSeconds': round(time.monotonic() - start, 3), 'patchCalls': attempt,
        'modelCalls': attempt + 1, 'promptBytes': len(prompt.encode('utf-8')),
        'compactResponseBytes': len(json.dumps(response, ensure_ascii=False).encode('utf-8')),
        'modelSelection': 'inherited_user_config', 'reasoningEffort':effort or 'inherited','coordinates': 'unchanged_from_final_model_decisions'}
    save(folder / 'timing.json', timing)
    return {'ok': True, 'geometryPath': str(folder / 'geometry.json'), 'timing': timing}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--data', help='已选项目不可变学习版本的数据目录')
    args = parser.parse_args()
    if args.data:DATA = Path(args.data).resolve()
    try:
        result = generate(read(args.input), args.out)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False))
        raise SystemExit(1)
