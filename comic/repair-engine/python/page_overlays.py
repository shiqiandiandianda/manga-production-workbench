from PIL import Image
import numpy as np
import math


def background_piece(item, left, begin, right, end):
    color = item.get('color', '#ffffff').lstrip('#')
    start = np.array([int(color[i:i+2], 16) for i in (0, 2, 4)], dtype=float)
    gradient = item.get('gradient')
    opacity = item.get('opacity', 1)
    if not gradient:
        return Image.new('RGBA', (right-left, end-begin), tuple(start.astype(int)) + (round(opacity*255),))
    color = gradient['endColor'].lstrip('#')
    finish = np.array([int(color[i:i+2], 16) for i in (0, 2, 4)], dtype=float)
    width, height = item['width'], item['height']
    xx = np.arange(left, right, dtype=float)[None, :] + .5 - item['x'] - width/2
    yy = np.arange(begin, end, dtype=float)[:, None] + .5 - item['y'] - height/2
    if gradient['type'] == 'radial':
        t = np.clip(np.hypot(xx, yy) / math.hypot(width/2, height/2), 0, 1)
    else:
        radians = math.radians(gradient.get('angle', 90))
        dx, dy = math.cos(radians), math.sin(radians)
        span = (abs(width*dx) + abs(height*dy))/2
        t = np.clip((xx*dx + yy*dy + span)/(2*span), 0, 1)
    a0, a1 = gradient.get('startOpacity', 1), gradient.get('endOpacity', 1)
    alpha = a0*(1-t) + a1*t
    # CanvasGradient interpolates the color channels separately from alpha.
    rgb = start*(1-t[..., None]) + finish*t[..., None]
    result = np.empty((end-begin, right-left, 4), dtype=np.uint8)
    result[..., :3] = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    result[..., 3] = np.clip(np.rint(alpha*opacity*255), 0, 255).astype(np.uint8)
    return Image.fromarray(result, 'RGBA')

def composite_tiles(band, top, width, tiles):
    for item in tiles:
        x, y, w, h = item['x'], item['y'], item['width'], item['height']
        left, right = max(0,x), min(width,x+w)
        begin, end = max(top,y), min(top+band.height,y+h)
        if left >= right or begin >= end:
            continue
        if item.get('type') == 'background':
            piece=background_piece(item,left,begin,right,end)
        else:
            with Image.open(item['file']) as overlay:
                piece=overlay.crop((left-x,begin-y,right-x,end-y)).convert('RGBA')
        band.alpha_composite(piece,(left,begin-top))
    return band

def overlay_bands(image_bands, width, backgrounds, foregrounds):
    for top, band in image_bands:
        if backgrounds:
            base=Image.new('RGBA',band.size,(0,0,0,0))
            composite_tiles(base,top,width,backgrounds)
            base.alpha_composite(band)
            band=base
        composite_tiles(band,top,width,foregrounds)
        yield top,band
