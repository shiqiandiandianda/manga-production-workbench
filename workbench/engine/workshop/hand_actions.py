"""Basic, reference-driven hands when there is no mapped script."""
import copy

POLICY_VERSION='simple-reference-hands-2'
# The model chooses short action IDs. It cannot invent a belt, face or prop interaction.
ACTIONS=(
 ('fist','握拳，拇指自然放在收拢的四指外侧'),
 ('open_palm','摊开手掌，五指自然张开'),
 ('stop_palm','竖掌制止，四指并拢伸直'),
 ('point','食指指向前方，其余手指自然收拢'),
 ('pinch','拇指与食指轻轻捏合，其余手指放松'),
 ('thumbs_up','拇指竖起，其余四指收拢'),
 ('claw','五指张开并弯曲，呈空手抓握手势'),
 ('relaxed','手部自然放松，手指略弯曲垂下'),
 ('cupped_palm','掌心向上，手指轻拢成承接的手势'),
 ('two_fingers','食指和中指伸出，其余手指自然收拢'),
)
CATALOG=dict(ACTIONS)
DEFAULT_IDS=('fist','open_palm','stop_palm','point','pinch','claw','relaxed','cupped_palm')
SELECTION_SCHEMA={'type':'object','properties':{'actionIds':{'type':'array','items':{'type':'string','enum':list(CATALOG)},'maxItems':8}},'required':['actionIds'],'additionalProperties':False}


def choose_actions(worker,client,directory,reference,character,specified,update):
    """Supplementary actions are bounded; user instructions never pass through rewriting."""
    specified=list(specified)
    if len(specified)==8:return {'gestures':specified,'gestureSources':['用户指定']*8,'gesturePolicyVersion':POLICY_VERSION,'gestureSelection':'user'}
    prompt=('只读图选手势，不生图。没有剧本，不需要章节或服装绑定。根据附图角色年龄、气质、衣袖护腕与手套，从给出的基础手势中选择适合其漫画素材使用的动作。'
            '每项只返回对应actionId，选择明显不同的手形。userSpecifiedActions由程序原样保留在前面，不要重新写。'
            '补足到共8个；系统补充不指定左右手，不涉及拉腰带、穿衣、整理布条，不出现脸部身体、道具、武器或技能效果。'
            '动作是制作补充，不能宣称发生在原著。'
            +worker.prompt_data({'character':character,'userSpecifiedActions':specified,'availableActions':[{'id':k,'action':v} for k,v in ACTIONS],'needed':8-len(specified)}))
    selected=worker._turn(client,directory,prompt,worker.references(reference),schema=SELECTION_SCHEMA,update=update)
    ids=selected.get('actionIds',[]) if isinstance(selected,dict) else []
    ids=[i for i in ids if isinstance(i,str) and i in CATALOG] if isinstance(ids,list) else []
    # A malformed supplemental selection cannot block generation of basic hands.
    hints={'fist':('握拳',),'open_palm':('摊掌','摊开手掌','张开手掌'),'stop_palm':('竖掌','制止'),'point':('指向',),'pinch':('捏合',),'thumbs_up':('拇指竖起','点赞'),'claw':('抓握','爪形'),'relaxed':('放松','自然下垂'),'cupped_palm':('承接','掌心向上'),'two_fingers':('两根手指','两指','食指和中指')}
    used=set()
    for action in specified:
        match=next((key for key,terms in hints.items() if any(term in action for term in terms)),None)
        if match:used.add(match)
    chosen=[]
    for key in [*ids,*DEFAULT_IDS,*CATALOG]:
        if key not in chosen and key not in used:chosen.append(key)
        if len(chosen)==8-len(specified):break
    return {'gestures':specified+[CATALOG[i] for i in chosen],'gestureSources':['用户指定']*len(specified)+['制作补充']*len(chosen),'gesturePolicyVersion':POLICY_VERSION,'gestureSelection':'reference' if ids else 'basic-fallback','gestureActionIds':chosen}


def needs_plan(result,specified,hands_ready=False):
    actions=result.get('gestures',[])
    if not isinstance(actions,list) or len(actions)!=8 or any(not isinstance(a,str) or not a.strip() for a in actions) or actions[:len(specified)]!=list(specified):return True
    return not hands_ready and len(specified)<8 and result.get('gesturePolicyVersion')!=POLICY_VERSION


def explicit_outfit_actions(outfit):
    """Keep manually entered/changed strings; exclude known matching auto supplements."""
    result=[];sources=outfit.get('gestureSources') or []
    for i,action in enumerate(outfit.get('gestures') or []):
        if not isinstance(action,str) or not action.strip():continue
        source=sources[i] if i<len(sources) else None
        auto=isinstance(source,str) and source in {'制作补充','补充'} or isinstance(source,dict) and source.get('source')=='补充' and source.get('origin')!='用户指定' and source.get('name')==action
        if not auto:result.append(action)
    return result[:8]


def remember_replacement(result):
    if result.get('gestures'):
        result.setdefault('previousGesturePlans',[]).append({k:copy.deepcopy(result.get(k)) for k in ['gestures','gestureSources','gesturePolicyVersion']})
