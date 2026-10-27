"""Local, persistent comic-character workbench (Python standard library only)."""
from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import io
import ipaddress
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import socket
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit
import zipfile


ROOT = Path(__file__).resolve().parent
STYLES = {"国漫", "日漫", "韩漫", "美漫"}
LIBRARY_STYLES = STYLES | {"真人", "3D", "漫画原画", "混合原样", "未知原样"}
SOURCE_STYLES = {"comic", "photo", "3d", "mixed", "unknown"}
CATEGORIES = {"主角", "配角", "群像"}
KINDS = {"comic_character", "analyze", "face", "base", "outfit", "gestures", "hands", "special", "combine", "pipeline", "project_auto", "library_faces", "library_body", "clothing_extract", "clothing_collect", "library_face_core", "library_hairstyle", "head_prepare", "hair_apply", "extract_assets", "hands_auto", "face_refine", "hairstyle_preview", "crowd_set", "card_convert", "card_outfit_scan", "image_combine"}
CLOTHING_ERAS = ("古代", "现代", "未来科技", "其他")
CLOTHING_GENDERS = ("男", "女", "通用")
CLOTHING_AGES = ("儿童", "少年", "青年", "中年", "老年", "通用")
MAX_BODY = 92 * 1024 * 1024  # 60 MB raw document batch after base64 encoding.
MAX_IMAGE = 20 * 1024 * 1024
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix):
    return prefix + "_" + secrets.token_hex(6)


def template_info():
    from prompt_templates import public_template
    return copy.deepcopy(public_template())


def template_hash():
    from prompt_templates import template_fingerprint
    return template_fingerprint()


def master_template_bytes():
    from prompt_templates import master_template
    return json.dumps(master_template(), ensure_ascii=False, indent=2).encode('utf-8')


class APIError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def text_value(value, label, limit=200000, required=False):
    if not isinstance(value, str):
        raise APIError(label + "需要填写文字。")
    value = value.strip()
    if len(value) > limit:
        raise APIError(label + "过长，请缩短后再试。")
    if required and not value:
        raise APIError("请填写" + label + "。")
    return value


def integer(value, label, minimum=1, maximum=100000):
    if isinstance(value, bool):
        raise APIError(label + "需要填写整数。")
    try:
        result = int(value)
    except (ValueError, TypeError, OverflowError):
        raise APIError(label + "需要填写整数。")
    if isinstance(value, float) and value != result:
        raise APIError(label + "需要填写整数。")
    if result < minimum or result > maximum:
        raise APIError(f"{label}须在{minimum}至{maximum}之间。")
    return result


def episodes(value):
    if value is None or value == "":
        return []
    if isinstance(value, str):
        parts = re.split(r"[,，、;；\s]+", value.strip())
        result = []
        for part in parts:
            if not part:
                continue
            match = re.fullmatch(r"(?:第)?(\d+)(?:话)?(?:[-~～—至](?:第)?(\d+)(?:话)?)?", part)
            if not match:
                raise APIError("出场话数请填写数字或范围，例如 1-8,12。")
            start = integer(match[1], "话数")
            end = integer(match[2], "话数") if match[2] else start
            if end < start or end - start > 10000:
                raise APIError("出场话数范围不正确。")
            result.extend(range(start, end + 1))
    elif isinstance(value, list) and len(value) <= 10000:
        result = [integer(item, "话数") for item in value]
    else:
        raise APIError("出场话数格式不正确。")
    return sorted(set(result))


def gestures(value):
    if value is None:
        return []
    if isinstance(value, str):
        value = [s for s in re.split(r"[\n;；]+", value) if s.strip()]
    if not isinstance(value, list) or len(value) > 32:
        raise APIError("手部动作请填写列表，最多32项。")
    # Script analysis can attach episode/source evidence to each gesture.
    result = []
    for item in value:
        if isinstance(item, dict):
            if not isinstance(item.get("name") or item.get("action"), str):
                raise APIError("动作需要名称。")
            result.append(copy.deepcopy(item))
        else:
            result.append(text_value(item, "手部动作", 1500, True))
    return result


def image_url(value):
    if value in (None, ""):
        return ""
    value = text_value(value, "图片路径", 500)
    decoded = unquote(value)
    if not decoded.startswith("/files/") or "?" in decoded or "#" in decoded:
        raise APIError("请使用工作台中上传或生成的图片。")
    parts = decoded.removeprefix("/files/").split("/")
    if parts[0] not in {"assets", "generated"} or any(p in {"", ".", ".."} for p in parts):
        raise APIError("图片路径不正确。")
    return value


def image_urls(value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 12:
        raise APIError("角色参考图请使用列表，最多12张。")
    return list(dict.fromkeys(image_url(item) for item in value if item))


def source_files(value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 100:
        raise APIError("来源文档列表格式不正确，最多100个文件。")
    result, identifiers = [], set()
    for item in value:
        if not isinstance(item, dict):
            raise APIError("来源文档内容格式不正确。")
        item_id = item.get("id")
        if not isinstance(item_id, str) or not ID_RE.fullmatch(item_id) or item_id in identifiers:
            raise APIError("来源文档编号不正确或重复。")
        identifiers.add(item_id)
        entry = {"id": item_id, "name": text_value(item.get("name", ""), "来源文件名", 300, True),
                 "url": image_url(item.get("url", "")), "size": integer(item.get("size", 0), "文件大小", 0, 20 * 1024 * 1024),
                 "format": text_value(item.get("format", "unknown"), "文件格式", 20),
                 "textLength": integer(item.get("textLength", 0), "文字长度", 0, 1000000)}
        if entry["url"] and not unquote(entry["url"]).startswith("/files/assets/"):
            raise APIError("来源文档应使用上传的原文件。")
        if "sha256" in item:
            digest = item["sha256"]
            if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise APIError("来源文件校验信息不正确。")
            entry["sha256"] = digest
        if "archive" in item:
            archive = item["archive"]
            if not isinstance(archive, str) or not ID_RE.fullmatch(archive):
                raise APIError("来源压缩包编号不正确。")
            entry["archive"] = archive
        if "text" in item:
            entry["text"] = text_value(item["text"], "来源提取文本", 200000)
        if "readRange" in item:
            entry["readRange"] = read_range(item["readRange"])
        if "readChapters" in item:
            entry["readChapters"] = episodes(item["readChapters"])
        if "rangeVerified" in item:
            if not isinstance(item["rangeVerified"], bool):
                raise APIError("来源章节核对状态不正确。")
            entry["rangeVerified"] = item["rangeVerified"]
        if "importError" in item:
            entry["importError"] = text_value(item["importError"], "读取提示", 2000)
        if 'alternateOriginals' in item:
            entry['alternateOriginals'] = []
            for original in item['alternateOriginals']:
                entry['alternateOriginals'].append({'id':text_value(original.get('id',''),'原件编号',80),
                    'url':image_url(original.get('url','')),'name':text_value(original.get('name',''),'原件名称',300)})
        result.append(entry)
    return result


def read_range(value):
    if value is None:
        return None
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise APIError("章节范围需要起始章和结束章。")
    start, end = [integer(item, "章节范围") for item in value]
    if end < start:
        raise APIError("结束章节不能早于起始章节。")
    return [start, end]


def chapter_metadata(data):
    """Preserve the selected source index separately from generated analysis."""
    result = {}
    if "readRange" in data:
        result["readRange"] = read_range(data["readRange"])
    if "rangeVerified" in data:
        if not isinstance(data["rangeVerified"], bool):
            raise APIError("章节范围核对状态不正确。")
        result["rangeVerified"] = data["rangeVerified"]
    if "warnings" in data or "importWarnings" in data:
        result["importWarnings"] = text_list(data.get("importWarnings", data.get("warnings", [])), "读取提示", count=300, limit=3000)
    if "availableChapters" in data:
        available = data["availableChapters"]
        if not isinstance(available, list) or len(available) > 10000:
            raise APIError("章节目录格式不正确。")
        result["availableChapters"] = []
        for item in available:
            if not isinstance(item, dict):
                raise APIError("章节目录内容不正确。")
            record = {"chapter": integer(item.get("chapter"), "目录章号"),
                      "title": text_value(item.get("title", ""), "章节标题", 500)}
            for key in ("member", "sourceId", "sourceHash"):
                if key in item:
                    record[key] = text_value(item[key], "章节来源", 1000)
            result["availableChapters"].append(record)
    if "chapters" in data:
        values = data["chapters"]
        if not isinstance(values, list) or len(values) > 10000:
            raise APIError("已读章节内容格式不正确。")
        result["chapters"] = []
        total, seen = 0, set()
        for item in values:
            if not isinstance(item, dict):
                raise APIError("章节内容不正确。")
            chapter = integer(item.get("chapter"), "章号")
            record = {"chapter": chapter, "title": text_value(item.get("title", ""), "章节标题", 500),
                      "text": text_value(item.get("text", ""), "本章正文", 1000000)}
            for key in ("sourceId", "sourceHash", "member"):
                if key in item:
                    record[key] = text_value(item[key], "章节来源", 1000)
            identity = (record.get("sourceHash") or record.get("sourceId", ""), chapter)
            if identity in seen:
                raise APIError("已读章节编号重复，请先确认不同版本来源。")
            seen.add(identity)
            total += len(record["text"])
            if total > 20_000_000:
                raise APIError("已读章节缓存超过2000万字，请拆分项目。")
            paragraphs = item.get("paragraphs", [])
            if not isinstance(paragraphs, list) or len(paragraphs) > 30000:
                raise APIError("章节段落索引格式不正确。")
            record["paragraphs"] = []
            for paragraph in paragraphs:
                if not isinstance(paragraph, dict):
                    raise APIError("段落内容不正确。")
                record["paragraphs"].append({"id": text_value(paragraph.get("id", ""), "段落编号", 180, True),
                    "index": integer(paragraph.get("index"), "段号"), "text": text_value(paragraph.get("text", ""), "段落原文", 1000000)})
            result["chapters"].append(record)
    if "readScopes" in data:
        scopes = data['readScopes']
        if not isinstance(scopes,list) or len(scopes)>10000: raise APIError('已读批次格式不正确。')
        result['readScopes'] = []
        for scope in scopes:
            if not isinstance(scope,dict): raise APIError('已读批次内容不正确。')
            record = copy.deepcopy(scope)
            record['range'] = read_range(scope.get('range'))
            if not record['range']: raise APIError('已读批次缺少章节范围。')
            record['chapters'] = episodes(scope.get('chapters',[]))
            if any(not record['range'][0] <= n <= record['range'][1] for n in record['chapters']): raise APIError('批次章号超出该批次范围。')
            result['readScopes'].append(record)
    rng = result.get("readRange")
    if result.get("rangeVerified") and rng:
        if any(not rng[0] <= chapter["chapter"] <= rng[1] and not any(scope["range"][0] <= chapter["chapter"] <= scope["range"][1] for scope in result.get("readScopes",[])) for chapter in result.get("chapters", [])):
            raise APIError("已读章节超出选择范围。")
    return result


def text_list(value, label, count=100, limit=3000):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > count:
        raise APIError(label + "列表格式不正确。")
    return [text_value(item, label, limit) for item in value]


def gesture_sources(value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 32:
        raise APIError("动作来源列表格式不正确。")
    result = []
    for item in value:
        if not isinstance(item, dict) or item.get("source") not in ("剧本", "补充"):
            raise APIError("动作来源需要标明剧本或补充。")
        result.append({"name": text_value(item.get("name", ""), "动作名称", 1500, True),
                       "source": item["source"], "episodes": episodes(item.get("episodes", [])),
                       "evidence": text_value(item.get("evidence", ""), "动作依据", 10000)})
    return result


def copy_style_metadata(result, data, fields):
    for field in fields:
        if field in data:
            if data[field] not in (None, "") and (not isinstance(data[field], str) or data[field] not in (LIBRARY_STYLES if field == "faceCoreStyle" else STYLES)):
                raise APIError("素材画风不正确。")
            result[field] = data[field] or ""


def clothing_metadata(data):
    era = data.get("era", "其他")
    gender = data.get("gender", "通用")
    age = data.get("ageGroup", "通用")
    if era not in CLOTHING_ERAS or gender not in CLOTHING_GENDERS or age not in CLOTHING_AGES:
        raise APIError("服装的时代、性别或年龄分类不正确。")
    return {"era": era, "gender": gender, "ageGroup": age, "tags": text_list(data.get("tags", []), "服装标签", count=50, limit=100)}


def library_record(data):
    if data.get('kind')=='crowd_set':
        from crowd_sets import crowd_record
        return crowd_record(data)
    kind = data.get("kind", "face")
    style = data.get("style", "国漫")
    if kind not in ("face", "body", "clothing", "face_core", "hairstyle", "character_card") or not isinstance(style, str) or style not in LIBRARY_STYLES:
        raise APIError("图库分类或画风不正确。")
    refs = data.get("referenceIds", [])
    if not isinstance(refs, list) or not all(isinstance(v, str) and ID_RE.fullmatch(v) for v in refs):
        raise APIError("参考编号格式不正确。")
    result = {"id": new_id("library"), "name": text_value(data.get("name", "未命名素材"), "素材名称", 160, True),
              "kind": kind, "style": style, "description": text_value(data.get("description", ""), "素材描述", 20000),
              "image": image_url(data.get("image", "")), "referenceIds": refs, "createdAt": now()}
    if kind == "clothing":
        result.update(clothing_metadata(data))
    if kind == "body":
        from body_library import metadata
        result.update(metadata(data),bodyTemplateValidated=False,bodyTemplateReviewStatus="pending")
    if kind in ('face','body') and any(key in data for key in ('era','gender','ageStage')):
        from identity_library import pure_metadata
        result.update(pure_metadata(data))
    if kind in ('face_core','hairstyle'):
        from identity_library import pure_metadata
        result.update(pure_metadata(data))
        result.update(pureValidated=False,pureReviewStatus='pending')
        if kind=='hairstyle' and data.get('storageForm')=='neutral_white_head_three_views':
            result.update(storageForm='neutral_white_head_three_views',preview=result['image'],hairstyleValidated=False)
    return result


def outfit_record(data):
    if not isinstance(data, dict):
        raise APIError("服装内容格式不正确。")
    result = {
        "id": new_id("outfit"), "name": text_value(data.get("name", "默认服装"), "服装名称", 120, True),
        "description": text_value(data.get("description", ""), "服装描述", 20000),
        "episodes": episodes(data.get("episodes", [])), "gestures": gestures(data.get("gestures", [])),
        "reference": image_url(data.get("reference", "")), "specialInstructions": text_value(data.get("specialInstructions", ""), "特殊动作说明", 20000),
        "card": image_url(data.get("card", "")), "hands": image_url(data.get("hands", "")), "combined": image_url(data.get("combined", "")), "specials": [],
    }
    specials = data.get("specials", [])
    if not isinstance(specials, list) or len(specials) > 200:
        raise APIError("特殊动作列表格式不正确。")
    for item in specials:
        if not isinstance(item, dict):
            raise APIError("特殊动作内容格式不正确。")
        special = {"id": new_id("special"), "name": text_value(item.get("name", "特殊动作"), "特殊动作名称", 3000, True),
                   "image": image_url(item.get("image", ""))}
        if "episodes" in item:
            special["episodes"] = episodes(item["episodes"])
        result["specials"].append(special)
    if "gestureSources" in data:
        result["gestureSources"] = gesture_sources(data["gestureSources"])
    if "specialSuggestions" in data:
        result["specialSuggestions"] = text_list(data["specialSuggestions"], "特殊动作建议")
    if "gestureNote" in data:
        result["gestureNote"] = text_value(data["gestureNote"], "动作备注", 20000)
    if "scriptDescription" in data:
        result["scriptDescription"] = text_value(data["scriptDescription"], "剧本服装描述", 30000)
    if "clothingImage" in data:
        result["clothingImage"] = image_url(data["clothingImage"])
    if any(field in data for field in ("era", "gender", "ageGroup", "tags")):
        metadata = clothing_metadata(data)
        for field in ("era", "gender", "ageGroup", "tags"):
            if field in data:
                result[field] = metadata[field]
    for field in ("libraryClothingId", "clothingId"):
        if field in data:
            value = data[field]
            if value and (not isinstance(value, str) or not ID_RE.fullmatch(value)):
                raise APIError("服装素材编号不正确。")
            result[field] = value or ""
    copy_style_metadata(result, data, ("style",))
    if 'appearanceProfileId' in data:
        if not isinstance(data['appearanceProfileId'],str) or not ID_RE.fullmatch(data['appearanceProfileId']): raise APIError('服装所属时期编号不正确。')
        result['appearanceProfileId'] = data['appearanceProfileId']
    if 'id' in data and (not isinstance(data['id'],str) or not ID_RE.fullmatch(data['id'])): raise APIError('服装编号不正确。')
    return {**copy.deepcopy(data), **result, 'id':data.get('id',result['id'])}


def character_record(data):
    if not isinstance(data, dict):
        raise APIError("角色内容格式不正确。")
    category = data.get("category", "配角")
    if not isinstance(category, str) or category not in CATEGORIES:
        raise APIError("角色分类请选择主角、配角或群像。")
    outfits = data.get("outfits", [])
    if not isinstance(outfits, list) or len(outfits) > 100:
        raise APIError("服装列表格式不正确。")
    candidates = data.get("faceCandidates", [])
    if not isinstance(candidates, list) or len(candidates) > 8:
        raise APIError("脸图方案列表格式不正确，最多8个方案。")
    candidate_records, candidate_ids = [], set()
    for index, candidate in enumerate(candidates, 1):
        if not isinstance(candidate, dict):
            raise APIError("脸图方案内容格式不正确。")
        candidate_id = candidate.get("id")
        if not isinstance(candidate_id, str) or not ID_RE.fullmatch(candidate_id) or candidate_id in candidate_ids:
            raise APIError("脸图方案编号不正确或重复。")
        candidate_ids.add(candidate_id)
        record = {"id": candidate_id, "image": image_url(candidate.get("image", "")),
                  "label": text_value(candidate.get("label", f"方案{index}"), "脸图方案名称", 160, True)}
        if "description" in candidate:
            record["description"] = text_value(candidate["description"], "脸图方案描述", 20000)
        copy_style_metadata(record, candidate, ("style",))
        candidate_records.append(record)
    selected_id = data.get("selectedFaceId", "")
    if selected_id and (not isinstance(selected_id, str) or not ID_RE.fullmatch(selected_id)):
        raise APIError("已选脸图方案编号不正确。")
    selection_mode = data.get("faceSelectionMode", "")
    if selection_mode not in ("", "manual", "auto"):
        raise APIError("脸图选择方式不正确。")
    identity_source = data.get("identitySource", "design")
    if identity_source not in ("design", "face", "fullbody"):
        raise APIError("输入图片类型请选择角色设计、定稿脸图或定稿全身图。")
    input_prepared = data.get("inputPrepared", False)
    if not isinstance(input_prepared, bool):
        raise APIError("输入图片处理状态格式不正确。")
    character_name = text_value(data.get("name", ""), "角色名称", 120)
    if not character_name:
        if identity_source == "design":
            raise APIError("请填写角色名称。")
        character_name = "上传角色"
    result = {
        "id": new_id("char"), "name": character_name,
        "category": category, "description": text_value(data.get("description", ""), "角色描述", 30000),
        "episodes": episodes(data.get("episodes", [])), "gestures": gestures(data.get("gestures", [])),
        "reference": image_url(data.get("reference", "")), "references": image_urls(data.get("references", [])), "face": image_url(data.get("face", "")),
        "base": image_url(data.get("base", "")), "outfits": [outfit_record(o) for o in outfits],
        "faceApproved": False, "baseApproved": False,
        "faceCandidates": candidate_records, "faceCandidateSheet": image_url(data.get("faceCandidateSheet", "")),
        "selectedFaceId": selected_id or "", "faceSelectionReason": text_value(data.get("faceSelectionReason", ""), "选脸说明", 30000),
        "faceSelectionMode": selection_mode,
        "identitySource": identity_source, "inputPrepared": input_prepared,
        "inputImageKey": text_value(data.get("inputImageKey", ""), "输入图片校验信息", 2000),
    }
    for field in ('faceCore',):
        if field in data:result[field]=image_url(data[field])
    for field in ('libraryFaceCoreId',):
        if field in data:
            value=data[field]
            if value and (not isinstance(value,str) or not ID_RE.fullmatch(value)):raise APIError('纯脸素材编号不正确。')
            result[field]=value or ''
    if 'faceCoreApproved' in data:
        if not isinstance(data['faceCoreApproved'],bool):raise APIError('纯脸确认状态需要布尔值。')
        result['faceCoreApproved']=data['faceCoreApproved']
    if 'hairstyle' in data:
        from identity_library import validate_hairstyle
        result['hairstyle']=validate_hairstyle(data['hairstyle'])
    if "aliases" in data:
        result["aliases"] = text_list(data["aliases"], "角色别名", limit=120)
    if "evidence" in data:
        result["evidence"] = text_value(data["evidence"], "角色依据", 30000)
    if "inputDescription" in data:
        result["inputDescription"] = text_value(data["inputDescription"], "上传角色观察描述", 30000)
    if "gestureSources" in data:
        result["gestureSources"] = gesture_sources(data["gestureSources"])
    for key in ("libraryFaceId", "libraryBodyId"):
        if key in data:
            value = data[key]
            if value and (not isinstance(value, str) or not ID_RE.fullmatch(value)):
                raise APIError("图库参考编号不正确。")
            result[key] = value or ""
    copy_style_metadata(result, data, ("faceStyle", "baseStyle", "faceCoreStyle"))
    if 'id' in data and (not isinstance(data['id'],str) or not ID_RE.fullmatch(data['id'])): raise APIError('角色编号不正确。')
    if 'appearanceProfiles' in data:
        from project_ops import validate_profile
        if not isinstance(data['appearanceProfiles'],list) or len(data['appearanceProfiles'])>100: raise APIError('人物时期列表格式不正确。')
        result['appearanceProfiles']=[validate_profile(profile,previous=profile) for profile in data['appearanceProfiles']]
        if len({profile['id'] for profile in result['appearanceProfiles']})!=len(result['appearanceProfiles']): raise APIError('人物时期编号重复。')
    from crowd_sets import copy_crowd_character_fields
    result=copy_crowd_character_fields(result,data)
    return {**copy.deepcopy(data), **result, 'id':data.get('id',result['id'])}


def project_record(data):
    if not isinstance(data, dict):
        raise APIError("项目内容格式不正确。")
    style_mode = data.get("styleMode", "auto")
    style = data.get("style", "国漫")
    if not isinstance(style_mode, str) or not isinstance(style, str) or style_mode not in {"auto", "manual"} or style not in STYLES:
        raise APIError("画风设置不正确。")
    workflow_mode = data.get("workflowMode", "manual")
    if workflow_mode not in ("manual", "auto"):
        raise APIError("制作方式请选择手动或自动。")
    auto_archive = data.get("autoArchiveClothing", True)
    if not isinstance(auto_archive, bool):
        raise APIError("自动保存服装素材设置格式不正确。")
    style_resolved = data.get("inputStyleResolved", False)
    if not isinstance(style_resolved, bool):
        raise APIError("输入画风识别状态格式不正确。")
    start = integer(data.get("rangeStart", 1), "起始话数")
    end = integer(data.get("rangeEnd", 20), "结束话数")
    if end < start:
        raise APIError("结束话数不能早于起始话数。")
    result = {
        "id": new_id("project"), "name": text_value(data.get("name", "未命名项目"), "项目名称", 160, True),
        "script": text_value(data.get("script", ""), "剧本", 1000000), "rangeStart": start, "rangeEnd": end,
        "styleMode": style_mode, "style": style, "recommendedStyle": "", "characters": [],
        "workflowMode": workflow_mode,
        "autoArchiveClothing": auto_archive,
        "inputStyleResolved": style_resolved,
        "sourceFiles": source_files(data.get("sourceFiles", [])),
        "createdAt": now(), "updatedAt": now(),
    }
    result.update(chapter_metadata(data))
    from project_ops import ensure_scopes
    ensure_scopes(result)
    for key in ('chapterAnalysis','teamProjectPrefix','teamAssetRegistry','teamAssetStates','teamReferences','semanticReviews','semanticReviewLog','mergeHistory','chapterVariants','analysisVariants'):
        if key in data: result[key]=copy.deepcopy(data[key])
    return result


class Workbench:
    def __init__(self, root=ROOT, worker_module=None, start_worker=True):
        self.root = Path(root).resolve()
        self.data = self.root / "data"
        self.data.mkdir(parents=True, exist_ok=True)
        (self.data / "assets").mkdir(exist_ok=True)
        (self.data / "generated").mkdir(exist_ok=True)
        self.state_path = self.data / "state.json"
        self.lock = threading.RLock()
        self.wake = threading.Event()
        self.stop_event = threading.Event()
        self.runtime_lock = threading.Lock()
        self.runtime_time = 0.0
        self.job_library_versions = {}
        self.job_project_versions = {}
        self.job_futures = {}
        self.pool = None
        self.runtime = {"ready": False, "loggedIn": False, "imageGeneration": False, "message": "点击检查连接，确认本机 Codex 状态。"}
        if worker_module is None:
            import worker
            worker_module = worker
        self.worker = worker_module
        self.state = {"projects": [], "library": [], "jobs": []}
        if self.state_path.exists():
            try:
                self.state = json.loads(self.state_path.read_text(encoding="utf-8"))
                if not all(isinstance(self.state.get(key), list) for key in ("projects", "library", "jobs")):
                    raise ValueError("state shape")
            except (OSError, ValueError, TypeError) as exc:
                raise RuntimeError("工作台数据无法读取，已保留原文件。请检查 data/state.json。") from exc
        self.state.setdefault('recycleBin', [])
        interrupted = False
        for job in self.state["jobs"]:
            if job.get("status") == "running":
                job.update(status="failed", phase="interrupted", message="上次运行被中断，可重新提交任务。", finishedAt=now())
                interrupted = True
        if interrupted or not self.state_path.exists():
            self.save()
        self.thread = None
        if start_worker:
            self.pool = ThreadPoolExecutor(max_workers=8,thread_name_prefix="character-pool")
            self.thread = threading.Thread(target=self.worker_loop, name="character-job-worker", daemon=True)
            self.thread.start()

    def save(self):
        with self.lock:
            from chapter_analysis import register_project_ids
            from team_bridge import register_references
            for project in self.state["projects"]:
                register_project_ids(project)
                register_references(project, self.data)
            temp = self.state_path.with_suffix(".tmp")
            with temp.open("w", encoding="utf-8", newline="\n") as stream:
                json.dump(self.state, stream, ensure_ascii=False, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            # Windows preview/indexing processes can briefly deny replacement.
            # Retry the same fully flushed file; never discard the prior state.
            for attempt in range(8):
                try:
                    os.replace(temp, self.state_path)
                    break
                except PermissionError:
                    if attempt == 7:
                        raise
                    time.sleep(0.05 * (attempt + 1))

    def close(self):
        self.stop_event.set()
        self.wake.set()
        if self.thread:
            self.thread.join(timeout=2)
        if self.pool is not None:self.pool.shutdown(wait=False,cancel_futures=True)

    def settings(self):
        fn = getattr(self.worker, "settings", None)
        result = fn() if fn else {}
        from job_scheduler import concurrency_limit
        return {**result,"maxConcurrentJobs":concurrency_limit(result)}

    def snapshot(self):
        with self.lock:
            result = copy.deepcopy(self.state)
        result['detachedCharacters']=copy.deepcopy(self.state.get('detachedCharacters',[]))
        from recycle_cleanup import config
        result['materialRecycleSettings']=config(self)
        result['recycleBin']=[{k:entry.get(k) for k in ('id','name','reason','deletedAt','mergedInto','restorable')} for entry in result.get('recycleBin',[])]
        result["runtime"] = copy.deepcopy(self.runtime)
        result["settings"] = self.settings()
        from job_scheduler import blocked_reason,concurrency_limit,progress_snapshot
        limit=concurrency_limit(result['settings'])
        from resource_control import admission
        pressure=admission(self.data,result['settings'],sum(j['status']=='running' for j in result['jobs']))
        for job in result['jobs']:
            job.update(progress_snapshot(job))
            job['blockedReason']=(blocked_reason(result,job,limit) or pressure['reason']) if job.get('status')=='queued' else ''
        result['queuedJobs']=[copy.deepcopy(job) for job in result['jobs'] if job.get('status')=='queued']
        result['queueOrder']=[job['id'] for job in result['queuedJobs']]
        result['runningJobs']=[copy.deepcopy(job) for job in result['jobs'] if job.get('status')=='running']
        result['scheduler']={'maxConcurrentJobs':limit,'runningCount':len(result['runningJobs']),'runningSlots':len(result['runningJobs']),
            'queuedCount':len(result['queuedJobs']),'blockedCount':sum(bool(job['blockedReason']) for job in result['queuedJobs'])}
        result["template"] = template_info()
        result["templateHash"] = template_hash()
        from script_import import supported_extensions
        result["scriptFormats"] = supported_extensions()
        from chapter_analysis import build_chapter_requirements
        for project in result["projects"]:
            requirements = build_chapter_requirements(project, result["library"], asset_root=self.data)
            project["chapterRequirements"] = requirements["chapters"]
            project["chapterRequirementSummary"] = requirements["totals"]
            project["assetWarnings"] = requirements["warnings"]
        return result

    def probe(self, force=True):
        with self.runtime_lock:
            try:
                self.runtime = self.worker.probe_runtime(force=force)
            except Exception as exc:
                self.runtime = {"ready": False, "loggedIn": False, "imageGeneration": False, "message": "连接检查失败：" + str(exc)[:500]}
            self.runtime_time = time.monotonic()
            return copy.deepcopy(self.runtime)

    def find(self, collection, item_id, label):
        if not isinstance(item_id, str) or not ID_RE.fullmatch(item_id):
            raise APIError(label + "编号不正确。", 404)
        for item in collection:
            if item.get("id") == item_id:
                return item
        raise APIError("未找到" + label + "。", 404)

    def project(self, pid):
        return self.find(self.state["projects"], pid, "项目")

    def character(self, project, cid):
        return self.find(project["characters"], cid, "角色")

    def outfit(self, character, oid):
        return self.find(character["outfits"], oid, "服装")

    def editable(self, pid, character_id=None, outfit_id=None, allow_readonly_previews=False):
        from job_scheduler import resource_keys,resources_conflict
        probe={'id':'manual_edit','kind':'pipeline' if character_id else 'analyze','projectId':pid,'characterId':character_id}
        if outfit_id:
            probe['resourceLocks']=['write:outfit:'+pid+':'+character_id+':'+outfit_id]
        for active in self.state['jobs']:
            if allow_readonly_previews and active.get('kind')=='face_refine':continue
            if active.get('status')=='running' and resources_conflict(self.state,probe,active):
                raise APIError('这个人物或素材正在被任务使用，请等待对应任务完成或取消后再修改。',409)

    def assert_job_sources(self,job):
        from job_scheduler import source_input_version
        expected=job.get('sourceInputVersion')
        if expected and source_input_version(self,job)!=expected:
            raise APIError('图片来源或人物身份版本已变化，当前结果保留为任务文件，请按当前素材重新制作。',409)

    def file_path(self, url):
        url = image_url(url)
        if not url:
            raise APIError("缺少图片路径。", 404)
        candidate = (self.data / unquote(url[len("/files/"):])).resolve()
        allowed = [(self.data / "assets").resolve(), (self.data / "generated").resolve()]
        if not any(candidate.is_relative_to(p) for p in allowed):
            raise APIError("文件路径不正确。", 404)
        return candidate

    def upload(self, payload):
        filename = text_value(payload.get("filename", "图片"), "文件名", 300, True)
        value = payload.get("data", "")
        if not isinstance(value, str):
            raise APIError("图片数据格式不正确。")
        match = re.fullmatch(r"data:(image/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\r\n]+)", value)
        if not match:
            raise APIError("只支持 PNG、JPEG 和 WebP 图片。")
        try:
            raw = base64.b64decode(match[2], validate=True)
        except (ValueError, binascii.Error):
            raise APIError("图片数据损坏，请重新选择。")
        if not raw or len(raw) > MAX_IMAGE:
            raise APIError("图片不能超过20 MB。")
        mime = match[1]
        signatures = {
            "image/png": (raw.startswith(b"\x89PNG\r\n\x1a\n") and len(raw) >= 24),
            "image/jpeg": raw.startswith(b"\xff\xd8\xff") and len(raw) >= 12,
            "image/jpg": raw.startswith(b"\xff\xd8\xff") and len(raw) >= 12,
            "image/webp": len(raw) >= 20 and raw.startswith(b"RIFF") and raw[8:12] == b"WEBP",
        }
        if not signatures[mime]:
            raise APIError("图片类型与内容不一致，请重新选择。")
        ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/webp": ".webp"}[mime]
        from resource_control import store_upload
        return {'url':store_upload(self,raw,ext),'filename':Path(filename).name}

    def clothing_sources(self, projects, character_id=None, outfit_id=None, allow_reference=False):
        sources, seen = [], set()
        for project in projects:
            for character in project.get("characters", []):
                if character_id and character.get("id") != character_id:
                    continue
                for outfit in character.get("outfits", []):
                    if outfit_id and outfit.get("id") != outfit_id:
                        continue
                    choices = [outfit.get("card")]
                    if allow_reference:
                        choices.append(outfit.get("reference"))
                    for url in choices:
                        if not url:
                            continue
                        try:
                            file = self.file_path(url)
                        except APIError:
                            continue
                        if not file.is_file() or file.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                            continue
                        digest = hashlib.sha256()
                        with file.open("rb") as stream:
                            for chunk in iter(lambda: stream.read(131072), b""):
                                digest.update(chunk)
                        key = digest.hexdigest()
                        if key not in seen:
                            seen.add(key)
                            style = outfit.get("style") or project.get("style", "国漫")
                            sources.append({"projectId": project["id"], "characterId": character["id"], "outfitId": outfit["id"],
                                            "projectName": project["name"], "characterName": character["name"],
                                            "name": outfit.get("name", "服装"), "description": outfit.get("description", ""),
                                            "style": style if style in STYLES else project.get("style", "国漫"), "card": url})
                        break
        return sources

    def merge_job_library(self, job_id, incoming):
        if not isinstance(incoming, list) or any(not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not ID_RE.fullmatch(entry["id"]) for entry in incoming):
            raise ValueError("任务返回的图库格式不正确。")
        existing = {entry["id"]: copy.deepcopy(entry) for entry in self.state["library"]}
        versions = self.job_library_versions.setdefault(job_id, copy.deepcopy(existing))
        absent = object()
        for entry in incoming:
            item_id = entry["id"]
            prior, current = versions.get(item_id), existing.get(item_id)
            if any(row.get('item',{}).get('id')==item_id for row in self.state.get('materialRecycleBin',[])):
                continue
            if prior is None or current is None:
                existing[item_id] = copy.deepcopy(entry)
            else:
                merged = copy.deepcopy(current)
                for field in set(prior) | set(entry):
                    if current.get(field, absent) == prior.get(field, absent):
                        if field in entry:
                            merged[field] = copy.deepcopy(entry[field])
                        else:
                            merged.pop(field, None)
                existing[item_id] = merged
            versions[item_id] = copy.deepcopy(entry)
        return list(existing.values())

    def enqueue(self, payload):
        kind = payload.get("kind")
        if not isinstance(kind, str) or kind not in KINDS:
            raise APIError("任务类型不正确。")
        with self.lock:
            pid, cid, oid = payload.get("projectId") or None, payload.get("characterId") or (payload.get('roleId') if kind=='crowd_set' else None), payload.get("outfitId")
            sources, project, character = None, None, None
            if kind in {'comic_character','card_convert','card_outfit_scan','image_combine'}:
                pid,cid,oid=None,None,None
            elif kind in {"library_faces", "library_body", "library_face_core", "library_hairstyle"} or kind in {"extract_assets","face_refine","hairstyle_preview","crowd_set"} and not cid:
                if not isinstance(payload.get("style", "国漫"), str) or payload.get("style", "国漫") not in (STYLES if kind in {"library_faces","library_body"} else LIBRARY_STYLES):
                    raise APIError("请选择有效画风。")
                if kind in {'library_face_core','library_hairstyle','extract_assets','face_refine','hairstyle_preview','crowd_set'} and pid:
                    project=self.project(pid)
                    if cid:character=self.character(project,cid)
            elif kind == "clothing_collect":
                projects = [self.project(pid)] if pid else self.state["projects"]
                sources = self.clothing_sources(projects)
                if not sources:
                    raise APIError("还没有可收集的服装角色卡，请先生成服装角色卡。")
            else:
                project = self.project(pid)
                if kind == 'project_auto' and not project.get('script','').strip() and not project.get('characters'):
                    raise APIError('请先导入剧本或添加角色，再开始自动制作。')
                if kind not in {"analyze", "project_auto"}:
                    character = self.character(project, cid)
                    if kind in {"outfit", "gestures", "hands", "special", "combine", "pipeline", "clothing_extract", "hands_auto"}:
                        self.outfit(character, oid)
                    if kind == "clothing_extract":
                        sources = self.clothing_sources([project], cid, oid, allow_reference=True)
                        if not sources:
                            raise APIError("这一套服装还没有可读取的角色卡或参考图。")
            job = {"id": new_id("job"), "kind": kind, "projectId": pid, "characterId": cid, "outfitId": oid,
                   "status": "queued", "phase": "queued", "message": "等待处理", "createdAt": now(),
                   "instructions": text_value(payload.get("instructions", ""), "任务说明", 30000),
                   "count": 3 if kind == "face" else 1 if kind in {"library_face_core","library_hairstyle","head_prepare","hair_apply","extract_assets","face_refine","hairstyle_preview"} else integer(payload.get("count", 8), "数量", 1, 32),
                   "style": payload.get("style", "国漫"), "cancelRequested": False}
            if kind in {"face","pipeline","project_auto"}: job["faceCandidateCount"] = 3
            if kind == 'comic_character':
                job['instructions'] = text_value(payload.get('instructions', ''), '角色资产提示词', 18000, True)
                job['references'] = image_urls(payload.get('references', []))
                if len(job['references']) > 3: raise APIError('角色资产最多3张固定参考图。')
                job['count'] = 1
            template = template_info()
            job["templateId"] = template["id"]
            job["templateVersion"] = template["version"]
            job["templateHash"] = template_hash()
            for key in ("libraryId", "bodyId", "action", "name", "description", "referenceIds", "sourceHead", "sourceHeadHash", "sourceSubjectKey", "subjectScope", "autoCapture", "autoCaptureKey", "retryOf", "parentJobId"):
                if key in payload:
                    job[key] = copy.deepcopy(payload[key])
            if kind=='library_body':
                from body_library import metadata
                job.update(metadata(payload))
                if 'name' in payload:job['name']=text_value(payload['name'],'身体模板名称',160,True)
            if kind in {'library_faces','library_body'} and any(key in payload for key in ('era','gender','ageStage')):
                from identity_library import pure_metadata
                job.update(pure_metadata(payload))
            if kind in {'library_face_core','library_hairstyle','extract_assets'}:
                from identity_library import pure_metadata
                job.update(pure_metadata(payload))
                for field in ('reference','references'):
                    if field in payload:job[field]=image_url(payload[field]) if field=='reference' else image_urls(payload[field])
                action=payload.get('action','generate')
                if action not in {'generate','extract'}:raise APIError('请选择生成或提取。')
                job['action']=action
                ref_ids=job.get('referenceIds',[])
                if not isinstance(ref_ids,list) or len(ref_ids)>12:raise APIError('素材参考编号须为列表，最多12项。')
                for ref_id in ref_ids:self.find(self.state['library'],ref_id,'参考素材')
            from job_scheduler import validate_dependencies
            try:job['dependsOn']=validate_dependencies(self.state['jobs'],job['id'],payload.get('dependsOn',[]))
            except ValueError as exc:raise APIError(str(exc)) from exc
            if kind in {'library_face_core','library_hairstyle','extract_assets'}:
                output=payload.get('outputStyle',payload.get('style','国漫'))
                if not isinstance(output,str) or output!='source' and output not in LIBRARY_STYLES:raise APIError('请选择保留原风格或输出画风。')
                source_style=payload.get('sourceStyle','unknown')
                if not isinstance(source_style,str) or source_style not in SOURCE_STYLES:raise APIError('输入图片类型不正确。')
                job.update(outputStyle=output,sourceStyle=source_style)
                if 'sourceHead' in job:job['sourceHead']=image_url(job['sourceHead'])
            if kind in {'card_convert','card_outfit_scan','image_combine'}:
                from standalone_tools import prepare_job
                prepare_job(self,job,payload)
            if kind=='extract_assets':
                parts=payload.get('parts',['face_core','hairstyle'])
                if not isinstance(parts,list) or not parts or any(not isinstance(part,str) for part in parts) or len(set(parts))!=len(parts) or any(part not in {'face_core','hairstyle','clothing'} for part in parts):raise APIError('请选择纯脸、发型或服装素材。')
                job['parts']=parts
                if not character and not (job.get('reference') or job.get('sourceHead') or job.get('references') or job.get('referenceIds')):raise APIError('请上传或选择待拆分的图片。')
            if kind=='hands_auto':
                costume=self.outfit(character,oid)
                valid_card=bool(costume.get('card') and self.file_path(costume['card']).is_file() and not costume.get('semanticReviewPending'))
                if not valid_card:
                    preparer=next((j for j in reversed(self.state['jobs']) if j.get('status') in {'queued','running'} and j.get('projectId')==pid and (j.get('kind')=='project_auto' or j.get('characterId')==cid and j.get('outfitId')==oid and j.get('kind') in {'outfit','pipeline'})),None)
                    if not preparer:raise APIError('请先生成这套服装角色卡，或先将它的制作任务加入队列。')
                    if preparer['id'] not in job['dependsOn']:job['dependsOn'].append(preparer['id'])
            if "forceAnalysis" in payload:
                if kind != "analyze" or not isinstance(payload["forceAnalysis"], bool):
                    raise APIError("强制重拆参数仅适用于剧本分析且需要布尔值。")
                job["forceAnalysis"] = payload["forceAnalysis"]
            if sources is not None:
                job["sources"] = sources
            if payload.get("scheduleDate"):
                job["scheduleDate"] = text_value(payload["scheduleDate"], "计划日期", 10)
            if payload.get("libraryId"):
                self.find(self.state["library"], payload["libraryId"], "图库条目")
            if project is not None:
                selected = read_range(payload.get('readRange') or [project.get('rangeStart',1),project.get('rangeEnd',20)])
                job['readScope']={'range':selected,'chapterNumbers':sorted({c['chapter'] for c in project.get('chapters',[]) if selected[0]<=c['chapter']<=selected[1]}),
                    'sourceHashes':sorted({c.get('sourceHash') for c in project.get('chapters',[]) if selected[0]<=c['chapter']<=selected[1] and c.get('sourceHash')})}
                job['readScope']['scriptHash']=hashlib.sha256(('\n\n'.join(c['text'] for c in project.get('chapters',[]) if selected[0]<=c['chapter']<=selected[1]) or project.get('script','')).encode()).hexdigest()
            if character is not None:
                from life_stages import ensure_appearance_profiles, get_profile
                ensure_appearance_profiles(project)
                profile = get_profile(character,payload.get('appearanceProfileId') or (self.outfit(character,oid).get('appearanceProfileId') if oid else None) or character.get('defaultAppearanceProfileId'))
                if not profile: raise APIError('未找到该角色的人物时期。',404)
                if oid and self.outfit(character,oid).get('appearanceProfileId') != profile['id']: raise APIError('服装不属于所选人物时期。')
                job['appearanceProfileId']=profile['id']
            if kind in {'face_refine','hairstyle_preview'}:
                from refinement_api import prepare_refinement_job
                prepare_refinement_job(self,job,payload,project,character)
            if kind=='crowd_set':
                from crowd_sets import prepare_crowd_job
                if project is not None:job['style']=project['style']
                prepare_crowd_job(self,job,payload,project,character)
            request_id=payload.get('clientRequestId')
            if request_id is not None:
                if not isinstance(request_id,str) or not ID_RE.fullmatch(request_id): raise APIError('请求编号格式不正确。')
                job['clientRequestId']=request_id
            fingerprint_fields={k:v for k,v in job.items() if k not in {'id','status','phase','message','createdAt','cancelRequested','clientRequestId'}}
            job['requestFingerprint']=hashlib.sha256(json.dumps(fingerprint_fields,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
            if kind=='crowd_set' and not payload.get('crowdSetId'):
                fingerprint_fields.pop('crowdSetId',None)
                job['requestFingerprint']=hashlib.sha256(json.dumps(fingerprint_fields,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
            for existing in self.state['jobs']:
                same_request=request_id is not None and existing.get('clientRequestId')==request_id
                same_active=existing.get('status') in {'queued','running'} and existing.get('requestFingerprint')==job['requestFingerprint']
                if same_request:
                    if existing.get('requestFingerprint')!=job['requestFingerprint']: raise APIError('这个请求编号已用于不同任务，请重新提交。',409)
                    return {**copy.deepcopy(existing),'duplicate':True}
                if same_active: return {**copy.deepcopy(existing),'duplicate':True}
            self.state["jobs"].append(job)
            self.save()
        self.wake.set()
        return copy.deepcopy(job)

    def update_job(self, job_id, *args, **kwargs):
        if args:
            if len(args) == 1 and isinstance(args[0], dict):
                kwargs = {**args[0], **kwargs}
            elif len(args) <= 2:
                kwargs = {**dict(zip(("phase", "message"), args)), **kwargs}
            else:
                raise TypeError("update accepts dict or phase, message")
        with self.lock:
            job = self.find(self.state["jobs"], job_id, "任务")
            checkpoint = kwargs.get("checkpoint")
            if isinstance(checkpoint,dict):self.assert_job_sources(job)
            checkpoint_project, checkpoint_library = None, None
            if isinstance(checkpoint, dict) and checkpoint.get("project") is not None:
                updated = checkpoint["project"]
                if not isinstance(updated, dict) or updated.get("id") != job.get("projectId"):
                    raise ValueError("任务检查点的项目编号不一致。")
                from job_scheduler import merge_project_delta
                live=self.project(job['projectId'])
                known_baseline=job_id in self.job_project_versions
                baseline=self.job_project_versions.get(job_id,copy.deepcopy(live))
                from crowd_sets import guard_crowd_update
                guard_crowd_update(self,job,baseline,updated)
                merged=merge_project_delta(baseline,updated,live)
                if not known_baseline:
                    for field in ('rangeStart','rangeEnd','readRange','rangeVerified','script'):
                        if field in live:merged['project'][field]=copy.deepcopy(live[field])
                        else:merged['project'].pop(field,None)
                checkpoint_project=merged['project'];checkpoint_project['updatedAt']=now()
                from job_scheduler import validate_output_delta
                validate_output_delta(self,baseline,updated,checkpoint_project)
                self.job_project_versions[job_id]=copy.deepcopy(updated)
                if merged['conflicts']:job.setdefault('mergeConflicts',[]).extend(merged['conflicts'])
            if job.get('kind')=='crowd_set':
                from crowd_sets import crowd_superseded
                if crowd_superseded(self,job):raise APIError('群像来源或版本已过期，未覆盖套组。',409)
            if isinstance(checkpoint, dict) and checkpoint.get("library") is not None:
                checkpoint_library = self.merge_job_library(job_id, checkpoint["library"])
            if checkpoint_project is not None:
                live = self.project(job["projectId"])
                live.clear()
                live.update(checkpoint_project)
            if checkpoint_library is not None:
                self.state["library"] = checkpoint_library
            if checkpoint_project is not None or checkpoint_library is not None:
                from crowd_sets import advance_crowd_source
                advance_crowd_source(self,job)
                from job_scheduler import source_input_version
                job['sourceInputVersion']=source_input_version(self,job)
            if job.get("cancelRequested") or self.stop_event.is_set():
                if checkpoint_project is not None or checkpoint_library is not None:
                    self.save()
                raise self.worker.Cancelled("任务已取消。")
            if not kwargs:
                return
            fields = ("phase", "message", "progress", "files", "log", "stepProgress", "assetExtraction", "partialFailures", "needsRetry", "visualRefinement", "hairstylePreview", "crowdSet", "partialSuccess", "missingParts", "resourceMode", "resourceCharacterIds", "toolResult")
            if 'toolResult' in kwargs:
                from standalone_tools import validate_result
                kwargs['toolResult']=validate_result(self,job,kwargs['toolResult'])
            changed = any(key in kwargs and kwargs[key] != job.get(key) for key in fields)
            followups=kwargs.get('autoCaptureFollowups') or (checkpoint.get('autoCaptureFollowups') if isinstance(checkpoint,dict) else None)
            if not changed and checkpoint_project is None and checkpoint_library is None and not followups:
                return
            for key in fields:
                if key in kwargs:
                    job[key] = copy.deepcopy(kwargs[key])
            if job.get('kind')=='project_auto' and ('resourceMode' in kwargs or 'resourceCharacterIds' in kwargs):
                from job_scheduler import resource_keys
                job['resourceLocks']=resource_keys(self.state,job)
            job["updatedAt"] = now()
            self.save()
            followups=kwargs.get('autoCaptureFollowups') or (checkpoint.get('autoCaptureFollowups') if isinstance(checkpoint,dict) else None)
            if followups:self.queue_followups(job,followups)

    def claim_job(self):
        from job_scheduler import next_job,concurrency_limit,resource_keys
        with self.lock:
            if self.stop_event.is_set():return None
            from resource_control import admission
            active=sum(j['status']=='running' for j in self.state['jobs'])
            if not admission(self.data,self.settings(),active)['allowed']:return None
            job=next_job(self.state,concurrency_limit(self.settings()))
            from refinement_api import refinement_superseded
            from crowd_sets import crowd_superseded
            while job and (self.capture_superseded(job) or refinement_superseded(self,job) or crowd_superseded(self,job)):
                job.update(status='cancelled',phase='superseded',message='来源图片已更新，旧素材或预览任务已跳过；请以当前图片重新制作。',finishedAt=now())
                self.save();job=next_job(self.state,concurrency_limit(self.settings()))
            if not job:return None
            job.update(status='running',phase='starting',message='正在启动',startedAt=now(),resourceLocks=resource_keys(self.state,job))
            self.save()
            from job_scheduler import source_input_version
            job['sourceInputVersion']=source_input_version(self,job)
            self.save()
            current_job=copy.deepcopy(job)
            current_job.update(_dataDir=str(self.data),_baseDir=str(self.root))
            project=copy.deepcopy(self.project(job['projectId'])) if job.get('projectId') else None
            if project is not None and job.get('readScope'):
                selected=job['readScope']['range']
                project.update(rangeStart=selected[0],rangeEnd=selected[1],readRange=selected)
                if project.get('chapters'):project['script']='\n\n'.join(c['text'] for c in project['chapters'] if selected[0]<=c['chapter']<=selected[1])
            library=copy.deepcopy(self.state['library'])
            self.job_library_versions[job['id']]={entry['id']:copy.deepcopy(entry) for entry in library}
            if project is not None:self.job_project_versions[job['id']]=copy.deepcopy(project)
            return job,current_job,project,library

    def execute_claimed(self,context):
        job,current_job,project,library=context
        try:
            result=self.worker.run_job(current_job,project,library,lambda *a,**kw:self.update_job(job['id'],*a,**kw)) or {}
            with self.lock:
                if job.get('cancelRequested') or self.stop_event.is_set():raise self.worker.Cancelled('任务已取消。')
                if result.get('project') is not None:
                    self.assert_job_sources(job)
                    from crowd_sets import guard_crowd_update
                    guard_crowd_update(self,job,self.job_project_versions.get(job['id'],project),result['project'])
                    updated=result['project']
                    if not isinstance(updated,dict) or updated.get('id')!=job.get('projectId'):raise ValueError('任务返回的项目编号不一致。')
                    from job_scheduler import merge_project_delta
                    live=self.project(job['projectId'])
                    merged=merge_project_delta(self.job_project_versions.get(job['id'],project),updated,live)
                    from job_scheduler import validate_output_delta
                    validate_output_delta(self,self.job_project_versions.get(job['id'],project),updated,merged['project'])
                    updated=merged['project'];updated['updatedAt']=now()
                    if merged['conflicts']:job.setdefault('mergeConflicts',[]).extend(merged['conflicts'])
                    live.clear();live.update(updated)
                if job.get('kind')=='crowd_set':
                    from crowd_sets import crowd_superseded
                    if crowd_superseded(self,job):raise APIError('群像来源或套组版本已过期，旧结果保留为文件。',409)
                if result.get('library') is not None:self.state['library']=self.merge_job_library(job['id'],result['library'])
                if not result.get('superseded'):
                    from refinement_api import apply_preview_result
                    apply_preview_result(self,job,result)
                from crowd_sets import advance_crowd_source
                advance_crowd_source(self,job)
                failed=bool(result.get('errors') or result.get('partialFailures') or result.get('needsRetry'))
                superseded=bool(result.get('superseded'))
                job.update(status='cancelled' if superseded else 'failed' if failed else 'completed',phase='superseded' if superseded else 'partial_failed' if result.get('needsRetry') else 'failed' if failed else 'completed',
                    message=result.get('message','部分制作未完成，已完成的结果保留。' if failed else '已完成'),finishedAt=now())
                if result.get('toolResult') is not None:
                    from standalone_tools import validate_result
                    job['toolResult']=validate_result(self,job,result['toolResult'])
                for key in ('files','log','errors','progress','stepProgress','assetExtraction','partialFailures','needsRetry','crowdSet','partialSuccess','missingParts'):
                    if key in result:job[key]=copy.deepcopy(result[key])
                self.save()
                if job.get('kind')=='card_outfit_scan' and job.get('status')=='completed' and job.get('autoConvert'):
                    try:
                        from outfit_conversion import enqueue_outfits
                        enqueue_outfits(self,job['id'])
                        job['message']='服装清单已完成，各套角色卡已分别加入制作队列。'
                    except Exception as error:
                        job['batchError']=str(error);job['message']='服装清单已保存，提交制作未完成：'+str(error)[:300]
                    self.save()
                if result.get('autoCaptureFollowups'):self.queue_followups(job,result['autoCaptureFollowups'])
        except self.worker.Cancelled:
            with self.lock:
                job.update(status='cancelled',phase='cancelled',message='任务已取消，已完成的文件保留。',finishedAt=now());self.save()
        except Exception as exc:
            with self.lock:
                job.update(status='failed',phase='failed',message=str(exc)[:2000] or '生成失败，请重试。',finishedAt=now());self.save()
            print('Job failed:',type(exc).__name__,str(exc),file=sys.stderr)
        finally:
            with self.lock:
                self.job_library_versions.pop(job['id'],None);self.job_project_versions.pop(job['id'],None)
            self.wake.set()
        return True

    def run_one(self):
        context=self.claim_job()
        return self.execute_claimed(context) if context else False

    def worker_loop(self):
        last_schedule_check=0.0
        while not self.stop_event.is_set():
            if time.monotonic()-last_schedule_check>=30:
                try:
                    self.schedule_daily_faces()
                    from recycle_cleanup import schedule
                    schedule(self)
                except Exception as exc:print('定期维护未完成：',str(exc),file=sys.stderr)
                last_schedule_check=time.monotonic()
            while not self.stop_event.is_set():
                context=self.claim_job()
                if context is None:break
                future=self.pool.submit(self.execute_claimed,context)
                with self.lock:self.job_futures[context[0]['id']]=future
                def finished(completed,job_id=context[0]['id']):
                    with self.lock:self.job_futures.pop(job_id,None)
                    self.wake.set()
                future.add_done_callback(finished)
            self.wake.wait(timeout=0.5);self.wake.clear()

    def capture_superseded(self,job):
        if not job.get('autoCapture') or not job.get('sourceHeadHash') or not job.get('projectId') or not job.get('characterId'):return False
        from life_stages import get_profile
        try:
            project=self.project(job['projectId']);char=self.character(project,job['characterId']);profile=get_profile(char,job.get('appearanceProfileId'))
            path=self.file_path((profile or {}).get('face',''))
            return not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=job['sourceHeadHash']
        except (APIError,OSError):return True

    def capture_face_assets(self,project,character,profile_id,include_clothing=False):
        from life_stages import get_profile
        profile=get_profile(character,profile_id)
        if not profile or not profile.get('faceApproved') or not profile.get('face'):return None
        source=image_url(profile['face']);path=self.file_path(source)
        if not path.is_file() or path.suffix.lower() not in {'.png','.jpg','.jpeg','.webp'}:return None
        try:
            from PIL import Image
            with Image.open(path) as image:image.verify()
        except (OSError,ValueError):return None
        parts=['face_core','hairstyle']+(['clothing'] if include_clothing else [])
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        key=hashlib.sha256(json.dumps([project['id'],character['id'],profile_id,digest,parts,project['style']],sort_keys=True).encode()).hexdigest()
        existing=[j for j in self.state['jobs'] if j.get('autoCaptureKey')==key]
        if existing and existing[-1].get('status') in {'queued','running','completed'}:return copy.deepcopy(existing[-1])
        capture=self.enqueue({'kind':'extract_assets','projectId':project['id'],'characterId':character['id'],'appearanceProfileId':profile_id,
            'sourceHead':source,'sourceHeadHash':digest,'parts':parts,'sourceStyle':profile.get('sourceStyle','unknown'),'outputStyle':project['style'],
            'style':project['style'],'autoCapture':True,'autoCaptureKey':key,'clientRequestId':'capture_'+key[:42]+'_'+str(len(existing))})
        profile['autoCaptureJobId']=capture['id'];self.save();return capture

    def queue_followups(self,parent,followups):
        if not isinstance(followups,list) or len(followups)>200:
            parent.setdefault('followupWarnings',[]).append('自动素材计划格式不正确，未加入队列。');self.save();return
        for index,payload in enumerate(followups):
            try:
                if not isinstance(payload,dict) or payload.get('kind','extract_assets')!='extract_assets':raise APIError('自动素材任务类型不正确。')
                planned=copy.deepcopy(payload);planned['kind']='extract_assets';planned['autoCapture']=True
                planned['parentJobId']=parent['id']
                source=image_url(planned.get('sourceHead') or planned.get('reference') or '')
                if not source:raise APIError('自动素材计划缺少已保存的来源图片。')
                source_path=self.file_path(source)
                if not source_path.is_file():raise APIError('自动素材计划的来源图片不存在。',404)
                digest=hashlib.sha256(source_path.read_bytes()).hexdigest()
                if planned.get('sourceHeadHash') and planned['sourceHeadHash'] != digest:
                    raise APIError('自动素材计划的来源图片已更新，请以当前图片重新拆分。',409)
                planned.update(sourceHead=source,sourceHeadHash=digest)
                if planned.get('projectId'):
                    from life_stages import get_profile
                    target=self.project(planned['projectId']);owner=self.character(target,planned.get('characterId',''))
                    profile=get_profile(owner,planned.get('appearanceProfileId'))
                    if not profile:raise APIError('自动素材计划未找到对应人物时期。',404)
                    planned['appearanceProfileId']=profile['id']
                planned['dependsOn']=list(dict.fromkeys(dep for dep in planned.get('dependsOn',[]) if dep!=parent['id']))
                planned.setdefault('clientRequestId','follow_'+hashlib.sha256(json.dumps([parent['id'],index,planned],sort_keys=True).encode()).hexdigest()[:48])
                self.enqueue(planned)
            except (APIError,ValueError,TypeError) as exc:parent.setdefault('followupWarnings',[]).append(str(exc))
        self.save()

    def schedule_daily_faces(self, local_time=None):
        config = self.settings().get("dailyFaces", {})
        if not isinstance(config, dict) or not config.get("enabled"):
            return None
        local_time = local_time or datetime.now(timezone(timedelta(hours=8)))
        if local_time.strftime("%H:%M") < config.get("time", "09:00"):
            return None
        day = local_time.strftime("%Y-%m-%d")
        with self.lock:
            if any(j.get("scheduleDate") == day and j.get("kind") == "library_faces" for j in self.state["jobs"]):
                return None
            return self.enqueue({"kind": "library_faces", "style": config.get("style", "国漫"),
                                 "instructions": config.get("instructions", ""), "count": 8, "scheduleDate": day})

    def cancel(self, jid):
        with self.lock:
            job = self.find(self.state["jobs"], jid, "任务")
            if job["status"] == "queued":
                job.update(status="cancelled", phase="cancelled", message="已取消排队", cancelRequested=True, finishedAt=now())
            elif job["status"] == "running":
                job.update(cancelRequested=True, message="正在取消…")
            self.save()
            return copy.deepcopy(job)

    def mutate(self, method, path, payload):
        if not isinstance(payload, dict):
            raise APIError("请求内容需要是对象。")
        if method=='POST' and path.startswith('/api/tool-results/') and path.endswith('/save-library'):
            parts=path.strip('/').split('/')
            if len(parts)!=4:raise APIError('转换入库路径无效。',404)
            from conversion_library import save_result
            return save_result(self,parts[2])
        if method=='POST' and path in {'/api/library/recycle-bin/settings','/api/library/recycle-bin/preview','/api/library/recycle-bin/clean'}:
            from recycle_cleanup import update_settings,plan,clean
            with self.lock:
                if path.endswith('/settings'):return update_settings(self,payload)
                if path.endswith('/preview'):return plan(self,payload.get('mode','expired'))
                return clean(self,payload.get('mode','expired'),payload.get('version'))
        if method=='POST' and path=='/api/resources/clean-previews':
            from resource_control import clean_previews,THUMB_LOCK
            with THUMB_LOCK:return clean_previews(self.data)
        if method=='POST' and path.startswith('/api/detached-characters/') and path.endswith('/restore'):
            from external_references import restore
            return restore(self,path.strip('/').split('/')[2])
        if method=='POST' and path.startswith('/api/projects/') and path.endswith('/detach'):
            pieces=path.strip('/').split('/')
            if len(pieces)!=6 or pieces[3]!='characters':raise APIError('角色移出路径无效。',404)
            from external_references import detach
            return detach(self,pieces[2],pieces[4])
        if method == "POST" and path == "/api/upload":
            return self.upload(payload)
        if method == "POST" and path == "/api/scripts/import":
            from script_import import ScriptImportError, import_scripts
            try:
                selected_range = read_range([payload.get("rangeStart", 1), payload.get("rangeEnd", 20)]) if "rangeStart" in payload or "rangeEnd" in payload else None
                return import_scripts(payload.get("files"), self.data, payload.get("knownHashes"), chapter_range=selected_range)
            except ScriptImportError as exc:
                raise APIError(str(exc)) from exc
        if method == "POST" and path == "/api/scripts/read-saved":
            from script_import import ScriptImportError, read_saved_sources
            try:
                selected_range = read_range([payload.get("rangeStart", 1), payload.get("rangeEnd", 20)])
                return read_saved_sources(source_files(payload.get("sourceFiles", [])), self.data, chapter_range=selected_range)
            except ScriptImportError as exc:
                raise APIError(str(exc)) from exc
        if method == "POST" and path.startswith("/api/team-master/") and path.endswith("/check-bindings"):
            pieces = path.strip("/").split("/")
            if len(pieces) != 4:
                raise APIError("未找到这个操作。", 404)
            from team_bridge import export_team_master, check_panel_bindings
            with self.lock:
                master = export_team_master(self.project(pieces[2]), self.data)
            return check_panel_bindings(master, payload.get("panels"), payload.get("masterVersion"), payload.get("projectId"))
        if method == "POST" and path in {"/api/jobs/batch/plan","/api/jobs/batch"}:
            from batch_jobs import plan_batch,enqueue_batch
            with self.lock:
                return plan_batch(self,payload) if path.endswith('/plan') else enqueue_batch(self,payload)
        if method == 'POST' and path.startswith('/api/tools/outfit-scans/') and path.endswith('/convert'):
            pieces=path.strip('/').split('/')
            if len(pieces)!=5:raise APIError('转换路径无效。',404)
            from outfit_conversion import enqueue_outfits
            return enqueue_outfits(self,pieces[3],payload.get('outfitIds'))
        if method == "POST" and path == "/api/jobs":
            return self.enqueue(payload)
        if method == "POST" and path == "/api/settings":
            settings = {k: text_value(v, "程序路径", 2000) for k, v in payload.items() if k in {"codexPath", "pythonPath"}}
            if 'resourceControl' in payload:
                from resource_control import validate_settings
                try:settings['resourceControl']=validate_settings(payload['resourceControl'],self.settings().get('resourceControl'))
                except ValueError as error:raise APIError(str(error)) from error
            if "dailyFaces" in payload:
                config = payload["dailyFaces"]
                if not isinstance(config, dict) or not isinstance(config.get("enabled", False), bool):
                    raise APIError("每日群像计划格式不正确。")
                scheduled_time = config.get("time", "09:00")
                if not isinstance(scheduled_time, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", scheduled_time):
                    raise APIError("计划时间请使用 HH:MM 格式。")
                if not isinstance(config.get("style", "国漫"), str) or config.get("style", "国漫") not in STYLES:
                    raise APIError("每日群像计划的画风不正确。")
                settings["dailyFaces"] = {"enabled": config.get("enabled", False), "time": scheduled_time,
                                          "style": config.get("style", "国漫"), "instructions": text_value(config.get("instructions", ""), "计划说明", 30000)}
            if 'maxConcurrentJobs' in payload:settings['maxConcurrentJobs']=integer(payload['maxConcurrentJobs'],'同时任务数',1,8)
            if not settings:
                raise APIError("请选择需要修改的设置。")
            try:
                if 'maxConcurrentJobs' in payload:settings['maxConcurrentJobs']=integer(payload['maxConcurrentJobs'],'同时任务数',1,8)
                result = self.worker.save_settings(settings)
                self.wake.set()
            except (ValueError, OSError) as exc:
                raise APIError(str(exc))
            self.runtime_time = 0
            return result
        parts = path.strip("/").split("/")
        with self.lock:
            from body_library import mutation as body_mutation
            handled,response=body_mutation(self,method,parts,payload)
            if handled:return response
            from material_library import material_mutation
            handled,response=material_mutation(self,method,parts,payload)
            if handled:return response
            from project_ops import special_mutation, store_project
            handled,response=special_mutation(self,method,parts,payload)
            if handled: return response
            if method == "POST" and parts == ["api", "projects"]:
                project = project_record(payload)
                result = store_project(self,project)
            elif method == "POST" and parts == ["api", "projects", "import"]:
                raw = payload.get("project", payload)
                project = project_record(raw)
                if raw.get('id') and not any(p['id']==raw['id'] for p in self.state['projects']):
                    if not isinstance(raw['id'],str) or not ID_RE.fullmatch(raw['id']): raise APIError('导入项目编号不正确。')
                    project['id']=raw['id']
                chars = raw.get("characters", [])
                if not isinstance(chars, list) or len(chars) > 500:
                    raise APIError("导入的角色列表不正确。")
                project["characters"] = [character_record(c) for c in chars]
                copy_style_metadata(project, raw, ("recommendedStyle",))
                for key in ("styleReason",):
                    if key in raw:
                        project[key] = text_value(raw[key], "画风推荐说明", 30000)
                if "analysisWarnings" in raw:
                    project["analysisWarnings"] = text_list(raw["analysisWarnings"], "分析提示")
                if "analysisRange" in raw:
                    rng = raw["analysisRange"]
                    if not isinstance(rng, list) or len(rng) != 2:
                        raise APIError("分析范围格式不正确。")
                    project["analysisRange"] = [integer(value, "分析话数") for value in rng]
                missing = []
                def check_import_assets(value):
                    if isinstance(value, dict):
                        for key, item in list(value.items()):
                            if key in {"reference", "face", "base", "card", "hands", "combined", "image", "sheet", "url", "faceCandidateSheet", "clothingImage"} and isinstance(item, str) and item:
                                if not self.file_path(item).is_file():
                                    missing.append(item)
                                    value[key] = ""
                            elif key == "references" and isinstance(item, list):
                                found = []
                                for url in item:
                                    if self.file_path(url).is_file():
                                        found.append(url)
                                    else:
                                        missing.append(url)
                                value[key] = found
                            else:
                                check_import_assets(item)
                    elif isinstance(value, list):
                        for item in value:
                            check_import_assets(item)
                check_import_assets(project["characters"])
                check_import_assets(project["sourceFiles"])
                project["importWarnings"] = ["图片未在本机找到，已清理对应链接：" + url for url in sorted(set(missing))]
                project["importWarnings"].append("导入的脸图保留，角色需要重新点击确认后继续制作。")
                result = store_project(self,project,imported=True)
            elif len(parts) == 4 and parts[:2] == ["api", "jobs"] and parts[3] == "cancel" and method == "POST":
                return self.cancel(parts[2])
            elif parts[:2] == ["api", "projects"] and len(parts) in {3, 4, 5, 6, 7}:
                project = self.project(parts[2])
                if not (len(parts)==4 and parts[3]=='read-chapters' and method=='POST'):
                    self.editable(project["id"])
                if len(parts) == 3 and method == "PATCH":
                    chapter_fields = {"chapters", "availableChapters", "readRange", "rangeVerified", "importWarnings", "readScopes"}
                    allowed_fields = {"name", "script", "rangeStart", "rangeEnd", "styleMode", "style", "sourceFiles", "workflowMode", "autoArchiveClothing"} | chapter_fields
                    merged = {**project, **{k: v for k, v in payload.items() if k in allowed_fields}}
                    changed_source = any(key in payload and payload[key] != project.get(key) for key in ("script", "rangeStart", "rangeEnd", "sourceFiles"))
                    changed_script = 'script' in payload and payload['script'] != project.get('script')
                    changed_range = any(key in payload and payload[key] != project.get(key) for key in ("rangeStart", "rangeEnd"))
                    if changed_range and "chapters" not in payload:
                        merged.update(readRange=[merged['rangeStart'],merged['rangeEnd']],rangeVerified=False)
                        merged['script']='\n\n'.join(c['text'] for c in project.get('chapters',[]) if merged['rangeStart']<=c['chapter']<=merged['rangeEnd'])
                    validated = project_record(merged)
                    for key in ("name", "script", "rangeStart", "rangeEnd", "styleMode", "style", "sourceFiles", "workflowMode", "autoArchiveClothing"):
                        project[key] = validated[key]
                    for key in chapter_fields:
                        if key in validated:
                            project[key] = validated[key]
                    if changed_script and 'chapters' not in payload:
                        project.pop('chapterAnalysis',None); project.pop('analysisRange',None)
                    if "styleMode" in payload or "style" in payload:
                        project["recommendedStyle"] = ""
                    result = project
                elif len(parts) == 4 and parts[3] == "review-analysis" and method == "POST":
                    from chapter_analysis import apply_semantic_revisions
                    try:
                        reviewed = apply_semantic_revisions(project, payload.get("revisions"), reviewer="来源审校")
                    except (ValueError, TypeError, KeyError) as exc:
                        raise APIError(str(exc)) from exc
                    project.clear()
                    project.update(reviewed["project"])
                    result = {key: value for key, value in reviewed.items() if key != "project"}
                elif len(parts) == 4 and parts[3] == "read-chapters" and method == "POST":
                    from script_import import ScriptImportError, read_saved_sources
                    selected_range = read_range([payload.get("rangeStart", project["rangeStart"]), payload.get("rangeEnd", project["rangeEnd"])])
                    try:
                        parsed = read_saved_sources(project.get("sourceFiles", []), self.data, chapter_range=selected_range)
                    except ScriptImportError as exc:
                        raise APIError(str(exc)) from exc
                    from project_ops import append_scope
                    chapter_metadata(parsed)
                    updated=append_scope(project,parsed,selected_range)
                    if project.get('name') not in {'导入剧本','未命名项目'}: updated['name']=project['name']
                    project.clear(); project.update(updated)
                    result = project
                elif len(parts) == 4 and parts[3] == "characters" and method == "POST":
                    result = character_record(payload)
                    project["characters"].append(result)
                elif len(parts) >= 5 and parts[3] == "characters":
                    char = self.character(project, parts[4])
                    if len(parts) == 5 and method == "PATCH":
                        fields = {"name", "category", "description", "episodes", "gestures", "reference", "references", "face", "base", "faceCandidates", "faceCandidateSheet", "selectedFaceId", "faceSelectionReason", "faceSelectionMode", "identitySource", "inputPrepared", "inputImageKey"}
                        validated = character_record({**char, **{k: v for k, v in payload.items() if k in fields}, "outfits": []})
                        if validated["name"] != char["name"]:
                            char["aliases"] = sorted(set(char.get("aliases", []) + [char["name"]]))
                        face_changed = "face" in payload and validated["face"] != char.get("face", "")
                        base_changed = "base" in payload and validated["base"] != char.get("base", "")
                        input_changed = any(field in payload and validated[field] != char.get(field, default) for field, default in
                                            (("identitySource", "design"), ("reference", ""), ("references", [])))
                        previous_inputs = {url for url in [char.get("reference"), *char.get("references", [])] if url}
                        for key in ("faceApproved", "baseApproved"):
                            if key in payload:
                                if not isinstance(payload[key], bool):
                                    raise APIError("确认状态格式不正确。")
                                candidate = validated.get("face" if key == "faceApproved" else "base")
                                if key == "baseApproved" and face_changed and "base" not in payload:
                                    candidate = ""
                                if payload[key] and not candidate:
                                    raise APIError("请先生成或上传对应图片。")
                        if face_changed:
                            char["faceApproved"] = False
                            char["faceStyle"] = project["style"]
                            char["selectedFaceId"] = ""
                            char["faceSelectionReason"] = ""
                            char["faceSelectionMode"] = "manual"
                            if "base" not in payload:
                                char["base"] = ""
                            char["baseApproved"] = False
                        if base_changed:
                            char["baseApproved"] = False
                            char["baseStyle"] = project["style"]
                        if face_changed or base_changed:
                            for previous in char["outfits"]:
                                previous.update(card="", hands="", combined="", specials=[])
                        for key in fields:
                            if key in payload:
                                char[key] = validated[key]
                        for key in ("faceApproved", "baseApproved"):
                            if key in payload:
                                char[key] = payload[key]
                        if input_changed:
                            char.update(inputPrepared=False, inputImageKey="", face="", faceApproved=False,
                                        faceCandidates=[], faceCandidateSheet="", selectedFaceId="", faceSelectionReason="", faceSelectionMode="",
                                        base="", baseApproved=False)
                            for field in ("faceStyle", "baseStyle", "inputDescription"):
                                char.pop(field, None)
                            for previous in char["outfits"]:
                                previous.update(card="", hands="", combined="", specials=[])
                                if previous.get("reference") in previous_inputs:
                                    previous["reference"] = ""
                            if project.get("styleMode") != "manual" and not project.get("script", "").strip():
                                project["inputStyleResolved"] = False
                        result = char
                    elif len(parts) == 6 and parts[5] == "select-face" and method == "POST":
                        candidate = self.find(char.get("faceCandidates", []), payload.get("candidateId"), "该角色的脸图方案")
                        selected_image = image_url(candidate.get("image", ""))
                        if not selected_image or not self.file_path(selected_image).is_file():
                            raise APIError("这个脸图方案文件不存在，请重新生成或上传。", 404)
                        if self.file_path(selected_image).suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                            raise APIError("脸图方案需要使用图片文件。")
                        selected_style = candidate.get("style") or project["style"]
                        if not isinstance(selected_style, str) or selected_style not in STYLES:
                            raise APIError("这个脸图方案的画风不正确。")
                        if selected_image != char.get("face", ""):
                            char.update(base="", baseApproved=False)
                            for previous in char["outfits"]:
                                previous.update(card="", hands="", combined="", specials=[])
                        char.update(face=selected_image, faceApproved=True, faceStyle=selected_style, selectedFaceId=candidate["id"],
                                    faceSelectionReason="", faceSelectionMode="manual")
                        result = char
                    elif len(parts) == 6 and parts[5] == "outfits" and method == "POST":
                        result = outfit_record(payload)
                        from life_stages import get_profile
                        result['appearanceProfileId']=payload.get('appearanceProfileId') or char.get('defaultAppearanceProfileId')
                        if not get_profile(char,result['appearanceProfileId']): raise APIError('服装所属时期不属于该角色。')
                        char["outfits"].append(result)
                    elif len(parts) == 7 and parts[5] == "outfits" and method == "PATCH":
                        outfit = self.outfit(char, parts[6])
                        fields = {"name", "description", "episodes", "gestures", "reference", "specialInstructions", "appearanceProfileId"}
                        validated = outfit_record({**outfit, **{k: v for k, v in payload.items() if k in fields}})
                        from life_stages import get_profile
                        if validated.get('appearanceProfileId') and not get_profile(char,validated['appearanceProfileId']): raise APIError('服装所属时期不属于该角色。')
                        if validated["name"] != outfit["name"]:
                            outfit["aliases"] = sorted(set(outfit.get("aliases", []) + [outfit["name"]]))
                        images = {key: image_url(payload[key]) for key in ("card", "hands", "combined") if key in payload}
                        costume_changed = any(key in payload and validated[key] != outfit.get(key, "") for key in ("description", "reference", "appearanceProfileId"))
                        actions_changed = "gestures" in payload and validated["gestures"] != outfit.get("gestures", [])
                        card_changed = "card" in images and images["card"] != outfit.get("card", "")
                        hands_changed = "hands" in images and images["hands"] != outfit.get("hands", "")
                        if costume_changed:
                            outfit.update(card="", hands="", combined="", specials=[])
                        if actions_changed or card_changed:
                            outfit.update(hands="", combined="")
                        if hands_changed:
                            outfit["combined"] = ""
                        for key in fields:
                            if key in payload:
                                outfit[key] = validated[key]
                        outfit.update(images)
                        result = outfit
                    else:
                        raise APIError("未找到这个操作。", 404)
                else:
                    raise APIError("未找到这个操作。", 404)
                project["updatedAt"] = now()
            elif parts == ["api", "library"] and method == "POST":
                result = library_record(payload)
                self.state["library"].append(result)
            elif len(parts) == 3 and parts[:2] == ["api", "library"] and method == "PATCH":
                item = self.find(self.state["library"], parts[2], "服装素材")
                if item.get("kind") != "clothing":
                    raise APIError("这个编辑入口用于服装素材的分类和标签。")
                fields = {"name", "description", "style", "image", "era", "gender", "ageGroup", "tags"}
                validated = library_record({**item, **{key: value for key, value in payload.items() if key in fields}})
                for field in fields:
                    if field in payload:
                        item[field] = validated[field]
                item["updatedAt"] = now()
                result = item
            elif len(parts) == 4 and parts[:2] == ["api", "library"] and parts[3] == "wear" and method == "POST":
                clothing = self.find(self.state["library"], parts[2], "服装素材")
                if clothing.get("kind") != "clothing":
                    raise APIError("换装需要选择纯服装素材。")
                project = self.project(payload.get("projectId"))
                self.editable(project["id"])
                char = self.character(project, payload.get("characterId"))
                if clothing.get("style") != project.get("style"):
                    raise APIError("服装画风与项目不一致，请选择相同画风的衣服。")
                image = image_url(clothing.get("image", ""))
                if not image or not self.file_path(image).is_file():
                    raise APIError("这套服装的图片文件不存在，请重新上传或生成。", 404)
                if self.file_path(image).suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                    raise APIError("服装素材需要使用图片文件。")
                outfit = outfit_record({"name": payload.get("name") or clothing["name"], "description": clothing.get("description", ""),
                                        "episodes": payload.get("episodes", []), "reference": image,
                                        "libraryClothingId": clothing["id"], "clothingId": clothing["id"], "clothingImage": image})
                char["outfits"].append(outfit)
                project["updatedAt"] = now()
                result = {"projectId": project["id"], "characterId": char["id"], "outfit": outfit}
            elif len(parts) == 4 and parts[:2] == ["api", "library"] and parts[3] == "adopt" and method == "POST":
                face = self.find(self.state["library"], parts[2], "脸图")
                if face.get("kind") != "face" or not face.get("image"):
                    raise APIError("请选择一张已生成的群像脸图。")
                project = self.project(payload.get("projectId"))
                self.editable(project["id"])
                if face.get("style") != project.get("style"):
                    raise APIError("脸图画风与项目不一致，请选择相同画风的素材。")
                body = self.find(self.state["library"], payload["bodyId"], "身体模板") if payload.get("bodyId") else None
                if body and (body.get("kind") != "body" or body.get("style") != project.get("style") or not body.get("image")):
                    raise APIError("请选择同画风、已生成的身体模板。")
                result = character_record({"name": payload.get("name") or face["name"], "category": "群像", "description": face.get("description", ""),
                                           "face": face["image"], "base": body["image"] if body else ""})
                result.update(faceApproved=False, baseApproved=bool(body), libraryFaceId=face["id"], libraryBodyId=body["id"] if body else "")
                project["characters"].append(result)
                project["updatedAt"] = now()
            else:
                raise APIError("未找到这个操作。", 404)
            self.save()
            return copy.deepcopy(result)

    def export(self, pid, output=None):
        with self.lock:
            catalog=self.state["library"]+[copy.deepcopy(r["item"]) for r in self.state.get("materialRecycleBin",[]) if isinstance(r.get("item"),dict)]
            library_export = pid in {"library", "clothing", "face_core", "hairstyle"}
            if library_export:
                items = self.state["library"] if pid == "library" else [item for item in self.state["library"] if item.get("kind") == pid]
                content = {"library": copy.deepcopy(items)}
                archive_name = "素材库" if pid == "library" else {"clothing":"服装素材库","face_core":"五官脸库","hairstyle":"发型库"}[pid]
            else:
                content = copy.deepcopy(self.project(pid))
                archive_name = content["name"]
                from life_stages import ensure_appearance_profiles
                ensure_appearance_profiles(content)
                identity_ids={profile.get(key) for character in content.get('characters',[]) for profile in character.get('appearanceProfiles',[]) for key in ('libraryFaceCoreId',) if profile.get(key)}
                identity_ids.update(profile.get('hairstyle',{}).get('libraryHairstyleId') for character in content.get('characters',[]) for profile in character.get('appearanceProfiles',[]) if profile.get('hairstyle',{}).get('libraryHairstyleId'))
                crowd_ids={char.get('crowdSetId') for char in content.get('characters',[]) if char.get('crowdSetId')}
                content['crowdLibrary']=copy.deepcopy([item for item in catalog if item.get('kind')=='crowd_set' and item['id'] in crowd_ids])
                content['identityLibraries']=copy.deepcopy([item for item in catalog if item.get('id') in identity_ids])
                clothing_ids = {outfit.get(key) for char in content.get("characters", []) for outfit in char.get("outfits", []) for key in ("clothingId", "libraryClothingId") if outfit.get(key)}
                related = [item for item in catalog if item.get("kind") == "clothing" and
                           (item.get("id") in clothing_ids or item.get("sourceProjectId") == pid)]
                content["clothingLibrary"] = copy.deepcopy(related)
                clothing_by_id = {item["id"]: item for item in related}
                for char in content.get("characters", []):
                    for outfit in char.get("outfits", []):
                        item = clothing_by_id.get(outfit.get("clothingId") or outfit.get("libraryClothingId"))
                        if item and item.get("image"):
                            outfit["clothingImage"] = item["image"]
            project_jobs = copy.deepcopy([job for job in self.state["jobs"] if job.get("projectId") == pid]) if not library_export else []
            if not library_export:
                content['mergedProjectArchives']=[copy.deepcopy(entry) for entry in self.state.get('recycleBin',[]) if entry.get('reason')=='merged' and entry.get('mergedInto')==pid]
        template = template_info()
        content["productionTemplate"] = template
        urls = set()
        def collect(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if value.get("kind") == "clothing" and key == "sourceCard":
                        continue
                    collect(item)
            elif isinstance(value, list):
                for item in value:
                    collect(item)
            elif isinstance(value, str) and value.startswith("/files/"):
                urls.add(value)
        if library_export:
            for item in content["library"]:
                collect(item.get("image"))
                if item.get('kind')=='crowd_set':
                    for field in ('fullGroupImage','headSheet','clothingSheet'):collect(item.get(field))
                if item.get('kind')=='character_card':
                    for field in ('card','hands','combined'):collect(item.get(field))
                if item.get("kind") in {"face", "body"}:
                    collect(item.get("sheet"))
        else:
            collect(content)
        history, production_records = [], []
        for job in project_jobs:
            if not ID_RE.fullmatch(str(job.get("id", ""))):
                continue
            nominal = self.data / "generated" / job["id"]
            if nominal.is_symlink():
                continue
            directory = nominal.resolve()
            if not directory.is_relative_to((self.data / "generated").resolve()) or not directory.is_dir():
                continue
            if directory.parent != (self.data / "generated").resolve() or directory.name != job["id"]:
                continue
            for file in sorted(directory.rglob("*")):
                resolved = file.resolve()
                if file.is_symlink() or not resolved.is_relative_to(directory) or not file.is_file() or file.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                    continue
                url = "/files/" + file.relative_to(self.data).as_posix()
                urls.add(url)
                history.append((url, job, file.relative_to(directory).as_posix()))
            for file in sorted(directory.rglob("prompt-*.json")):
                resolved = file.resolve()
                if file.is_symlink() or not resolved.is_relative_to(directory) or not file.is_file():
                    continue
                try:
                    if file.stat().st_size > 16 * 1024 * 1024:
                        continue
                    raw = file.read_bytes()
                    record = json.loads(raw.decode("utf-8-sig"))
                except (OSError, ValueError, UnicodeError):
                    continue
                if not isinstance(record, dict) or not isinstance(record.get("prompt"), str):
                    continue
                record_path = "制作记录/" + job["id"] + "/" + file.relative_to(directory).as_posix()
                production_records.append({"jobId": job["id"], "path": record_path, "file": file})
        labels = {}
        def safe_name(value, default="素材"):
            value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(value)).strip(" .")
            return (value[:100] or default)
        def describe(url, path, **metadata):
            if not isinstance(url, str) or not url.startswith("/files/"):
                return
            try:
                extension = self.file_path(url).suffix
            except APIError:
                extension = ".bin"
            if not re.fullmatch(r"\.[A-Za-z0-9]{1,12}", extension):
                extension = ".bin"
            labels.setdefault(url, []).append({"path": path + extension, **metadata})
        if not library_export:
            for url, job, filename in history:
                job_name = safe_name(job.get("kind", "任务")) + "_" + safe_name(job["id"])
                describe(url, "历史图片/" + job_name + "/" + safe_name(Path(filename).stem), kind="history", jobId=job["id"], status=job.get("status"))
            for index, source in enumerate(content.get("sourceFiles", []), 1):
                filename = safe_name(Path(source.get("name", "来源文件")).stem)
                describe(source.get("url"), f"来源文件/{index:03d}_{filename}", kind="source", name=source.get("name"), sourceId=source.get("id"), archive=source.get("archive"))
            for character in content.get("characters", []):
                role = safe_name(character.get("name", "角色"))
                category = safe_name(character.get("category", "配角"))
                folder = f"角色/{category}/{role}_{safe_name(character.get('id', ''))[-8:]}"
                for field, title in (("face", "01_脸图"), ("base", "02_身体底稿")):
                    describe(character.get(field), folder + "/" + title, role=role, category=category, kind=field)
                describe(character.get("faceCandidateSheet"), folder + "/脸图候选/00_八方案总览", role=role, category=category, kind="face_sheet")
                for index, candidate in enumerate(character.get("faceCandidates", []), 1):
                    title = f"{index:02d}_" + safe_name(candidate.get("label", f"候选{index}"))
                    describe(candidate.get("image"), folder + "/脸图候选/" + title, role=role, category=category, kind="face_candidate",
                             candidateId=candidate.get("id"), selected=candidate.get("id") == character.get("selectedFaceId"))
                references = [character.get("reference")] + character.get("references", [])
                for index, reference in enumerate(dict.fromkeys(url for url in references if url), 1):
                    describe(reference, folder + f"/参考图/{index:02d}_角色参考", role=role, category=category, kind="reference")
                for outfit in character.get("outfits", []):
                    costume = safe_name(outfit.get("name", "服装"))
                    outfit_folder = folder + f"/服装/{costume}_{safe_name(outfit.get('id', ''))[-8:]}"
                    for field, title in (("card", "01_服装角色卡"), ("hands", "02_八格手部动作"), ("combined", "03_合并角色卡"), ("reference", "服装参考")):
                        describe(outfit.get(field), outfit_folder + "/" + title, role=role, category=category, outfit=costume, kind=field)
                    describe(outfit.get("clothingImage"), outfit_folder + "/服装库定稿", role=role, category=category, outfit=costume, kind="clothing")
                    for index, special in enumerate(outfit.get("specials", []), 1):
                        describe(special.get("image"), outfit_folder + f"/特殊动作/{index:02d}_" + safe_name(special.get("name", "特殊动作")), role=role, category=category, outfit=costume, kind="special")
        catalog_items = content["library"] if library_export else content.get("clothingLibrary", [])
        for item in catalog_items:
            if item.get("kind") == "clothing":
                folder = f"服装库/{safe_name(item.get('style', '国漫'))}/{safe_name(item.get('era', '其他'))}/{safe_name(item.get('gender', '通用'))}/{safe_name(item.get('ageGroup', '通用'))}"
                describe(item.get("image"), folder + "/" + safe_name(item.get("name", "服装")) + "_" + safe_name(item.get("id", ""))[-8:], kind="clothing", clothingId=item.get("id"))
            elif library_export and item.get('kind')=='character_card':
                folder='角色卡/'+safe_name(item.get('name','角色卡'))+'_'+safe_name(item['id'])[-8:]
                for field,title in (('card','01_标准角色卡'),('hands','02_八格手部卡'),('combined','03_上下合成图')):describe(item.get(field),folder+'/'+title,kind='character_card',materialId=item['id'])
            elif library_export and item.get('kind')=='crowd_set':
                folder='群像库/五人套组/'+safe_name(item.get('style','国漫'))+'/'+safe_name(item.get('name','群像'))+'_'+safe_name(item['id'])[-8:]
                for field,title in (('fullGroupImage','01_五人全身'),('headSheet','02_五头完整总览'),('clothingSheet','03_纯服装总览')):describe(item.get(field),folder+'/'+title,kind='crowd_set',crowdSetId=item['id'])
            elif library_export:
                folder = f"素材库/{safe_name({'face_core':'五官脸库','hairstyle':'发型库','body':'身体模板'}.get(item.get('kind'),'历史整头'))}/{safe_name(item.get('style','国漫'))}"
                describe(item.get("image"), folder + "/" + safe_name(item.get("name", "素材")) + "_" + safe_name(item.get("id", ""))[-8:], kind=item.get("kind"))
                describe(item.get("preview"),folder+"/白模三视_"+safe_name(item.get("id",""))[-8:],kind="hairstyle_preview")
                describe(item.get("sheet"), folder + "/预览_" + safe_name(item.get("id", ""))[-8:], kind="preview")
        buffer = output if output is not None else io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("project.json" if not library_export else "library.json", json.dumps(content, ensure_ascii=False, indent=2))
            if not library_export:
                from team_bridge import export_team_master
                archive.writestr("团队母版_v2.json", json.dumps(export_team_master(content, self.data), ensure_ascii=False, indent=2))
            archive.writestr("格式模板.json", json.dumps(template, ensure_ascii=False, indent=2))
            archive.writestr("提示词母模板.json", master_template_bytes())
            for record in production_records:
                archive.write(record["file"],record["path"])
            if not library_export:
                archive.writestr("剧本.txt", content.get("script", ""))
            missing, manifest_files, written_labels = [], [], set()
            for url in sorted(urls):
                try:
                    file = self.file_path(url)
                    if file.is_file():
                        original_path = "files/" + file.relative_to(self.data).as_posix()
                        archive.write(file, original_path)
                        descriptions = labels.get(url, [{"path": original_path, "kind": "asset"}])
                        for description in descriptions:
                            label_path = description["path"]
                            if label_path != original_path and label_path not in written_labels:
                                archive.write(file, label_path)
                                written_labels.add(label_path)
                            manifest_files.append({"url": url, "originalPath": original_path, **description})
                    else:
                        missing.append(url)
                except APIError:
                    missing.append(url)
            if missing:
                archive.writestr("缺失文件.txt", "\n".join(missing))
            archive.writestr("manifest.json", json.dumps({"projectId": content.get("id"), "name": archive_name, "exportedAt": now(),
                                                         "script": "剧本.txt" if not library_export else None,
                                                         "files": manifest_files, "missing": missing,
                                                         "productionRecords": [{"jobId": item["jobId"], "path": item["path"]} for item in production_records]}, ensure_ascii=False, indent=2))
            archive.writestr("说明.txt", "角色文件夹按主角、配角、群像和服装版本整理；来源文件保存上传文档与ZIP原件。\nfiles文件夹保留原始路径以便后续恢复；manifest.json记录每张图片及来源的对应关系。\n")
        return (output if output is not None else buffer.getvalue()), archive_name


def is_loopback_host(host):
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


class Handler(BaseHTTPRequestHandler):
    server_version = "ComicWorkbench/1.0"
    protocol_version = "HTTP/1.1"

    @property
    def app(self):
        return self.server.app

    def log_message(self, fmt, *args):
        if not args or str(args[0]).startswith("GET /api/state"):
            return
        print(fmt % args, file=sys.stderr)

    def local_request(self):
        if not is_loopback_host(self.client_address[0]):
            raise APIError("工作台只允许本机访问。", 403)
        host = self.headers.get("Host", "")
        try:
            parsed = urlsplit("http://" + host)
            valid = parsed.hostname and is_loopback_host(parsed.hostname) and parsed.port == self.server.server_port and not parsed.username and not parsed.path
        except ValueError:
            valid = False
        if not valid:
            raise APIError("访问地址不正确，请使用本地工作台网址。", 403)
        origin = self.headers.get("Origin")
        if origin:
            try:
                parsed = urlsplit(origin)
                valid = parsed.scheme == "http" and parsed.hostname and is_loopback_host(parsed.hostname) and parsed.port == self.server.server_port and not parsed.username
            except ValueError:
                valid = False
            if not valid:
                raise APIError("请在工作台页面中执行这个操作。", 403)

    def send_bytes(self, data, mime="application/json; charset=utf-8", status=200, headers=None):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Connection", "close")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.close_connection = True
        if self.command != "HEAD":
            self.wfile.write(data)

    def json(self, obj, status=200):
        self.send_bytes(json.dumps(obj, ensure_ascii=False).encode("utf-8"), status=status)

    def read_json(self):
        if self.headers.get("Transfer-Encoding"):
            raise APIError("不支持这个上传方式。", 400)
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            raise APIError("请使用 JSON 格式提交。", 415)
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise APIError("请求长度不正确。")
        if size <= 0 or size > MAX_BODY:
            raise APIError("请求内容过大或为空。", 413)
        try:
            obj = json.loads(self.rfile.read(size).decode("utf-8"))
        except (ValueError, UnicodeError):
            raise APIError("请求内容无法读取。")
        if not isinstance(obj, dict):
            raise APIError("请求内容需要是对象。")
        return obj

    def send_file(self,path,mime,headers=None,cache=False):
        path=Path(path);stat=path.stat();etag='"'+str(stat.st_mtime_ns)+'-'+str(stat.st_size)+'"'
        status=304 if cache and self.headers.get('If-None-Match')==etag else 200
        self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length','0' if status==304 else str(stat.st_size));self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','same-origin');self.send_header('Cache-Control','private, no-cache' if cache else 'no-store');self.send_header('Connection','close')
        if cache:self.send_header('ETag',etag)
        for k,v in (headers or {}).items():self.send_header(k,v)
        self.end_headers();self.close_connection=True
        if self.command!='HEAD' and status!=304:
            with path.open('rb') as stream:
                while True:
                    block=stream.read(1024*1024)
                    if not block:break
                    self.wfile.write(block)

    def dispatch(self):
        try:
            self.local_request()
            path = urlsplit(self.path).path
            if self.command in {"POST", "PATCH"}:
                payload = self.read_json()
                if self.command == "POST" and path == "/api/shutdown":
                    self.json({"ok": True, "message": "工作台已停止。"})
                    def shutdown():
                        self.app.close()
                        self.server.shutdown()
                    threading.Thread(target=shutdown, name="local-shutdown", daemon=True).start()
                else:
                    self.json(self.app.mutate(self.command, path, payload))
                return
            if self.command not in {"GET", "HEAD"}:
                raise APIError("不支持这个操作。", 405)
            if path == '/api/state':
                from resource_control import state_etag
                etag=state_etag(self.app)
                if self.headers.get('If-None-Match')==etag:self.send_bytes(b'',status=304,headers={'ETag':etag})
                else:self.send_bytes(json.dumps(self.app.snapshot(),ensure_ascii=False).encode('utf-8'),headers={'ETag':etag})
            elif path=='/api/resources':
                from resource_control import overview
                self.json(overview(self.app))
            elif path=='/api/workbench/state':
                from resource_control import compact_state
                self.json(compact_state(self.app))
            elif path=='/api/thumbnail':
                from urllib.parse import parse_qs
                from resource_control import thumbnail
                query=parse_qs(urlsplit(self.path).query)
                try:size=int(query.get('size',['512'])[0])
                except ValueError:raise APIError('预览尺寸无效。')
                self.send_file(thumbnail(self.app,query.get('url',[''])[0],size),'image/webp',cache=True)
            elif path.startswith('/api/projects/') and len(path.strip('/').split('/'))==3:
                with self.app.lock:self.json(copy.deepcopy(self.app.project(path.strip('/').split('/')[2])))
            elif path.startswith('/api/library/') and path.endswith('/delete-preview'):
                from material_library import preview
                pieces=path.strip('/').split('/')
                if len(pieces)!=4:raise APIError('未找到这个操作。',404)
                with self.app.lock:self.json(preview(self.app,pieces[2]))
            elif path.startswith('/api/tool-results/') and path.endswith('/export'):
                from standalone_tools import export_result
                pieces=path.strip('/').split('/')
                if len(pieces)!=4:raise APIError('未找到这个操作。',404)
                from resource_control import export_temp
                temp=export_temp(self.app)
                try:
                    with self.app.lock:export_result(self.app,pieces[2],output=temp)
                    self.send_file(temp,'application/zip',headers={'Content-Disposition':'attachment; filename=character-tool-result.zip'})
                finally:temp.unlink(missing_ok=True)
            elif path == "/api/template":
                self.json(template_info())
            elif path == "/api/refinement-options":
                from refinement_api import refinement_options
                self.json(refinement_options())
            elif path == "/api/script-formats":
                from script_import import supported_extensions
                self.json({"extensions": supported_extensions()})
            elif path == "/api/health":
                with self.app.lock:
                    busy = any(job.get("status") in {"queued", "running"} for job in self.app.state.get("jobs", []))
                self.json({"ok": True, "app": "comic-character-workbench", "version": "1.18.0", "busy": busy})
            elif path.startswith("/api/team-master/"):
                from team_bridge import export_team_master
                with self.app.lock:
                    master = export_team_master(self.app.project(path.rsplit("/", 1)[-1]), self.app.data)
                self.send_bytes(json.dumps(master, ensure_ascii=False, indent=2).encode("utf-8"), headers={"Content-Disposition": "attachment; filename=team-master-v2.json"})
            elif path == "/api/runtime":
                self.json(self.app.probe(force='cached=1' not in self.path))
            elif path.startswith("/api/export/"):
                from urllib.parse import quote
                from resource_control import export_temp
                temp=export_temp(self.app)
                try:
                    _,name=self.app.export(unquote(path[len('/api/export/'):]),output=temp)
                    self.send_file(temp,'application/zip',headers={'Content-Disposition':"attachment; filename*=UTF-8''"+quote(name+'.zip')})
                finally:temp.unlink(missing_ok=True)
            elif path.startswith("/files/"):
                file = self.app.file_path(path)
                if not file.is_file():
                    raise APIError("图片尚未生成或文件已移动。", 404)
                # Generated files may include downloadable JSON, but never execute active HTML/SVG.
                mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
                if mime in {"text/html", "image/svg+xml", "application/javascript", "text/javascript"}:
                    mime = "application/octet-stream"
                self.send_file(file,mime)
            elif path.startswith("/api/"):
                raise APIError("未找到这个操作。", 404)
            else:
                relative = unquote(path).lstrip("/") or "index.html"
                public = (self.app.root / "public").resolve()
                file = (public / relative).resolve()
                if not file.is_relative_to(public) or not file.is_file():
                    raise APIError("未找到页面。", 404)
                mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
                if mime.startswith("text/") or mime == "application/javascript":
                    mime += "; charset=utf-8"
                self.send_file(file,mime)
        except APIError as exc:
            self.json({"error": str(exc)}, exc.status)
            if self.command not in {"GET", "HEAD"}:
                self.close_connection = True
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as exc:
            print("Request failed:", type(exc).__name__, str(exc), file=sys.stderr)
            self.json({"error": "操作未完成，请查看工作台运行窗口。"}, 500)

    do_GET = dispatch
    do_HEAD = dispatch
    do_POST = dispatch
    do_PATCH = dispatch
    do_OPTIONS = dispatch
    do_DELETE = dispatch


class ServiceAlreadyRunning(OSError):
    pass


class PortLease:
    """Windows per-port mutex: single queue owner without TCP TIME_WAIT delays."""
    registry_lock = threading.Lock()
    held_ports = set()

    def __init__(self, port):
        self.port = port
        self.handle = None
        self.kernel = None
        if os.name != "nt":
            return
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
        kernel.CreateMutexW.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.ReleaseMutex.argtypes = [wintypes.HANDLE]
        kernel.ReleaseMutex.restype = wintypes.BOOL
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        with self.registry_lock:
            if port in self.held_ports:
                raise ServiceAlreadyRunning("这个端口上的角色工作台已经启动。")
            handle = kernel.CreateMutexW(None, False, f"Local\\CodexComicCharacterWorkbenchPort_{port}")
            if not handle:
                raise OSError("无法建立本地工作台启动锁。")
            outcome = kernel.WaitForSingleObject(handle, 0)
            if outcome not in (0, 0x80):  # acquired or previous owner crashed
                kernel.CloseHandle(handle)
                raise ServiceAlreadyRunning("这个端口上的角色工作台已经启动。")
            self.held_ports.add(port)
            self.handle, self.kernel = handle, kernel

    def release(self):
        if self.handle is None:
            return
        with self.registry_lock:
            self.kernel.ReleaseMutex(self.handle)
            self.kernel.CloseHandle(self.handle)
            self.held_ports.discard(self.port)
            self.handle = None


class LocalHTTPServer(ThreadingHTTPServer):
    # A mutex prevents duplicate Windows services. Reusable sockets let a
    # stopped service restart even while completed HTTP connections TIME_WAIT.
    allow_reuse_address = True

    def __init__(self, address, handler):
        self._port_lease = None
        try:
            if os.name == "nt" and address[1]:
                self._port_lease = PortLease(address[1])
                try:
                    with socket.create_connection(address, timeout=0.3):
                        pass
                except (OSError, TimeoutError):
                    pass
                else:
                    raise ServiceAlreadyRunning("端口已被其他本地程序使用，请更换工作台端口。")
            super().__init__(address, handler)
            if os.name == "nt" and not address[1]:
                self._port_lease = PortLease(self.server_port)
        except Exception:
            if self._port_lease:
                self._port_lease.release()
            raise

    def server_close(self):
        try:
            super().server_close()
        finally:
            if self._port_lease:
                self._port_lease.release()


def make_server(app, port=4326):
    server = LocalHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.app = app
    return server


def main():
    port = integer(os.environ.get("CHARACTER_WORKBENCH_PORT", "4326"), "端口", 1024, 65535)
    # Acquire the service lock and listening socket before recovering state.
    # A short retry also covers the first transition from older exclusive
    # Windows sockets; no queue or data file is opened while waiting.
    bind_deadline = time.monotonic() + 15
    waiting_message = False
    while True:
        try:
            server = make_server(None, port)
            break
        except ServiceAlreadyRunning as exc:
            print(f"无法启动本地工作台：{exc}", file=sys.stderr)
            return 1
        except OSError as exc:
            if os.name != "nt" or getattr(exc, "winerror", None) != 10048 or time.monotonic() >= bind_deadline:
                print(f"无法启动本地工作台：{exc}", file=sys.stderr)
                return 1
            if not waiting_message:
                print("正在等待上一次工作台连接释放，请稍候……", flush=True)
                waiting_message = True
            time.sleep(0.5)
    try:
        app = Workbench()
    except Exception as exc:
        server.server_close()
        print(f"无法读取工作台数据：{exc}", file=sys.stderr)
        return 1
    server.app = app
    print(f"漫画角色工作台已启动：http://127.0.0.1:{port}", flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        app.close()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
