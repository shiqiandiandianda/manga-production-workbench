"""Compact Codex layout decisions, local invariant assembly and bounded patches."""
import argparse
import copy
import hashlib
import json
import re
import time
from pathlib import Path
from layout_engine.core import digest, validate_geometry
from layout_engine.phase_timing import PhaseTimings
from layout_engine.final_contract import (collect_check, raise_issues, final_packet_errors,
    learned_metadata_errors, bind_learned_packet)
from layout_engine.dialogue import apply_dialogue_rules
from layout_engine.repair import normalize_source_anchors
from layout_engine.rhythm import scene_change
from layout_engine.repair_context import build_repair, enforce_patch_scope, enforce_frozen_response
from layout_engine.model_pipeline import (call_codex, layout_schema, layout_prompt,
    packet_from_response, check_contract, save, obj, arr, S)
from layout_engine.wire import wire_schema,encode_wire,decode_wire,compact_json_payloads
from layout_engine.value_wire import (VERSION as VALUE_ENCODING, build_context,
    encoded_schema, encode_prompt, encode_response, decode_response)
from layout_engine.selective_overlap import selective_prompt
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
    if profile.get('policy',{}).get('transportProtocol')=='lossless-short-fields-v1':
        columns=['frameId','role','w','h'];groups={}
        for sample in result['samples']:groups.setdefault(sample['referenceId'],[]).append([sample[k] for k in columns])
        result['samples']={'columns':columns,'byReference':groups}
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
    for compact_shot,source_shot in zip(prompt_script['shots'],script['shots']):
        if source_shot.get('existingArtwork'):compact_shot['existingArtwork']=copy.deepcopy(source_shot['existingArtwork'])
        if source_shot.get('artworkLayout'):compact_shot['artworkLayout']=copy.deepcopy(source_shot['artworkLayout'])
    prompt = layout_prompt(prompt_script, compact, style)
    if script.get('studioSource',{}).get('mode')=='screen-crop-reflow':
        prompt+='\n本次是已有整屏图片裁格后的重新排版。每格已有固定成图，existingArtwork给出真实宽高及摘要；不得生成图片、改变构图、拆格或改写台词。请按本项目学习风格安排框位、间距与背景，并兼顾现有成图比例；下游根据artworkLayout保留当前取景或等比缩放在格内取景，原文件始终完整保留，不生图、不扩图、不拉伸。'
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
    prompt += '\nsourceAnchors对象严格只含shotCode和quote；不得添加key、shotKey、field、sourceField。quote必须来自本镜头description或dialogue的连续原文。少于4字的原台词可整句引用（例如宋玄！），不能截取短片段或仅引用标点。'
    prompt += '\n每个information_reveal的前后两格都必须处于同一已声明dialogueGroup内，包括末格线索揭示。每个information_boundary必须位于两个相邻dialogueGroup之间。此要求只完善元数据，不改变格数与原构图。'
    prompt += '\n本次同时完成底色，不再追加一次调色调用。paletteDecisions按sections起止镜号同序。依据完全覆盖section才可使用；无依据status=pending、referenceFrameIds=[]、中性暂定底、reason写主色待确认。basisType=script_color用script_color且引用脚本原文颜色，不能编参考框；默认同场景参考用anchored；episode_reference是同话原图推定，不是精确映射。纯黑只用于已确认specialFlashbackKeys；本轮为空则禁止黑底。backgrounds覆盖整张画布，不同底色仅在真实正留白渐变，渐变不穿正文格。不得为配色增加留白。'
    prompt += '\n本话色彩来源：' + json.dumps(evidence, ensure_ascii=False, separators=(',', ':'))
    if any(s.get('existingArtwork') for s in script['shots']):
        prompt += '\n已有成图的existingArtwork只记录真实像素与摘要，不得改写。没有artworkLayout时逐格严格保持原图比例。若artworkLayout.framePolicy=fixed，严格满足abs(h-w*artworkLayout.height/artworkLayout.width)<=1px；若为rules，先按当前排版规则设计框位，原图在框内等比缩放取景。cover只改变显示取景，原文件、人物比例不变；preserve保留当前手动取景与框形。禁止拉伸、重生图或扩图。'
    if script.get('layoutRuleContract'):
        prompt += '\n最终接入校验同属本任务：height须为20至1000000的整数，每格w/h至少20；背景最多200段；linear与画格不得有任何正交集。新图h/w须达到冻结合同minimumNewPanelHOverW，已有图仍保持原比例。学习协议叠格以完整connections/overlapDecisions、必要性原文、保护对象及冻结证据校验，不以理由中是否有某个汉字替代。'
    if profile.get('policy',{}).get('overlapNecessityMode')=='selective_v1':
        prompt=selective_prompt(prompt)
    if profile.get('policy',{}).get('transportProtocol')=='lossless-short-fields-v1':
        prompt=compact_json_payloads(prompt)
        prompt+='\n输出协议只压缩字段名：以输出schema每个属性description中的原字段名为语义，全部理由、证据、坐标和决策仍须完整填写。样本表按columns逐列读取，未删任何参考框。保持原有推理质量和逐格审阅。'
    return prompt


PATCH_SCHEMA = obj({'changes': arr(obj({'path': S, 'valueJson': S}))})


def apply_patch(response, patch):
    check_contract(patch, PATCH_SCHEMA)
    result = copy.deepcopy(response)
    allowed_top = {'height', 'sections', 'backgrounds', 'connections', 'mainDecisions', 'framingDecisions', 'overlapDecisions', 'dialogueGroups', 'paletteDecisions'}
    for change in patch['changes']:
        path = change['path']
        if not path.startswith('/') or any(not p or '~' in p for p in path.split('/')[1:]):
            raise ValueError('补丁路径无效：' + path)
        parts = path.split('/')[1:]
        if parts[0] == 'panels':
            if len(parts) != 3 or not parts[1].isdigit() or parts[2] not in {'x', 'y', 'w', 'h', 'role', 'beat', 'placementReason', 'referenceIds'}:
                raise ValueError('补丁禁止更换分镜ID、数量和顺序')
        elif parts[0] not in allowed_top:
            raise ValueError('补丁字段超出排版职责')
        target = result
        for i, part in enumerate(parts[1:], 1):
            parent = parts[i - 1]
            if isinstance(target, list):
                if not parent.isdigit() or int(parent) >= len(target):
                    raise ValueError('补丁数组位置不存在：' + path)
                target = target[int(parent)]
            elif isinstance(target, dict) and parent in target:
                target = target[parent]
            else:
                raise ValueError('补丁父字段不存在：' + path)
        key = parts[-1]
        if isinstance(target, list):
            if not key.isdigit() or int(key) >= len(target):
                raise ValueError('补丁数组位置不存在：' + path)
            key = int(key)
        elif not isinstance(target, dict) or key not in target:
            raise ValueError('补丁不可添加未知字段：' + path)
        def invalid_number(value):
            raise ValueError('补丁不能含非有限数值：' + value)
        target[key] = json.loads(change['valueJson'], parse_constant=invalid_number)
    return result


def validate(response, script, profile, evidence, timer=None):
    # Schema/assembly dependencies gate unsafe traversal; independent checks then collect together.
    check_contract(response, compact_schema(profile))
    expanded = expand_response(response, script)
    packet = packet_from_response(expanded, script, profile, validate=False)
    issues = []
    collect_check(issues, 'palette_evidence', lambda: validate_palette_evidence(packet, script, profile, evidence), timer)
    colored = collect_check(issues, 'palette_decisions', lambda: apply_palette_response(packet, script,
        {'backgrounds': response['backgrounds'], 'paletteDecisions': response['paletteDecisions']}, evidence, validate=False), timer)
    if colored is not None: packet = colored
    collect_check(issues, 'native_complete', lambda: validate_geometry(packet, script), timer)
    if script.get('layoutRuleContract'):
        bound = bind_learned_packet(packet, script, profile)
        issues.extend(learned_metadata_errors(bound, script, profile))
        collect_check(issues, 'final_contract', lambda: raise_issues(final_packet_errors(bound, script, profile)), timer)
    raise_issues(issues)
    assert [[p[k] for k in ('x', 'y', 'w', 'h')] for p in packet['panels']] == [[p[k] for k in ('x', 'y', 'w', 'h')] for p in response['panels']]
    return packet


def generate(request, folder):
    folder = Path(folder).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    timer = PhaseTimings(folder / 'timing.json')
    timer.details.update(modelCalls=0, patchCalls=0, modelSelection='inherited_user_config',
        qualityChecks='complete-original-validator-plus-shared-final-contract', reasoningPreserved=True)
    try:
        with timer.phase('preparation'):
            manifest = read(DATA / 'manifest.json')
            for relative, expected in manifest['files'].items():
                if hashlib.sha256((DATA / relative).read_bytes()).hexdigest() != expected:
                    raise ValueError('学习资料版本校验失败：' + relative)
            script = approved_script(request)
            profile = profile_for(script)
            evidence = palette_for(script)
            prompt = make_prompt(script, profile, evidence)
            base_prompt = prompt
            schema = compact_schema(profile)
            save(folder / 'fixed-script.json', script)
            save(folder / 'frozen-profile.json', profile)
            save(folder / 'palette-evidence.json', evidence)
            images = list(dict.fromkeys(DATA / 'palette-evidence' / e['image'] for e in evidence['examples'] if e.get('image')))
            effort=request.get('reasoningEffort','high')
            if effort not in ('high','inherit'):raise ValueError('排版速度设置无效')
            effort=None if effort=='inherit' else effort
            compressed=profile.get('policy',{}).get('transportProtocol')=='lossless-short-fields-v1'
            value_encoding=request.get('responseEncoding')
            if value_encoding not in (None,VALUE_ENCODING):raise ValueError('未知响应编码版本，未降级或复用旧输出')
            context=None;transport_schema=schema;base_prompt_bytes=len(prompt.encode('utf-8'))
            if value_encoding:
                context=build_context(script,profile,evidence,schema,prompt)
                prompt=encode_prompt(prompt,context)
                transport_schema=encoded_schema(schema,context)
                save(folder/'transport-context.json',{**context.manifest(),'bindings':context.bindings})
            output_schema=wire_schema(transport_schema) if compressed else transport_schema
            timer.details.update(responseEncoding=value_encoding or 'legacy',basePromptBytes=base_prompt_bytes,
                contextBytes=len(json.dumps(context.manifest(),ensure_ascii=False,separators=(',',':')).encode('utf-8')) if context else 0)
            timer.details.update(promptBytes=len(prompt.encode('utf-8')),reasoningEffort=effort or 'inherited',
                transportProtocol=profile.get('policy',{}).get('transportProtocol','original'))
        timer.details['modelCalls'] += 1
        with timer.phase('model_call', call='decision-1', detailFile='decision-1/call-timing.json'):
            response = call_codex(prompt, output_schema, folder / 'decision-1', images,reasoning_effort=effort,**({'stable_context':True} if compressed else {}))
        with timer.phase('output_decode'):
            timer.details['receivedWireResponseBytes']=len(json.dumps(response,ensure_ascii=False,separators=(',',':')).encode('utf-8'))
            if compressed:
                save(folder/'wire-response.json',response)
                response=decode_wire(response,transport_schema)
            if context:
                save(folder/'encoded-response-1.json',response)
                response=decode_response(response,schema,context)
            check_contract(response,schema)
            save(folder / 'compact-response-1.json', response)
            response, normalized = normalize_source_anchors(response, script)
            if normalized:save(folder / 'metadata-normalization.json', normalized)
        last_patch_error = None
        for attempt in range(3):
            try:
                with timer.phase('validation_pass', attempt=attempt+1):
                    packet = validate(response, script, profile, evidence, timer)
                save(folder / f'validation-{attempt + 1}.json', {'passed': True, 'issues': []})
                break
            except (ValueError, KeyError, IndexError, TypeError) as exc:
                save(folder / f'validation-{attempt + 1}.json', {'error': str(exc), 'issues': getattr(exc,'issues',[{'layer':'schema_or_assembly','message':str(exc)}]), 'passed': False, 'rejectedPatch': last_patch_error})
                if attempt == 2:
                    detail = str(exc) + (('；上一补丁未采用：' + last_patch_error) if last_patch_error else '')
                    raise ValueError('自动修正仍未通过完整校验：' + detail + '；结果和日志已保留，未使用模板替代') from exc
                with timer.phase('patch_preparation', attempt=attempt+1):
                    repair, repair_scope = build_repair(prompt,base_prompt,response,script,profile,schema,exc,
                        compressed=compressed,value_encoding=bool(context),last_patch_error=last_patch_error)
                    save(folder / f'repair-context-{attempt + 1}.json', repair_scope)
                    timer.details.setdefault('repairContexts', []).append({'attempt':attempt+1,'mode':repair_scope['mode'],
                        'reason':repair_scope['fallbackReason'],'fullPromptBytes':repair_scope['fullPromptBytes'],
                        'selectedPromptBytes':repair_scope['selectedPromptBytes']})
                    timer.details['repairInputBytesSaved']=timer.details.get('repairInputBytesSaved',0)+repair_scope['fullPromptBytes']-repair_scope['selectedPromptBytes']
                timer.details['modelCalls'] += 1
                timer.details['patchCalls'] += 1
                with timer.phase('patch_call', attempt=attempt+1, detailFile=f'repair-{attempt+1}/call-timing.json'):
                    patch = call_codex(repair, PATCH_SCHEMA, folder / f'repair-{attempt + 1}',images=images,reasoning_effort=effort,**({'stable_context':True} if compressed else {}))
                with timer.phase('patch_apply', attempt=attempt+1):
                    try:
                        candidate = apply_patch(response, patch)
                        candidate, changes = normalize_source_anchors(candidate, script)
                        check_contract(candidate, schema)
                        enforce_patch_scope(patch, repair_scope, response, candidate)
                        enforce_frozen_response(response, candidate, repair_scope)
                    except (ValueError, KeyError, IndexError, TypeError) as patch_error:
                        last_patch_error = str(patch_error)
                        save(folder / f'rejected-patch-{attempt + 1}.json', {'error':last_patch_error,'originalResponsePreserved':True})
                    else:
                        response = candidate
                        normalized.extend(changes)
                        if normalized:save(folder / 'metadata-normalization.json', normalized)
                        last_patch_error = None
                    save(folder / f'compact-response-{attempt + 2}.json', response)
        with timer.phase('result_write'):
            packet['generator'].update(engine='compact-layout-agent-v1', compactResponseDigest=digest(response), learningSourceRunId=read(DATA / 'learned-style-source.json')['runId'], corrections=attempt,citationMetadataRepairs=len(normalized),learningReferenceIds=[s['id'] for s in profile['sourceFiles']],projectStyleVersion=profile['version'])
            packet['generator']['backgrounds'] = 'codex-cli-integrated-palette'
            if context:packet['generator'].update(responseEncoding=VALUE_ENCODING,transportContextDigest=context.context_digest)
            save(folder / 'geometry.json', packet)
        final_transport=encode_response(response,schema,context) if context else response
        timer.details['wireResponseBytesMeaning']='canonical re-encoding of final decisions; actual first response is receivedWireResponseBytes'
        timer.finish('done', compactResponseBytes=len(json.dumps(response,ensure_ascii=False).encode('utf-8')),
            wireResponseBytes=len(json.dumps(encode_wire(final_transport,transport_schema) if compressed else final_transport,ensure_ascii=False,separators=(',',':')).encode('utf-8')),
            repeatedValueCount=len(final_transport['texts']) if context else 0,
            coordinates='unchanged_from_final_model_decisions')
        return {'ok': True, 'geometryPath': str(folder / 'geometry.json'), 'timing': timer.snapshot()}
    except BaseException as exc:
        timer.finish('failed', error=str(exc))
        raise


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
