"""Run frozen learned projects through their original, complete layout engine."""
import copy
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent / 'engine'

def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))

def native_modules():
    engine = str(ENGINE)
    if engine not in sys.path:
        sys.path.insert(0, engine)
    from layout_engine.core import validate_geometry, digest
    from layout_engine.dialogue import apply_dialogue_rules
    return validate_geometry, digest, apply_dialogue_rules

def snapshot(root, script):
    contract = script['layoutRuleContract']
    key, version = contract['id'], contract['version']
    if not re.fullmatch(r'[\w-]{1,80}', key) or not re.fullmatch(r'[\w-]{1,120}', version):
        raise ValueError('学习规则路径无效')
    folder = Path(os.environ.get('AUTO_LAYOUT_LIBRARY_DIR',str(Path(root).parent/'library'))) / key / 'versions' / version / 'data'
    manifest = read(folder / 'manifest.json')
    for relative, expected in manifest['files'].items():
        file = (folder / relative).resolve()
        if not file.is_relative_to(folder.resolve()) or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise ValueError('原助手冻结学习资料校验失败：' + relative)
    for source in contract['sources']:
        file = folder / source['name']
        if source['name'] not in ('learning-profile.json', 'learned-style.json') or hashlib.sha256(file.read_bytes()).hexdigest() != source['sha256']:
            raise ValueError('所选学习规则与原助手版本不一致')
    _, digest, apply_dialogue_rules = native_modules()
    rules = read(folder / 'dialogue-layout-rules.json')
    plan = rules.get('projects', {}).get(script['projectId'], {}).get('plans', {}).get(script['id'])
    if plan and plan['scriptContentDigest'] != digest(script['shots']):
        original = folder / 'approved-scripts' / (script['id'] + '.json')
        if not original.exists():
            raise ValueError('已确认信息段落的原脚本不在学习包中')
        fields = ['code','description','dialogue','shotSize','cameraAngle','location','time','weather','note','sfx']
        semantic = lambda shots: [{**{k:str(s.get(k,'')) for k in fields},'cast':str(s.get('characters',s.get('participants','')))} for s in shots]
        if semantic(script['shots']) != semantic(read(original)['shots']):
            raise ValueError('脚本内容已变化，不能沿用旧信息段落')
        plan['scriptContentDigest'] = digest(script['shots'])
    profile = apply_dialogue_rules(script, read(folder / 'learning-profile.json'), rules)
    return folder, profile

def validate_complete(root, packet, script):
    data, profile = snapshot(root, script)
    validate_geometry, _, _ = native_modules()
    from layout_engine.final_contract import collect_check, raise_issues, final_packet_errors, learned_metadata_errors
    issues = learned_metadata_errors(packet, script, profile)
    collect_check(issues, 'final_contract', lambda: raise_issues(final_packet_errors(packet, script, profile)))
    native_script = copy.deepcopy(script)
    native_script.pop('layoutRuleContract', None)
    native_packet = copy.deepcopy(packet)
    native_packet['profileVersion'] = profile['version']
    collect_check(issues, 'native_complete', lambda: validate_geometry(native_packet, native_script))
    raise_issues(issues)
    if packet.get('generator',{}).get('mode')=='native-style-rules':
        from native_style_layout import style_book,validate_native_result
        from execution_policy import native_book_path
        book=style_book(native_book_path(root,packet['generator'].get('styleBookVersion')))
        specific=data/f"palette-evidence-{script['id']}.json"
        evidence=read(specific if specific.exists() else data/'palette-evidence.json')
        if str(evidence.get('episode'))!=str(script['episode']):evidence={'projectId':script['projectId'],'episode':script['episode'],'examples':[],'specialFlashbackKeys':[]}
        _,digest,_=native_modules();evidence['scriptContentDigest']=digest(script['shots'])
        validate_native_result(packet,script,profile,book,evidence=evidence)
    return True


def subprocess_failure_detail(folder):
    """Expose the actual validation reason, without dumping a traceback in UI."""
    folder=Path(folder)
    stderr=(folder/'native.stderr.log').read_text(encoding='utf-8',errors='replace')
    for line in reversed(stderr.splitlines()):
        match=re.match(r'^(?:ValueError|RuntimeError|AssertionError|TypeError|KeyError):\s*(.+)',line)
        if match:return match.group(1)[:1200]
    stdout=(folder/'native.stdout.log').read_text(encoding='utf-8',errors='replace').strip()
    return stdout[-1200:] or '执行进程异常退出，详细日志已保留。'


def generate(root, script, folder, effort):
    folder = Path(folder)
    native_modules()
    from layout_engine.phase_timing import PhaseTimings
    from layout_engine.final_contract import bind_learned_packet
    from layout_engine.value_wire import VERSION as VALUE_ENCODING
    timer = PhaseTimings(folder/'bridge-timing.json')
    try:
        with timer.phase('preparation'):
            data, profile = snapshot(root, script)
            from execution_policy import native_execution,native_book_path
            execution=native_execution(root)
            native=execution['enabled'] and script['projectId'] in execution['projects']
            entry='native_style_agent.py' if native else 'layout_agent.py'
            style_args=['--styles',str(native_book_path(root,execution['styleBookVersion']))] if native else []
            request = folder / 'native-request.json'
            request.write_text(json.dumps({'script': script, 'reasoningEffort': effort, 'responseEncoding': VALUE_ENCODING}, ensure_ascii=False), encoding='utf-8')
            output = folder / 'native-engine'
            output.mkdir()
        with timer.phase('native_subprocess', detailFile='native-engine/timing.json'):
            with (folder / 'native.stdout.log').open('w', encoding='utf-8') as stdout, (folder / 'native.stderr.log').open('w', encoding='utf-8') as stderr:
                result = subprocess.run([sys.executable, str(ENGINE / entry), '--data', str(data), '--input', str(request), '--out', str(output), *style_args],
                    stdout=stdout, stderr=stderr, creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
            if result.returncode:
                raise ValueError('排版校验未通过，当前画布已保留：' + subprocess_failure_detail(folder))
        with timer.phase('output_parse_and_bind'):
            packet = read(output/'geometry.json') if native else bind_learned_packet(read(output/'geometry.json'), script, profile)
        with timer.phase('bridge_final_validation'):
            validate_complete(root, packet, script)
        timer.finish('done')
        return packet
    except BaseException as exc:
        timer.finish('failed', error=str(exc))
        raise
