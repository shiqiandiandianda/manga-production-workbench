"""Resolve an explicit user override only from the installed immutable book."""
from artwork_framing import frame_artwork
import re,json,math
from pathlib import Path

def trusted_constraints(packet):
    supplied=packet.get('nativeUserConstraints')
    g=packet.get('generator',{});version=g.get('styleBookVersion','')
    if supplied is None and g.get('mode')!='native-style-rules':return None
    if g.get('mode')!='native-style-rules' or g.get('provider')!='local-native-styles' or g.get('engine')!='dazhou-native-style-v1' or not re.fullmatch(r'dazhou-native-v\d+',version):raise ValueError('高度约束覆盖缺少正式固有规则来源')
    path=Path(__file__).resolve().parent.parent/'styles/dazhou'/(version+'.json')
    book=json.loads(path.read_text(encoding='utf-8-sig'))
    from layout_engine.core import digest
    expected=book.get('runtime',{}).get('userConstraints')
    if expected is None and supplied is None:return None
    if not expected or supplied!=expected or g.get('styleBookDigest')!=digest(book):raise ValueError('高度约束覆盖与已登记用户规则不符')
    if supplied.get('minimumHOverW')!=1.0 or supplied.get('mainFullWidth') is not True:raise ValueError('用户高度/主格占幅约束无效')
    if 'maximumHOverW' in supplied and (supplied['maximumHOverW']!=16/9 or supplied.get('maximumHeightNumerator')!=16 or supplied.get('maximumHeightDenominator')!=9):raise ValueError('用户9:16高度上限无效')
    return supplied

def dimension_errors(packet,script,constraints):
    if not constraints:return []
    errors=[]
    for i,p in enumerate(packet.get('panels',[])):
        w,h=p.get('w'),p.get('h');key=str(p.get('key'))
        if not all(type(v) in (int,float) and math.isfinite(v) and v>0 for v in (w,h)):continue
        art=frame_artwork(script['shots'][i]) if script and i<len(script['shots']) else None
        if not art and h<w:errors.append(key+'新画格高度不得小于宽度')
        if not art and constraints.get('maximumHOverW') and (type(w) is not int or type(h) is not int or h>w*16//9):errors.append(key+'新画格必须为整数且高度不得超过floor(宽×16/9)')
        if p.get('role')=='main' and (p.get('x')!=0 or w!=packet.get('canvas',{}).get('width')):errors.append(key+'主格须x=0且占满画布宽度')
    return errors
