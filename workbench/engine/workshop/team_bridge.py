"""One-way team v2 exports and checks for explicit storyboard asset bindings.

No image/model calls or guessed spreadsheet mappings occur in this module.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit

COLLECTIONS = ('documents', 'sources', 'facts', 'entities', 'relationships', 'events', 'rules', 'clues',
    'source_conflicts', 'requirements', 'client_checks', 'adaptations', 'assets', 'states', 'references',
    'episodes', 'panels', 'texts', 'styles', 'layouts', 'prompts', 'handoffs', 'revisions', 'human_checks', 'exports')


def _prefix(project):
    return project.setdefault('teamProjectPrefix', 'BOOK' + hashlib.sha256(str(project.get('id') or project.get('name')).encode()).hexdigest()[:6].upper())


def _id(prefix, kind, value):
    return prefix + '-' + kind + hashlib.sha256(str(value).encode()).hexdigest()[:12].upper()


def _file(url, data_directory):
    if not isinstance(url, str) or not url.startswith('/files/') or urlsplit(url).query or urlsplit(url).fragment:
        return None
    root = Path(data_directory).resolve()
    candidate = (root / unquote(url[len('/files/'):])).resolve()
    if not any(candidate.is_relative_to((root / sub).resolve()) for sub in ('assets', 'generated')):
        return None
    if not candidate.is_file() or candidate.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp'):
        return None
    try:
        from PIL import Image
        with Image.open(candidate, formats=['PNG', 'JPEG', 'WEBP']) as image:
            if image.width < 1 or image.height < 1:
                return None
    except (OSError, ValueError):
        return None
    return candidate


def register_references(project, data_directory):
    """Persist stable reference slots; replacing image content increments version."""
    from life_stages import ensure_appearance_profiles
    ensure_appearance_profiles(project)
    prefix = _prefix(project)
    records = project.setdefault('teamReferences', [])
    slots = []
    for character in project.get('characters', []):
        for profile in character.get('appearanceProfiles', []):
            asset, state = profile.get('teamAssetId'), profile.get('teamStateId')
            if not asset or not state:
                continue
            for field, role in (('face','identity'),('faceCore','face_core'),('base','body'),('reference','input_reference')):
                if profile.get(field): slots.append((asset,state,role,profile[field]))
            if profile.get('hairstyle',{}).get('image'): slots.append((asset,state,'hairstyle',profile['hairstyle']['image']))
            if character.get('category') == '群像' and profile.get('id') == character.get('defaultAppearanceProfileId'):
                crowd = character.get('crowdAssets') or {}
                for field, role in (('fullGroupImage','crowd_full'),('headSheet','crowd_heads'),('clothingSheet','crowd_clothing')):
                    if crowd.get(field): slots.append((asset,state,role,crowd[field]))

        for outfit in character.get('outfits', []):
            asset, state = outfit.get('teamAssetId'), outfit.get('teamStateId')
            if not asset or not state:
                continue
            for field, role in (('card', 'wearing_card'), ('hands', 'hand_card'), ('combined', 'combined_card'), ('reference', 'costume_reference')):
                if outfit.get(field):
                    slots.append((asset, state, role, outfit[field]))
    active = set()
    for asset, state, role, url in slots:
        slot = asset + ':' + state + ':' + role
        active.add(slot)
        record = next((item for item in records if item.get('slot') == slot), None)
        file = _file(url, data_directory)
        signature = None
        if file:
            stat = file.stat()
            signature = [str(file), stat.st_size, stat.st_mtime_ns]
        if record and record.get('_stat') == signature and record.get('url') == url:
            record['available'] = bool(file)
            continue
        digest = hashlib.sha256(file.read_bytes()).hexdigest() if file else None
        if record is None:
            record = {'reference_id': _id(prefix, 'REF', slot), 'asset_id': asset, 'state_id': state,
                'reference_role': role, 'version': 1, 'slot': slot, 'history': []}
            records.append(record)
        elif record.get('sha256') != digest and digest is not None:
            record['history'].append({'version': record['version'], 'url': record.get('url'), 'sha256': record.get('sha256')})
            record['version'] += 1
            record['review_status'] = 'pending'
        record.update(url=url, file_path=str(file) if file else None, runtime_id=None,
            available=bool(file), sha256=digest, _stat=signature)
        record.setdefault('review_status', 'pending')
    for record in records:
        if record.get('slot') not in active or record.get('mergeRetired'):
            record['available'] = False
            record['review_status'] = 'pending'
    return records


def export_team_master(project, data_directory):
    """Export source-backed asset draft, keeping absent boards/approvals absent."""
    from chapter_analysis import register_project_ids
    from life_stages import get_profile
    project = copy.deepcopy(project)
    register_project_ids(project)
    register_references(project, data_directory)
    prefix = _prefix(project)
    analysis = project.get('chapterAnalysis') or {}
    chapters = project.get('chapters') or []
    read = sorted({item['chapter'] for item in chapters})
    supplied = sorted({item.get('chapter') for item in project.get('availableChapters', []) if isinstance(item.get('chapter'), int)} | set(read))
    source_hashes = sorted({item.get('sha256') for item in project.get('sourceFiles', []) if item.get('sha256')})
    analyzed = sorted({item['chapter'] for item in analysis.get('chapters', []) if item.get('readStatus') == 'analyzed' and item['chapter'] in read})
    pending = [number for number in read if number not in analyzed]
    version_data = {'sourceHashes': source_hashes, 'range': project.get('readRange'), 'style': project.get('style'),
        'analysis': analysis, 'characters': project.get('characters', []), 'states': project.get('teamAssetStates', []),
        'references': [{k: r.get(k) for k in ('reference_id', 'asset_id', 'state_id', 'version', 'sha256', 'available', 'review_status')}
                       for r in project.get('teamReferences', [])]}
    master_version = '2.0.' + hashlib.sha256(json.dumps(version_data, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
    master = {'schema_version': 'novel_comic_team_v2', 'document_status': 'source_asset_draft',
        'project': {'project_id': prefix, 'title': project.get('name', ''), 'source_version': '+'.join(source_hashes) or 'manual-unverified',
            'master_version': master_version, 'master_carrier': 'json',
            'supplied_chapters': supplied, 'read_chapters': read, 'unread_chapters': [n for n in supplied if n not in read],
            'coverage_note': f'已读取{read}；已完整映射片段的章节{analyzed}，尚待完整分析{pending}。当前提取聚焦人物、服装、群像。甲方分镜未提供，其他小说规则／伏笔尚待完整核验。',
            'adaptation_mode': 'faithful_compression', 'primary_style_id': None,
            'tool_profile': {'verified': False, 'formats': [], 'field_mapping': {}, 'maximum_rows': None,
                'creates_bubbles': None, 'supports_layout': None, 'supports_references': None}},
        **{collection: [] for collection in COLLECTIONS}}
    documents, source_ids, chapter_sources, paragraph_map = {}, {}, {}, {}
    for chapter in chapters:
        document_key = chapter.get('sourceHash') or chapter.get('sourceId') or 'manual'
        doc_id = _id(prefix, 'DOC', document_key)
        source_file = next((item for item in project.get('sourceFiles', []) if item.get('id') == chapter.get('sourceId') or item.get('sha256') == chapter.get('sourceHash')), {})
        documents.setdefault(doc_id, {'document_id': doc_id, 'kind': 'novel', 'title': source_file.get('name') or project.get('name', ''),
            'version': document_key, 'location': source_file.get('url', ''), 'read_scope': str([scope.get('range') for scope in project.get('readScopes',[])] or project.get('readRange') or read)})
        chapter_sources[chapter['chapter']] = []
        for paragraph in chapter.get('paragraphs', []):
            identifier = _id(prefix, 'S', f'{document_key}:{chapter.get("member", "")}:{chapter["chapter"]}:{paragraph["index"]}')
            source_ids[(chapter['chapter'], paragraph['id'])] = identifier
            paragraph_map[identifier] = paragraph['text']
            chapter_sources[chapter['chapter']].append(identifier)
            master['sources'].append({'source_id': identifier, 'document_id': doc_id, 'chapter': chapter['chapter'],
                'paragraph': paragraph['index'], 'raw_text': paragraph['text'], 'clean_text': paragraph['text'], 'handling': 'indexed'})
    master['documents'] = list(documents.values())
    chars = {character['id']: character for character in project.get('characters', [])}
    outfits = {outfit['id']: outfit for character in chars.values() for outfit in character.get('outfits', [])}
    entity_sources, asset_sources, state_events = {}, {}, {}
    def evidence_ids(number, appearance):
        return list(dict.fromkeys(source_ids[(number, e['paragraphId'])] for e in appearance.get('evidence', [])
            if e.get('verified') and (number, e.get('paragraphId')) in source_ids))
    for chapter in analysis.get('chapters', []):
        number = chapter['chapter']
        if number not in chapter_sources:
            continue
        for segment in chapter.get('segments', []):
            ev_id = segment['id']
            actors = []
            ev_sources = [source_ids[(number, pid)] for pid in segment.get('sourceParagraphIds', []) if (number, pid) in source_ids]
            for appearance in segment.get('appearances', []):
                character = chars.get(appearance.get('characterId'))
                outfit = outfits.get(appearance.get('outfitId'))
                if not character:
                    continue
                profile = get_profile(character,appearance.get('appearanceProfileId') or (outfit or {}).get('appearanceProfileId') or character.get('defaultAppearanceProfileId')) or character
                state_events.setdefault(profile['teamStateId'], []).append(ev_id)
                evidence = evidence_ids(number, appearance)
                entity_sources.setdefault(character['identityEntityId'], []).extend(evidence or ev_sources)
                asset_sources.setdefault(profile['teamAssetId'], []).extend(evidence)
                if outfit:
                    asset_sources.setdefault(outfit['teamAssetId'], []).extend(evidence)
                state_events.setdefault(appearance.get('stateId'), []).append(ev_id)
                if appearance.get('appearanceType') == 'onscreen':
                    actors.append(character['identityEntityId'])
                for evidence_item in appearance.get('evidence', []):
                    if not evidence_item.get('verified') or appearance.get('basis') not in ('source', 'inference'):
                        continue
                    sid = source_ids.get((number, evidence_item.get('paragraphId')))
                    if not sid:
                        continue
                    content = evidence_item.get('quote') or paragraph_map[sid]
                    fact_id = _id(prefix, 'F', character['identityEntityId'] + ':' + sid + ':' + content)
                    if not any(item['fact_id'] == fact_id for item in master['facts']):
                        master['facts'].append({'fact_id': fact_id, 'source_ids': [sid], 'subject_id': character['identityEntityId'],
                            'type': 'appearance_evidence', 'content': content, 'basis': appearance.get('basis'),
                            'claim_type': evidence_item.get('claimType', 'literal'), 'review_status': 'draft'})
            master['events'].append({'event_id': ev_id, 'source_ids': list(dict.fromkeys(ev_sources)), 'actors': list(dict.fromkeys(actors)),
                'scene_entity_id': None, 'goal': '', 'obstacle': '', 'action': segment.get('summary') or segment.get('title', ''),
                'result': '', 'depends_on': [], 'story_time': segment.get('time', ''), 'knowledge': [], 'prop_changes': [], 'disposition': 'keep'})
    for character in chars.values():
        entity_id = character['identityEntityId']
        citations = list(dict.fromkeys(entity_sources.get(entity_id, [])))
        master['entities'].append({'entity_id': entity_id, 'kind': 'character', 'name': character['name'],
            'aliases': character.get('aliases', []), 'source_ids': citations, 'speaking_mode': 'unknown', 'review_status': 'draft'})
        objects = [(profile, 'crowd' if character.get('category') == '群像' else 'character', character['name']+' · '+profile.get('name','当前定稿时期')) for profile in character.get('appearanceProfiles',[])]
        objects += [(outfit, 'costume', character['name'] + ' · ' + outfit['name']) for outfit in character.get('outfits', [])]
        for obj, kind, name in objects:
            aid, state_id = obj['teamAssetId'], obj['teamStateId']
            visual_profile = (get_profile(character,obj.get('appearanceProfileId')) if kind=='costume' else obj) or {}
            visual_fields = {'face_identity_group_id':visual_profile.get('faceIdentityGroupId',''),
                'face_continuity':copy.deepcopy(visual_profile.get('faceContinuity',{})),
                'face_core':visual_profile.get('faceCore',''),'library_face_core_id':visual_profile.get('libraryFaceCoreId',''),
                'hairstyle':copy.deepcopy(visual_profile.get('hairstyle',{})),
                'body_continuity':visual_profile.get('identityContinuity','unspecified')}


            if kind == 'crowd' and obj.get('id') == character.get('defaultAppearanceProfileId'):
                crowd = character.get('crowdAssets') or {}
                visual_fields.update(crowd_set_id=character.get('crowdSetId') or crowd.get('crowdSetId',''),
                    crowd_assets=copy.deepcopy(crowd), production_ready=bool(crowd.get('productionReady')),
                    source_facts=copy.deepcopy(crowd.get('sourceFacts') or {'memberCount':'unknown','sameFrame':'unknown','clothing':'unknown'}),
                    member_index=copy.deepcopy(crowd.get('memberIndex',[])))

            citations = list(dict.fromkeys(asset_sources.get(aid, [])))
            original_fragments = list(dict.fromkeys(fact['content'] for fact in master['facts']
                if fact.get('subject_id') == entity_id and fact.get('basis') == 'source'
                and any(source in citations for source in fact.get('source_ids', []))))
            # Mixed free-form descriptions stay unclassified draft notes. Only
            # verified original fragments enter source_features; no design is
            # claimed adopted merely because a model produced a description.
            master['assets'].append({'asset_id': aid, 'entity_id': entity_id, 'kind': kind, 'name': name,
                'appearance_group_id': aid, 'source_ids': citations, 'source_features': original_fragments,
                'design_features': [], 'draft_notes': obj.get('scriptDescription') or obj.get('description') or (character.get('scriptDescription') or character.get('description','') if obj.get('id') == character.get('defaultAppearanceProfileId') else ''), 'state_ids': [state_id],
                'source_description_history': copy.deepcopy(obj.get('sourceDescriptionHistory', character.get('sourceDescriptionHistory',[]) if obj.get('id') == character.get('defaultAppearanceProfileId') else [])),
                'first_mention_source_id': citations[0] if citations else None, 'first_visible_panel_id': None,
                'acquired_event_id': None, 'activated_event_id': None, 'first_use_event_id': None,
                'production_need': 'candidate', 'review_status': 'draft', 'workbench_id': obj['id'],
                'appearance_profile_id': obj.get('appearanceProfileId') or (obj.get('id') if kind in ('character','crowd') else None),
                'identity_review_pending':bool(obj.get('identityReviewPending')),
                'period': obj.get('period'), 'age_stage': obj.get('ageStage'), 'age_text': obj.get('ageText',''),**visual_fields})
            refs = [r['reference_id'] for r in project.get('teamReferences', []) if r.get('state_id') == state_id and r.get('available')]
            master['states'].append({'state_id': state_id, 'asset_id': aid, 'source_ids': citations,
                'description': obj.get('name', '') + (' · 默认身份' if kind in ('character', 'crowd') else ' · 服装版本'),
                'allowed_event_ids': list(dict.fromkeys(state_events.get(state_id, []))), 'reference_ids': refs, 'review_status': 'draft',**visual_fields})
    # Explicit production/adaptation policies stay outside original novel facts.
    for character in chars.values():
        for profile in character.get('appearanceProfiles',[]):
            relation=profile.get('faceContinuity',{})
            if relation.get('basis')=='authorized_adaptation':
                master['adaptations'].append({'adaptation_id':_id(prefix,'ADAPT','face:'+profile['id']),
                    'entity_id':character['identityEntityId'],'appearance_profile_id':profile['id'],
                    'status':'authorized','basis':'authorized_adaptation','source_ids':[],
                    'description':'用户指定脸部关联：'+relation.get('status','unknown'),
                    'source_profile_id':relation.get('sourceProfileId',''),
                    'face_identity_group_id':profile.get('faceIdentityGroupId','')})
    assets_by_id = {item['asset_id']: item for item in master['assets']}
    for state in project.get('teamAssetStates', []):
        asset = assets_by_id.get(state.get('assetId'))
        if not asset or any(item['state_id'] == state['id'] for item in master['states']):
            continue
        asset['state_ids'].append(state['id'])
        state_sources = []
        for evidence in state.get('evidence', []):
            if not evidence.get('verified'):
                continue
            pid = evidence.get('paragraphId', '')
            matching = [identifier for (number, paragraph_id), identifier in source_ids.items() if paragraph_id == pid]
            state_sources.extend(matching)
        master['states'].append({'state_id': state['id'], 'asset_id': state['assetId'], 'source_ids': list(dict.fromkeys(state_sources)),
            'description': '、'.join(state.get('states', [])), 'allowed_event_ids': list(dict.fromkeys(state_events.get(state['id'], []))),
            'reference_ids': [], 'review_status': 'pending', 'basis': state.get('basis', 'inference'), 'retired': state.get('retired', False)})
    master['references'] = [{key: value for key, value in record.items() if key not in {'slot', '_stat', 'history', 'url'}}
        for record in project.get('teamReferences', []) if record['asset_id'] in assets_by_id]
    master['handoffs'].append({'handoff_id': _id(prefix, 'H', 'asset-draft'), 'scope': str(project.get('readRange') or read),
        'master_version': master['project']['master_version'], 'from_role': '角色工房', 'to_role': '编剧与分镜',
        'completed': [f'已读取章节{read}的索引', f'已完整映射章节{analyzed}的人物／衣着／群像需求', '当前已登记人物、资产与状态编号'],
        'pending': [f'章节{pending}尚待完整逐段分析', '甲方分镜尚未提供，未核验逐格绑定', '人物关系／规则／伏笔等完整原著母版字段待继续提取',
            '待设计外观和真实图片', '实际成图与排版验收'], 'status': 'pending'})
    master['workbench'] = {'project_id': project['id'], 'chapter_analysis': analysis,
        'read_scopes':copy.deepcopy(project.get('readScopes',[])), 'merge_history':copy.deepcopy(project.get('mergeHistory',[])),
        'book_identity':copy.deepcopy(project.get('bookIdentity',{})),
        'face_identity_groups':copy.deepcopy(project.get('faceIdentityGroups',[])),
        'visual_identity_reviews':copy.deepcopy(project.get('visualIdentityReviews',[])), 'characters':copy.deepcopy(project.get('characters',[])),
        'semantic_reviews': copy.deepcopy(project.get('semanticReviews', project.get('semanticReviewLog', []))),
        'reference_history': [{k: v for k, v in r.items() if k not in {'_stat', 'file_path'}} for r in project.get('teamReferences', [])],
        'client_material_status': 'not_provided', 'board_alignment_status': 'not_provided'}
    return master


def check_panel_bindings(master, panels, master_version=None, project_id=None):
    """Validate IDs, ownership and pinned reference versions, never name-guess."""
    errors, warnings = [], []
    if not isinstance(panels, list) or len(panels) > 10000:
        return {'status': 'needs_revision', 'errors': ['分镜panels需要不超过10000项的数组。'], 'warnings': [], 'panel_count': 0}
    if project_id is not None and project_id != master['project']['project_id']:
        errors.append('分镜项目编号与当前资产母版不同。')
    if master_version is not None and master_version != master['project']['master_version']:
        errors.append('分镜使用的母版版本已变化，请重新核对资产引用。')
    assets = {item['asset_id']: item for item in master['assets']}
    states = {item['state_id']: item for item in master['states']}
    references = {item['reference_id']: item for item in master['references']}
    seen = set()
    for index, panel in enumerate(panels, 1):
        if not isinstance(panel, dict):
            errors.append(f'第{index}格不是对象。')
            continue
        identifier = panel.get('panel_id')
        if not isinstance(identifier, str) or not identifier:
            errors.append(f'第{index}格缺少稳定格编号，不能仅按行号对齐。')
            identifier = f'第{index}格'
        elif identifier in seen:
            errors.append(f'{identifier}格编号重复。')
        seen.add(identifier)
        bindings = panel.get('asset_bindings')
        if not isinstance(bindings, list):
            errors.append(f'{identifier}缺少asset_bindings资产引用数组。')
            continue
        if not bindings:
            warnings.append(f'{identifier}没有实体资产绑定；需确认属于无人物／抽象／文字格。')
        for binding in bindings:
            if not isinstance(binding, dict):
                errors.append(f'{identifier}资产绑定格式不正确。')
                continue
            aid, sid = binding.get('asset_id'), binding.get('state_id')
            if not isinstance(aid, str) or not isinstance(sid, str):
                errors.append(f'{identifier}资产与状态编号必须是文字。')
                continue
            if aid not in assets:
                errors.append(f'{identifier}引用了未登记资产：{aid}。')
                continue
            if assets[aid].get('identity_review_pending'):
                errors.append(f'{identifier}人物时期已修改，需按新身份重新制作并核验：{aid}。')
            if sid not in states or states[sid]['asset_id'] != aid:
                errors.append(f'{identifier}造型状态不属于该资产：{sid}。')
                continue
            if states[sid].get('retired'):
                errors.append(f'{identifier}引用了已废弃造型状态：{sid}，需要重新核对。')
                continue
            refs, versions = binding.get('reference_ids'), binding.get('reference_versions')
            if not isinstance(refs, list) or not refs:
                errors.append(f'{identifier}资产{aid}尚未绑定真实参考图。')
                continue
            if not isinstance(versions, dict):
                errors.append(f'{identifier}未锁定参考图版本。')
                versions = {}
            for rid in refs:
                reference = references.get(rid) if isinstance(rid, str) else None
                if not reference or reference['asset_id'] != aid:
                    errors.append(f'{identifier}参考图不属于当前资产：{rid}。')
                    continue
                if reference.get('state_id') != sid:
                    errors.append(f'{identifier}参考图造型状态不匹配：{rid}。')
                if versions.get(rid) != reference['version']:
                    errors.append(f'{identifier}参考图版本不匹配：{rid}。')
                if not reference.get('available'):
                    errors.append(f'{identifier}参考图文件缺失：{rid}。')
                if reference.get('review_status') != 'checked':
                    warnings.append(f'{identifier}参考图{rid}尚未完成视觉验收。')
    return {'status': 'needs_revision' if errors else ('structure_matched_review_pending' if warnings else 'structure_matched'),
        'errors': errors, 'warnings': warnings, 'panel_count': len(panels),
        'limits': '核对登记编号、状态归属与真实图片版本；图像外观、剧情语义及排版需要另行验收。'}
