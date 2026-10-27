from PIL import Image

def normalize_gaps(gaps, height):
    if not isinstance(gaps, list) or len(gaps) > 100:
        raise ValueError('最多支持 100 处漫画间隔')
    result = []
    for item in gaps:
        if not isinstance(item, dict):
            raise ValueError('漫画间隔格式无效')
        y, gap = item.get('y'), item.get('gap')
        if type(y) is not int or not 0 < y < height:
            raise ValueError('裁断位置必须在图片顶部和底部之间')
        if type(gap) is not int or not 0 < gap <= 10000:
            raise ValueError('间隔应为 1–10000 px 的整数')
        result.append({'y': y, 'gap': gap})
    result.sort(key=lambda item: item['y'])
    if any(a['y'] == b['y'] for a, b in zip(result, result[1:])):
        raise ValueError('同一裁断位置只能设置一处间隔')
    if height + sum(item['gap'] for item in result) > 1000000:
        raise ValueError('增加间隔后的图片高度不能超过 100 万 px')
    return result

def insert_gaps(image_bands, width, height, gaps):
    gaps = normalize_gaps(gaps, height)
    index, output_top = 0, 0
    for source_top, band in image_bands:
        cursor = 0
        while index < len(gaps) and gaps[index]['y'] <= source_top + band.height:
            item = gaps[index]
            cut = item['y'] - source_top
            if cut > cursor:
                piece = band.crop((0, cursor, width, cut))
                yield output_top, piece
                output_top += piece.height
            remaining = item['gap']
            while remaining:
                rows = min(256, remaining)
                yield output_top, Image.new('RGBA', (width, rows), 'white')
                output_top += rows
                remaining -= rows
            cursor = cut
            index += 1
        if cursor < band.height:
            piece = band if cursor == 0 else band.crop((0, cursor, width, band.height))
            yield output_top, piece
            output_top += piece.height
