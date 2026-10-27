"""Separate visual identities by period and age while sharing one character."""
from __future__ import annotations
import copy
import re
from uuid import uuid4

PERIODS = ('current_life', 'previous_life', 'unspecified')
AGE_STAGES = ('infant', 'child', 'teen', 'young_adult', 'adult', 'middle_aged', 'elderly', 'unspecified')
AGE_LABELS = {'infant':'婴幼儿','child':'儿童/幼年','teen':'少年','young_adult':'青年',
              'adult':'成年','middle_aged':'中年','elderly':'老年','unspecified':'年龄未说明'}
VISUAL_FIELDS = ('face','faceCandidates','faceCandidateSheet','faceApproved','faceStyle','selectedFaceId',
                 'faceSelectionMode','faceSelectionReason','base','baseStyle','baseApproved','reference','references',
                 'identitySource','inputPrepared','inputImageKey','inputDescription','libraryFaceId',
                 'libraryBodyId','faceCandidateCount','headContractVersion','headReviewStatus','legacyHeadReviewPending','identityReviewPending','familyReference','identityContinuity','identityHistory','faceCore','faceCoreApproved','faceCoreStyle','libraryFaceCoreId','faceCoreReviewPending','headIdentityReviewPending','headPreparationPending','hairReviewPending','faceCoreHistory','faceDiversityReview','faceDiversityReviewPending','faceDiversityReviewStatus','faceCandidatesPending')
TEXT_FIELDS = ('name','period','ageStage','ageText','description','sourceDescription','basis','evidence','identityContinuity','identityContinuityBasis','faceIdentityGroupId','faceContinuity','hairstyle')

def profile_record(data, previous=None):
    if not isinstance(data, dict):
        raise ValueError('时期资料必须是对象')
    result = copy.deepcopy(previous or {})
    for key in TEXT_FIELDS + VISUAL_FIELDS:
        if key in data:
            result[key] = copy.deepcopy(data[key])
    result.setdefault('id', str(data.get('id') or uuid4().hex))
    result.setdefault('name', '新时期')
    result.setdefault('period', 'unspecified')
    result.setdefault('ageStage', 'unspecified')
    result.setdefault('ageText', '')
    result.setdefault('description', '')
    result.setdefault('basis', 'production_design')
    result.setdefault('evidence', [])
    result.setdefault('faceApproved', False)
    result.setdefault('faceCandidates', [])
    result.setdefault('references', [])
    result.setdefault('identitySource', 'design')
    result.setdefault('identityContinuity', 'unspecified')
    if 'identityContinuity' in data and 'identityContinuityBasis' not in data and (
            previous is None or data['identityContinuity'] != previous.get('identityContinuity')):
        result['identityContinuityBasis']='production_design'
    if result['identityContinuity'] not in ('same_body','different_body','unspecified'):
        raise ValueError('时期身体关联无效')
    if previous and any(result.get(k) != previous.get(k) for k in ('period','ageStage')) and any(previous.get(k) for k in ('face','base')):
        result['identityReviewPending'] = True
        if result.get('ageStage') != previous.get('ageStage') and previous.get('faceCore'):
            result['faceCoreReviewPending'] = True
            result.setdefault('faceCoreHistory',[]).append({'image':previous['faceCore'],'ageStage':previous.get('ageStage'),'reason':'年龄阶段改变，保留旧五官素材作年龄参照'})
            result['faceGroupHistory']=list(dict.fromkeys([*result.get('faceGroupHistory',[]),previous.get('faceIdentityGroupId','')]))
            result['faceIdentityGroupId']=''
            relation=copy.deepcopy(result.get('faceContinuity') or {})
            relation.update(status='age_related',basis='production_design')
            result['faceContinuity']=relation
    if result['period'] not in PERIODS or result['ageStage'] not in AGE_STAGES:
        raise ValueError('时期或年龄阶段无效')
    if result['basis'] not in ('source','inference','production_design','authorized_adaptation'):
        raise ValueError('时期依据无效')
    for key in ('name','ageText','description','sourceDescription'):
        if key in result and not isinstance(result[key], str):
            raise ValueError('时期文字字段必须是文本')
    if not isinstance(result.get('evidence'), list) or not isinstance(result.get('references'), list):
        raise ValueError('时期依据和参考图必须是列表')
    from appearance_identity import normalize_profile_visual
    normalize_profile_visual(result)
    if result.get('identityContinuityBasis','inference') not in ('source','inference','production_design','authorized_adaptation'):
        raise ValueError('身体关联依据无效')
    return result

def get_profile(char, profile_id=None):
    selected = profile_id or char.get('activeAppearanceProfileId') or char.get('defaultAppearanceProfileId')
    return next((p for p in char.get('appearanceProfiles', []) if p.get('id') == selected), None)

def _chinese_number(text):
    if text.isdigit(): return int(text)
    digits = {c:i for i,c in enumerate('零一二三四五六七八九')}
    digits.update({'〇':0,'两':2})
    if '百' in text:
        left,right = text.split('百',1)
        return digits.get(left,1)*100 + (_chinese_number(right.lstrip('零')) if right.lstrip('零') else 0)
    if '十' in text:
        left,right = text.split('十',1)
        return (digits.get(left,1) if left else 1)*10 + (digits.get(right,0) if right else 0)
    if len(text)==1: return digits.get(text)
    return None

def _stage_hint(text):
    if not text: return 'unspecified','unspecified',''
    period = 'previous_life' if re.search(r'前世|穿越前|重生前|上一世',text) else 'unspecified'
    stage,age_text = 'unspecified',''
    age = re.search(r'(\d{1,3}|[零〇一二两三四五六七八九十百]{1,5})岁|年龄[：:]\s*(\d{1,3}|[零〇一二两三四五六七八九十百]{1,5})',text)
    if age:
        years = _chinese_number(age.group(1) or age.group(2))
        age_text = (age.group(1) or age.group(2)) + '岁'
        if years is not None and 0 <= years <= 120:
            stage = 'infant' if years<=2 else 'child' if years<=12 else 'teen' if years<=17 else 'young_adult' if years<=35 else 'middle_aged' if years<=59 else 'elderly'
    if stage=='unspecified':
        if re.search(r'婴儿|婴幼儿',text): stage='infant'
        elif re.search(r'幼年|童年|儿童|孩童|三四岁',text): stage='child'
        elif re.search(r'少年时期|少年阶段',text): stage='teen'
        elif re.search(r'青年时期|青年阶段',text): stage='young_adult'
        elif re.search(r'中年时期|中年阶段',text): stage='middle_aged'
        elif re.search(r'老年时期|老年阶段',text): stage='elderly'
    return period,stage,age_text

def source_age_evidence(project):
    """Bind source age to a named panel/subject; descriptions are not evidence."""
    found = {}
    chars = project.get('characters',[])
    names = {c.get('name'):c for c in chars if c.get('name') and len(c['name'])>=2}
    for chapter in sorted(project.get('chapters',[]),key=lambda c:c.get('chapter',0)):
        paragraphs=chapter.get('paragraphs',[])
        for index,row in enumerate(paragraphs):
            text=row.get('text','')
            _,stage,age=_stage_hint(text)
            if not age or stage=='unspecified': continue
            # Multiple speaker ages cannot be attributed from a single quotation.
            if len(re.findall(r'(?:\d{1,3}|[零〇一二两三四五六七八九十百]{1,5})岁',text))>1: continue
            subject=None;subject_row=None;subject_basis='source'
            direct=[name for name in names if re.search(re.escape(name)+r'[^，。！？“”]{0,10}(?:现年|年仅|今年|年龄[：:]|已|才)?(?:\d{1,3}|[零〇一二两三四五六七八九十百]{1,5})岁',text)
                    and not re.search(r'[你她他](?:今年|已|才)?(?:\d{1,3}|[零〇一二两三四五六七八九十百]{1,5})岁',text)]
            if len(direct)==1: subject=direct[0];subject_row=row
            elif re.search(r'年龄[：:]',text):
                for earlier in reversed(paragraphs[max(0,index-2):index]):
                    panel=re.search(r'姓名[：:]\s*([^。\s”]+)',earlier.get('text',''))
                    if panel:
                        if panel.group(1) in names: subject=panel.group(1);subject_row=earlier
                        break
            elif re.search(r'她[^。]{0,10}(?:\d{1,3}|[零〇一二两三四五六七八九十百]{1,5})岁',text):
                for earlier in reversed(paragraphs[max(0,index-2):index]):
                    matched=[name for name in names if name in earlier.get('text','')]
                    if matched:
                        # Narrow narrative antecedent; never infer from a mixed-name sentence.
                        if len(matched)==1: subject=matched[0];subject_row=earlier;subject_basis='inference'
                        break
            if not subject: continue
            # Childhood memories never refine the default current adult profile.
            context=' '.join(x.get('text','') for x in paragraphs[max(0,index-2):index+1])
            period,_,_=_stage_hint(context)
            if period=='previous_life' or stage in ('infant','child','teen'): continue
            evidence=[{'chapter':chapter.get('chapter'),'paragraphId':row.get('id'),'quote':text[:160],'verified':True}]
            if subject_row is not row:
                evidence.insert(0,{'chapter':chapter.get('chapter'),'paragraphId':subject_row.get('id'),'quote':subject_row.get('text','')[:160],'verified':True})
            found.setdefault(names[subject]['id'],{'ageStage':stage,'ageText':age,'basis':'source',
                'subjectBasis':subject_basis,'evidence':evidence,'sourceId':chapter.get('sourceId',''),
                'sourceHash':chapter.get('sourceHash',''),'member':chapter.get('member','')})
    return found


def _profile_key(profile):
    return (profile.get('period','unspecified'), profile.get('ageStage','unspecified'))

def _new_profile(char, period, age_stage, age_text='', basis='inference', evidence=None):
    label = ('前世' if period == 'previous_life' else '当世') + ' · ' + AGE_LABELS[age_stage]
    profile = profile_record({'name':label, 'period':period, 'ageStage':age_stage,
                              'ageText':age_text, 'basis':basis, 'evidence':evidence or []})
    profile['identityEntityId'] = char.get('identityEntityId','')
    profile['identityContinuity'] = 'unspecified' if period == 'previous_life' else 'same_body'
    profile['identityContinuityBasis'] = 'inference'
    if period == 'current_life' and char.get('face'):
        profile['familyReference'] = char['face']
    char.setdefault('appearanceProfiles', []).append(profile)
    return profile

def ensure_appearance_profiles(project):
    """Migrate legacy visual fields without assigning an adult face to childhood."""
    ages = source_age_evidence(project)
    for char in project.get('characters', []):
        profiles = char.setdefault('appearanceProfiles', [])
        default = next((p for p in profiles if p.get('id') == char.get('defaultAppearanceProfileId')), None)
        if default is None:
            default = profile_record({'name':'当前定稿时期','period':'current_life','ageStage':'unspecified'})
            default.update({k:copy.deepcopy(char[k]) for k in VISUAL_FIELDS if k in char})
            default['teamAssetId'] = char.get('teamAssetId','')
            default['teamStateId'] = char.get('teamStateId','')
            profiles.insert(0, default)
            char['defaultAppearanceProfileId'] = default['id']
        default['identityEntityId'] = char.get('identityEntityId','')
        checked_age = ages.get(char.get('id'))
        if checked_age and default.get('ageStage') == 'unspecified':
            default.update(copy.deepcopy(checked_age))
            default['period'] = 'current_life'
            default['name'] = '当世 · ' + AGE_LABELS[checked_age['ageStage']]
        # Source-confirmed age enrichment does not invalidate an existing identity.

        # Legacy ordinary edits remain mirrored to the default, never another period.
        for key in VISUAL_FIELDS:
            if key in char:
                default[key] = copy.deepcopy(char[key])
        if default.get('face') and not default.get('headContractVersion'):
            default['legacyHeadReviewPending'] = True
            char['legacyHeadReviewPending'] = True
        if not any(p.get('id') == char.get('activeAppearanceProfileId') for p in profiles):
            char['activeAppearanceProfileId'] = default['id']
        for outfit in char.get('outfits', []):
            if not get_profile(char, outfit.get('appearanceProfileId')) or not outfit.get('appearanceProfileId'):
                text = ' '.join(str(outfit.get(k) or '') for k in ('name','description','sourceDescription'))
                period, age_stage, age_text = _stage_hint(text)
                if period == 'unspecified': period = 'current_life'
                if age_stage != 'unspecified' or period == 'previous_life':
                    profile = next((p for p in profiles if _profile_key(p) == (period,age_stage)), None)
                    if profile is None: profile = _new_profile(char,period,age_stage,age_text)
                else:
                    profile = default
                outfit['appearanceProfileId'] = profile['id']
            if outfit.get('card') and not outfit.get('headContractVersion'):
                outfit['legacyHeadReviewPending'] = True
                outfit['semanticReviewPending'] = True
            profile = get_profile(char,outfit['appearanceProfileId'])
            if (profile and profile['id'] != default['id'] and any(outfit.get(k) for k in ('card','hands','combined'))
                    and outfit.get('cardAppearanceProfileId') != profile['id']):
                outfit.setdefault('appearanceProfileReviewPending', True)
                outfit['semanticReviewPending'] = True
                outfit.setdefault('appearanceProfileReason','旧图是否符合这个时期的脸、发型与身体尚未核验，原文件保留。')
    return project

def bind_source_profiles(project):
    """Use explicit source period/age or conservative legacy hints."""
    ensure_appearance_profiles(project)
    characters = {c.get('id'):c for c in project.get('characters', [])}
    profile_types = {}
    outfit_types = {}
    outfit_chapters = {}
    for chapter in project.get('chapterAnalysis', {}).get('chapters', []):
        for segment in chapter.get('segments', []):
            for appearance in segment.get('appearances', []):
                char = characters.get(appearance.get('characterId'))
                if not char: continue
                outfit = next((o for o in char.get('outfits',[]) if o.get('id') == appearance.get('outfitId')),None)
                default = get_profile(char,char['defaultAppearanceProfileId'])
                period = appearance.get('period','unspecified')
                stage = appearance.get('ageStage','unspecified')
                age_text = appearance.get('ageText','')
                if period not in PERIODS: period = 'unspecified'
                if stage not in AGE_STAGES: stage = 'unspecified'
                hint = ' '.join([str((outfit or {}).get('name') or ''), *appearance.get('states',[])])
                if appearance.get('appearanceType') == 'memory':
                    # Only use a memory's title if the outfit itself has no period/age cue.
                    if _stage_hint(hint)[:2] == ('unspecified','unspecified'):
                        hint += ' ' + str(segment.get('title') or '')
                hint_period,hint_stage,hint_age = _stage_hint(hint)
                if period == 'unspecified': period = hint_period
                if stage == 'unspecified': stage = hint_stage
                if not age_text: age_text = hint_age
                if period == 'unspecified': period = 'current_life'
                profile = None
                if appearance.get('appearanceProfileId'):
                    profile = get_profile(char,appearance['appearanceProfileId'])
                if profile is None and stage == 'unspecified':
                    bound=get_profile(char,(outfit or {}).get('appearanceProfileId'))
                    if bound and bound.get('period')==period:
                        # Missing source age does not revoke an approved/adapted
                        # age or create a duplicate unknown-age period.
                        profile=bound
                    elif period=='current_life':
                        profile=default
                if profile is None:
                    profile = next((p for p in char['appearanceProfiles'] if _profile_key(p) == (period,stage)),None)
                    if profile is None and period == 'current_life' and default.get('ageStage') == 'unspecified' and (
                            stage not in ('infant','child','teen') or not any(default.get(k) for k in ('face','base','reference'))):
                        profile = default
                        profile.update(ageStage=stage,ageText=age_text,basis=appearance.get('basis','inference'),
                                       evidence=copy.deepcopy(appearance.get('evidence',[])))
                    if profile is None:
                        profile = _new_profile(char,period,stage,age_text,appearance.get('basis','inference'),appearance.get('evidence',[]))
                if profile['id'] != default['id'] and not profile.get('sourceDescription'):
                    own_quotes = [e.get('quote','') for e in appearance.get('evidence',[]) if e.get('verified') is not False]
                    profile['sourceDescription'] = ('时期：'+profile['name']+'。年龄：'+(age_text or '原文未说明')+
                        '；五官、发型、发色、体型未说明，需本时期独立设计。相关原文：'+'；'.join(own_quotes)[:300])
                    profile['description'] = '只设计'+profile['name']+'外观，按本时期年龄和原文依据；未写的发型等由美术补设。'
                    if own_quotes: profile['evidence'] = copy.deepcopy(appearance.get('evidence',[]))
                appearance['appearanceProfileId'] = profile['id']
                kind = 'candidate' if appearance.get('productionNeed') in ('candidate','reference_only') else appearance.get('appearanceType')
                profile_types.setdefault(profile['id'],set()).add(kind)
                if outfit and outfit.get('appearanceProfileId') != profile['id']:
                    # A wearing card belongs to one physical age/period. Reuse its
                    # clothing definition, not an adult body/card for another age.
                    related = next((o for o in char['outfits'] if o.get('sourceOutfitId') == outfit['id'] and
                                    o.get('appearanceProfileId') == profile['id']),None)
                    if related is None:
                        related = {k:copy.deepcopy(v) for k,v in outfit.items() if k not in (
                            'id','teamAssetId','teamStateId','card','hands','combined','specials','reference','productionHistory')}
                        related.update(id=uuid4().hex,name=outfit['name']+' · '+profile['name'],
                                       sourceOutfitId=outfit['id'],appearanceProfileId=profile['id'],specials=[])
                        if outfit.get('card'):
                            related['legacyProfileMismatchReferences'] = [outfit['card']]
                            related['appearanceProfileReviewPending'] = True
                        char['outfits'].append(related)
                    outfit = related
                    appearance.update(outfitId=outfit['id'],outfitName=outfit['name'])
                if outfit:
                    outfit['appearanceProfileId'] = profile['id']
                    outfit_types.setdefault(outfit['id'],set()).add(kind)
                    outfit_chapters.setdefault(outfit['id'],set()).add(chapter.get('chapter'))
    for char in project.get('characters',[]):
        for outfit in char.get('outfits',[]):
            if outfit['id'] in outfit_types:
                outfit['candidateOnly'] = 'onscreen' not in outfit_types[outfit['id']]
                outfit['episodes'] = sorted(x for x in outfit_chapters[outfit['id']] if isinstance(x,int))
        for profile in char.get('appearanceProfiles',[]):
            if profile['id'] in profile_types:
                profile['candidateOnly'] = 'onscreen' not in profile_types[profile['id']]
    return project

def profile_character(char, profile_id=None):
    profile = get_profile(char,profile_id)
    if profile is None:
        raise ValueError('没有找到所选人物时期')
    working = dict(char)
    for key in VISUAL_FIELDS:
        working.pop(key,None)
    working.update({k:copy.deepcopy(profile[k]) for k in VISUAL_FIELDS if k in profile})
    for key in ('faceIdentityGroupId','faceContinuity','hairstyle'):
        working[key]=copy.deepcopy(profile.get(key))
    working['appearanceProfileId'] = profile['id']
    if profile.get('identityReviewPending'):
        working.update(faceApproved=False,faceCandidates=[],faceCandidateSheet='',identitySource='design',reference='',references=[],base='',faceCore='',faceCoreApproved=False,faceCoreReviewPending=True)
    working['appearanceProfile'] = {k:copy.deepcopy(profile.get(k)) for k in TEXT_FIELDS + ('id','teamAssetId','teamStateId')}
    working['outfits'] = [o for o in char.get('outfits',[]) if o.get('appearanceProfileId') == profile['id']]
    working['description'] = profile.get('description') or char.get('description','') if profile['id'] == char.get('defaultAppearanceProfileId') else profile.get('description','')
    working['sourceDescription'] = profile.get('sourceDescription') or (
        char.get('sourceDescription','') if profile['id'] == char.get('defaultAppearanceProfileId') else '')
    if profile['id'] == char.get('defaultAppearanceProfileId'):
        working['sourceDescriptionHistory'] = [copy.deepcopy(row) for row in char.get('sourceDescriptionHistory',[]) if
            any(o.get('appearanceProfileId') == profile['id'] and row.get('chapter') in o.get('episodes',[]) for o in char.get('outfits',[]))]
    else:
        working['sourceDescriptionHistory'] = [{'description':profile.get('sourceDescription',''),
            'basis':profile.get('basis','inference'),'definitionEvidence':copy.deepcopy(profile.get('evidence',[])),
            'analysisOrigin':'appearance_profile'}]
    return working

def commit_profile_character(char, working, profile_id=None):
    profile = get_profile(char,profile_id or working.get('appearanceProfileId'))
    if profile is None: raise ValueError('时期已不存在，未覆盖其他时期')
    for key in VISUAL_FIELDS:
        if key in working: profile[key] = copy.deepcopy(working[key])
        else: profile.pop(key,None)
    for key in ('faceIdentityGroupId','faceContinuity','hairstyle'):
        if key in working and working[key] is not None: profile[key]=copy.deepcopy(working[key])
    known = {o.get('id') for o in char.get('outfits',[])}
    for outfit in working.get('outfits',[]):
        outfit.setdefault('appearanceProfileId',profile['id'])
        if outfit.get('id') not in known:
            char.setdefault('outfits',[]).append(outfit)
            known.add(outfit.get('id'))
    if profile['id'] == char.get('defaultAppearanceProfileId'):
        for key in VISUAL_FIELDS:
            if key in profile: char[key] = copy.deepcopy(profile[key])
            else: char.pop(key,None)
    return char
