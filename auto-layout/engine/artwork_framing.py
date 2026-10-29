"""Resolve target-frame constraints independently of immutable native pixels."""
import math

def frame_artwork(shot):
    art=shot.get('existingArtwork')
    if not art:return None
    def valid(n):return type(n) in (int,float) and math.isfinite(n) and n>0
    if not all(valid(art.get(k)) for k in ('width','height')):raise ValueError('已有图片尺寸无效：'+shot['key'])
    placement=shot.get('artworkLayout')
    if placement is None:return art
    if placement.get('version')!=1 or placement.get('fit') not in ('preserve','cover','contain','frame-to-artwork') or placement.get('framePolicy') not in ('fixed','rules'):raise ValueError('已有图片取景约束无效：'+shot['key'])
    if placement['fit']=='preserve' and placement['framePolicy']!='fixed':raise ValueError('保留取景必须冻结当前框形')
    if placement['fit']=='frame-to-artwork':return art
    if placement['framePolicy']=='rules':return None
    if not all(valid(placement.get(k)) for k in ('width','height')):raise ValueError('目标框形无效：'+shot['key'])
    return {k:placement[k] for k in ('width','height')}
