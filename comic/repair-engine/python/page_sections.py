from PIL import Image
from png_pages import bands

def normalize_sections(sections, height, width=32768):
    if not isinstance(sections, list) or len(sections) > 200:
        raise ValueError('漫画最多支持 200 个分段图层')
    result, ids = [], set()
    for item in sections:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id'] or item['id'] in ids:
            raise ValueError('漫画图层编号无效')
        ids.add(item['id'])
        start, end, length = item.get('start'), item.get('end'), item.get('height')
        if type(start) is not int or type(end) is not int or start < 0 or end < start or end > height:
            raise ValueError('漫画图层图片范围无效')
        if type(length) is not int or length < max(1, end-start) or length > 1000000:
            raise ValueError('图层长度不能短于画面，最长为 100 万 px')
        cuts=item.get('cutouts',[])
        if not isinstance(cuts,list) or len(cuts)>500:
            raise ValueError('漫画剪切数量无效')
        for cut in cuts:
            if not isinstance(cut,dict) or any(type(cut.get(key)) is not int for key in ['x','y','width','height']) or cut['x']<0 or cut['y']<start or cut['width']<1 or cut['height']<1 or cut['x']+cut['width']>width or cut['y']+cut['height']>end:
                raise ValueError('漫画剪切范围无效')
        result.append({'cutouts':cuts,'id': item['id'], 'start': start, 'end': end, 'height': length, 'visible': item.get('visible', True) is not False})
    if sum(item['height'] for item in result if item['visible']) > 1000000:
        raise ValueError('漫画总长度不能超过 100 万 px')
    return result

def arrange_sections(source, width, sections):
    output_top = 0
    for item in sections:
        if not item['visible']:
            continue
        if item['end'] > item['start']:
            for top, band in bands(source):
                begin, end = max(top, item['start']), min(top+band.height, item['end'])
                if begin < end:
                    piece = band.crop((0, begin-top, width, end-top))
                    for hole in item.get('cutouts',[]):
                        hole_begin,hole_end=max(begin,hole['y']),min(end,hole['y']+hole['height'])
                        if hole_begin<hole_end:
                            piece.paste((0,0,0,0),(hole['x'],hole_begin-begin,hole['x']+hole['width'],hole_end-begin))
                    yield output_top, piece
                    output_top += piece.height
                if top+band.height >= item['end']:
                    break
        remaining = item['height'] - (item['end']-item['start'])
        while remaining:
            count = min(256, remaining)
            yield output_top, Image.new('RGBA', (width, count), (0, 0, 0, 0))
            output_top += count
            remaining -= count
    if output_top == 0:
        yield 0, Image.new('RGBA', (width, 1), (0, 0, 0, 0))
