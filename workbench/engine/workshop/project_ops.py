"""Source-based book identity, recoverable project merges, and scope caching.

Pure project operations except bounded local OPF/header metadata reads.
Never invokes a model, expands unselected chapter bodies, or deletes files.
"""
from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import re
import unicodedata


class ProjectOperationError(ValueError):
    pass


def _unique(rows, key):
    result, seen = [], set()
    for row in rows:
        identity = key(row)
        if identity not in seen:
            seen.add(identity)
            result.append(copy.deepcopy(row))
    return result


def _title(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value or "")).strip("《》 \t\r\n")).casefold()


def book_identity(project, data_directory):
    """Only verified saved bytes or explicit original metadata identify a book."""
    root = Path(data_directory).resolve()
    hashes, books, warnings = [], [], []
    for source in project.get("sourceFiles", []):
        if source.get("format") == "zip":
            continue
        url = source.get("url", "")
        if not isinstance(url, str) or not re.fullmatch(r"/files/assets/[A-Za-z0-9_.-]+", url):
            continue
        path = (root / url.removeprefix("/files/")).resolve()
        if not path.is_relative_to(root / "assets") or not path.is_file() or path.stat().st_size > 20 * 1024 * 1024:
            continue
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if source.get("sha256") and source["sha256"] != digest:
            warnings.append("来源原件校验不同，未用于自动识别：" + str(source.get("name", "")))
            continue
        hashes.append(digest)
        title, authors, identifier = "", [], ""
        try:
            if path.suffix.lower() == ".epub":
                from ebook_import import _Package, _xml, _local, _resolve, _child
                package = _Package(raw, "EPUB")
                try:
                    container = _xml(package.read("META-INF/container.xml"), "EPUB容器")
                    entry = next(x for x in container.iter() if _local(x.tag) == "rootfile" and x.get("full-path"))
                    opf = _xml(package.read(_resolve("", entry.get("full-path"))), "EPUB书目")
                    metadata = _child(opf, "metadata")
                    if metadata is not None:
                        title = next(("".join(x.itertext()).strip() for x in metadata if _local(x.tag) == "title"), "")
                        authors = ["".join(x.itertext()).strip() for x in metadata if _local(x.tag) == "creator"]
                        identifier = next(("".join(x.itertext()).strip() for x in metadata if _local(x.tag) == "identifier"), "")
                finally:
                    package.close()
            elif path.suffix.lower() in {".txt", ".md", ".markdown", ".fountain"}:
                text = raw[:65536].decode("utf-8-sig", errors="ignore")
                title_match = re.search(r"(?m)^\s*(?:书名|作品名称|作品名|剧名|标题)\s*[:：]\s*(.+)$", text)
                author_match = re.search(r"(?m)^\s*(?:作者|著者)\s*[:：]\s*(.+)$", text)
                title = title_match[1].strip("《》 ") if title_match else ""
                authors = [author_match[1].strip()] if author_match else []
            if title:
                books.append({"title": title, "authors": sorted({x for x in authors if x}), "identifier": identifier,
                              "sourceHash": digest, "sourceId": source.get("id", "")})
        except Exception as exc:
            warnings.append("书籍元数据尚未识别：" + str(exc)[:180])
    return {"version": 1, "sourceHashes": sorted(set(hashes)),
            "books": _unique(books, lambda x: (x["title"], tuple(x["authors"]), x["identifier"], x["sourceHash"])),
            "warnings": warnings}


def same_book(left, right):
    hashes = sorted(set(left.get("sourceHashes", [])) & set(right.get("sourceHashes", [])))
    if hashes:
        return {"matched": True, "basis": "verified_original_sha256", "evidence": hashes}
    for a in left.get("books", []):
        for b in right.get("books", []):
            if not _title(a.get("title")) or _title(a["title"]) != _title(b.get("title")):
                continue
            authors = {_title(x) for x in a.get("authors", [])} & {_title(x) for x in b.get("authors", [])}
            if authors:
                return {"matched": True, "basis": "original_title_and_author", "evidence": [a, b]}
            aid, bid = str(a.get("identifier", "")), str(b.get("identifier", ""))
            if aid and aid == bid and len(aid) >= 12:
                return {"matched": True, "basis": "original_title_and_identifier", "evidence": [a, b]}
    return {"matched": False, "basis": "insufficient_original_identity", "evidence": []}


def _scope(project):
    rng = project.get("readRange") or [project.get("rangeStart", 1), project.get("rangeEnd", 20)]
    hashes = sorted({x.get("sourceHash") for x in project.get("chapters", []) if x.get("sourceHash") and rng[0] <= x["chapter"] <= rng[1]})
    payload = json.dumps([rng, hashes], sort_keys=True)
    return {"id": "scope_" + hashlib.sha256(payload.encode()).hexdigest()[:16], "range": list(rng),
            "chapters": sorted({x["chapter"] for x in project.get("chapters", []) if rng[0] <= x["chapter"] <= rng[1]}),
            "sourceHashes": hashes, "rangeVerified": bool(project.get("rangeVerified")),
            "readAt": project.get("updatedAt") or project.get("createdAt")}


def ensure_scopes(project):
    if project.get("chapters") or project.get("readRange"):
        project["readScopes"] = _unique([*project.get("readScopes", []), _scope(project)], lambda row: row["id"])
    else:
        project.setdefault("readScopes", [])
    return project


def _remap(value, ids):
    if isinstance(value, str):
        return ids.get(value, value)
    if isinstance(value, list):
        return [_remap(item, ids) for item in value]
    if isinstance(value, dict):
        return {ids.get(key, key): (item if key in {"quote", "text", "raw_text", "clean_text", "description", "name", "title", "mergeHistory", "lastAutomaticMerge", "restoreHistory", "alternateOriginals"}
                                   else _remap(item, ids)) for key, item in value.items()}
    return value


def _merge_fields(target, incoming, conflicts, owner):
    """Keep established choices; conflicting artwork is retained as a variant."""
    for key, value in incoming.items():
        if key in {"id", "identityEntityId", "teamAssetId", "teamStateId", "outfits", "appearanceProfiles",
                   "defaultAppearanceProfileId", "activeAppearanceProfileId"}:
            continue
        if key in {"aliases", "identityNames", "episodes", "references"} and isinstance(value, list):
            existing = target.get(key, [])
            target[key] = sorted(set(existing + value)) if all(isinstance(x, (str, int)) for x in existing + value) else _unique(existing + value, lambda x: json.dumps(x, sort_keys=True))
        elif not target.get(key):
            target[key] = copy.deepcopy(value)
        elif target[key] != value and key in {"face", "base", "card", "hands", "combined", "reference", "faceCandidateSheet", "description", "scriptDescription", "sourceDescription", "category"}:
            conflicts.append({"kind": "field_variant", "owner": owner, "field": key,
                              "kept": copy.deepcopy(target[key]), "incoming": copy.deepcopy(value), "decision": "keep_primary_review_variant"})
            target.setdefault("mergeVariants", []).append({"field": key, "value": copy.deepcopy(value)})
        elif isinstance(value, list) and isinstance(target[key], list) and key in {"sourceDescriptionHistory", "productionHistory", "mergeVariants"}:
            target[key] = _unique(target[key] + value, lambda x: json.dumps(x, sort_keys=True))


def _names(character):
    generic = {"他", "她", "爹", "娘", "母亲", "父亲", "哥哥", "妹妹", "男子", "女子"}
    return {str(x) for x in [character.get("name"), *character.get("aliases", []), *character.get("identityNames", [])] if x and x not in generic}


def _match_profile(profiles, incoming):
    direct = [x for x in profiles if x.get("id") == incoming.get("id")]
    if direct:
        return direct[0]
    candidates = [x for x in profiles if x.get("period") == incoming.get("period") and x.get("ageStage") == incoming.get("ageStage")
                  and (x.get("name") == incoming.get("name") or (x.get("period") not in {None, "unspecified"} and x.get("ageStage") not in {None, "unspecified"}))]
    return candidates[0] if len(candidates) == 1 else None


def merge_projects(primary, secondary, select_incoming_scope=False):
    """Return merged copy, a complete ID map and explicit conflicting variants."""
    from chapter_analysis import register_project_ids, chapter_fingerprint
    merged, incoming = copy.deepcopy(primary), copy.deepcopy(secondary)
    ensure_scopes(merged); ensure_scopes(incoming)
    register_project_ids(merged); register_project_ids(incoming)
    ids, conflicts = {incoming["id"]: merged["id"]}, []
    old_characters = len(merged.get("characters", []))
    source_records = {row.get("sha256") or row.get("id"): row for row in merged.get("sourceFiles", [])}
    for source in incoming.get("sourceFiles", []):
        key = source.get("sha256") or source.get("id")
        if key in source_records:
            target = source_records[key]
            ids[source["id"]] = target["id"]
            if source.get("url") and source.get("url") != target.get("url"):
                target.setdefault("alternateOriginals", []).append({"id": source["id"], "url": source["url"], "name": source.get("name")})
        else:
            merged.setdefault("sourceFiles", []).append(copy.deepcopy(source)); source_records[key] = merged["sourceFiles"][-1]
    for source in merged.get("sourceFiles", []):
        if source.get("archive") in ids:
            source["archive"] = ids[source["archive"]]
    for character in incoming.get("characters", []):
        matches = [x for x in merged.get("characters", []) if x.get("id") == character["id"]
                   or x.get("identityEntityId") == character.get("identityEntityId") or _names(x) & _names(character)]
        target = matches[0] if len(matches) == 1 else None
        if target is None:
            if matches:
                conflicts.append({"kind": "ambiguous_character_identity", "name": character["name"], "decision": "retain_independent_identity"})
            merged.setdefault("characters", []).append(copy.deepcopy(character))
            target = merged["characters"][-1]
            continue
        for key in ("id", "identityEntityId", "teamAssetId", "teamStateId"):
            if character.get(key) and target.get(key):
                ids[character[key]] = target[key]
        if re.search(r"未明|未具名|未知", target.get("name", "")) and not re.search(r"未明|未具名|未知", character.get("name", "")):
            target.setdefault("aliases", []).append(target["name"]); target["name"] = character["name"]
        _merge_fields(target, character, conflicts, target["id"])
        for profile in character.get("appearanceProfiles", []):
            profiles = target.setdefault("appearanceProfiles", [])
            destination = _match_profile(profiles, profile)
            if destination is None:
                profiles.append(copy.deepcopy(profile)); destination = profiles[-1]
            else:
                for key in ("id", "teamAssetId", "teamStateId"):
                    if profile.get(key) and destination.get(key):
                        ids[profile[key]] = destination[key]
                _merge_fields(destination, profile, conflicts, destination["id"])
        for outfit in character.get("outfits", []):
            mapped_profile = ids.get(outfit.get("appearanceProfileId"), outfit.get("appearanceProfileId"))
            candidates = [x for x in target.get("outfits", []) if x["id"] == outfit["id"] or
                          (x.get("name") == outfit.get("name") and x.get("appearanceProfileId") == mapped_profile)]
            destination = candidates[0] if len(candidates) == 1 else None
            if destination is None:
                record = copy.deepcopy(outfit)
                if mapped_profile:
                    record["appearanceProfileId"] = mapped_profile
                target.setdefault("outfits", []).append(record)
            else:
                for key in ("id", "teamAssetId", "teamStateId"):
                    if outfit.get(key) and destination.get(key):
                        ids[outfit[key]] = destination[key]
                _merge_fields(destination, outfit, conflicts, destination["id"])
    merged = _remap(merged, ids)
    incoming = _remap(incoming, ids)
    source_chapters = {x["chapter"]: x for x in merged.get("chapters", [])}
    accepted = set()
    for chapter in incoming.get("chapters", []):
        number = chapter["chapter"]
        prior = source_chapters.get(number)
        if prior is None:
            merged.setdefault("chapters", []).append(copy.deepcopy(chapter)); source_chapters[number] = merged["chapters"][-1]; accepted.add(number)
        elif prior.get("text", "").strip() != chapter.get("text", "").strip():
            conflicts.append({"kind": "chapter_source_version", "chapter": number, "keptSourceHash": prior.get("sourceHash"),
                              "incomingSourceHash": chapter.get("sourceHash"), "decision": "keep_primary_source_review_variant"})
            merged.setdefault("chapterVariants", []).append(copy.deepcopy(chapter))
        else:
            accepted.add(number)
    merged["chapters"] = sorted(merged.get("chapters", []), key=lambda x: x["chapter"])
    analysis = merged.setdefault("chapterAnalysis", {"chapters": [], "warnings": []})
    known_analysis = {x["chapter"]: x for x in analysis.get("chapters", [])}
    for chapter in incoming.get("chapterAnalysis", {}).get("chapters", []):
        number = chapter["chapter"]
        if number not in accepted:
            merged.setdefault("analysisVariants", []).append(copy.deepcopy(chapter)); continue
        if number not in known_analysis:
            copy_chapter = copy.deepcopy(chapter)
            if number in source_chapters:
                source = source_chapters[number]
                for key in ("sourceId", "sourceHash", "member"):
                    if key in source:
                        copy_chapter[key] = source[key]
                copy_chapter["inputHash"] = chapter_fingerprint(source)
            analysis.setdefault("chapters", []).append(copy_chapter)
            known_analysis[number] = copy_chapter
        elif json.dumps(known_analysis[number], sort_keys=True) != json.dumps(chapter, sort_keys=True):
            merged.setdefault("analysisVariants", []).append(copy.deepcopy(chapter))
            conflicts.append({"kind": "analysis_variant", "chapter": number, "decision": "keep_primary_analysis_review_variant"})
    analysis["chapters"] = sorted(analysis.get("chapters", []), key=lambda x: x["chapter"])
    analysis["warnings"] = list(dict.fromkeys(analysis.get("warnings", []) + incoming.get("chapterAnalysis", {}).get("warnings", [])))
    # Keep historical references explicit. A changed mapped slot must never
    # silently acquire a different image/version under the old reference id.
    known_slots = {r.get("slot"): r for r in merged.get("teamReferences", [])}
    for reference in incoming.get("teamReferences", []):
        previous_slot = reference.get("slot", "")
        mapped_slot = ":".join(ids.get(x, x) for x in previous_slot.split(":"))
        reference["slot"] = mapped_slot
        existing = known_slots.get(mapped_slot)
        if existing and reference.get("reference_id") != existing.get("reference_id"):
            reference["available"] = False
            reference["mergeRetired"] = True
            reference["review_status"] = "pending"
            conflicts.append({"kind": "reference_slot_variant", "referenceId": reference.get("reference_id"),
                              "primaryReferenceId": existing.get("reference_id"), "decision": "retain_history_not_rebind_version"})
        else:
            known_slots[mapped_slot] = reference
    for key in ("teamAssetStates", "teamReferences", "semanticReviews", "semanticReviewLog"):
        merged[key] = _unique(merged.get(key, []) + incoming.get(key, []), lambda x: x.get("id") or x.get("reference_id") or json.dumps(x, sort_keys=True))
    merged["availableChapters"] = _unique(merged.get("availableChapters", []) + incoming.get("availableChapters", []),
                                        lambda x: (x.get("chapter"), x.get("sourceHash"), x.get("member")))
    merged["readScopes"] = _unique(merged.get("readScopes", []) + incoming.get("readScopes", []), lambda x: x["id"])
    if select_incoming_scope:
        for key in ("rangeStart", "rangeEnd", "readRange", "rangeVerified"):
            if key in secondary:
                merged[key] = copy.deepcopy(secondary[key])
    start, end = merged.get("rangeStart", 1), merged.get("rangeEnd", 20)
    merged["script"] = "\n\n".join(x["text"] for x in merged.get("chapters", []) if start <= x["chapter"] <= end) if merged.get("chapters") else merged.get("script", "")
    merged.setdefault("mergeHistory", []).append({"sourceProjectId": secondary["id"], "sourceName": secondary.get("name"), "idMap": copy.deepcopy(ids), "conflicts": copy.deepcopy(conflicts)})
    register_project_ids(merged)
    summary = {"charactersBefore": old_characters, "charactersAfter": len(merged.get("characters", [])),
               "readChapters": sorted(source_chapters), "readScopes": [x["range"] for x in merged["readScopes"]],
               "mappedIds": len(ids), "retainedOriginalFiles": True, "retainedImages": True,
               "conflicts": len(conflicts), "sourceProjectArchived": True}
    return {"project": merged, "idMap": ids, "conflicts": conflicts, "summary": summary}


def append_scope(project, parsed, selected_range):
    """Append a physically selected read without dropping earlier bodies/analysis."""
    incoming = {"id": project["id"] + "_read", "name": project["name"], "characters": [],
                "rangeStart": selected_range[0], "rangeEnd": selected_range[1], **copy.deepcopy(parsed)}
    result = merge_projects(project, incoming, select_incoming_scope=True)
    result["project"]["mergeHistory"].pop()
    return result["project"]


def preserve_live_sources(live, updated):
    """A running chapter snapshot cannot erase a newly appended read scope."""
    if all(live.get(key) == updated.get(key) for key in ("readScopes","chapters","sourceFiles","rangeStart","rangeEnd","readRange")):
        return updated
    result = copy.deepcopy(updated)
    for key in ("sourceFiles", "chapters", "availableChapters", "readScopes"):
        rows = live.get(key, []) + result.get(key, [])
        identity = (lambda x: x.get("sha256") or x.get("id")) if key == "sourceFiles" else ((lambda x: x.get("chapter")) if key == "chapters" else ((lambda x: x.get("id")) if key == "readScopes" else lambda x: (x.get("chapter"), x.get("sourceHash"), x.get("member"))))
        result[key] = _unique(rows, identity)
    for key in ("rangeStart", "rangeEnd", "readRange", "rangeVerified", "bookIdentity", "mergeHistory"):
        if key in live:
            result[key] = copy.deepcopy(live[key])
    start, end = result.get("rangeStart", 1), result.get("rangeEnd", 20)
    result["script"] = "\n\n".join(x["text"] for x in result.get("chapters", []) if start <= x["chapter"] <= end) if result.get("chapters") else live.get("script", updated.get("script", ""))
    return result



def validate_profile(data, previous=None):
    """Validate independent-period fields without reusing another period's art."""
    from server import APIError, ID_RE, image_url, image_urls, text_value, character_record
    from life_stages import profile_record, VISUAL_FIELDS
    try:
        profile = profile_record(data, previous=previous)
    except ValueError as exc:
        raise APIError(str(exc)) from exc
    if not ID_RE.fullmatch(str(profile.get('id', ''))):
        raise APIError('人物时期编号不正确。')
    for field in ('name','ageText','description','sourceDescription','inputDescription'):
        if field in profile:
            profile[field] = text_value(profile[field], '人物时期描述', 30000, field == 'name')
    for field in ('face','base','reference','faceCandidateSheet','faceCore'):
        if field in profile:
            profile[field] = image_url(profile[field])
    profile['references'] = image_urls(profile.get('references', []))
    for field in ('faceApproved','baseApproved','faceCoreApproved','inputPrepared'):
        if field in profile and not isinstance(profile[field],bool):
            raise APIError('人物时期确认状态需要布尔值。')
    # Reuse the established candidate/style/input validator, without recursively
    # including appearanceProfiles in this deliberately small compatibility view.
    view = {'name': profile['name'], 'outfits': [], **{k: profile[k] for k in VISUAL_FIELDS if k in profile}}
    validated = character_record(view)
    for field in VISUAL_FIELDS:
        if field in profile and field in validated:
            profile[field] = validated[field]
    for field in ('faceApproved','baseApproved'):
        if field in data: profile[field] = data[field]
        elif previous and field in previous: profile[field] = previous[field]
    for field,image_field in (('faceApproved','face'),('baseApproved','base')):
        if profile.get(field) and not profile.get(image_field): raise APIError('请先生成或上传对应图片。')
    if 'hairstyle' in profile:
        from identity_library import validate_hairstyle
        original_hair=copy.deepcopy(profile['hairstyle'])
        profile['hairstyle']=validate_hairstyle(profile['hairstyle'])
        for field in ('sourceStyle','outputStyle'):
            if field not in original_hair:profile['hairstyle'].pop(field,None)
    return profile


def store_project(app, project, *, imported=False):
    """Automatically append a verified same book; project title alone never merges."""
    from server import APIError, now
    project['bookIdentity'] = book_identity(project, app.data)
    ensure_scopes(project)
    matches = []
    for existing in app.state['projects']:
        existing['bookIdentity'] = book_identity(existing, app.data)
        match = same_book(existing['bookIdentity'], project['bookIdentity'])
        if match['matched']: matches.append((existing,match))
    if len(matches) > 1:
        project.setdefault('importWarnings', []).append('有多个同书项目，已保留独立项目；请在项目合并窗口选择主项目。')
    elif len(matches) == 1:
        primary, identity = matches[0]
        if imported and project.get('characters'): app.editable(primary['id'])
        result = merge_projects(primary, project, select_incoming_scope=True)
        result['project']['updatedAt'] = now()
        result['project']['bookIdentity'] = book_identity(result['project'], app.data)
        result['project']['lastAutomaticMerge'] = {'sourceProjectId': project['id'], 'basis': identity['basis'],
            'at': now(), 'summary': result['summary'], 'conflicts': result['conflicts']}
        # The incoming copy has never appeared in the active list. Its original
        # values remain recoverable, as do all physically saved source files.
        app.state.setdefault('recycleBin', []).append({'id': project['id'], 'name':project['name'], 'reason':'merged',
            'deletedAt':now(), 'mergedInto':primary['id'], 'restorable':True, 'project':copy.deepcopy(project), 'jobs':[]})
        primary.clear(); primary.update(result['project'])
        return primary
    app.state['projects'].append(project)
    return project


def special_mutation(app, method, parts, payload):
    """Return (handled, response); never mutates a worker-owned live character."""
    from server import APIError, now, text_value, ID_RE, character_record, image_url, STYLES
    from life_stages import ensure_appearance_profiles, get_profile, profile_character, commit_profile_character, VISUAL_FIELDS
    from chapter_analysis import register_project_ids
    from crowd_sets import crowd_mutation
    handled,response=crowd_mutation(app,method,parts,payload)
    if handled:return True,response
    from refinement_api import refinement_mutation
    handled,response=refinement_mutation(app,method,parts,payload)
    if handled:return True,response
    from identity_library import library_mutation
    handled,response=library_mutation(app,method,parts,payload)
    if handled:return True,response
    if method=='POST' and len(parts)==4 and parts[:2]==['api','jobs'] and parts[3]=='dependencies':
        job=app.find(app.state['jobs'],parts[2],'任务')
        if job.get('status')!='queued':raise APIError('只有等待任务可以调整依赖。',409)
        from job_scheduler import validate_dependencies
        try:job['dependsOn']=validate_dependencies(app.state['jobs'],job['id'],payload.get('dependsOn',[]))
        except ValueError as exc:raise APIError(str(exc)) from exc
        app.save();app.wake.set();return True,copy.deepcopy(job)
    if method == 'POST' and parts == ['api','jobs','reorder']:
        queued = [j for j in app.state['jobs'] if j.get('status') == 'queued']
        order = payload.get('jobIds')
        if not isinstance(order,list) or not all(isinstance(x,str) for x in order) or len(set(order)) != len(order):
            raise APIError('请提交完整、不重复的等待任务顺序。')
        if set(order) != {j['id'] for j in queued}:
            raise APIError('任务队列已变化，请刷新后重新排序。',409)
        by_id = {j['id']:j for j in queued}; cursor = iter(order)
        app.state['jobs'] = [by_id[next(cursor)] if j.get('status') == 'queued' else j for j in app.state['jobs']]
        app.save(); app.wake.set()
        return True, {'queueOrder': order, 'queuedJobs':copy.deepcopy([by_id[x] for x in order])}
    if parts[:2] != ['api','projects'] or len(parts) < 3:
        return False, None
    pid = parts[2]
    if len(parts) == 4 and parts[3] == 'restore' and method == 'POST':
        if any(p['id'] == pid for p in app.state['projects']): raise APIError('这个项目已经在项目列表中。',409)
        entry = app.find(app.state.setdefault('recycleBin', []),pid,'回收站项目')
        project = copy.deepcopy(entry['project'])
        project['updatedAt'] = now(); project['restoredAt'] = now()
        project.setdefault('restoreHistory',[]).append({'at':now(),'reason':entry.get('reason'),'mergedInto':entry.get('mergedInto'),'originalJobs':copy.deepcopy(entry.get('jobs',[]))})
        # Restoring never resumes cancelled/deleted queued jobs automatically.
        app.state['projects'].append(project); app.state['recycleBin'].remove(entry)
        app.save()
        return True, {'project':copy.deepcopy(project),'message':'项目已恢复，原件和图片仍保留；原任务不会自动重新执行。'}
    if len(parts) == 3 and method == 'DELETE':
        project = app.project(pid)
        if any(j.get('projectId') == pid and j.get('status') == 'running' for j in app.state['jobs']):
            raise APIError('这个项目有运行中的任务，请先取消当前任务，等它停止后再删除。',409)
        jobs = copy.deepcopy([j for j in app.state['jobs'] if j.get('projectId') == pid])
        for job in app.state['jobs']:
            if job.get('projectId') == pid and job.get('status') == 'queued':
                job.update(status='cancelled',phase='cancelled',cancelRequested=True,message='项目移入回收站，等待任务已取消。',finishedAt=now())
        app.state.setdefault('recycleBin', []).append({'id':pid,'name':project['name'],'reason':'deleted','deletedAt':now(),
            'restorable':True,'project':copy.deepcopy(project),'jobs':jobs})
        app.state['projects'].remove(project); app.save()
        return True, {'deleted':True,'projectId':pid,'retainedFiles':True,'message':'项目已移入回收站，图片和来源原件保留。'}
    if len(parts) == 4 and parts[3] == 'merge' and method == 'POST':
        primary = app.project(pid); secondary = app.project(payload.get('sourceProjectId'))
        if primary is secondary: raise APIError('请选择另一个待合并项目。')
        dry = payload.get('dryRun',True)
        if not isinstance(dry,bool) or not isinstance(payload.get('explicitMerge',False),bool): raise APIError('合并确认参数需要布尔值。')
        identity = same_book(book_identity(primary,app.data),book_identity(secondary,app.data))
        authorized = identity['matched'] or payload.get('explicitMerge') is True
        warnings = [] if identity['matched'] else ['原件信息不能核对为同一本书；只有明确确认才会合并。']
        if not authorized:
            return True, {'canMerge':False,'projectId':pid,'sourceProjectId':secondary['id'],'warnings':warnings,'conflicts':[],'summary':{},'idMap':{}}
        busy = any(j.get('projectId') in {pid,secondary['id']} and j.get('status') == 'running' for j in app.state['jobs'])
        if busy:
            if not dry: raise APIError('待合并项目有运行中的任务，请先取消，等任务停止后再合并。',409)
            warnings.append('当前有运行中的任务，需要先取消并等待停止。')
        merged = merge_projects(primary,secondary)
        response = {'canMerge':not busy,'projectId':pid,'sourceProjectId':secondary['id'],'warnings':warnings,
            'summary':merged['summary'],'conflicts':merged['conflicts'],'idMap':merged['idMap'],'identityBasis':identity['basis']}
        if dry: return True, response
        original_jobs = copy.deepcopy([j for j in app.state['jobs'] if j.get('projectId') == secondary['id']])
        app.state.setdefault('recycleBin', []).append({'id':secondary['id'],'name':secondary['name'],'reason':'merged','deletedAt':now(),
            'mergedInto':pid,'restorable':True,'project':copy.deepcopy(secondary),'jobs':original_jobs})
        for job in app.state['jobs']:
            if job.get('projectId') == secondary['id']:
                job['mergedFromProjectId'] = secondary['id']
                remapped = _remap(job,merged['idMap']); job.clear(); job.update(remapped)
        for item in app.state['library']:
            if item.get('sourceProjectId') == secondary['id']:
                item['mergedFromProjectId'] = secondary['id']
                remapped = _remap(item,merged['idMap']); item.clear(); item.update(remapped)
        merged['project']['updatedAt'] = now()
        primary.clear(); primary.update(merged['project']); app.state['projects'].remove(secondary)
        app.save(); response['project'] = copy.deepcopy(primary)
        return True, response
    if len(parts) >= 5 and parts[3] == 'characters':
        project = app.project(pid); app.editable(pid,parts[4],parts[6] if len(parts)>=7 and parts[5]=='outfits' else None)
        char = app.character(project,parts[4]); ensure_appearance_profiles(project)
        if len(parts) in {6,7} and parts[5] == 'appearance-profiles' and method in {'POST','PATCH'}:
            if method == 'POST' and len(parts) == 6:
                profile = validate_profile(payload)
                if any(p['id'] == profile['id'] for p in char['appearanceProfiles']): raise APIError('这个时期编号已存在。',409)
                char['appearanceProfiles'].append(profile)
            elif method == 'PATCH' and len(parts) == 7:
                old = get_profile(char,parts[6])
                if not old: raise APIError('未找到该角色的人物时期。',404)
                profile = validate_profile(payload,previous=old)
                stage_changed=any(field in payload and profile.get(field)!=old.get(field) for field in ('period','ageStage'))
                if stage_changed and any(old.get(field) for field in ('face','base','reference')):
                    profile.setdefault('identityHistory',[]).append({'at':now(),'reason':'period_or_age_changed','previous':copy.deepcopy({k:v for k,v in old.items() if k!='identityHistory'})})
                    profile.update(identityReviewPending=True,faceApproved=False,baseApproved=False)
                    for outfit in char.get('outfits',[]):
                        if outfit.get('appearanceProfileId')==profile['id']:
                            outfit.update(semanticReviewPending=True,semanticReviewReason='人物时期或年龄已修改，需要按新身份重新制作。')
                    for reference in project.get('teamReferences',[]):
                        if reference.get('asset_id')==old.get('teamAssetId'):reference['review_status']='pending'
                if 'faceCore' in payload and profile.get('faceCore')!=old.get('faceCore'):
                    from identity_library import mark_head_pending
                    mark_head_pending(project,char,profile,'已更新纯脸身份，旧完整头部及相关素材保留待核验。')
                if 'hairstyle' in payload and profile.get('hairstyle')!=old.get('hairstyle'):
                    from identity_library import mark_head_pending
                    mark_head_pending(project,char,profile,'本时期发型已修改，旧头部、身体和卡保留待核验。')
                old.clear(); old.update(profile)
                if profile['id'] == char['defaultAppearanceProfileId']:
                    for field in VISUAL_FIELDS:
                        if field in profile: char[field] = copy.deepcopy(profile[field])
            else: return False,None
            from appearance_identity import refresh_visual_identity
            refresh_visual_identity(project)
            if 'faceCore' in payload:
                from identity_library import apply_core
                apply_core(project,char,profile['id'],profile['faceCore'],profile.get('libraryFaceCoreId',''),profile.get('faceCoreStyle',project['style']),approved=bool(profile.get('faceCoreApproved')))
            register_project_ids(project); project['updatedAt']=now(); app.save()
            return True, copy.deepcopy(char)
        if (len(parts) == 5 and method == 'PATCH') or (len(parts) == 6 and parts[5] in {'select-face','approve-face'} and method == 'POST'):
            profile_id = payload.get('appearanceProfileId') or char['defaultAppearanceProfileId']
            profile = get_profile(char,profile_id)
            if not profile: raise APIError('未找到该角色的人物时期。',404)
            working = profile_character(char,profile_id)
            old_core=working.get('faceCore','')
            old_face=working.get('face','')
            was_approved=bool(working.get('faceApproved'))
            if method == 'POST':
                candidate = ({'id':working.get('selectedFaceId') or 'approved_'+char['id'],'image':working.get('face'),'style':working.get('faceStyle') or project['style']} if parts[5]=='approve-face' else app.find(working.get('faceCandidates',[]),payload.get('candidateId'),'该时期的脸图方案'))
                selected = image_url(candidate.get('image',''))
                if not selected or not app.file_path(selected).is_file(): raise APIError('这个脸图方案文件不存在，请重新生成或上传。',404)
                if app.file_path(selected).suffix.lower() not in {'.png','.jpg','.jpeg','.webp'}: raise APIError('脸图方案需要使用图片文件。')
                style = candidate.get('style') or project['style']
                if style not in STYLES: raise APIError('这个脸图方案的画风不正确。')
                if selected != working.get('face',''):
                    working.update(base='',baseApproved=False)
                    from identity_library import archive_outfit
                    for outfit in working['outfits']:
                        archive_outfit(outfit,'本时期人工选脸更新')
                        outfit.update(card='',hands='',combined='',specials=[])
                working.update(face=selected,faceApproved=True,faceStyle=style,selectedFaceId=candidate['id'],faceSelectionMode='manual',faceSelectionReason='')
                if parts[5]=='select-face':
                    from server import template_info
                    working['headContractVersion']=candidate.get('headContractVersion','')
                    working['legacyHeadReviewPending']=working['headContractVersion']!=template_info()['version']
                    working['headReviewStatus']=candidate.get('headReviewStatus','pending')
                    if selected!=old_face:
                        from identity_library import mark_head_pending
                        group=profile.get('faceIdentityGroupId')
                        for member in char.get('appearanceProfiles',[]):
                            if member.get('faceIdentityGroupId')!=group:continue
                            if member.get('faceCore'):
                                member.update(faceCoreReviewPending=True,faceCoreApproved=False)
                            if member['id']!=profile['id']:mark_head_pending(project,char,member,'同脸组已选择新的五官候选，需整理本时期头部。')
                        if working.get('faceCore'):working.update(faceCoreReviewPending=True,faceCoreApproved=False)

            else:
                shared = {'name','category','episodes','gestures'}
                visual = set(VISUAL_FIELDS) | {'description'}
                fields = shared | visual
                validation_input = {**working, **{k:v for k,v in payload.items() if k in fields},'outfits':[]}
                validated = character_record(validation_input)
                for field in ('faceApproved','baseApproved'):
                    if field in payload:
                        if not isinstance(payload[field],bool): raise APIError('确认状态格式不正确。')
                        url = validated.get('face' if field == 'faceApproved' else 'base')
                        if payload[field] and not url: raise APIError('请先生成或上传对应图片。')
                changed_face = 'face' in payload and validated['face'] != working.get('face','')
                changed_base = 'base' in payload and validated['base'] != working.get('base','')
                changed_input = any(k in payload and validated.get(k) != working.get(k) for k in ('identitySource','reference','references'))
                previous_inputs = {x for x in [working.get('reference'),*working.get('references',[])] if x}
                if changed_face:
                    working.update(faceApproved=False,faceStyle=project['style'],selectedFaceId='',faceSelectionReason='',faceSelectionMode='manual',baseApproved=False)
                    if 'base' not in payload: working['base']=''
                if changed_base: working.update(baseApproved=False,baseStyle=project['style'])
                if changed_face or changed_base:
                    from identity_library import archive_outfit
                    working.setdefault('identityHistory',[]).append({key:working.get(key,'') for key in ('face','base','faceCore')})
                    for outfit in working['outfits']:
                        archive_outfit(outfit,'本时期脸图或身体底稿更新')
                        outfit.update(card='',hands='',combined='',specials=[])
                for key in fields:
                    if key in payload and key in validated: working[key]=validated[key]
                for field in ('faceApproved','baseApproved'):
                    if field in payload: working[field]=payload[field]
                if changed_input:
                    working.update(inputPrepared=False,inputImageKey='',face='',faceApproved=False,faceCandidates=[],faceCandidateSheet='',selectedFaceId='',faceSelectionReason='',faceSelectionMode='',base='',baseApproved=False)
                    for field in ('faceStyle','baseStyle','inputDescription'): working.pop(field,None)
                    from identity_library import archive_outfit
                    for outfit in working['outfits']:
                        archive_outfit(outfit,'本时期输入身份更新')
                        outfit.update(card='',hands='',combined='',specials=[])
                        if outfit.get('reference') in previous_inputs: outfit['reference']=''
                    if project.get('styleMode') != 'manual' and not project.get('script','').strip(): project['inputStyleResolved']=False
                for key in shared:
                    if key in payload:
                        if key == 'name' and validated[key] != char[key]: char['aliases']=sorted(set(char.get('aliases',[])+[char[key]]))
                        char[key]=validated[key]
            if 'faceCore' in payload and working.get('faceCore') != old_core:
                from identity_library import mark_head_pending
                mark_head_pending(project,char,profile,'纯脸身份已更新，本时期完整头部与相关素材待整理。')
                working.update(headPreparationPending=True,hairReviewPending=True,faceApproved=False,baseApproved=False)
            commit_profile_character(char,working,profile_id)
            if 'faceCore' in payload and working.get('faceCore'):
                from identity_library import apply_core
                apply_core(project,char,profile_id,working['faceCore'],working.get('libraryFaceCoreId',''),working.get('faceCoreStyle',project['style']),approved=bool(working.get('faceCoreApproved')))
            if 'description' in payload: profile['description']=validated['description']
            project['updatedAt']=now(); app.save()
            if method=='POST' or payload.get('faceApproved') is True and (not was_approved or working.get('face','') != old_face):
                app.capture_face_assets(project,char,profile_id,include_clothing=payload.get('includeClothing') is True)
            return True, copy.deepcopy(char)
    return False,None
