"""Stable, layout-owned content interface. Producer layout answers are excluded.

Adapters may translate a field name. They cannot supply a main/support verdict,
placement, group, dimensions, overlap necessity or target coordinates.
"""
import copy

FORMAT='comic-layout-source-facts-v1'
FORBIDDEN=('主格','叙事功能','排版','原版版式','矩形像素','行内','主副格','款式','叠图')

def normalize(shot,config):
    raw=shot.get('sourceFields') or {};canonical=shot.get('layoutSourceFacts') or {}
    if canonical and canonical.get('format')!=FORMAT:raise ValueError(shot['key']+'排版内容事实接口版本无效')
    # Only this allowlist can enter the independent decision engine.
    composition=canonical.get('composition')
    field='layoutSourceFacts.composition' if isinstance(composition,str) and composition.strip() else None
    if not field:
        field=next((k for k in config['compositionFields'] if isinstance(raw.get(k),str) and raw[k].strip()),None)
        composition=raw[field] if field else str(shot.get('composition') or '')
    entries=canonical.get('utterances',raw.get('台词',[]))
    if not isinstance(entries,list):entries=[]
    utterances=[]
    for t in entries:
        if not isinstance(t,dict):continue
        who=t.get('speaker',t.get('说话人'));kind=t.get('channel',t.get('类型'));text=t.get('text',t.get('文本',''))
        if not isinstance(text,str):continue
        channel='spoken' if kind in config['spokenTypes'] or kind=='spoken' else 'thought' if kind in config['thoughtTypes'] or kind=='thought' else 'narration' if kind in ('旁白','narration') else 'unattributed'
        offscreen=channel=='spoken' and (kind in config['offscreenTypes'] or t.get('offscreen') is True)
        utterances.append({'speaker':str(who).strip() if who else None,'channel':channel,'offscreen':offscreen,'text':text})
    if not utterances and shot.get('dialogue'):
        utterances=[{'speaker':str(shot['speaker']) if shot.get('speaker') else None,'channel':'spoken' if shot.get('speaker') else 'unattributed','offscreen':False,'text':str(shot['dialogue'])}]
    return {'format':FORMAT,'key':shot['key'],'description':str(canonical.get('description',shot.get('description',''))),
        'composition':str(composition or ''),'shotSize':str(canonical.get('shotSize',shot.get('shotSize',''))),'cameraAngle':str(canonical.get('cameraAngle',shot.get('cameraAngle',''))),
        'characters':copy.deepcopy(canonical.get('characters',shot.get('characters',[]))),
        'location':str(shot.get('location') or ''),'time':str(shot.get('time') or ''),'utterances':utterances,
        'fieldProvenance':{'composition':field},'producerLayoutAnswersUsed':False}
