"""Automatic O01–O07 recognition, necessity comparison and planning geometry.

Only source narrative/composition is read. No prefilled overlap hints are used.
Protected rectangles are conservative PREPRODUCTION PLANS, never image analysis.
"""
import re

VERSION='automatic-overlap-v2'
def has(pattern,text):return bool(re.search(pattern,text))
def text(f):return f['description']+' '+f['composition']+' '+f['speech']
def shared_object(a,b,objects):return next((o for o in sorted(objects,key=len,reverse=True) if o in a and o in b),None)

def recognize(fa,fb,config):
    a,b=text(fa),text(fb);obj=shared_object(a,b,config['objects'])
    hit=lambda name,value:has(config['signals'][name],value)
    attention=hit('attention',a);reach=hit('reach',b);precontact=hit('precontact',a)
    counter=hit('counterAction',b) and hit('counterTiming',b)
    reaction=hit('reaction',b);action=fa['action'] or hit('action',a)
    immediate=hit('immediate',b);provoke=hit('provoke',a)
    # Temporal adjacency alone never establishes necessity. Require an explicit
    # shared instant, interruption, or perceptual focus transfer in the source.
    linked=hit('necessaryLink',a+' '+b)
    explain=bool(fa['speech']) or hit('explain',a);thought=hit('thought',b)
    scene=fa['base']=='spatial' or hit('scene',a)
    question=fb['question'] or hit('question',b);aggression=hit('aggression',b)
    aftermath=hit('aftermath',a);dominant=hit('dominant',b) and bool(fb['speech'])
    reading=hit('reading',a) and bool(obj)
    detail=fb['base']=='detail' and hit('detail',b);key_reveal=hit('keyReveal',b)
    same_actor=bool(fa['actor'] and fa['actor']==fb['actor'])
    focus_locked=attention and reach and bool(obj) and (same_actor or hit('focusLock',a)) and linked
    interruption=precontact and counter and fb['base']=='detail' and bool(fb['actor'] and fb['actor'] in a)
    return [
      {'id':'O01','matched':explain and thought,'necessary':explain and thought and immediate and linked,'signal':'说明被同一瞬间的认知转折打断' if linked else '思考可用紧密分离表达'},
      {'id':'O02','matched':provoke and reaction,'necessary':provoke and reaction and immediate and linked,'signal':'挑衅尚未结束即被强烈身体反应打断' if linked else '只有挑衅和反应，缺少必须叠合的即时打断'},
      {'id':'O03','matched':(attention and reach) or interruption,'necessary':focus_locked or interruption,'variant':'接触前焦点转向反制细节' if interruption else '锁定同一对象接出手',
       'signal':'上格明确停在接触前一瞬，下格反制细节造成时间停顿' if interruption else ('已锁定'+str(obj)+'并直接进入同一对象的手部动作' if focus_locked else '观察与动作未证明必须叠合')},
      {'id':'O04','matched':scene and question,'necessary':scene and question and aggression and linked,'signal':'场面尚未结束即被施压质问切入' if linked else '普通发问或施压标签不需要靠叠图成立'},
      {'id':'O05','matched':action and reaction and not thought,'necessary':action and reaction and immediate and linked and bool(fa['actor'] and fb['actor']) and fa['actor']!=fb['actor'],
       'signal':'关键动作同一瞬间切入另一人物的强反应' if linked else '动作与反应有因果，但紧密分离仍可表达'},
      {'id':'O06','matched':aftermath and dominant,'necessary':aftermath and dominant and linked and (aggression or hit('pressure',b)),
       'signal':'结果场面未收束即被持续施压的发问切入' if linked else '结果后的普通续话不自动叠合'},
      {'id':'O07','matched':reading and detail,'necessary':reading and detail and key_reveal and linked,
       'signal':'阅读同一'+str(obj)+'的视线即时转向改变判断的关键细节' if linked else '普通关键细节仍可完整分离阅读'}]

def protected_plan(f,config):
    c=f['composition'];a=f['description'];margin=config['planningMargins']
    rects=[{'x':margin['side'],'y':margin['top'],'w':1-2*margin['side'],'h':1-margin['top']-margin['bottom'],'reason':'原构图主体、脸部与关键动作的保守中央规划区'}]
    # An explicit composition anchor outranks the default planning margin.
    if has(r'下侧|下缘|下方|下部|在下|脚印|双足|头脚|完整身体|全身|膝盖|脚底|足部',c):
        rects.append({'x':0,'y':.8,'w':1,'h':.2,'reason':'原构图明确在下部承载身体、动作或接触信息'})
    if has(r'上侧|上缘|上方|上部|在上',c):rects.append({'x':0,'y':0,'w':1,'h':.2,'reason':'原构图明确在上部承载信息'})
    if has(r'左侧|左缘|左下|左上',c):rects.append({'x':0,'y':0,'w':.25,'h':1,'reason':'原构图左侧有明确承载'})
    if has(r'右侧|右缘|右下|右上',c):rects.append({'x':.75,'y':0,'w':.25,'h':1,'reason':'原构图右侧有明确承载'})
    if has(r'充满|占满|满画面|覆盖整个|横贯整个',c):rects=[{'x':0,'y':0,'w':1,'h':1,'reason':'原构图占满画面，无可规划遮让区'}]
    return {'status':'planning-only-pending-artwork','sourceComposition':c,'protectedRects':rects,
        'protectedContent':(c or a)[:100],'basis':'按目标原构图自动生成的保守规划包络；不是实际成图检测，须保留pending_artwork。'}

def rect_intersects(a,b):return min(a['x']+a['w'],b['x']+b['w'])>max(a['x'],b['x']) and min(a['y']+a['h'],b['y']+b['h'])>max(a['y'],b['y'])
def intersection_rect(a,b):
    x=max(a['x'],b['x']);y=max(a['y'],b['y']);w=min(a['x']+a['w'],b['x']+b['w'])-x;h=min(a['y']+a['h'],b['y']+b['h'])-y
    return {'x':x,'y':y,'w':w,'h':h} if w>0 and h>0 else None
def world_rect(panel,r):return {'x':panel['x']+r['x']*panel['w'],'y':panel['y']+r['y']*panel['h'],'w':r['w']*panel['w'],'h':r['h']*panel['h']}

def solve(previous,current,earlier,upper,lower,config):
    options=[];reasons=[]
    max_depth=min(config['maximumDepthPixels'],int(previous['h']*config['maximumUpperDepthFraction']),int(current['h']*config['maximumLowerDepthFraction']))
    depths=list(range(max_depth,config['minimumDepthPixels']-1,-config['depthStepPixels']))
    if not depths:return None,{'reason':'保留内容与最小可辨叠合尺度之间没有足够空间','cornersTried':[]}
    bottom=max(p['y']+p['h'] for p in earlier+[previous])
    for corner in ('lower_left','lower_right'):
        xs=[0,int((1280-current['w'])*.12)] if corner=='lower_left' else [1280-current['w'],int((1280-current['w'])*.88)]
        for x in dict.fromkeys(xs):
            if corner=='lower_left' and x+current['w']>=previous['x']+previous['w'] or corner=='lower_right' and x<=previous['x']:continue
            for depth in depths:
                candidate={**current,'x':x,'y':bottom-depth}
                overlap=intersection_rect(previous,candidate)
                if not overlap or overlap['w']<config['minimumIntersectionWidthPixels']:continue
                if any(rect_intersects(candidate,p) for p in earlier):continue
                upper_hit=any(rect_intersects(overlap,world_rect(previous,r)) for r in upper['protectedRects'])
                lower_hit=any(rect_intersects(overlap,world_rect(candidate,r)) for r in lower['protectedRects'])
                if upper_hit or lower_hit:
                    reasons.append(corner+(':前格保护内容冲突' if upper_hit else ':后格保护内容冲突'));continue
                # Prefer a smaller obscured area and less change to the chosen
                # vertical reading alignment; no fixed right corner or depth.
                options.append({'x':x,'y':candidate['y'],'depthPixels':depth,'corner':corner,'intersection':overlap,
                    'rank':(overlap['w']*overlap['h'],abs(x-current['x']),-depth)})
                break
    if not options:return None,{'reason':'两侧叠角均无法同时保留原构图保护内容和相邻阅读关系','cornersTried':sorted(set(reasons))}
    best=min(options,key=lambda v:v['rank']);best.pop('rank')
    return best,{'optionsConsidered':len(options),'cornersTried':sorted(set(o['corner'] for o in options))}

def choose(a,b,fa,fb,book,previous,current,earlier):
    config=book['runtime']['overlapSelection'];recognized=recognize(fa,fb,config)
    evaluation={'version':VERSION,'from':a['key'],'to':b['key'],'recognition':recognized,'accepted':False,
        'manualHintsUsed':False,'alternatives':['紧密纵向分离','纵向错位分离（不使用阶梯小格）']}
    matches=[r for r in recognized if r['matched']]
    if not matches:evaluation['reason']='7款均未匹配，不为了有叠图而硬叠';return None,evaluation
    necessary=[r for r in matches if r['necessary']]
    if not necessary:evaluation['reason']='匹配仅为可选组合，紧密分离可完整表达；未达到required必要性';return None,evaluation
    if a.get('existingArtwork') or b.get('existingArtwork'):
        evaluation['reason']='已有成图不能用文字规划包络冒充实际主体检测；本次自动叠合仅用于待生成画格';return None,evaluation
    upper=protected_plan(fa,config);lower=protected_plan(fb,config)
    geometry,geometry_review=solve(previous,current,earlier,upper,lower,config)
    evaluation.update(upperPlanning=upper,lowerPlanning=lower,geometryReview=geometry_review)
    if not geometry:evaluation['reason']=geometry_review['reason'];return None,evaluation
    priority=config['priority'];r=min(necessary,key=lambda r:priority.index(r['id']));style=next(s for s in book['overlapStyles'] if s['id']==r['id'])
    cost='原上格“'+fa['description'][:32]+'”与下格“'+fb['description'][:32]+'”构成'+r['signal']+'；紧密分离或纵向错位会削弱这一次即时打断或必要焦点转移。'
    proof={'styleId':style['id'],'necessityLevel':'required','separationCost':cost,
        'upperProtectedContent':'规划保护：'+upper['protectedContent'],'lowerProtectedContent':'规划保护：'+lower['protectedContent'],
        'upperSafeCorner':'自动规划包络外的'+geometry['corner']+'角部，成图未验','lowerSafeCorner':'自动规划上缘留白，成图未验',
        'depthPixels':geometry['depthPixels'],'corner':geometry['corner'],'xOverride':geometry['x'],'yOverride':geometry['y'],
        'automaticPlanning':True,'selectionVersion':VERSION}
    evaluation.update(accepted=True,selectedStyle=style['id'],reason=r['signal'],necessityComparison={'tightSeparation':cost,'verticalOffsetSeparation':cost},geometry=geometry)
    return {'style':style,'proof':proof,'automaticEvaluation':evaluation},evaluation
