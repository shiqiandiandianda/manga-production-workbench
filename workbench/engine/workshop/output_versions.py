"""Exact provenance of the identity/card inputs used for an independent output."""
from __future__ import annotations
import hashlib
import json
import copy


def _asset(worker,url):
    if not url:return {'url':'','sha256':''}
    path=worker.asset_path(url)
    if not path.is_file():raise ValueError('输出依赖的身份或服装原图已丢失，请重新选择')
    return {'url':url,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}


def identity_source_version(worker,project,char,include_core_context=False):
    profile_id=char.get('appearanceProfileId') or char.get('activeAppearanceProfileId') or char.get('defaultAppearanceProfileId','')
    profile=char.get('appearanceProfile') or char
    owner=next((c for c in project.get('characters',[]) if c.get('id')==char.get('id')),None)
    core_url=char.get('faceCore')
    if owner and profile_id:
        from appearance_identity import get_face_core
        core_url=get_face_core(project,owner,profile_id).get('image') or core_url
    version={'projectId':project.get('id',''),'characterId':char.get('id',''),'appearanceProfileId':profile_id,
        'faceIdentityGroupId':char.get('faceIdentityGroupId',''),'projectStyle':worker.style_of(project),
        'head':_asset(worker,char.get('face')),'body':_asset(worker,char.get('base')),
        'headContractVersion':char.get('headContractVersion',''),
        'identityReviewPending':bool(char.get('identityReviewPending')),
        'headPreparationPending':bool(char.get('headPreparationPending')),
        'headIdentityReviewPending':bool(char.get('headIdentityReviewPending')),
        'period':profile.get('period',''),'ageStage':profile.get('ageStage',''),
        'ageText':profile.get('ageText','')}
    if include_core_context:
        version['canonicalCore']=_asset(worker,core_url)
        version['faceCoreReviewPending']=bool(char.get('faceCoreReviewPending'))
    version['hash']=hashlib.sha256(json.dumps(version,sort_keys=True,ensure_ascii=False).encode('utf-8')).hexdigest()
    return version


def output_source_version(worker,project,char,outfit,include_card=False,include_hands=False):
    version=identity_source_version(worker,project,char)
    version['outfitId']=outfit.get('id','')
    version['outfitReference']=_asset(worker,outfit.get('reference'))
    version['outfitDescriptionHash']=hashlib.sha256(json.dumps({
        'description':outfit.get('description',''),'sourceDescription':outfit.get('sourceDescription') or outfit.get('scriptDescription',''),
        'sourceHistory':outfit.get('sourceDescriptionHistory',[]),'appearanceProfileId':outfit.get('appearanceProfileId','')
    },sort_keys=True,ensure_ascii=False).encode('utf-8')).hexdigest()
    if include_card:version['card']=_asset(worker,outfit.get('card'))
    if include_hands:version['hands']=_asset(worker,outfit.get('hands'))
    version['identityHash']=version['hash']
    version.pop('hash')
    version['hash']=hashlib.sha256(json.dumps(version,sort_keys=True,ensure_ascii=False).encode('utf-8')).hexdigest()
    return version


def validate_source_version(worker,project,version,outfit=None):
    from life_stages import get_profile,profile_character
    if not isinstance(version,dict) or version.get('projectId')!=project.get('id'):
        raise ValueError('图片输出没有对应的项目身份来源，未写入定稿')
    owner=next((c for c in project.get('characters',[]) if c.get('id')==version.get('characterId')),None)
    profile=get_profile(owner,version.get('appearanceProfileId')) if owner else None
    if not profile:raise ValueError('图片来源所属人物或时期已变化，旧结果仅保留文件，未写入新身份')
    char=profile_character(owner,profile['id'])
    if version.get('outfitId'):
        current_outfit=next((o for o in owner.get('outfits',[]) if o.get('id')==version['outfitId']),None)
        if not current_outfit or current_outfit.get('appearanceProfileId')!=profile['id']:
            raise ValueError('图片输出对应的服装版本已变化，旧图未写入其他人物或时期')
        # The caller may provide its working outfit when checking just before
        # saving hands after a newly generated card in the same task.
        if outfit is not None:current_outfit=outfit
        current=output_source_version(worker,project,char,current_outfit,'card' in version,'hands' in version)
    else:current=identity_source_version(worker,project,char,'canonicalCore' in version)
    if current.get('hash')!=version.get('hash'):
        raise ValueError('图片使用的脸、身体或服装原图版本已变化，旧结果仅保留文件，请按最新定稿重作')
    return True


def assert_working_source(worker,project,char,outfit,version):
    current=output_source_version(worker,project,char,outfit,'card' in version,'hands' in version)
    if current['hash']!=version['hash']:
        raise ValueError('生图途中身份或服装参考改变，未把旧来源图片写入当前定稿')
    return True

def validate_output_delta(worker,baseline,updated,merged):
    """Verify only newly produced/replaced outputs against current merged inputs.

    Unchanged historical images stay registered even if their identity now has
    a pending revision. A source receipt alone never proves visual acceptance.
    """
    old_chars={c.get('id'):c for c in (baseline or {}).get('characters',[])}
    for char in (updated or {}).get('characters',[]):
        previous=old_chars.get(char.get('id'),{})
        old_outfits={o.get('id'):o for o in previous.get('outfits',[])}
        for outfit in char.get('outfits',[]):
            before=old_outfits.get(outfit.get('id'),{})
            def check(version):
                if version.get('characterId')!=char.get('id') or version.get('outfitId')!=outfit.get('id') or \
                    version.get('appearanceProfileId')!=outfit.get('appearanceProfileId'):
                    raise ValueError('图片来源不属于接收它的人物、时期或服装，未跨角色写入')
                validate_source_version(worker,merged,version)
            for field,receipt in (('card','cardSourceVersion'),('hands','handsSourceVersion'),('combined','combinedSourceVersion')):
                version=outfit.get(receipt)
                if outfit.get(field) and isinstance(version,dict) and (
                    outfit.get(field)!=before.get(field) or version!=before.get(receipt)):
                    check(version)
            old_specials={item.get('id'):item for item in before.get('specials',[])}
            for item in outfit.get('specials',[]):
                version=item.get('sourceVersion');old=old_specials.get(item.get('id'),{})
                if item.get('image') and isinstance(version,dict) and (
                    item.get('image')!=old.get('image') or version!=old.get('sourceVersion')):check(version)
    return True
