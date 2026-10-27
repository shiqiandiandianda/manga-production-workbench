"""Content-led support shapes, with audited 21–25 evidence and no random cycle.

Reference bounds are approximate shape envelopes. Target dimensions are solved
from visible framing needs; a reference rectangle is never copied as a slot.
"""
import re

VERSION='content-support-v4'
def has(pattern,text):return bool(re.search(pattern,text))

def select(f,choice,book,previous=None,previous_fact=None):
    cfg=book['runtime']['supportGeometry'];c=f['composition'];d=f['description']
    full=has(cfg['signals']['fullBody'],c)
    vertical=full or has(cfg['signals']['vertical'],c)
    span=has(cfg['signals']['spanningSubjects'],c)
    faces=has(cfg['signals']['multipleFaces'],c+' '+f['camera'])
    prop=has(cfg['signals']['protectedProp'],c)
    pose=has(cfg['signals']['emotionalPose'],c+' '+d)
    style=(choice or {}).get('styleId','B01')
    # Original framing outranks a combination's typical shape.
    if vertical or f['base']=='detail' or f['base']=='spatial':
        variant='tall';why='原构图需要纵向动作/道具路径、身体或空间纵深'
    elif f['shoulder'] or faces or prop:
        variant='relational';why='保留同框人物、过肩前景、手与道具的关系'
    elif '近景' in f['size'] and not pose:
        variant='compact';why='原近景聚焦表情和短句，未要求完整身体或纵向路径'
    elif pose:
        variant='tall';why='情绪通过身体姿态承载，不能一律缩成表情角标'
    elif style=='S01' or span:
        variant='compact';why='局部短对答或并列关系，采用较宽的竖幅承载'
    elif style in ('S02','S05'):
        variant='tall';why='原中景承载说话姿态与局部返回关系'
    else:
        variant='relational';why='原中景保留半身、手势和同场关系'
    shape=cfg['variants'][variant]
    # Semantic information load, not character-count jitter or episode parity.
    signals={'multipleFaces':faces,'spanningSubjects':span,'protectedProp':prop,
             'overShoulder':f['shoulder'],'multipleSpeakers':len(f['speakers'])>1,
             'fullBody':full,'vertical':vertical}
    load=min(1,sum(cfg['loadWeights'][k] for k,v in signals.items() if v))
    low,high=shape['widthRange'];width=low+(high-low)*load
    # Wide scene relationships are content requirements, not diversity quotas.
    if span:width=max(width,cfg['contentFit']['spanningWidth'])
    if faces and prop:width=max(width,cfg['contentFit']['facesWithPropWidth'])
    if f['base']=='spatial':width=max(width,cfg['contentFit']['spatialWidth'])
    rlo,rhi=shape['heightOverWidthRange']
    height_need=min(1,(.6 if vertical else 0)+(.4 if full else 0)+(.25 if prop else 0)+(.15 if pose else 0))
    ratio=rlo+(rhi-rlo)*height_need
    alignment=(choice or {}).get('side','left');anchor_reason='按本局部组合的接话关系确定位置'
    if has(cfg['signals']['centerAnchor'],c):alignment='center';anchor_reason='原构图明确主体/焦点居中'
    elif f['rightAnchor']:alignment='right';anchor_reason='原构图明确主体在右'
    elif has(cfg['signals']['leftAnchor'],c):alignment='left';anchor_reason='原构图明确主体在左'
    elif not choice and previous and previous_fact and (
         f['speaker'] and f['speaker']==previous_fact['speaker'] or
         f['actor'] and f['actor']==previous_fact['actor']):
        alignment=previous.get('alignment','left');anchor_reason='同一人物续说/续动作，保持局部一侧'
    elif not choice and previous and previous_fact and f['reaction'] and f['actor'] and previous_fact['actor'] and f['actor']!=previous_fact['actor']:
        alignment='left' if previous.get('alignment')=='right' else 'right';anchor_reason='原文明确转向另一人物反应，局部回应前格'
    margins=cfg['placement'][style]
    role='question' if f['question'] else 'return' if choice and choice.get('returnsToFirst') else 'answer' if choice and choice.get('memberIndex',0)>0 else 'opening'
    inset=margins.get(role,margins['opening'])
    return {'version':VERSION,'variant':variant,'width':round(1280*width),'ratio':ratio,
        'alignment':alignment,'edgeInset':round(1280*inset),'informationLoad':signals,
        'referenceEvidenceIds':shape['evidenceIds'],
        'reason':why+'；'+anchor_reason+'。样本只提供近似形态范围，尺寸服从本格原取景。',
        'sourceFraming':{'shotSize':f['size'],'camera':f['camera'],'composition':c}}

def position(g,width):
    if g['alignment']=='center':return round((1280-width)/2)
    inset=min(g['edgeInset'],max(0,1280-width))
    return inset if g['alignment']=='left' else 1280-width-inset
