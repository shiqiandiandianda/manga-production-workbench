"""Plan the whole support sequence before constructing the validated packet.

Candidates preserve source framing; repetition is a solver constraint rather
than a user repair task. These are implementation parameters, not new samples.
"""
from artwork_framing import frame_artwork
import copy,math,re
from native_support_geometry import select,position

VERSION='content-sequence-v6'

def positive(text):
    # Negative production instructions cannot establish visible subject needs.
    negative='不(?:画|要|得|能|将|把|插|改|遮|复制|换|拉|裁|并列|提前|随之)|无(?:伤|倒地)|未(?:出现|出镜)|勿|避免|禁止'
    return '，'.join(c for c in re.split('[，。；;]',text) if not re.search(negative,c))

def source_shape(f,choice,book,previous=None,previous_fact=None):
    clean=copy.deepcopy(f);clean['composition']=positive(f['composition'])
    clean['description']=positive(f['description'])
    shape=select(clean,choice,book,previous,previous_fact)
    shape['version']=book['runtime']['supportGeometry']['version'] if book['runtime'].get('readingPlanner',{}).get('supportHeightPolicy') else 'content-sequence-v11' if book['runtime'].get('userConstraints',{}).get('maximumHOverW') else VERSION
    shape['sourceFraming']['composition']=f['composition']
    shape['reason']+=' 否定性制作约束不作为出镜内容。'
    return shape

def bad_repeat(run,near):
    if len(run)<3:return False
    a=run[-3:]
    if len({(p['w'],p['h']) for p in a})==1:return True
    if any(p['role']!='support' for p in a):return False
    ws=[p['w'] for p in a];rs=[p['h']/p['w'] for p in a];cs=[p['x']+p['w']/2 for p in a]
    return (max(ws)-min(ws))/max(ws)<near['widthTolerance'] and max(rs)-min(rs)<near['aspectTolerance'] and max(cs)-min(cs)<1280*near['centerToleranceOfCanvas']

def plan(shots,fs,mains,combos,book):
    joint=any(s.get('artworkLayout',{}).get('repairPolicyVersion')==2 for s in shots)
    cfg=book['runtime'];near=cfg['supportSelection']['nearRepeat'];sets=[];previous=None;active=None
    bounded=bool(cfg.get('userConstraints',{}).get('maximumHOverW'));support_policy=cfg.get('readingPlanner',{}).get('supportHeightPolicy')
    for i,(s,f) in enumerate(zip(shots,fs)):
        art=frame_artwork(s);art_ratio=None
        if art:
            aw,ah=art.get('width'),art.get('height')
            if not all(type(v) in (int,float) and math.isfinite(v) and v>0 for v in (aw,ah)):raise ValueError('已有图片尺寸无效：'+s['key'])
            art_ratio=ah/aw
        if i in mains:
            style=mains[i][1];ratio=cfg['mainRatios'][style]
            if re.search('纵深|完整身体|全景',f['composition']+' '+f['size']):ratio=max(ratio,1.5)
            if cfg.get('readingPlanner'):
                from native_reading_rhythm import support_height
                ratio=f['_mainGeometry']['ratio'];required=1280
                for j in ([] if bounded else range(i+1,len(shots))):
                    if j in mains:break
                    future=source_shape(fs[j],combos.get(j),book)
                    fa=frame_artwork(shots[j]);fr=fa['height']/fa['width'] if fa else support_height(fs[j],future,book)
                    extra=0 if fa else max(x[2] for x in cfg['sequencePlanning']['candidates'])
                    required=max(required,math.ceil(future['width']**2*(fr+extra)/(.94*1280)))
                if not art_ratio:ratio=max(ratio,required/1280)
                if bounded:f['_mainGeometry'].update(heightPolicy='content-first-supports-resolved-without-main-growth')
                else:f['_mainGeometry'].update(ratio=ratio,groupAreaMinimumHeight=required)
            ratio=art_ratio or ratio;active={'w':1280,'h':min(round(1280*ratio),1280*16//9) if bounded and not art_ratio else round(1280*ratio)}
            main_options=[{'role':'main','x':0,**active,'cost':0,'shape':None}]
            if joint and not art_ratio and f.get('_mainGeometry'):
                low,high=f['_mainGeometry']['range']
                for candidate_ratio in (low,(low+high)/2,high):
                    h=round(1280*candidate_ratio)
                    if not any(p['h']==h for p in main_options):main_options.append({'role':'main','x':0,'w':1280,'h':h,'cost':abs(candidate_ratio-ratio),'shape':None})
            sets.append(main_options);previous=None;continue
        base=source_shape(f,combos.get(i),book,previous,fs[i-1] if i else None);previous=base
        if cfg.get('combinationPlanner'):
            from local_combination_rules import shape_preference
            base=shape_preference(f,base,cfg['combinationPlanner'])
        if cfg.get('readingPlanner'):
            from native_reading_rhythm import support_height
            base['ratio']=support_height(f,base,book);base['heightSelection']='source-bounded-stable-random'
            base['reason']+=' 高度按当前甲方要求高≥宽，并在原构图可承载范围内稳定随机取值。'
            if support_policy:
                from native_reading_rhythm import support_profile
                base['heightProfile']=support_profile(f,base,book)
                base['reason']+=' '+base['heightProfile']['reason']+'；不套用主格紧凑范围。'
        ratio=art_ratio or base['ratio'];preferred=base['width'];variant=base['variant']
        # A focus frame, a normal frame and a breathing frame are meaningful
        # area choices, not tiny pixel nudges. Never change an existing ratio.
        configs=cfg['sequencePlanning'];options=[];width_limits=[]
        candidates=list(configs['candidates'])
        if bounded and not art_ratio:
            if support_policy:lo,hi=base['heightProfile']['range']
            else:
                from native_reading_rhythm import compact_content
                lo=cfg['readingPlanner']['supportHeightRanges'][variant][0]
                if compact_content(f,cfg['readingPlanner']):lo=cfg['readingPlanner']['compactSupportRange'][0]
                if base['informationLoad']['fullBody'] or base['informationLoad']['vertical']:lo=max(lo,1.4)
            # Reconsider content-safe height as well as width; the main never
            # grows to accommodate a failed support candidate.
            candidates.extend([('compact_fit',1,lo-ratio),('compact_focus',.9,lo-ratio)])
        if art and (s.get('artworkLayout',{}).get('fit')=='frame-to-artwork' or s.get('artworkLayout',{}).get('tighten')):
            cap=math.floor(math.sqrt(active['w']*active['h']*.94/ratio))
            candidates.append(('artwork_content_fit',min(preferred,cap)/preferred,0))
        for name,scale,height_extra in candidates:
            r=ratio if art_ratio else min(ratio+height_extra,16/9) if bounded else ratio+height_extra
            if support_policy and not art_ratio:r=max(lo,min(r,hi,16/9))
            w=min(round(preferred*scale),cfg['maximumSupportWidth'],cfg['maximumSupportWidth'] if joint else math.floor(math.sqrt(active['w']*active['h']*.94/r)))
            width_limits.append(w)
            # Wider relationships/full scenes retain the content-fit floor;
            # focus may reduce excess space but cannot cut necessary subjects.
            fit=cfg['supportGeometry']['contentFit'];signals=base['informationLoad']
            floor=preferred*.88
            if f['base']=='spatial':floor=max(floor,fit['spatialWidth']*1280)
            if signals['spanningSubjects']:floor=max(floor,fit['spanningWidth']*1280)
            if signals['multipleFaces'] and signals['protectedProp']:floor=max(floor,fit['facesWithPropWidth']*1280)
            if art and (s.get('artworkLayout',{}).get('fit')=='frame-to-artwork' or s.get('artworkLayout',{}).get('tighten')):
                # Full artwork is retained; no subjects are removed to satisfy a script-derived portrait floor.
                floor=min(floor,preferred*.7)
            if w<max(480,floor):continue
            g={**copy.deepcopy(base),'width':w,'ratio':r,'candidate':name}
            g['reason']+=' 全话候选“'+name+'”保留原景别及人物/道具关系，仅调整画格承载面积和竖幅余量。'
            p={'role':'support','x':position(g,w),'w':w,'h':min(round(w*r),w*16//9) if bounded and not art_ratio else round(w*r),'shape':g,'cost':0 if name=='source_fit' else configs['alternativeCost']}
            if cfg.get('combinationPlanner'):
                from local_combination_rules import candidate_cost
                p['cost']=candidate_cost(f,p,base,cfg['combinationPlanner'])
            if not any((q['x'],q['w'],q['h'])==(p['x'],p['w'],p['h']) for q in options):options.append(p)
        if not options:
            main_index=max(k for k in mains if k<i)
            raise ValueError('画格承载范围与主副格面积限制冲突：'+s['key']+'；所属主格 '+shots[main_index]['key']+' '+str(active['w'])+'×'+str(active['h'])+'；副格必要宽度至少 '+str(math.ceil(max(480,floor)))+'，候选最大宽度 '+str(max(width_limits,default=0))+'；目标高宽比 '+str(round(ratio,3)))
        sets.append(options)
    # Exact dynamic programming over the preceding two candidates. Entire
    # suffixes can be reconsidered; a later conflict never traps a greedy pick.
    states={(None,None,None):(0,[])}
    for i,options in enumerate(sets):
        nxt={}
        for _,(cost,path) in states.items():
            for j,p in enumerate(options):
                main_index=max(k for k in mains if k<=i)
                main_choice=j if i in mains else path[main_index]
                main=options[j] if i in mains else sets[main_index][main_choice]
                if p['role']=='support' and p['w']*p['h']>main['w']*main['h']*.94:continue
                run=[sets[k][path[k]] for k in range(max(0,i-2),i)]+[p]
                if bad_repeat(run,near):continue
                key=(path[-1] if path else None,j,main_choice);score=cost+p['cost']
                if key not in nxt or score<nxt[key][0]:nxt[key]=(score,path+[j])
        if not nxt:raise ValueError('当前源图/构图约束没有可用的安全款式组合：'+shots[i]['key'])
        states=nxt
    _,path=min(states.values(),key=lambda v:(v[0],v[1]))
    result={}
    for i,j in enumerate(path):
        p=sets[i][j]
        if joint and i in mains and not frame_artwork(shots[i]):
            fs[i]['_mainGeometry'].update(ratio=p['h']/p['w'],heightPolicy='joint-main-support-content-candidates')
        if p['shape']:
            result[i]=p['shape'];result[i]['sequenceSelection']={'version':cfg['supportGeometry']['version'] if support_policy else 'content-sequence-v11' if bounded else VERSION,'candidateCount':len(sets[i]),'selectedCandidate':p['shape']['candidate'],'automaticAdjustment':j!=0,'reason':'在全话兼容候选中最少调整；同尺寸及近似同列重复在写出结果前自动解开，未改原文、景别、人物或图像比例。'}
    return result
