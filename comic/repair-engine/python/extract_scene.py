"""Render only a requested output rectangle, using exact cached source strips."""
from PIL import Image
from png_pages import extract, page_info
from page_sections import normalize_sections
from page_layout import normalize_gaps
from page_overlays import composite_tiles

def shifted(tiles, x, y):
    return [{**tile, 'x': tile['x']-x, 'y': tile['y']-y} for tile in tiles]

def extract_scene(source, manifest, rect):
    info=page_info(source)
    x,y,w,h=(rect[key] for key in ['x','y','width','height'])
    if 'sections' in manifest:
        sections=normalize_sections(manifest['sections'],info['height'],info['width'])
        segments=[];offset=0
        for section in sections:
            if section['visible']:
                segments.append({**section,'outputStart':offset})
                offset+=section['height']
    else:
        segments=[];start=0;offset=0
        for gap in normalize_gaps(manifest.get('gaps',[]),info['height']):
            segments.append({'start':start,'end':gap['y'],'outputStart':start+offset})
            start=gap['y'];offset+=gap['gap']
        segments.append({'start':start,'end':info['height'],'outputStart':start+offset})
    tiles=manifest['tiles']
    backgrounds=[item for item in tiles if item.get('coordinateSpace')=='background']
    foregrounds=[item for item in tiles if item.get('coordinateSpace')=='output']
    source_tiles=[item for item in tiles if item.get('coordinateSpace','source')=='source']
    result=Image.new('RGBA',(w,h))
    composite_tiles(result,0,w,shifted(backgrounds,x,y))
    for section in segments:
        output_start=section['outputStart']
        begin=max(y,output_start);end=min(y+h,output_start+section['end']-section['start'])
        for output_top in range(begin,end,512):
            rows=min(512,end-output_top);source_top=section['start']+output_top-output_start
            piece=extract(source,{'x':x,'y':source_top,'width':w,'height':rows})
            composite_tiles(piece,0,w,shifted(source_tiles,x,source_top))
            for hole in section.get('cutouts',[]):
                left=max(x,hole['x']);right=min(x+w,hole['x']+hole['width'])
                top=max(source_top,hole['y']);bottom=min(source_top+rows,hole['y']+hole['height'])
                if left<right and top<bottom:
                    piece.paste((0,0,0,0),(left-x,top-source_top,right-x,bottom-source_top))
            result.alpha_composite(piece,(0,output_top-y))
    composite_tiles(result,0,w,shifted(foregrounds,x,y))
    return result
