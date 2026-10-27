"""Versioned production rules shared by the worker, browser and exports."""
import copy
from functools import lru_cache
import hashlib
import json
from pathlib import Path

TEMPLATE_FILE = Path(__file__).resolve().parent / 'prompts' / 'standard-v1.json'


@lru_cache(maxsize=1)
def _template():
    value = json.loads(TEMPLATE_FILE.read_text(encoding='utf-8-sig'))
    if (value.get('canvas') != {'width': 1920, 'height': 1080}
            or value.get('columns') != [40, 20, 20, 20]
            or value.get('hands') != {'rows': 2, 'cols': 4}
            or value.get('combined') != {'width': 1920, 'height': 2160}):
        raise ValueError('标准角色卡模板的尺寸或排版配置无效')
    if value.get('faceCandidates') != {'count': 3, 'rows': 1, 'cols': 3, 'completeHair': True}:
        raise ValueError('选脸模板必须为一排3个完整发型候选')
    if not value.get('headFraming', {}).get('completeHair') or value.get('headFraming', {}).get('cropHair') is not False:
        raise ValueError('头部定稿模板必须完整露出头发，不允许裁切')
    for key in ('common', 'card', 'face_candidates', 'neutral_base', 'hands_grid', 'hands_match', 'special', 'clothing', 'face_core', 'hairstyle', 'same_face_head'):
        if not isinstance(value.get('prompts', {}).get(key), str) or not value['prompts'][key].strip():
            raise ValueError('标准提示词模板缺少：' + key)
    return value


def public_template():
    return copy.deepcopy({k: v for k, v in _template().items() if k != 'prompts'})


def master_template():
    return copy.deepcopy(_template())


def prompt_text(kind):
    return _template()['prompts'][kind]


def image_prefix(style):
    return prompt_text('common').format(style=style)


def template_fingerprint():
    return hashlib.sha256(json.dumps(_template(), ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()


def landscape_size():
    value = _template()['canvas']
    return value['width'], value['height']
