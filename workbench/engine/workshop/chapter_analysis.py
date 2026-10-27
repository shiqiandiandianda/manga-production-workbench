"""Source chapters, stable appearance bindings and live asset requirements.

This module performs no model calls, image generation or persistence. Only the
registration/merge functions mutate their explicitly supplied project object.
"""
from __future__ import annotations

import copy
import hashlib
from pathlib import Path
import re
import time
from urllib.parse import unquote, urlsplit
from uuid import uuid4
from life_stages import (PERIODS, AGE_STAGES, ensure_appearance_profiles, bind_source_profiles, get_profile, profile_character)

BASIS = ('source', 'inference', 'production_design', 'authorized_adaptation')
APPEARANCE_TYPES = ('onscreen', 'offscreen', 'memory', 'mentioned_only', 'system', 'narration')
STATUS_LABELS = {'ready': '已就绪', 'existing_needs_work': '已有素材待完善',
                 'definition_only': '已登记待制作', 'unregistered': '未登记', 'candidate': '候选待确认'}
GENERIC_NAMES = {'他', '她', '他们', '她们', '哥', '哥哥', '老哥', '妹妹', '爹', '娘',
                 '父亲', '母亲', '男子', '女子', '少年', '少女', '男人', '女人', '大人',
                 '村民', '山匪', '路人', '老者', '村长', '黑衣人', '青衣男子'}


def _object(properties):
    return {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}


def _array(items):
    return {'type': 'array', 'items': items}


STRING = {'type': 'string'}
EVIDENCE_SCHEMA = _object({'paragraphId': STRING, 'quote': STRING,
                          'claimType': {'type': 'string', 'enum': ['literal', 'character_guess', 'reported', 'rumor', 'metaphor']}})
FACE_CONTINUITY_SCHEMA = _object({'status':{'type':'string','enum':['same','different','age_related','unknown']},
    'basis':{'type':'string','enum':list(BASIS)},'sourceProfileId':STRING,
    'evidence':{**_array(EVIDENCE_SCHEMA),'maxItems':2}})
HAIRSTYLE_SCHEMA = _object({'era':{'type':'string','enum':['ancient','modern','future','unspecified']},
    'gender':{'type':'string','enum':['男','女','通用','未说明']},'ageStage':{'type':'string','enum':list(AGE_STAGES)},
    'sourceDescription':{'type':'string','maxLength':120},'sourceEvidence':{**_array(EVIDENCE_SCHEMA),'maxItems':2},
    'designDescription':{'type':'string','maxLength':120},'designBasis':{'type':'string','enum':list(BASIS)}})
APPEARANCE_SCHEMA = _object({'characterName': STRING, 'outfitName': STRING,
    'appearanceType': {'type': 'string', 'enum': list(APPEARANCE_TYPES)},
    'period': {'type':'string','enum':list(PERIODS)}, 'ageStage': {'type':'string','enum':list(AGE_STAGES)}, 'ageText': STRING,
    'faceContinuity':FACE_CONTINUITY_SCHEMA,'hairstyle':HAIRSTYLE_SCHEMA,
    'states': _array(STRING), 'presentationNotes': _array(STRING), 'basis': {'type': 'string', 'enum': list(BASIS)},
    'evidence': {**_array(EVIDENCE_SCHEMA), 'maxItems': 2}})
SEGMENT_SCHEMA = _object({'id': STRING, 'title': {'type': 'string', 'maxLength': 40}, 'location': STRING, 'time': STRING,
    'summary': {'type': 'string', 'maxLength': 120}, 'sourceParagraphIds': _array(STRING), 'appearances': _array(APPEARANCE_SCHEMA)})
CHAPTER_SCHEMA = _object({'chapter': {'type': 'integer'}, 'title': STRING, 'summary': STRING,
    'segments': _array(SEGMENT_SCHEMA), 'mentions': _array(_object({'name': STRING, 'description': {'type': 'string', 'maxLength': 100},
    'basis': {'type': 'string', 'enum': list(BASIS)}, 'evidence': {**_array(EVIDENCE_SCHEMA), 'maxItems': 2}}))})
ANALYSIS_SCHEMA = _object({
    'recommendation': _object({'style': {'type': 'string', 'enum': ['国漫', '日漫', '韩漫', '美漫']}, 'reason': STRING}),
    'characters': _array(_object({'name': STRING, 'category': {'type': 'string', 'enum': ['主角', '配角', '群像']},
        'description': {'type': 'string', 'maxLength': 150}, 'aliases': _array(STRING), 'episodes': _array({'type': 'integer'}),
        'evidence': {'type': 'string', 'maxLength': 160},
        'outfits': _array(_object({'name': STRING, 'description': {'type': 'string', 'maxLength': 120},
                                 'episodes': _array({'type': 'integer'})}))})),
    'analysis': _object({'chapters': _array(CHAPTER_SCHEMA), 'warnings': _array(STRING)}),
    'warnings': _array(STRING)
})


def _number(value):
    try:
        result = int(value)
        return result if result > 0 else None
    except (ValueError, TypeError):
        return None


def _chinese_number(value):
    if str(value).isdigit():
        return int(value)
    digits = dict(zip('零〇一二两三四五六七八九', [0, 0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9]))
    total = current = 0
    for ch in value:
        if ch in digits:
            current = digits[ch]
        elif ch in '十百千':
            total += (current or 1) * {'十': 10, '百': 100, '千': 1000}[ch]
            current = 0
        else:
            return None
    return total + current


def selected_chapters(project, episodes=None):
    """Read only the chosen chapter bodies; prefer reader-provided structure."""
    start, end = _number(project.get('rangeStart')) or 1, _number(project.get('rangeEnd')) or 20
    wanted = {_number(x) for x in episodes} if episodes else None
    supplied = project.get('chapters') or project.get('chapterContents') or []
    if isinstance(supplied, dict):
        supplied = list(supplied.values())
    structured = [x for x in supplied if isinstance(x, dict) and isinstance(x.get('text'), str)]
    if structured:
        result = []
        for entry in structured:
            number = _number(entry.get('chapter', entry.get('number')))
            if number is not None and start <= number <= end and (wanted is None or number in wanted):
                item = copy.deepcopy(entry)
                item['chapter'] = number
                item.setdefault('title', f'第{number}章')
                item.setdefault('paragraphs', _paragraphs(item['text'], number, item['title']))
                result.append(item)
        if not result:
            raise ValueError('剧本中没有找到所选章节，请检查范围或章号')
        return sorted(result, key=lambda x: x['chapter'])
    text = project.get('script') or ''
    pattern = r'(?m)^\s*(?:#{1,6}[ \t]*)?(?:第\s*([0-9零〇一二两三四五六七八九十百千]+)\s*[话集章回]|(?:EP|Episode)\s*(\d+)\b)[^\n]*'
    headers = list(re.finditer(pattern, text, re.I))
    if not headers:
        if not text.strip():
            raise ValueError('请先导入可读取的剧本文字')
        return [{'chapter': start, 'title': '未识别章号的选定文本', 'text': text,
                 'rangeUnverified': True, 'paragraphs': _paragraphs(text, start, '')}]
    result = []
    for index, match in enumerate(headers):
        number = _chinese_number(match.group(1) or match.group(2))
        if number is not None and start <= number <= end and (wanted is None or number in wanted):
            body = text[match.start():headers[index + 1].start() if index + 1 < len(headers) else len(text)]
            title = match.group(0).strip()
            result.append({'chapter': number, 'title': title, 'text': body, 'paragraphs': _paragraphs(body, number, title)})
    if not result:
        raise ValueError('剧本中没有找到所选章节，请检查范围或章号')
    return result


def _paragraphs(text, number, title):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if lines and title and lines[0] == title:
        lines = lines[1:]
    return [{'id': f'C{number:02d}-P{i:03d}', 'index': i, 'text': line}
            for i, line in enumerate(lines, 1)]


def chapter_fingerprint(chapter):
    payload = (chapter.get('chapter'), chapter.get('sourceId'), chapter.get('sourceHash'), chapter.get('member'),
               chapter.get('text'), [(p.get('id'), p.get('text')) for p in chapter.get('paragraphs', [])])
    return hashlib.sha256(repr(payload).encode('utf-8')).hexdigest()


def outfit_version_notes(outfit):
    """A compact reminder of version conditions, never the full history."""
    rows = outfit.get('sourceDescriptionHistory', [])
    prohibition = re.compile(r'(?:不能|不得|禁止|不许|不可|不穿|非).{0,8}(?:官服|制服|礼服|盔甲|铠甲)')
    positive = re.compile(r'玄衣卫袍服|官服|制服|礼服|夜行衣|练功服|婚服|睡衣')
    first_negative = None
    last_positive = None
    if outfit.get('sourceAppearance') == 'unreferenced':
        return []
    active_chapters = set(outfit.get('episodes', []))
    for row in rows:
        if active_chapters and row.get('chapter') not in active_chapters:
            continue
        description = str(row.get('description') or '')
        negative = prohibition.search(description)
        if negative:
            if first_negative is None:
                first_negative = {'chapter': row.get('chapter'), 'condition': negative.group()}
        elif positive.search(description):
            last_positive = {'chapter': row.get('chapter'), 'condition': description[:80]}
    return [x for x in (first_negative, last_positive) if x]


def _next_id(project, kind):
    prefix = project.setdefault('teamProjectPrefix', 'BOOK' + hashlib.sha256(
        str(project.get('id') or project.get('name') or 'local-project').encode()).hexdigest()[:6].upper())
    counters = project.setdefault('teamIdCounters', {})
    existing = set()
    for char in project.get('characters', []):
        existing.update(str(char.get(key) or '') for key in ('identityEntityId', 'teamAssetId', 'teamStateId'))
        for profile in char.get('appearanceProfiles', []):
            existing.update(str(profile.get(key) or '') for key in ('teamAssetId','teamStateId'))
        for outfit in char.get('outfits', []):
            existing.update(str(outfit.get(key) or '') for key in ('teamAssetId', 'teamStateId'))
    existing.update(str(x.get('id') or '') for x in project.get('teamAssetStates', []))
    for chapter in project.get('chapterAnalysis', {}).get('chapters', []):
        existing.update(str(x.get('id') or '') for x in chapter.get('segments', []))
    number = int(counters.get(kind, 0)) + 1
    while f'{prefix}-{kind}{number:04d}' in existing:
        number += 1
    counters[kind] = number
    return f'{prefix}-{kind}{number:04d}'


def register_project_ids(project):
    """Assign stable team IDs without replacing any established app IDs/artwork."""
    ensure_appearance_profiles(project)
    for char in project.get('characters', []):
        char.setdefault('id', uuid4().hex)
        char['identityNames'] = sorted(set(char.get('identityNames', [])) | {str(char.get('name') or '')})
        if not char.get('identityEntityId'):
            char['identityEntityId'] = _next_id(project, 'CH')
        if not char.get('teamAssetId'):
            char['teamAssetId'] = _next_id(project, 'A')
        if not char.get('teamStateId'):
            char['teamStateId'] = _next_id(project, 'ST')
        char['assetKind'] = 'crowd' if char.get('category') == '群像' else 'character'
        for profile in char.get('appearanceProfiles', []):
            profile['identityEntityId'] = char['identityEntityId']
            profile['assetKind'] = char['assetKind']
            if profile['id'] == char.get('defaultAppearanceProfileId'):
                profile['teamAssetId'], profile['teamStateId'] = char['teamAssetId'], char['teamStateId']
            else:
                if not profile.get('teamAssetId'): profile['teamAssetId'] = _next_id(project,'A')
                if not profile.get('teamStateId'): profile['teamStateId'] = _next_id(project,'ST')
        for outfit in char.get('outfits', []):
            outfit.setdefault('id', uuid4().hex)
            outfit['identityNames'] = sorted(set(outfit.get('identityNames', [])) | {str(outfit.get('name') or '')})
            if not outfit.get('teamAssetId'):
                outfit['teamAssetId'] = _next_id(project, 'A')
            if not outfit.get('teamStateId'):
                outfit['teamStateId'] = _next_id(project, 'ST')
            outfit.setdefault('assetKind', 'costume')
            outfit.setdefault('identityEntityId', char['identityEntityId'])
    from appearance_identity import refresh_visual_identity
    refresh_visual_identity(project)
    return project


def _names(character):
    return {str(x).strip() for x in [character.get('name'), *character.get('aliases', []), *character.get('identityNames', [])] if x}


def _state_parts(appearance):
    """Conservatively separate physical appearance changes from frame acting.

    Retain all old wording in notes. Only explicit age/body/clothing changes get
    reusable ST records; sitting, reading, smiling and holding props never do.
    """
    raw = [str(x).strip() for x in appearance.get('states', []) if str(x).strip()]
    raw.extend(str(x).strip() for x in appearance.get('materialStates', []) if str(x).strip())
    raw = list(dict.fromkeys(raw))
    notes = [str(x).strip() for x in appearance.get('presentationNotes', []) if str(x).strip()]
    materials = []
    physical = re.compile(r'受伤|伤势|伤口|骨折|断臂|断腿|疤痕|流血|出血|血迹|染血|沾血|带血|血污|'
        r'(?:衣服|衣物|衣衫|袖口|披风|手套).{0,12}(?:破损|撕破|撕裂|被撕扯|湿透|浸湿|淋湿)|'
        r'沾灰|灰尘|泥污|污渍|绷带|包扎|发髻散开|头发散开|发髻松散|'
        r'换装|换穿|改穿|脱下.{0,10}(?:衣|服|袍|披风|手套)|'
        r'(?:戴上|摘下|取下|卸下|披上).{0,10}(?:面具|帽|斗笠|披风|手套)|'
        r'护心镜.{0,18}(?:内置|内穿|衣内|衣服里|佩戴|保留|未取下|未卸下|取下|卸下|取出)|'
        r'(?:内置|内穿|佩戴|衣内|衣服里|塞入|塞着).{0,14}护心镜')
    age = re.compile(r'幼年|童年|儿童时期|少年时期|老年时期|前世|(?:\d{1,3}|[零〇一二两三四五六七八九十百]{1,5})岁')
    planned = re.compile(r'想要|试图|准备|打算|就要|试着')
    for value in raw:
        # Every original phrase survives, even if an older model mixed several
        # actions into one material state string.
        notes.append(value)
        for part in re.split(r'[，,；;。]', value):
            part = part.strip()
            if not part:
                continue
            if re.search(r'未知|不明|未确定|不确定|尚未确认|是否', part):
                continue
            if planned.search(part) and not re.search(r'仍|已|未取下|未卸下', part):
                continue
            if physical.search(part):
                materials.append(part)
            else:
                age_match = age.search(part)
                if age_match:
                    materials.append(age_match.group())
    return list(dict.fromkeys(materials)), list(dict.fromkeys(notes))


def normalize_project_presentations(project):
    """Migrate saved frame acting without deleting or renumbering old ST IDs."""
    register_project_ids(project)
    default_states = {}
    for char in project.get('characters', []):
        default_states[char['teamAssetId']] = char['teamStateId']
        for outfit in char.get('outfits', []):
            default_states[outfit['teamAssetId']] = outfit['teamStateId']
    records = {x.get('id'): x for x in project.get('teamAssetStates', [])}
    used_states = set()
    for chapter in project.get('chapterAnalysis', {}).get('chapters', []):
        for segment in chapter.get('segments', []):
            for appearance in segment.get('appearances', []):
                materials, notes = _state_parts(appearance)
                appearance.update(states=materials, materialStates=materials, presentationNotes=notes)
                state = records.get(appearance.get('stateId'))
                if not materials:
                    appearance['stateId'] = default_states.get(appearance.get('assetId'), appearance.get('stateId', ''))
                elif state and state.get('assetId') == appearance.get('assetId'):
                    state.update(states=materials, materialStates=materials,
                                 presentationNotes=list(dict.fromkeys(state.get('presentationNotes', []) + notes)))
                used_states.add(appearance.get('stateId'))
    for state in records.values():
        if state.get('id') in used_states:
            state['lifecycleStatus'] = 'active'
            state.pop('retiredReason', None)
        else:
            state['lifecycleStatus'] = 'retired'
            state['retiredReason'] = '当前片段不再引用；原编号保留供旧版本回查。'
    return project


def _explicit_name_upgrade(old_name, new_name, raw_chapters, source_by_number):
    if not re.search(r'姓名未明|姓名不明|未给姓名|姓名未说明|本名未明|本名不明|待确定|未具名|尚未具名', old_name):
        return False
    if new_name in GENERIC_NAMES or re.search(r'未明|不明|未给|未说明|待确定|未具名', new_name):
        return False
    for chapter in raw_chapters:
        paragraphs = {p.get('id'): str(p.get('text', '')) for p in source_by_number.get(chapter.get('chapter'), {}).get('paragraphs', [])}
        for segment in chapter.get('segments', []):
            for appearance in segment.get('appearances', []):
                if appearance.get('characterName') != new_name or appearance.get('basis') != 'source':
                    continue
                for evidence in appearance.get('evidence', []):
                    if not isinstance(evidence, dict):
                        continue
                    text = paragraphs.get(evidence.get('paragraphId'), '')
                    quote = str(evidence.get('quote') or '')
                    if new_name in text and quote and quote in text and evidence.get('claimType', 'literal') == 'literal':
                        return True
    return False


def _find_character(characters, incoming):
    name = str(incoming.get('name') or '').strip()
    if not name:
        return None
    # Only explicit stable names/aliases qualify; generic kinship and crowd words
    # must never bind two unknown people simply because the text calls both 哥.
    names = _names(incoming) - GENERIC_NAMES
    matches = [c for c in characters if names.intersection(_names(c) - GENERIC_NAMES)]
    return matches[0] if len(matches) == 1 else None


def _save_source_description_history(target, description, chapter_numbers, source_by_number,
                                     raw_chapters, character_names, outfit_name=None, definition_evidence=''):
    """One short source-analysis note per chapter, independent of art decisions."""
    history = {row.get('chapter'): copy.deepcopy(row) for row in target.get('sourceDescriptionHistory', [])
               if isinstance(row, dict) and _number(row.get('chapter'))}
    for number in chapter_numbers:
        source = source_by_number.get(number)
        if source is None:
            continue
        paragraphs = {p.get('id'): str(p.get('text', '')) for p in source.get('paragraphs', [])}
        evidence = []
        seen_evidence = set()
        for chapter in raw_chapters:
            if chapter.get('chapter') != number:
                continue
            for segment in chapter.get('segments', []):
                for appearance in segment.get('appearances', []):
                    if appearance.get('characterName') not in character_names:
                        continue
                    if outfit_name is not None and appearance.get('outfitName') != outfit_name:
                        continue
                    for entry in _evidence(appearance.get('evidence', []), paragraphs, []):
                        key = (entry.get('paragraphId'), entry.get('quote'), entry.get('claimType'))
                        if key not in seen_evidence:
                            seen_evidence.add(key)
                            evidence.append(entry)
        history[number] = {'chapter': number, 'description': str(description or ''),
                           'sourceId': source.get('sourceId', ''), 'sourceHash': source.get('sourceHash', ''),
                           'member': source.get('member', ''), 'definitionEvidence': str(definition_evidence or ''),
                           'evidence': evidence, 'analysisOrigin': 'model'}
    target['sourceDescriptionHistory'] = [history[number] for number in sorted(history)]


def _evidence(items, paragraphs, warnings):
    result = []
    for item in items if isinstance(items, list) else []:
        if isinstance(item, str):
            item = {'paragraphId': '', 'quote': item}
        if not isinstance(item, dict):
            continue
        paragraph_id = str(item.get('paragraphId') or '')
        quote = str(item.get('quote') or '')
        known = paragraphs.get(paragraph_id)
        if paragraph_id and known is None:
            warnings.append(f'证据段号无法回查：{paragraph_id}')
            continue
        if quote and known is not None and re.sub(r'\s+', '', quote) not in re.sub(r'\s+', '', known):
            warnings.append(f'证据引文与原段不符：{paragraph_id}')
            result.append({'paragraphId': paragraph_id, 'quote': quote,
                           'claimType': item.get('claimType', 'literal'), 'verified': False})
            continue
        result.append({'paragraphId': paragraph_id, 'quote': quote,
                       'claimType': item.get('claimType', 'literal'), 'verified': bool(known and quote)})
    return result


def merge_chapter_analysis(project, result, source_chapters):
    """Merge definitions then bind each real appearance to persistent IDs."""
    if not isinstance(result.get('characters'), list) or any(not isinstance(x, dict) for x in result['characters']):
        raise ValueError('人物分析结果结构无效')
    normalize_project_presentations(project)
    start, end = _number(project.get('rangeStart')) or 1, _number(project.get('rangeEnd')) or 20
    source_by_number = {x['chapter']: x for x in source_chapters}
    warnings = list((project.get('chapterAnalysis') or {}).get('warnings') or []) + list(result.get('warnings') or [])
    incoming_analysis = result.get('analysis') or {}
    raw_chapters = [x for x in incoming_analysis.get('chapters', []) if x.get('chapter') in source_by_number]
    for unexpected in incoming_analysis.get('chapters', []):
        if unexpected.get('chapter') not in source_by_number:
            warnings.append(f'已排除未读取章节映射：{unexpected.get("chapter")}')
    warnings.extend(incoming_analysis.get('warnings') or [])
    has_mapping = bool(raw_chapters)
    active_names = {a.get('characterName') for ch in raw_chapters for s in ch.get('segments', [])
                    for a in s.get('appearances', []) if a.get('appearanceType') in ('onscreen', 'offscreen', 'memory')}
    existing = project.setdefault('characters', [])
    bindings = {}
    for original in result['characters']:
        item = copy.deepcopy(original)
        name = str(item.get('name') or '').strip()
        if not name or name in GENERIC_NAMES:
            warnings.append('已排除没有明确身份名称的人物条目')
            continue
        chapters = sorted({_number(n) for n in item.get('episodes', []) if _number(n) and start <= _number(n) <= end})
        if item.get('episodes') and not chapters:
            warnings.append(f'已排除范围外人物：{name}')
            continue
        if has_mapping and name not in active_names and not (_names(item) & active_names):
            warnings.append(f'仅提及或没有出场映射的人物未自动入制作清单：{name}')
            continue
        char = _find_character(existing, item)
        if char is None:
            char = {**item, 'id': uuid4().hex, 'name': name, 'episodes': chapters, 'faceApproved': False, 'outfits': []}
            existing.append(char)
        else:
            char['episodes'] = sorted(set(char.get('episodes', []) + chapters))
            if _explicit_name_upgrade(char['name'], name, raw_chapters, source_by_number):
                char['identityNames'] = sorted(_names(char) | {name})
                char['name'] = name
            char['aliases'] = sorted((_names(char) | _names(item)) - {char['name']})
            char['scriptDescription'] = item.get('description', '')
            char['evidence'] = item.get('evidence', '')
        char['sourceDescription'] = item.get('description', '')
        _save_source_description_history(char, item.get('description', ''), chapters or source_by_number.keys(),
                                         source_by_number, raw_chapters, _names(item), definition_evidence=item.get('evidence', ''))
        bindings[name] = char
        for alias in _names(item) - GENERIC_NAMES:
            bindings.setdefault(alias, char)
        for raw_outfit in item.get('outfits', []):
            outfit_chapters = sorted({_number(n) for n in raw_outfit.get('episodes', []) if _number(n) and start <= _number(n) <= end})
            if raw_outfit.get('episodes') and not outfit_chapters:
                warnings.append(f'已排除范围外服装：{name}·{raw_outfit.get("name", "")}')
                continue
            outfit_name = str(raw_outfit.get('name') or '').strip()
            if not outfit_name:
                continue
            matches = [x for x in char.get('outfits', []) if x.get('name') == outfit_name or
                       outfit_name in x.get('aliases', []) or outfit_name in x.get('identityNames', [])]
            matches = [x for x in matches if not x.get('sourceOutfitId') or x.get('name') == outfit_name]
            # A renamed outfit remains bound through its already registered alias.
            if len(matches) == 1:
                outfit = matches[0]
                outfit['episodes'] = sorted(set(outfit.get('episodes', []) + outfit_chapters))
                outfit['scriptDescription'] = raw_outfit.get('description', '')
            else:
                outfit = {**copy.deepcopy(raw_outfit), 'id': uuid4().hex, 'episodes': outfit_chapters, 'gestures': [], 'specials': []}
                char.setdefault('outfits', []).append(outfit)
            outfit['sourceDescription'] = raw_outfit.get('description', '')
            _save_source_description_history(outfit, raw_outfit.get('description', ''),
                                             outfit_chapters or source_by_number.keys(), source_by_number, raw_chapters,
                                             _names(item), outfit_name, definition_evidence=item.get('evidence', ''))
        if not char.get('outfits') and not has_mapping:
            char['outfits'] = [{'id': uuid4().hex, 'name': '常用服装', 'description': '', 'episodes': chapters, 'gestures': [], 'specials': []}]
    register_project_ids(project)
    analysis = project.setdefault('chapterAnalysis', {'chapters': []})
    previous = {x.get('chapter'): x for x in analysis.get('chapters', [])}
    for raw in raw_chapters:
        number = _number(raw.get('chapter'))
        if number not in source_by_number:
            warnings.append(f'已排除未读取章节映射：{raw.get("chapter")}')
            continue
        source = source_by_number[number]
        paragraphs = {p.get('id'): str(p.get('text', '')) for p in source.get('paragraphs', [])}
        old_segments = previous.get(number, {}).get('segments', [])
        used_old = set()
        segments = []
        for raw_segment in raw.get('segments', []):
            paragraph_ids = [x for x in raw_segment.get('sourceParagraphIds', []) if x in paragraphs]
            for unknown in set(raw_segment.get('sourceParagraphIds', [])) - set(paragraph_ids):
                warnings.append(f'第{number}章片段段号无法回查：{unknown}')
            anchor = paragraph_ids[0] if paragraph_ids else ''
            old = next((x for x in old_segments if x.get('id') not in used_old and paragraph_ids and
                        x.get('sourceParagraphIds') == paragraph_ids), None)
            if old is None and anchor:
                old = next((x for x in old_segments if x.get('id') not in used_old and
                            x.get('sourceParagraphIds', [])[:1] == [anchor]), None)
            segment_id = old['id'] if old else _next_id(project, 'EV')
            used_old.add(segment_id)
            segment = {**copy.deepcopy(raw_segment), 'id': segment_id, 'sourceParagraphIds': paragraph_ids, 'appearances': []}
            for appearance in raw_segment.get('appearances', []):
                name = str(appearance.get('characterName') or '').strip()
                char = bindings.get(name)
                if char is None:
                    char = _find_character(existing, {'name': name, 'aliases': []})
                outfit_name = str(appearance.get('outfitName') or '').strip()
                outfits = [x for x in (char or {}).get('outfits', []) if x.get('name') == outfit_name or
                           (not x.get('sourceOutfitId') and (outfit_name in x.get('aliases', []) or outfit_name in x.get('identityNames', [])))]
                outfit = outfits[0] if len(outfits) == 1 else None
                evidence = _evidence(appearance.get('evidence', []), paragraphs, warnings)
                appearance_type = appearance.get('appearanceType', 'onscreen')
                if appearance_type not in APPEARANCE_TYPES:
                    appearance_type = 'narration'
                states, presentation_notes = _state_parts(appearance)
                asset_id = (outfit or char or {}).get('teamAssetId', '')
                state_id = (outfit or char or {}).get('teamStateId', '')
                if states and asset_id:
                    records = project.setdefault('teamAssetStates', [])
                    state = next((x for x in records if x.get('assetId') == asset_id and sorted(x.get('states', [])) == sorted(states)), None)
                    if state is None:
                        state = {'id': _next_id(project, 'ST'), 'assetId': asset_id, 'identityEntityId': (char or {}).get('identityEntityId', ''),
                                 'states': states, 'materialStates': states, 'lifecycleStatus': 'active',
                                 'basis': appearance.get('basis', 'source'), 'evidence': evidence}
                        records.append(state)
                    state['lifecycleStatus'] = 'active'
                    state.pop('retiredReason', None)
                    state_id = state['id']
                segment['appearances'].append({**copy.deepcopy(appearance), 'characterName': name, 'outfitName': outfit_name,
                    'characterId': (char or {}).get('id', ''), 'outfitId': (outfit or {}).get('id', ''),
                    'identityEntityId': (char or {}).get('identityEntityId', ''), 'assetId': asset_id, 'stateId': state_id,
                    'appearanceType': appearance_type, 'states': states, 'materialStates': states,
                    'presentationNotes': presentation_notes, 'basis': appearance.get('basis', 'source'), 'evidence': evidence})
            segments.append(segment)
        mentions = [{**copy.deepcopy(x), 'evidence': _evidence(x.get('evidence', []), paragraphs, warnings)}
                    for x in raw.get('mentions', []) if isinstance(x, dict)]
        covered = {p for segment in segments for p in segment.get('sourceParagraphIds', [])}
        missing_paragraphs = [p for p in paragraphs if p not in covered]
        if missing_paragraphs:
            warnings.append(f'第{number}章有{len(missing_paragraphs)}段尚未绑定片段，需补核：' + '、'.join(missing_paragraphs[:5]))
        previous[number] = {'chapter': number, 'title': source.get('title') or raw.get('title', ''),
            'summary': raw.get('summary', ''), 'sourceId': source.get('sourceId', ''), 'sourceHash': source.get('sourceHash', ''),
            'member': source.get('member', ''), 'segments': segments, 'mentions': mentions,
            'readStatus': 'analyzed' if segments and not missing_paragraphs else 'needs_review', 'analysisOrigin': 'model',
            'inputHash': chapter_fingerprint(source),
            'coverage': {'totalParagraphs': len(paragraphs), 'mappedParagraphs': len(covered), 'missingParagraphIds': missing_paragraphs}}
    analysis.update(schemaVersion='2.0', unit='source_chapter', sourceStage='source',
                    clientVerification={'status': 'not_provided', 'message': '甲方细纲/分镜未提供；当前清单为原著可视资产候选，未核验实际出镜。'},
                    chapters=sorted(previous.values(), key=lambda x: x['chapter']), warnings=list(dict.fromkeys(warnings)))
    if not raw_chapters:
        analysis['warnings'].append('分析结果缺少逐章片段映射，不能据此认定逐章需求已完整拆解。')
    # Persist which identities only have optional memory/offscreen appearances;
    # automatic image workflows must not produce these without a visual decision.
    types_by_character = {}
    types_by_outfit = {}
    for chapter in analysis['chapters']:
        for segment in chapter.get('segments', []):
            for appearance in segment.get('appearances', []):
                types_by_character.setdefault(appearance.get('characterId'), set()).add(appearance.get('appearanceType'))
                if appearance.get('outfitId'):
                    types_by_outfit.setdefault(appearance['outfitId'], set()).add(appearance.get('appearanceType'))
    for char in existing:
        if char['id'] in types_by_character:
            char['sourceAppearance'] = 'onscreen' if 'onscreen' in types_by_character[char['id']] else 'optional'
            char['candidateOnly'] = char['sourceAppearance'] == 'optional'
            char['productionNeed'] = 'candidate'
        for outfit in char.get('outfits', []):
            if outfit['id'] in types_by_outfit:
                outfit['sourceAppearance'] = 'onscreen' if 'onscreen' in types_by_outfit[outfit['id']] else 'optional'
                outfit['candidateOnly'] = outfit['sourceAppearance'] == 'optional'
                outfit['productionNeed'] = 'candidate'
    normalize_project_presentations(project)
    bind_source_profiles(project)
    register_project_ids(project)
    owners = {c['id']: c for c in project.get('characters', [])}
    for chapter in analysis['chapters']:
        for segment in chapter.get('segments', []):
            for appearance in segment.get('appearances', []):
                owner = owners.get(appearance.get('characterId'))
                if owner:
                    outfit = next((o for o in owner.get('outfits', []) if o['id'] == appearance.get('outfitId')),None)
                    _bind_revised_appearance(project,appearance,owner,outfit)
    project['analysisWarnings'] = list(dict.fromkeys(analysis['warnings']))
    project['analysisRange'] = [start, end]
    return project


def _file_exists(url, asset_root=None):
    if not isinstance(url, str) or not url.startswith('/files/'):
        return False
    try:
        if asset_root is None:
            import worker
            path = worker.asset_path(url)
        else:
            root = Path(asset_root).resolve()
            path = (root / unquote(urlsplit(url).path[7:])).resolve()
            path.relative_to(root)
        if not path.is_file():
            return False
        from PIL import Image
        with Image.open(path, formats=['PNG', 'JPEG', 'WEBP']) as picture:
            picture.verify()
        return True
    except (OSError, ValueError, TypeError):
        return False


def build_chapter_requirements(project, library, asset_root=None):
    """Return live, evidence-bound inventory. Never guesses identities by name."""
    project = copy.deepcopy(project)
    ensure_appearance_profiles(project)
    characters = {x.get('id'): x for x in project.get('characters', [])}
    library_by_id = {x.get('id'): x for x in library if isinstance(x, dict)} if isinstance(library, list) else {}
    analysis = project.get('chapterAnalysis') or {}
    warnings = list(analysis.get('warnings') or [])
    scope_error = ''
    try:
        source = selected_chapters(project) if project.get('script') or project.get('chapters') or project.get('chapterContents') else []
    except ValueError as error:
        source = []
        scope_error = str(error)
        warnings.append(scope_error + '；当前范围需求未知，未计为完成。')
    selected = {x['chapter']: x for x in source}
    analyzed = {x.get('chapter'): x for x in analysis.get('chapters', [])}
    checks = {}
    def usable(url):
        if url not in checks:
            checks[url] = _file_exists(url, asset_root)
        return checks[url]
    def standard_image(url, size):
        if not usable(url):
            return False
        try:
            from PIL import Image
            if asset_root is None:
                import worker
                path = worker.asset_path(url)
            else:
                path = Path(asset_root).resolve() / unquote(urlsplit(url).path[7:])
            with Image.open(path, formats=['PNG', 'JPEG', 'WEBP']) as picture:
                return picture.size == size
        except (OSError, ValueError, TypeError):
            return False
    def crowd_format(url):
        if not usable(url): return False
        try:
            from PIL import Image
            path = Path(asset_root).resolve() / unquote(urlsplit(url).path[7:]) if asset_root is not None else __import__('worker').asset_path(url)
            with Image.open(path,formats=['PNG','JPEG','WEBP']) as picture:
                return picture.width >= 100 and abs(picture.width / picture.height - 16 / 9) < .015
        except (OSError,ValueError,TypeError): return False
    target_style = project.get('style') or project.get('recommendedStyle') or '国漫'
    counts = {status: 0 for status in STATUS_LABELS}
    totals = {**counts, 'total': 0, 'analyzedChapters': 0, 'pendingChapters': 1 if scope_error else 0,
              'scopeUnknown': bool(scope_error or not source), 'complete': False}
    rows = []
    for number, source_chapter in selected.items():
        chapter = analyzed.get(number)
        row = {'chapter': number, 'title': source_chapter.get('title', ''), 'summary': (chapter or {}).get('summary', ''),
               'requirements': {'role': [], 'costume': [], 'crowd': []}, 'segments': [], 'mentions': (chapter or {}).get('mentions', []),
               'counts': {**counts, 'total': 0}, 'analyzed': bool(chapter and chapter.get('readStatus') == 'analyzed'), 'complete': False}
        if not row['analyzed']:
            totals['pendingChapters'] += 1
            warnings.append(f'第{number}章尚未完成逐段分析，需求数量未知。')
        else:
            totals['analyzedChapters'] += 1
        seen = set()
        for segment in (chapter or {}).get('segments', []):
            segment_row = {'id': segment.get('id', ''), 'title': segment.get('title', ''), 'summary': segment.get('summary', ''),
                           'location': segment.get('location', ''), 'time': segment.get('time', ''), 'requirements': []}
            for appearance in segment.get('appearances', []):
                appearance_type = appearance.get('appearanceType', 'onscreen')
                if appearance_type in ('mentioned_only', 'system', 'narration'):
                    continue
                owner = characters.get(appearance.get('characterId'))
                profile_id = appearance.get('appearanceProfileId') or next((o.get('appearanceProfileId') for o in (owner or {}).get('outfits',[]) if o.get('id') == appearance.get('outfitId')),None)
                profile = get_profile(owner,profile_id) if owner and profile_id else None
                char = profile_character(owner,profile_id) if profile else owner
                outfit = next((x for x in (char or {}).get('outfits', []) if x.get('id') == appearance.get('outfitId')), None)
                category = 'crowd' if (char or {}).get('category') == '群像' else 'role'
                kinds = [category] if category == 'crowd' else ['role', 'costume']
                for kind in kinds:
                    asset = outfit if kind == 'costume' else profile or char
                    asset_id = (asset or {}).get('teamAssetId', '')
                    state_id = ((profile or char or {}).get('teamStateId', '') if kind in ('role', 'crowd') else
                                appearance.get('stateId') or (asset or {}).get('teamStateId', ''))
                    costume_asset_id = (outfit or {}).get('teamAssetId', '')
                    costume_state_id = (appearance.get('stateId') or (outfit or {}).get('teamStateId', '')) if outfit else ''
                    missing = []
                    image = ''
                    some_images = []
                    if char:
                        face, body = char.get('face', ''), char.get('base', '')
                        face_library = library_by_id.get(char.get('libraryFaceId'))
                        body_library = library_by_id.get(char.get('libraryBodyId'))
                        reference_values = [char.get('reference'), *char.get('references', [])]
                        input_references = [value for value in reference_values if usable(value)]
                        if kind in ('role', 'crowd'):
                            for value in (face, body, *input_references, *(x.get('image') for x in [face_library, body_library] if x)):
                                if usable(value):
                                    some_images.append(value)
                            if kind in ('role','crowd') and char.get('legacyHeadReviewPending'):
                                missing.append('完整头发脸图待核对')
                            face_style_ok = char.get('faceStyle') in ('', None, target_style)
                            body_style_ok = char.get('baseStyle') in ('', None, target_style)
                            if not (usable(face) and char.get('faceApproved') and face_style_ok):
                                missing.append('从定稿图提取并确认脸图' if input_references and char.get('identitySource') == 'fullbody'
                                               and not usable(face) else '已确认脸图')
                            if not (usable(body) and body_style_ok and char.get('baseApproved') is not False and not any(char.get(k) for k in ('headPreparationPending','hairReviewPending','identityReviewPending'))):
                                missing.append('身体底稿')
                            image = face if usable(face) else body if usable(body) else input_references[0] if input_references else ''
                    if kind in ('costume', 'crowd'):
                        outfit_reference = (outfit or {}).get('reference')
                        if usable(outfit_reference):
                            some_images.append(outfit_reference)
                            if not image:
                                image = outfit_reference
                        for field, label in [('card', '穿着角色卡'), ('hands', '手部卡'), ('combined', '合并卡')]:
                            value = (outfit or {}).get(field, '')
                            style_ok = (outfit or {}).get('style') in ('', None, target_style)
                            size = (1920, 2160) if field == 'combined' else (1920, 1080)
                            if usable(value) and style_ok and standard_image(value, size):
                                some_images.append(value)
                                if not image or field == 'combined':
                                    image = value
                            else:
                                missing.append(label + ('（格式或画风待更新）' if usable(value) else ''))
                                if usable(value):
                                    some_images.append(value)
                                    if not image:
                                        image = value
                        clothing = library_by_id.get((outfit or {}).get('clothingId') or (outfit or {}).get('libraryClothingId'))
                        value = (outfit or {}).get('clothingImage') or (clothing or {}).get('image')
                        if usable(value):
                            some_images.append(value)
                            if not image:
                                image = value
                            if clothing and not clothing.get('detailReviewVersion'):
                                missing.append('服装库旧素材细节待核验')
                    crowd_assets = None
                    if kind == 'crowd' and owner and (owner.get('crowdSetId') or owner.get('crowdAssets')):
                        registered = library_by_id.get(owner.get('crowdSetId'))
                        crowd_assets = registered if registered and registered.get('kind') == 'crowd_set' else owner.get('crowdAssets', {})
                        missing, some_images, image = [], [], ''
                        for part, field, title in (('full_group','fullGroupImage','五人全身素材'),('heads','headSheet','五张完整头部'),('clothing','clothingSheet','对应纯服装')):
                            value = crowd_assets.get(field, '')
                            if usable(value):
                                some_images.append(value)
                                if part == 'heads' or not image: image = value
                            record = crowd_assets.get('parts',{}).get(part,{})
                            approved = record.get('status') == 'completed' and record.get('review',{}).get('status') in ('checked','manual_authorized')
                            digest_ok = False
                            if usable(value) and record.get('sha256'):
                                path = Path(asset_root).resolve() / unquote(urlsplit(value).path[7:]) if asset_root is not None else __import__('worker').asset_path(value)
                                digest_ok = hashlib.sha256(path.read_bytes()).hexdigest() == record['sha256']
                            if not (approved and digest_ok and crowd_format(value) and crowd_assets.get('style') == target_style):
                                missing.append(title + ('（格式、画风或核验待完善）' if usable(value) else ''))
                    if appearance_type in ('memory', 'offscreen') or (not crowd_assets and appearance.get('productionNeed') in ('candidate', 'reference_only')):
                        status, reason = 'candidate', '回忆/画外信息尚未确定实际画面，先保留候选。'
                    elif char is None or (kind == 'costume' and outfit is None):
                        status = 'unregistered'
                        reason = '尚未明确绑定人物身份。' if char is None else '这段衣着未绑定已登记服装；不能用其他衣服自动顶替。'
                    elif missing:
                        status = 'existing_needs_work' if some_images else 'definition_only'
                        reason = '已有图片，仍缺：' + '、'.join(missing) if some_images else '已登记定义，尚缺：' + '、'.join(missing)
                    else:
                        status, reason = 'ready', '所需已确认图片实际存在。'
                    if not crowd_assets and kind in ('costume', 'crowd') and (outfit or {}).get('semanticReviewPending') and some_images:
                        status = 'candidate' if status == 'candidate' else 'existing_needs_work'
                        reason = ('回忆/画外候选待分镜确认；' if status=='candidate' else '') + '原图衣着或时期需核验；旧图片保留，不代表新版本已完成。'
                        missing.append('原图衣着需核验')
                    if not crowd_assets and profile and profile.get('identityReviewPending'):
                        status = 'candidate' if status=='candidate' else 'existing_needs_work'
                        reason = '时期年龄或身体关联已修改，已有脸与身体需要重新核验。'
                        missing.append('本时期身份与身体核验')
                    if any(x.get('verified') is False for x in appearance.get('evidence', [])):
                        status, reason = 'candidate', '原句证据未通过回查，需要核验后再制作。'
                    state_image = ''
                    if appearance.get('states'):
                        # Expression/sweat/actions are frame presentation, not a
                        # reason to regenerate an entire otherwise reusable card.
                        state = next((x for x in project.get('teamAssetStates', []) if x.get('id') == appearance.get('stateId')), {})
                        proposed = state.get('image') or state.get('referenceImage')
                        state_image = proposed if usable(proposed) else ''
                    identity = appearance.get('characterId') or appearance.get('characterName', '')
                    key = (kind, identity, profile_id, appearance.get('outfitId') if kind != 'role' else '', state_id if kind != 'role' else '', appearance_type)
                    digest = hashlib.sha256(repr((number, segment.get('id'), key)).encode()).hexdigest()[:12]
                    item = {'id': f'REQ-{digest}', 'chapter': number, 'segmentId': segment.get('id', ''), 'type': kind,
                        'characterId': (char or {}).get('id', ''), 'outfitId': (outfit or {}).get('id', ''),
                        'appearanceProfileId': profile_id or (outfit or {}).get('appearanceProfileId',''),
                        'appearanceProfileName': (profile or {}).get('name','当前定稿时期'),
                        'faceIdentityGroupId':(profile or {}).get('faceIdentityGroupId',''),
                        'faceContinuity':copy.deepcopy((profile or {}).get('faceContinuity',{})),
                        'hairstyle':copy.deepcopy((profile or {}).get('hairstyle',{})),
                        'assetId': asset_id, 'stateId': state_id, 'identityEntityId': (char or {}).get('identityEntityId', ''),
                        'costumeAssetId': costume_asset_id, 'costumeStateId': costume_state_id,
                        'appearanceStateId': appearance.get('stateId', ''),
                        'name': ((char or {}).get('name') or appearance.get('characterName') or '未明确人物') +
                                (' · ' + ((outfit or {}).get('name') or appearance.get('outfitName') or '衣着未说明') if kind != 'role' else ''),
                        'basis': appearance.get('basis', 'source'), 'evidence': copy.deepcopy(appearance.get('evidence', [])),
                        'appearanceType': appearance_type, 'states': copy.deepcopy(appearance.get('states', [])),
                        'materialStates': copy.deepcopy(appearance.get('materialStates', appearance.get('states', []))),
                        'stateBasis': appearance.get('materialStateBasis') or appearance.get('basis', 'source'),
                        'outfitBasis': appearance.get('outfitBasis') or appearance.get('basis', 'source'),
                        'outfitEvidence': copy.deepcopy(appearance.get('outfitEvidence', [])),
                        'presentationNotes': copy.deepcopy(appearance.get('presentationNotes', [])),
                        'productionNeed': 'candidate', 'reviewStatus': 'pending',
                        'stateReviewPending': bool(appearance.get('states') and not state_image), 'stateImageUrl': state_image,
                        'status': status, 'label': STATUS_LABELS[status], 'reason': reason, 'imageUrl': image, 'missingParts': missing}
                    if crowd_assets is not None:
                        item.update(crowdSetId=owner.get('crowdSetId') or crowd_assets.get('id') or crowd_assets.get('crowdSetId'),
                            crowdAssets=copy.deepcopy(crowd_assets), productionReady=not missing,
                            sourceStatus=crowd_assets.get('sourceStatus') or 'unknown',
                            sourceFacts=copy.deepcopy(crowd_assets.get('sourceFacts') or {'memberCount':'unknown','sameFrame':'unknown','clothing':'unknown'}),
                            materialReviewStatus=crowd_assets.get('reviewStatus') or 'pending')
                        if not missing and status == 'ready':
                            item['reason'] = '已批准或核验的五人全身、五头与纯服装文件可用；原著人数与衣着事实单独保留。'
                    segment_row['requirements'].append(item)
                    if key not in seen:
                        seen.add(key)
                        row['requirements'][kind].append(item)
                        row['counts'][status] += 1
                        row['counts']['total'] += 1
            row['segments'].append(segment_row)
        row['complete'] = row['analyzed'] and row['counts']['total'] > 0 and row['counts']['ready'] == row['counts']['total']
        for key in counts:
            totals[key] += row['counts'][key]
        totals['total'] += row['counts']['total']
        rows.append(row)
    totals['complete'] = bool(rows) and totals['pendingChapters'] == 0 and all(x['complete'] for x in rows)
    return {'chapters': rows, 'totals': totals, 'warnings': list(dict.fromkeys(warnings))}


def outfit_script(project, character_id, outfit_id):
    """Only source paragraphs from segments actually wearing this outfit."""
    chapters = selected_chapters(project)
    analyzed = {x.get('chapter'): x for x in (project.get('chapterAnalysis') or {}).get('chapters', [])}
    parts = []
    for chapter in chapters:
        mapped = analyzed.get(chapter['chapter'])
        if mapped is None:
            continue
        ids = set()
        for segment in mapped.get('segments', []):
            if any(a.get('characterId') == character_id and a.get('outfitId') == outfit_id and
                   a.get('appearanceType') == 'onscreen' for a in segment.get('appearances', [])):
                ids.update(segment.get('sourceParagraphIds', []))
        lines = [p['text'] for p in chapter.get('paragraphs', []) if p.get('id') in ids]
        if lines:
            parts.append(chapter.get('title', '') + '\n' + '\n'.join(lines))
    return '\n\n'.join(parts)


def _revision_evidence(operation, chapters):
    evidence = []
    for row in operation.get('evidence', []):
        number = _number(row.get('chapter'))
        source = chapters.get(number)
        if source is None:
            raise ValueError('审校证据不属于已提供的章节')
        paragraphs = {p.get('id'): str(p.get('text', '')) for p in source.get('paragraphs', [])}
        checked = _evidence([row], paragraphs, [])
        if not checked or not checked[0].get('verified'):
            raise ValueError('审校证据段号或原文短句不能回查，未应用任何修订')
        evidence.append({**checked[0], 'chapter': number, 'sourceId': source.get('sourceId', ''),
                         'sourceHash': source.get('sourceHash', ''), 'member': source.get('member', '')})
    if not evidence:
        raise ValueError('语义修订必须提供可回查的原文证据')
    return evidence


def _revision_targets(project, operation):
    matches = []
    chapters = {x['chapter']: x for x in project.get('chapterAnalysis', {}).get('chapters', [])}
    targets = operation.get('targets', [])
    if not targets:
        raise ValueError('请指定修订的章节与片段')
    seen = set()
    for target in targets:
        number = _number(target.get('chapter'))
        chapter = chapters.get(number)
        segment_id = target.get('segmentId')
        candidates = [s for s in (chapter or {}).get('segments', []) if not segment_id or s.get('id') == segment_id]
        if not candidates:
            raise ValueError('没有找到指定的审校章节或片段')
        for segment in candidates:
            key = (number, segment['id'])
            if key not in seen:
                seen.add(key)
                matches.append((number, segment))
    return matches


def _bind_revised_appearance(project, appearance, char, outfit, state_basis=None):
    materials, notes = _state_parts(appearance)
    asset = outfit or char
    asset_id, state_id = asset['teamAssetId'], asset['teamStateId']
    basis = state_basis or appearance.get('materialStateBasis') or appearance.get('basis', 'source')
    if materials:
        records = project.setdefault('teamAssetStates', [])
        state = next((x for x in records if x.get('assetId') == asset_id and x.get('states') == materials and
                      x.get('basis', 'source') == basis), None)
        if state is None:
            state = {'id': _next_id(project, 'ST'), 'assetId': asset_id, 'identityEntityId': char['identityEntityId'],
                     'states': materials, 'materialStates': materials, 'basis': basis,
                     'evidence': copy.deepcopy(appearance.get('materialStateEvidence') or appearance.get('evidence', [])),
                     'lifecycleStatus': 'active'}
            records.append(state)
        state_id = state['id']
    appearance.update(characterId=char['id'], characterName=char['name'], identityEntityId=char['identityEntityId'],
                      outfitId=(outfit or {}).get('id', ''), outfitName=(outfit or {}).get('name', ''),
                      assetId=asset_id, stateId=state_id, states=materials, materialStates=materials,
                      presentationNotes=notes, materialStateBasis=basis)


def _refresh_revision_bindings(project):
    char_types, char_chapters, outfit_types, outfit_chapters = {}, {}, {}, {}
    analyzed_numbers = {x['chapter'] for x in project.get('chapterAnalysis', {}).get('chapters', [])}
    for chapter in project.get('chapterAnalysis', {}).get('chapters', []):
        for segment in chapter.get('segments', []):
            for appearance in segment.get('appearances', []):
                appearance_type = 'candidate' if appearance.get('productionNeed') in ('candidate', 'reference_only') else appearance.get('appearanceType')
                char_types.setdefault(appearance.get('characterId'), set()).add(appearance_type)
                char_chapters.setdefault(appearance.get('characterId'), set()).add(chapter['chapter'])
                if appearance.get('outfitId'):
                    oid = appearance['outfitId']
                    outfit_types.setdefault(oid, set()).add(appearance_type)
                    outfit_chapters.setdefault(oid, set()).add(chapter['chapter'])
    for char in project.get('characters', []):
        if char['id'] in char_types:
            char['candidateOnly'] = 'onscreen' not in char_types[char['id']]
            char['sourceAppearance'] = 'optional' if char['candidateOnly'] else 'onscreen'
            outside_scope = {x for x in char.get('episodes', []) if x not in analyzed_numbers}
            char['episodes'] = sorted(outside_scope | char_chapters.get(char['id'], set()))
        for outfit in char.get('outfits', []):
            if outfit['id'] in outfit_types:
                outfit['candidateOnly'] = 'onscreen' not in outfit_types[outfit['id']]
                outfit['sourceAppearance'] = 'optional' if outfit['candidateOnly'] else 'onscreen'
            outside_scope = {x for x in outfit.get('episodes', []) if x not in analyzed_numbers}
            if outfit['id'] not in outfit_types and not outside_scope:
                outfit.update(candidateOnly=True, sourceAppearance='unreferenced')
            outfit['episodes'] = sorted(outside_scope | outfit_chapters.get(outfit['id'], set()))
    normalize_project_presentations(project)


def apply_semantic_revisions(project, revisions, source_chapters=None, reviewer='semantic_review'):
    """Apply explicit, source-checked review operations to a transaction copy.

    This verifies quotation provenance, not the literary interpretation itself.
    The caller supplies reviewed decisions; this function never calls a model or
    generates images. Invalid operations leave the original project untouched.
    """
    if not isinstance(revisions, list) or not revisions:
        raise ValueError('请提供语义修订列表')
    revised = copy.deepcopy(project)
    register_project_ids(revised)
    normalize_project_presentations(revised)
    chapters = {x['chapter']: x for x in (source_chapters if source_chapters is not None else selected_chapters(revised))}
    characters = {x['id']: x for x in revised.get('characters', [])}
    review_id = 'REVIEW-' + uuid4().hex
    changes = []
    allowed = {'split_outfit', 'refine_outfit', 'set_category', 'set_states', 'add_appearance'}
    for operation in revisions:
        if not isinstance(operation, dict) or operation.get('type') not in allowed:
            raise ValueError('语义修订操作类型无效')
        kind = operation['type']
        basis, reason = operation.get('basis'), str(operation.get('reason') or '').strip()
        if basis not in ('source', 'inference') or not reason:
            raise ValueError('修订须注明原著/推定依据及审校理由')
        evidence = _revision_evidence(operation, chapters)
        char = characters.get(operation.get('characterId'))
        if char is None:
            raise ValueError('审校人物尚未登记')
        before = {'characterId': char['id'], 'identityEntityId': char['identityEntityId'], 'assetId': char['teamAssetId']}
        changed_targets = []
        if kind == 'set_category':
            category = operation.get('category')
            if category not in ('主角', '配角', '群像'):
                raise ValueError('人物分类无效')
            before['category'] = char.get('category')
            char.update(category=category, assetKind='crowd' if category == '群像' else 'character',
                        crowdInstance=category == '群像', classificationBasis=basis)
        elif kind in ('split_outfit', 'refine_outfit'):
            outfit_id = operation.get('fromOutfitId') if kind == 'split_outfit' else operation.get('outfitId')
            old = next((x for x in char.get('outfits', []) if x['id'] == outfit_id), None)
            if old is None:
                raise ValueError('审校服装尚未登记')
            before.update(outfitId=old['id'], outfitAssetId=old['teamAssetId'], outfitName=old.get('name'),
                          sourceDescriptionHistory=copy.deepcopy(old.get('sourceDescriptionHistory', [])))
            if kind == 'refine_outfit':
                description = str(operation.get('description') or '').strip()
                if not description:
                    raise ValueError('请提供补充后的原著服装描述')
                new_name = str(operation.get('name') or old['name']).strip()
                if new_name != old['name']:
                    if not re.search(r'未说明|未知|未明|待设计|未确定|款式待定', old['name'] + ' ' + old.get('description', '')):
                        raise ValueError('已明确版本不能靠补充细节改成另一套衣服，请采用拆分版本')
                    old['aliases'] = sorted(set(old.get('aliases', [])) | {old['name']})
                    old['identityNames'] = sorted(set(old.get('identityNames', [])) | {old['name'], new_name})
                    old['name'] = new_name
                old.update(sourceDescription=description, scriptDescription=description, semanticReviewPending=True)
                for _, segment in _revision_targets(revised, operation):
                    for appearance in segment.get('appearances', []):
                        if appearance.get('characterId') == char['id'] and appearance.get('outfitId') == old['id']:
                            appearance['outfitName'] = old['name']
                            appearance['semanticReviewId'] = review_id
                numbers = sorted({n for n, _ in _revision_targets(revised, operation)})
                _save_source_description_history(old, description, numbers, chapters,
                                                 revised.get('chapterAnalysis', {}).get('chapters', []), _names(char), old['name'])
                for row in old.get('sourceDescriptionHistory', []):
                    if row['chapter'] in numbers:
                        row.update(analysisOrigin='semantic_review', basis=basis, reviewId=review_id, reviewEvidence=copy.deepcopy(evidence))
            else:
                definition = operation.get('newOutfit') or {}
                name, description = str(definition.get('name') or '').strip(), str(definition.get('description') or '').strip()
                if not name or not description:
                    raise ValueError('新服装版本须有名称和原著描述')
                existing = [x for x in char.get('outfits', []) if x.get('name') == name]
                if existing:
                    raise ValueError('同名服装版本已登记，不能重复拆分')
                new = {'id': uuid4().hex, 'name': name, 'description': description, 'sourceDescription': description,
                       'scriptDescription': description, 'episodes': [], 'gestures': [], 'specials': [],
                       'productionNeed': 'candidate', 'reviewStatus': 'pending', 'splitFromOutfitId': old['id']}
                char.setdefault('outfits', []).append(new)
                register_project_ids(revised)
                old['semanticReviewPending'] = True
                targets = _revision_targets(revised, operation)
                for number, segment in targets:
                    found = False
                    for appearance in segment.get('appearances', []):
                        if appearance.get('characterId') == char['id'] and appearance.get('outfitId') == old['id']:
                            _bind_revised_appearance(revised, appearance, char, new)
                            target_options = next((t for t in operation.get('targets', []) if _number(t.get('chapter')) == number and
                                                   (not t.get('segmentId') or t.get('segmentId') == segment['id'])), {})
                            wearing_basis = target_options.get('outfitBasis') or operation.get('outfitBasis') or basis
                            if wearing_basis not in ('source', 'inference'):
                                raise ValueError('服装穿着依据无效')
                            wearing_evidence = target_options.get('outfitEvidence') or operation.get('outfitEvidence')
                            appearance['outfitBasis'] = wearing_basis
                            appearance['outfitEvidence'] = _revision_evidence({'evidence': wearing_evidence}, chapters) if wearing_evidence else copy.deepcopy(evidence)
                            appearance['semanticReviewId'] = review_id
                            changed_targets.append({'chapter': number, 'segmentId': segment['id']})
                            found = True
                    explicit_segment = any(_number(t.get('chapter')) == number and t.get('segmentId') == segment['id']
                                           for t in operation.get('targets', []))
                    if not found and explicit_segment:
                        raise ValueError('指定片段没有该人物与旧服装的对应出场，未应用修订')
                if not changed_targets:
                    raise ValueError('所选章节没有该人物与旧服装的对应出场')
                _save_source_description_history(new, description, sorted({x['chapter'] for x in changed_targets}), chapters,
                                                 revised.get('chapterAnalysis', {}).get('chapters', []), _names(char), name)
                for row in new.get('sourceDescriptionHistory', []):
                    wearing = next((a for ch in revised.get('chapterAnalysis', {}).get('chapters', []) if ch['chapter'] == row['chapter']
                                    for s in ch.get('segments', []) for a in s.get('appearances', []) if a.get('outfitId') == new['id']), {})
                    row.update(analysisOrigin='semantic_review', basis=wearing.get('outfitBasis') or basis,
                               reviewId=review_id, reviewEvidence=copy.deepcopy(wearing.get('outfitEvidence') or evidence))
                before['newOutfitId'] = new['id']
                before['newOutfitAssetId'] = new['teamAssetId']
        else:
            targets = _revision_targets(revised, operation)
            if kind == 'add_appearance' and basis != 'inference':
                raise ValueError('连续性补足出场须明确标为inference，不能冒充原文明写')
            for number, segment in targets:
                appearances = [x for x in segment.get('appearances', []) if x.get('characterId') == char['id']]
                if kind == 'add_appearance':
                    if appearances:
                        raise ValueError('该片段人物已登记出场，不重复添加')
                    outfit = next((x for x in char.get('outfits', []) if x['id'] == operation.get('outfitId')), None)
                    if operation.get('outfitId') and outfit is None:
                        raise ValueError('连续性出场的服装ID无效')
                    appearance = {'appearanceType': operation.get('appearanceType', 'onscreen'), 'states': operation.get('states', []),
                                  'presentationNotes': operation.get('presentationNotes', []), 'basis': 'inference',
                                  'productionNeed': operation.get('productionNeed', 'onscreen'),
                                  'evidence': copy.deepcopy(evidence), 'inferenceReason': reason, 'semanticReviewId': review_id}
                    if appearance['appearanceType'] not in ('onscreen', 'offscreen', 'memory'):
                        raise ValueError('连续性出场类型无效')
                    if appearance['productionNeed'] not in ('candidate', 'onscreen', 'reference_only'):
                        raise ValueError('连续性出场制作需求无效')
                    _bind_revised_appearance(revised, appearance, char, outfit, state_basis='inference')
                    segment.setdefault('appearances', []).append(appearance)
                else:
                    if not appearances:
                        raise ValueError('指定片段没有待修订状态的人物')
                    for appearance in appearances:
                        before.setdefault('appearances', []).append({'chapter': number, 'segmentId': segment['id'],
                            'states': copy.deepcopy(appearance.get('states', [])), 'stateId': appearance.get('stateId'),
                            'presentationNotes': copy.deepcopy(appearance.get('presentationNotes', []))})
                        outfit = next((x for x in char.get('outfits', []) if x['id'] == appearance.get('outfitId')), None)
                        appearance['states'] = copy.deepcopy(operation.get('states', []))
                        appearance['materialStates'] = []
                        old_notes = [] if operation.get('replacePresentationNotes') else appearance.get('presentationNotes', [])
                        appearance['presentationNotes'] = list(dict.fromkeys(old_notes + operation.get('presentationNotes', [])))
                        appearance['materialStateEvidence'] = copy.deepcopy(evidence)
                        appearance['stateInferenceReason'] = reason if basis == 'inference' else ''
                        state_basis = operation.get('materialStateBasis') or basis
                        if state_basis not in ('source', 'inference'):
                            raise ValueError('材料状态依据无效')
                        appearance['stateInferenceReason'] = reason if state_basis == 'inference' else ''
                        _bind_revised_appearance(revised, appearance, char, outfit, state_basis=state_basis)
                        appearance['semanticReviewId'] = review_id
                changed_targets.append({'chapter': number, 'segmentId': segment['id']})
        changes.append({'type': kind, **before, 'targets': changed_targets or copy.deepcopy(operation.get('targets', [])),
                        'basis': basis, 'reason': reason, 'evidence': evidence})
    _refresh_revision_bindings(revised)
    revised.setdefault('semanticReviews', []).append({'id': review_id, 'reviewer': str(reviewer), 'createdAt': time.time(),
                                                     'status': 'applied', 'changes': changes,
                                                     'verificationScope': '原文引用已回查；语义判断由审校决定提供。'})
    return {'project': revised, 'reviewId': review_id, 'changes': changes, 'warnings': []}
