"""Facial identity and hairstyle metadata, independent of bodies and full heads.

Registration and explicit setters mutate only supplied dictionaries. No files,
models, image generation, or persistence are performed here.
"""
from __future__ import annotations
import copy
import hashlib
import re

BASES = ('source','inference','production_design','authorized_adaptation')
FACE_RELATIONS = ('same','different','age_related','unknown')
HAIR_ERAS = ('ancient','modern','future','unspecified')
HAIR_GENDERS = ('男','女','通用','未说明')
AGE_STAGES = ('infant','child','teen','young_adult','adult','middle_aged','elderly','unspecified')
HAIR_WORDS = re.compile(r'头发|发型|长发|短发|黑发|白发|银发|发髻|披散|马尾|束发|发冠|发色|卷发|刘海|寸头|剃发|秃头|辫子')
UNKNOWN_WORDS = re.compile(r'未说明|未知|未写|待设计|不详')

def continuity_record(data=None,previous=None):
    result=copy.deepcopy(previous or {})
    if data is not None and not isinstance(data,dict): raise ValueError('脸部关联必须是对象')
    result.update(copy.deepcopy(data or {}))
    result.setdefault('status','unknown');result.setdefault('basis','inference')
    result.setdefault('sourceProfileId','');result.setdefault('evidence',[])
    if result['status'] not in FACE_RELATIONS or result['basis'] not in BASES:
        raise ValueError('脸部关联状态或依据无效')
    if not isinstance(result['sourceProfileId'],str) or not isinstance(result['evidence'],list):
        raise ValueError('脸部关联来源或证据无效')
    return result

def hairstyle_record(data=None,previous=None,age_stage='unspecified'):
    if data is not None and not isinstance(data,dict): raise ValueError('发型资料必须是对象')
    result=copy.deepcopy(previous or {});result.update(copy.deepcopy(data or {}))
    for key,value in {'era':'unspecified','gender':'未说明','ageStage':age_stage,
                     'sourceDescription':'','sourceEvidence':[],
                     'designDescription':'','designBasis':'production_design',
                     'libraryHairstyleId':'','image':'','reviewPending':True}.items():
        result.setdefault(key,value)
    if result['era'] not in HAIR_ERAS or result['gender'] not in HAIR_GENDERS or result['ageStage'] not in AGE_STAGES:
        raise ValueError('发型时代、性别或年龄分类无效')
    if result['designBasis'] not in BASES: raise ValueError('发型设计依据无效')
    for key in ('sourceDescription','designDescription','libraryHairstyleId','image'):
        if not isinstance(result[key],str): raise ValueError('发型文字和图像字段必须是文本')
    if not isinstance(result['sourceEvidence'],list) or not isinstance(result['reviewPending'],bool):
        raise ValueError('发型证据或审核状态无效')
    return result

def normalize_profile_visual(profile):
    profile['faceContinuity']=continuity_record(profile.get('faceContinuity'))
    profile['hairstyle']=hairstyle_record(profile.get('hairstyle'),age_stage=profile.get('ageStage','unspecified'))
    for key in ('faceIdentityGroupId','faceCore','libraryFaceCoreId','faceCoreStyle'):
        profile.setdefault(key,'')
        if not isinstance(profile[key],str): raise ValueError('五官身份字段必须是文本')
    profile.setdefault('faceCoreApproved',False)
    if not isinstance(profile['faceCoreApproved'],bool): raise ValueError('五官脸确认状态无效')
    return profile

def _next_group(project):
    prefix=project.setdefault('teamProjectPrefix','BOOK'+hashlib.sha256(
        str(project.get('id') or project.get('name') or 'local-project').encode()).hexdigest()[:6].upper())
    counters=project.setdefault('teamIdCounters',{})
    used={p.get('faceIdentityGroupId') for c in project.get('characters',[]) for p in c.get('appearanceProfiles',[])}
    used.update(g.get('id') for g in project.get('faceIdentityGroups',[]))
    number=int(counters.get('FG',0))+1
    while f'{prefix}-FG{number:04d}' in used: number+=1
    counters['FG']=number
    return f'{prefix}-FG{number:04d}'

def _selected_sources(project):
    start,end=int(project.get('rangeStart') or 1),int(project.get('rangeEnd') or 20)
    chapters=[c for c in project.get('chapters',[]) if start<=c.get('chapter',0)<=end]
    return {(c['chapter'],p['id']):p.get('text','') for c in chapters for p in c.get('paragraphs',[])},set(c['chapter'] for c in chapters)

def _verified_evidence(values,source,chapter=None):
    verified=[]
    for evidence in values or []:
        if not isinstance(evidence,dict): continue
        number=evidence.get('chapter',chapter)
        pid=evidence.get('paragraphId');quote=evidence.get('quote','')
        if isinstance(quote,str) and quote.strip() and quote.strip() in source.get((number,pid),''):
            verified.append({**copy.deepcopy(evidence),'chapter':number,'verified':True})
    return verified

def _owns_hair_claim(evidence,source_text,character,characters,active_ids=None):
    name=character.get('name','');quote=evidence.get('quote','')
    if not name: return False
    # A named observer is not the owner of another person's hair.
    descriptors=r'(?:的|自己(?:的)?|一头|满头|黑色|白色|银白|乌黑|金色|红色|浓密|稀疏|长长的|短短的|凌乱的|柔顺|高高的|低低的|留着|蓄着|梳着|扎着|束着|披着|披散着|盘着|挽着|把|将|着|[，, ])'
    direct=re.compile(re.escape(name)+descriptors+r'{0,8}(?:'+HAIR_WORDS.pattern+r')')
    named=[c for c in characters if c.get('name') and c['name'] in source_text]
    quote_actors=[c for c in characters if c.get('name') and c['name'] in quote]
    if len(quote_actors)>1: return False
    if name in quote:
        return bool(direct.search(quote))
    if named:
        # Anonymous quotations in mixed actors are not attributed by name count.
        return len(named)==1 and named[0]['id']==character['id'] and bool(direct.search(source_text))
    if re.search(r'妹妹|哥哥|男子|女子|少女|少年|身旁|另一个|那人|对方|望向|看着',source_text):
        return False
    return bool(active_ids=={character['id']} and re.search(r'他的|她的|自己|一头|满头|头发|发型',source_text))


def _owns_face_claim(evidence,source_text,character,characters,active_ids=None):
    quote=evidence.get('quote','');name=character.get('name','')
    names=[c for c in characters if c.get('name') and c['name'] in quote]
    if len(names)>1 or (names and names[0]['id']!=character['id']): return False
    whole_names=[c for c in characters if c.get('name') and c['name'] in source_text]
    if name in source_text:
        position=source_text.index(name)+len(name)
        tail=source_text[position:]
        marker=re.search(r'容貌|面容|五官|相貌|面孔|脸',tail)
        if not marker: return False
        before=tail[:marker.start()]
        if len(before)>25: return False
        foreign=re.search(r'看着|望向|看见|注视|身旁|旁边|妹妹|哥哥|男子|女子|另一人|对方',before)
        return not foreign or '自己' in before
    if whole_names or re.search(r'妹妹|哥哥|男子|女子|身旁|另一人|对方',source_text): return False
    return active_ids=={character['id']}


def _face_relation_supported(status,evidence,character_name):
    if status=='unknown': return True
    pattern={
        'same':r'容貌.{0,8}(?:未变|不变|没变|没有变化)|(?:同一张|同样的|相同的)脸|五官.{0,8}(?:相同|一样|未变)|长得.{0,6}(?:一模一样|相同)|相貌.{0,6}(?:未变|相同)',
        'different':r'另一副面孔|(?:面孔|脸|容貌|五官|相貌).{0,8}(?:不同|改变|变了)|截然不同.{0,6}(?:脸|面孔)',
        'age_related':r'(?:面容|脸|五官|容貌).{0,10}(?:年幼|幼小|成熟|苍老|衰老|皱纹)|(?:年幼|幼小|成熟|苍老|衰老|皱纹).{0,10}(?:面容|脸|五官|容貌)'
    }.get(status)
    return bool(pattern and any(re.search(pattern,e.get('quote','')) for e in evidence))


def _hair_design(profile,character):
    if profile.get('id')==character.get('defaultAppearanceProfileId'):
        observed=profile.get('inputDescription') or character.get('inputDescription') or ''
        parts=[part.strip() for part in re.split(r'[。；;\n]',observed) if HAIR_WORDS.search(part) and not UNKNOWN_WORDS.search(part)]
        if parts: return '既有定稿参考中的发型（需核对）：'+'；'.join(parts)[:360], 'existing_reference_description'
    hair=profile['hairstyle'];era={'ancient':'古代','modern':'现代','future':'未来科技','unspecified':'待定时代'}[hair['era']]
    age={'infant':'婴幼儿','child':'儿童','teen':'少年','young_adult':'青年','adult':'成年','middle_aged':'中年','elderly':'老年','unspecified':'年龄未定'}[hair['ageStage']]
    # Recommendations remain proposals, without turning them into novel facts.
    choice=('自然短发或简洁短层次' if hair['era']=='modern' else
            '束发、发髻或适合职业的简洁束发' if hair['era']=='ancient' else
            '简洁几何线条或功能性收束' if hair['era']=='future' else '按确认时代选择长度与收束方式')
    if hair['ageStage'] in ('infant','child'): choice='符合本年龄的短发、自然垂发或简洁小发束，避免机械复制成年发型'
    return f'美术建议：从{era}/{hair["gender"]}/{age}发型库筛选，候选可用{choice}；发色、长度和饰品尚未定稿。','production_recommendation'

def _profile_era(profile,appearance_quotes,scope_text,model_candidates=None):
    patterns={'modern':r'网络游戏|游戏公司|现代|手机|电脑|互联网|办公室',
              'ancient':r'玄衣卫|大周|武侠|江湖|朝廷|典史官服',
              'future':r'未来科技|星际|太空|赛博'}
    def options(text):
        return [era for era,pattern in patterns.items() if re.search(pattern,text)]
    local=options(' '.join(appearance_quotes))
    if len(local)==1: return local[0],'inference'
    if len(local)>1: return 'unspecified','inference'
    proposed={era for era in (model_candidates or []) if era in HAIR_ERAS and era!='unspecified'}
    if len(proposed)==1: return next(iter(proposed)),'inference'
    global_options=options(scope_text)
    return (global_options[0] if len(global_options)==1 else 'unspecified'),'inference'


def refresh_visual_identity(project,library=None,overrides=None):
    """Register metadata and verified hair facts only in the selected range.

    Overrides are objects with characterId/profileId, optional faceContinuity,
    hairstyle, ageStage and ageText. Authorized adaptation is explicit; no
    same-face assertion is inferred merely from transmigration or shared CH.
    Returns a preview; caller decides whether to persist the supplied project.
    """
    from life_stages import ensure_appearance_profiles,get_profile
    ensure_appearance_profiles(project)
    source,numbers=_selected_sources(project);scope_text='\n'.join(source.values())
    profile_appearances={}
    chars={c.get('id'):c for c in project.get('characters',[])}
    warnings=[];changes=[];period_text={}
    for chapter in project.get('chapterAnalysis',{}).get('chapters',[]):
        if chapter.get('chapter') not in numbers: continue
        for segment in chapter.get('segments',[]):
            for appearance in segment.get('appearances',[]):
                char=chars.get(appearance.get('characterId'))
                if not char: continue
                outfit=next((o for o in char.get('outfits',[]) if o.get('id')==appearance.get('outfitId')),{})
                pid=appearance.get('appearanceProfileId') or outfit.get('appearanceProfileId') or char.get('defaultAppearanceProfileId')
                profile_appearances.setdefault(pid,[]).append((chapter['chapter'],segment,appearance))
                phase=get_profile(char,pid)
                if phase and appearance.get('appearanceType')=='onscreen':
                    period_text.setdefault(phase.get('period','unspecified'),[]).extend(
                        source.get((chapter['chapter'],sid),'') for sid in segment.get('sourceParagraphIds',[]))
    for char in chars.values():
        default=get_profile(char,char.get('defaultAppearanceProfileId'))
        for profile in char.get('appearanceProfiles',[]):
            relation_before=profile.get('faceContinuity') or {}
            has_relation=bool(relation_before and (relation_before.get('status')!='unknown' or relation_before.get('basis')=='authorized_adaptation'))
            normalize_profile_visual(profile)
            if not profile['faceIdentityGroupId']: profile['faceIdentityGroupId']=_next_group(project)
            if profile.get('period')=='previous_life' and profile.get('identityContinuity')=='different_body' and not profile.get('identityContinuityBasis'):
                profile['identityContinuity']='unspecified'
                profile.setdefault('visualIdentityMigrationNotes',[]).append('旧版将前世默认判为不同身体；原著依据不足，现记未说明。脸部连续性独立登记。')
            if not has_relation and default and profile is not default:
                age_different=profile.get('ageStage') not in ('unspecified',default.get('ageStage'))
                status='age_related' if profile.get('identityContinuity')=='same_body' and age_different else 'unknown'
                profile['faceContinuity']=continuity_record({'status':status,'basis':'inference',
                    'sourceProfileId':default['id'],'evidence':copy.deepcopy(profile.get('evidence',[]))})
            hair=profile['hairstyle'];hair['ageStage']=profile.get('ageStage','unspecified')
            quotes=[];hair_facts=[];hair_evidence=[];era_candidates=[]
            for number,segment,appearance in profile_appearances.get(profile['id'],[]):
                evidence=_verified_evidence(appearance.get('evidence',[]),source,number)
                quotes.extend(e['quote'] for e in evidence)
                # Source descriptions from a model require an actual matching
                # hair-bearing quotation, otherwise stay unknown.
                proposed=appearance.get('hairstyle') or {}
                if proposed.get('era') in HAIR_ERAS: era_candidates.append(proposed['era'])
                proposed_evidence=_verified_evidence(proposed.get('sourceEvidence',[]),source,number)
                def owns_hair(e):
                    active={a.get('characterId') for a in segment.get('appearances',[]) if a.get('appearanceType') in ('onscreen','memory') and a.get('characterId')}
                    return _owns_hair_claim(e,source.get((number,e.get('paragraphId')),''),char,list(chars.values()),active)
                valid=[e for e in proposed_evidence if owns_hair(e) and HAIR_WORDS.search(e['quote']) and not UNKNOWN_WORDS.search(e['quote'])]
                if proposed.get('sourceDescription') and valid:
                    hair_facts.extend(e['quote'] for e in valid);hair_evidence.extend(valid)
                elif evidence:
                    valid=[e for e in evidence if owns_hair(e) and HAIR_WORDS.search(e['quote']) and not UNKNOWN_WORDS.search(e['quote'])]
                    hair_facts.extend(e['quote'] for e in valid);hair_evidence.extend(valid)
                # A uniquely bound named paragraph can supply omitted short
                # evidence. Never take another actor's hair from mixed scenes.
                for paragraph_id in segment.get('sourceParagraphIds',[]):
                    text=source.get((number,paragraph_id),'')
                    actors=[c for c in chars.values() if c.get('name') and c['name'] in text]
                    for clause in re.split(r'[，,。；;]',text):
                        if HAIR_WORDS.search(clause) and not UNKNOWN_WORDS.search(clause) and _owns_hair_claim({'quote':clause},text,char,list(chars.values())):
                            hair_facts.append(clause[:180]);hair_evidence.append({'chapter':number,'paragraphId':paragraph_id,'quote':clause[:180],'verified':True,'claimType':'literal'})
                continuity=appearance.get('faceContinuity')
                if continuity and profile['faceContinuity']['basis']!='authorized_adaptation':
                    cleaned=continuity_record(continuity)
                    cleaned['evidence']=[e for e in _verified_evidence(cleaned.get('evidence',[]),source,number)
                        if _owns_face_claim(e,source.get((number,e.get('paragraphId')),''),char,list(chars.values()),
                            {a.get('characterId') for a in segment.get('appearances',[]) if a.get('characterId')})]
                    if cleaned['basis']=='source' and not _face_relation_supported(cleaned['status'],cleaned['evidence'],char.get('name','')):
                        cleaned.update(status='unknown',basis='inference')
                        warnings.append(f'{char.get("name")}／{profile.get("name")}同脸关系缺少可回查原文，保留未知。')
                    if not cleaned['sourceProfileId'] and default is not profile: cleaned['sourceProfileId']=default['id']
                    profile['faceContinuity']=cleaned
                # Design suggestions from analysis remain design, never source.
                if proposed.get('designDescription') and hair.get('designOrigin') not in ('user_override','existing_reference_description'):
                    hair.update(designDescription=proposed['designDescription'],designBasis=proposed.get('designBasis','production_design'),designOrigin='analysis_design_proposal')
            existing=_verified_evidence(hair.get('sourceEvidence',[]),source)
            if hair_facts:
                hair['sourceDescription']='；'.join(dict.fromkeys(hair_facts))[:600]
                hair['sourceEvidence']=list({(e['chapter'],e['paragraphId'],e['quote']):e for e in hair_evidence}.values())
                hair['sourceStatus']='confirmed_description'
            elif profile['id'] in profile_appearances:
                # Existing future/history evidence is retained as history but
                # does not masquerade as a finding from the selected range.
                if hair.get('sourceEvidence') and not existing:
                    history=hair.setdefault('sourceHistory',[])
                    old={'sourceDescription':hair.get('sourceDescription'),'sourceEvidence':copy.deepcopy(hair['sourceEvidence'])}
                    if old not in history: history.append(old)
                hair.update(sourceDescription='',sourceEvidence=[],sourceStatus='unspecified')
            if hair.get('era')=='unspecified':
                hair['era'],hair['classificationBasis']=_profile_era(profile,quotes,'\n'.join(period_text.get(profile.get('period'),[])) or scope_text,era_candidates)
            if hair.get('gender')=='未说明':
                sex=char.get('gender')
                if sex in ('男','女'): hair['gender']=sex
                elif re.search(r'男子|男性|哥哥|父亲',char.get('description','')): hair['gender']='男'
                elif re.search(r'女子|女性|妹妹|母亲',char.get('description','')): hair['gender']='女'
                hair['genderBasis']='production_design'
            if not hair.get('designDescription'):
                hair['designDescription'],hair['designOrigin']=_hair_design(profile,char)
                hair['designBasis']='production_design'
            hair['reviewPending']=hair.get('reviewPending',True)
    for operation in overrides or []:
        if not isinstance(operation,dict): raise ValueError('身份修订必须是对象')
        char=chars.get(operation.get('characterId'))
        if not char: raise ValueError('身份修订未找到人物')
        profile=get_profile(char,operation.get('profileId') or operation.get('appearanceProfileId'))
        if not profile: raise ValueError('身份修订未找到人物时期')
        before=copy.deepcopy({k:profile.get(k) for k in ('faceContinuity','hairstyle','ageStage','ageText','faceIdentityGroupId')})
        if 'ageStage' in operation:
            if operation['ageStage'] not in AGE_STAGES: raise ValueError('修订年龄阶段无效')
            profile['ageStage']=operation['ageStage'];profile['hairstyle']['ageStage']=operation['ageStage']
            profile['ageStageBasis']=operation.get('basis','authorized_adaptation')
        if 'ageText' in operation: profile['ageText']=str(operation['ageText'])
        if 'faceContinuity' in operation:
            relation=continuity_record(operation['faceContinuity'],profile['faceContinuity'])
            if relation['basis']=='source':
                relation['evidence']=[e for e in _verified_evidence(relation['evidence'],source) if _owns_face_claim(e,source.get((e.get('chapter'),e.get('paragraphId')),''),char,list(chars.values()))]
                if not _face_relation_supported(relation['status'],relation['evidence'],char.get('name','')): raise ValueError('原文同脸修订缺少已选章节真实容貌证据')
            profile['faceContinuity']=relation
        if 'hairstyle' in operation:
            profile['hairstyle']=hairstyle_record(operation['hairstyle'],profile['hairstyle'],profile.get('ageStage','unspecified'))
            profile['hairstyle']['designOrigin']='user_override'
            if operation['hairstyle'].get('sourceDescription'):
                checked=[e for e in _verified_evidence(profile['hairstyle']['sourceEvidence'],source) if _owns_hair_claim(e,source.get((e.get('chapter'),e.get('paragraphId')),''),char,list(chars.values()))]
                if not checked: raise ValueError('原文发型修订缺少已选章节真实证据')
                profile['hairstyle']['sourceEvidence']=checked
        changes.append({'characterId':char['id'],'profileId':profile['id'],'before':before,
                        'after':copy.deepcopy({k:profile.get(k) for k in before}),'basis':operation.get('basis') or profile['faceContinuity']['basis']})
    # Resolve same-face edges; age-related/unknown/different stay separate. Do
    # not overwrite any legacy full head, body, approved face or reference.
    for char in chars.values():
        profiles={p['id']:p for p in char.get('appearanceProfiles',[])}
        parent={pid:pid for pid in profiles}
        def find(pid):
            while parent[pid]!=pid:
                parent[pid]=parent[parent[pid]];pid=parent[pid]
            return pid
        forbidden=[]
        for profile in profiles.values():
            relation=profile['faceContinuity'];target=relation.get('sourceProfileId')
            if target and target not in profiles:
                warnings.append('同脸来源时期不属于同一人物，未合并身份组。')
                relation.update(status='unknown',sourceProfileId='')
            elif target and target!=profile['id'] and relation['status'] in ('different','age_related'):
                forbidden.append((profile['id'],target))
        for profile in profiles.values():
            relation=profile['faceContinuity'];target=relation.get('sourceProfileId')
            if target not in profiles or target==profile['id'] or relation['status']!='same': continue
            left,right=find(profile['id']),find(target)
            if left==right: continue
            conflict=any({find(x),find(y)}=={left,right} for x,y in forbidden)
            if conflict:
                profile.setdefault('faceContinuityHistory',[]).append(copy.deepcopy(relation))
                relation.update(status='unknown',basis='inference')
                warnings.append('同脸关系与不同脸/年龄变化关系冲突，保留分组待核验。')
            else: parent[left]=right
        components={}
        for pid in profiles: components.setdefault(find(pid),[]).append(profiles[pid])
        used=set()
        ordered=sorted(components.values(),key=lambda members:(not any(p['id']==char.get('defaultAppearanceProfileId') for p in members),min(p['faceIdentityGroupId'] for p in members)))
        for members in ordered:
            canonical=next((p for p in members if p['id']==char.get('defaultAppearanceProfileId')),None)
            roots=[p for p in members if p['faceContinuity']['status']!='same' or p['faceContinuity'].get('sourceProfileId') not in {m['id'] for m in members}]
            canonical=canonical or (min(roots,key=lambda p:p['faceIdentityGroupId']) if roots else min(members,key=lambda p:p['faceIdentityGroupId']))
            gid=canonical['faceIdentityGroupId']
            if gid in used: gid=_next_group(project)
            used.add(gid)
            for profile in members:
                old=profile['faceIdentityGroupId']
                profile['faceIdentityGroupId']=gid
                if old!=gid:
                    history=profile.setdefault('faceGroupHistory',[])
                    if old not in history: history.append(old)
        # A group shares a pure face only; full heads and hair never propagate.
        for gid in {p['faceIdentityGroupId'] for p in profiles.values()}:
            members=[p for p in profiles.values() if p['faceIdentityGroupId']==gid]
            values={p.get('faceCore') for p in members if p.get('faceCore')}
            if len(values)>1:
                warnings.append(f'{char.get("name")}同脸组有不同五官脸素材，待用户确认，不覆盖旧素材。')
                for p in members: p['faceCoreReviewPending']=True
            elif len(values)==1:
                selected=next(p for p in members if p.get('faceCore'))
                for p in members:
                    for key in ('faceCore','faceCoreStyle','faceCoreApproved','libraryFaceCoreId'):
                        p[key]=copy.deepcopy(selected.get(key,'' if key!='faceCoreApproved' else False))
    groups=project.setdefault('faceIdentityGroups',[])
    active={}
    for char in chars.values():
        for profile in char.get('appearanceProfiles',[]):
            gid=profile['faceIdentityGroupId'];active.setdefault(gid,[]).append(profile)
            record=next((r for r in groups if r.get('id')==gid),None)
            if record is None:
                record={'id':gid,'identityEntityId':char.get('identityEntityId',''),'profileIds':[]};groups.append(record)
            record.update(profileIds=[p['id'] for p in active[gid]],lifecycleStatus='active')
    for group in groups:
        if group['id'] not in active: group['lifecycleStatus']='retired'
    for char in chars.values():
        default=get_profile(char,char.get('defaultAppearanceProfileId'))
        for key in ('faceCore','libraryFaceCoreId','faceCoreStyle','faceCoreApproved'):
            if default and key in default: char[key]=copy.deepcopy(default[key])
    return {'schemaVersion':'1.0','range':[int(project.get('rangeStart') or 1),int(project.get('rangeEnd') or 20)],
            'changes':changes,'warnings':list(dict.fromkeys(warnings)),
            'profiles':[{'characterId':c['id'],'name':c.get('name'),'profileId':p['id'],'profileName':p.get('name'),
                         'faceIdentityGroupId':p['faceIdentityGroupId'],'faceContinuity':copy.deepcopy(p['faceContinuity']),
                         'hairstyle':copy.deepcopy(p['hairstyle'])} for c in chars.values() for p in c.get('appearanceProfiles',[])]}

def get_face_core(project,char,profile_id=None):
    from life_stages import get_profile
    profile=get_profile(char,profile_id)
    if not profile: raise ValueError('未找到人物时期')
    gid=profile.get('faceIdentityGroupId','')
    members=[p for p in char.get('appearanceProfiles',[]) if p.get('faceIdentityGroupId')==gid and gid]
    usable=next((p for p in members if p.get('faceCore') and not p.get('faceCoreReviewPending') and not p.get('identityReviewPending')),None)
    if profile.get('identityReviewPending'): usable=None
    anchor=next((p for p in members if p.get('id')==profile.get('faceContinuity',{}).get('sourceProfileId') and p.get('face') and not p.get('identityReviewPending')),None)
    anchor=anchor or next((p for p in members if p.get('face') and not p.get('identityReviewPending')),None)
    if profile.get('identityReviewPending'): anchor=None
    return {'headReference':(anchor or {}).get('face',''),'anchorProfileId':(anchor or {}).get('id',''),
            'image':(usable or {}).get('faceCore',''),'style':(usable or {}).get('faceCoreStyle',''),
            'approved':bool((usable or {}).get('faceCoreApproved')),
            'libraryFaceCoreId':(usable or {}).get('libraryFaceCoreId',''),
            'sourceProfileId':(usable or {}).get('id',''),'faceIdentityGroupId':gid}

def set_face_core(project,char,profile_id,image,library_id='',style='',approved=False,invalidate_head=False):
    from life_stages import get_profile
    profile=get_profile(char,profile_id)
    if not profile: raise ValueError('未找到人物时期')
    if not isinstance(image,str) or not image: raise ValueError('五官脸素材无效')
    if not profile.get('faceIdentityGroupId'): refresh_visual_identity(project)
    gid=profile['faceIdentityGroupId']
    for member in char.get('appearanceProfiles',[]):
        if member.get('faceIdentityGroupId')!=gid: continue
        old=member.get('faceCore')
        if old and old!=image: member.setdefault('faceCoreHistory',[]).append({'image':old,'libraryFaceCoreId':member.get('libraryFaceCoreId','')})
        member.update(faceCore=image,libraryFaceCoreId=library_id,faceCoreStyle=style,faceCoreApproved=bool(approved))
        member.pop('faceCoreReviewPending',None)
        if invalidate_head and member.get('face'):
            member.update(headIdentityReviewPending=True,faceApproved=False)
            for outfit in char.get('outfits',[]):
                if outfit.get('appearanceProfileId')==member['id']:
                    outfit.update(semanticReviewPending=True,semanticReviewReason='五官身份已更换，整头和穿着卡需核验。')
    default=get_profile(char,char.get('defaultAppearanceProfileId'))
    for key in ('faceCore','libraryFaceCoreId','faceCoreStyle','faceCoreApproved','headIdentityReviewPending','faceApproved'):
        if default and key in default: char[key]=copy.deepcopy(default[key])
    return get_face_core(project,char,profile_id)

