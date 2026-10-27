"""Local page import, viewport extraction and full-resolution composition."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import shutil
import uuid
from PIL import Image, ImageOps,ImageDraw,ImageFont,ImageChops
from png_pages import page_info, streamable, extract, make_preview, paste_page, build_display_cache
from job_inputs import base_image

# Page height is handled by PNG bands rather than a full-page pixel allocation.
Image.MAX_IMAGE_PIXELS = None


def import_page(input_path: Path, output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / 'original.png'
    with input_path.open('rb') as source:
        is_png = source.read(8) == b'\x89PNG\r\n\x1a\n'
    if is_png and streamable(input_path):
        shutil.copy2(input_path, destination)
    else:
        with Image.open(input_path) as image:
            if image.format not in ['PNG', 'JPEG', 'WEBP']:
                raise ValueError('请选择 PNG、JPG 或 WebP 图片')
            normalized = ImageOps.exif_transpose(image).convert('RGBA')
            normalized.save(destination, 'PNG', compress_level=3)
    info = page_info(destination)
    preview_size = make_preview(destination, output_dir / 'preview-0.png', prepare_display=True)
    # Thumbnail the bounded preview, not a full-resolution repair region.
    with Image.open(output_dir / 'preview-0.png') as preview:
        thumb = preview.crop((0, 0, preview.width, min(preview.height, round(preview.width * 1.25)))).convert('RGBA')
    thumb.thumbnail((180, 220))
    thumb.save(output_dir / 'thumb.png')
    return {'width': info['width'], 'height': info['height'], 'previewSize': list(preview_size)}


def compose_job(job: Path, patch_path: Path, feather: int):
    request = json.loads((job / 'request.json').read_text(encoding='utf-8'))
    with Image.open(patch_path) as raw:
        patch = raw.convert('RGBA')
    with Image.open(job / 'mask.png') as raw:
        mask = raw.getchannel('A').point(lambda alpha: 255 - alpha)
    output = job / 'repaired_page.png'
    temporary = job / f'composed-{uuid.uuid4().hex}.tmp'
    paste_page(base_image(job,request), temporary, patch, request['crop'], mask, feather)
    temporary.replace(output)
    return {'path': str(output)}


def job_layer_mask(job,request,mask):
    """A protected crop already contains its single mask blend.

    Its overlay only needs a binary attachment window. Legacy/native raw edits
    keep the original feathering path exactly as before.
    """
    from repair_pipeline import gaussian_feather,inward_feather
    try:state=json.loads((job/'automation.json').read_text(encoding='utf-8'))
    except (FileNotFoundError,json.JSONDecodeError):state={}
    if isinstance(state,dict) and state.get('maskApplied') is True:
        crop=request['crop'];frame=request.get('frame') or crop
        fx,fy=frame['x']-crop['x'],frame['y']-crop['y'];fw,fh=frame['width'],frame['height']
        if mask.size!=(crop['width'],crop['height']) or any(type(value) is not int for value in (fx,fy,fw,fh)) or fx<0 or fy<0 or fw<=0 or fh<=0 or fx+fw>mask.width or fy+fh>mask.height:
            raise ValueError('已应用蒙版的选区框或尺寸无效，不能重复羽化或越界接回')
        window=Image.new('L',mask.size)
        ImageDraw.Draw(window).rectangle((fx,fy,fx+fw-1,fy+fh-1),fill=255)
        return ImageChops.multiply(mask.point(lambda value:255 if value else 0),window).tobytes()
    soften=gaussian_feather if request.get('featherMode')=='gaussian' else inward_feather
    return soften(mask.tobytes(),mask.width,mask.height,int(request.get('feather') or 0))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['import', 'region', 'preview', 'compose','reference','layers','guide','ai-layer','annotate','display-cache','job-thumb','extract-layer','accept-attempt'])
    parser.add_argument('--input', type=Path)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--rect', type=int, nargs=4)
    parser.add_argument('--job', type=Path)
    parser.add_argument('--feather', type=int, default=6)
    parser.add_argument('--manifest',type=Path)
    parser.add_argument('--compress-level',type=int,default=3)
    args = parser.parse_args()
    try:
        if args.command == 'import':
            result = import_page(args.input, args.out)
        elif args.command == 'display-cache':
            result = build_display_cache(args.input)
        elif args.command == 'accept-attempt':
            from attempt_publish import accept
            state = accept(args.job)
            result = {'status': state['status'], 'attemptId': state['attemptId']}
        elif args.command == 'extract-layer':
            from extract_scene import extract_scene
            crop=dict(zip(['x','y','width','height'],args.rect))
            manifest=json.loads(args.manifest.read_text(encoding='utf-8'))
            extract_scene(args.input,manifest,crop).save(args.out,'PNG',compress_level=3)
            result={'path':str(args.out)}
        elif args.command == 'region':
            crop = dict(zip(['x','y','width','height'], args.rect))
            extract(args.input, crop).save(args.out, 'PNG')
            result = {'path': str(args.out)}
        elif args.command == 'preview':
            result = {'previewSize': list(make_preview(args.input, args.out))}
        elif args.command=='job-thumb':
            with Image.open(args.input) as source:
                image=ImageOps.exif_transpose(source).convert('RGBA');image.thumbnail((96,96));image.save(args.out,'PNG',compress_level=6)
                result={'width':image.width,'height':image.height}
        elif args.command=='reference':
            with Image.open(args.input) as source:
                image=ImageOps.exif_transpose(source).convert('RGBA');image.thumbnail((2048,2048));image.save(args.out,'PNG')
                result={'width':image.width,'height':image.height}
        elif args.command=='guide':
            with Image.open(args.job/'crop.png') as raw: image=raw.convert('RGBA')
            with Image.open(args.job/'mask.png') as raw: editable=raw.getchannel('A').point(lambda alpha:255-alpha)
            overlay=Image.new('RGBA',image.size,(236,121,82,0));overlay.putalpha(editable.point(lambda alpha:round(alpha*.4)));image.alpha_composite(overlay);image.save(args.job/'guide.png','PNG');result={'path':str(args.job/'guide.png')}
        elif args.command=='annotate':
            request=json.loads((args.job/'request.json').read_text(encoding='utf-8'));crop=request['crop']
            with Image.open(args.job/'crop.png') as raw:image=raw.convert('RGBA')
            draw=ImageDraw.Draw(image)
            for mark in json.loads(args.manifest.read_text(encoding='utf-8')):
                colour=mark.get('color','#a6e020');size=max(1,min(160,int(mark.get('size',4))))
                if mark.get('kind')=='text':
                    try:font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',max(6,min(200,int(mark.get('fontSize',28)))))
                    except OSError:font=ImageFont.load_default()
                    draw.text((mark['x']-crop['x'],mark['y']-crop['y']),str(mark.get('text',''))[:300],fill=colour,font=font)
                else:
                    points=[(p['x']-crop['x'],p['y']-crop['y']) for p in mark.get('points',[])]
                    if len(points)>1:draw.line(points,fill=colour,width=size,joint='curve')
                    for x,y in points[::max(1,len(points)//10)]:draw.ellipse((x-size/2,y-size/2,x+size/2,y+size/2),fill=colour)
            image.save(args.job/'annotation.png','PNG');result={'path':str(args.job/'annotation.png')}
        elif args.command=='ai-layer':
            from repair_pipeline import normalize_patch,gaussian_feather,inward_feather
            request=json.loads((args.job/'request.json').read_text(encoding='utf-8'));crop=request['crop']
            with Image.open(args.job/'repaired.png') as raw: patch,_=normalize_patch(raw.convert('RGBA'),(crop['width'],crop['height']))
            patch.save(args.job/'image.png','PNG')
            with Image.open(args.job/'mask.png') as raw: mask=raw.getchannel('A').point(lambda alpha:255-alpha)
            softened=job_layer_mask(args.job,request,mask)
            layer_mask=Image.new('RGBA',patch.size,'white');layer_mask.putalpha(Image.frombytes('L',patch.size,softened));layer_mask.save(args.job/'layer-mask.png','PNG')
            import numpy as np
            patch_alpha=np.frombuffer(patch.getchannel('A').tobytes(),dtype=np.uint8).astype(np.float64)
            layer_alpha=np.frombuffer(softened,dtype=np.uint8).astype(np.float64)
            patch.putalpha(Image.frombytes('L',patch.size,np.rint(patch_alpha*layer_alpha/255).astype(np.uint8).tobytes()))
            patch.save(args.job/'layer.png','PNG');tiles=[];directory=args.job/'layer-tiles';directory.mkdir(exist_ok=True)
            for y in range(0,patch.height,512):
                for x in range(0,patch.width,512):
                    tile=Image.new('RGBA',(512,512));tile.paste(patch.crop((x,y,min(x+512,patch.width),min(y+512,patch.height))),(0,0));file=directory/f'{x}-{y}.png';tile.save(file,'PNG');tiles.append({'x':crop['x']+x,'y':crop['y']+y,'width':512,'height':512,'file':str(file)})
            from bubble_text import prepare_text_tiles
            from bubble_separation import prepare_bubble_tiles
            result={'path':str(args.job/'layer.png'),'imagePath':str(args.job/'image.png'),'maskPath':str(args.job/'layer-mask.png'),'tiles':tiles,'textLayers':prepare_text_tiles(args.job,Path(__file__).resolve().parents[1]/'public'/'fonts'),'bubbleLayers':prepare_bubble_tiles(args.job)}
        elif args.command=='layers':
            from png_pages import bands,write_page,page_info,_scan
            manifest=json.loads(args.manifest.read_text(encoding='utf-8'));info=page_info(args.input)
            from page_layout import normalize_gaps, insert_gaps
            gaps=normalize_gaps(manifest.get('gaps',[]),info['height']) if isinstance(manifest,dict) else []
            from page_sections import normalize_sections, arrange_sections
            sections=normalize_sections(manifest['sections'],info['height'],info['width']) if isinstance(manifest,dict) and 'sections' in manifest else None
            manifest=manifest['tiles'] if isinstance(manifest,dict) else manifest
            from page_overlays import composite_tiles, overlay_bands
            backgrounds=[item for item in manifest if item.get('coordinateSpace')=='background']
            foregrounds=[item for item in manifest if item.get('coordinateSpace')=='output']
            source_tiles=[item for item in manifest if item.get('coordinateSpace','source')=='source']
            def composed():
                for top,band in bands(args.input):
                    yield top,composite_tiles(band,top,info['width'],source_tiles)
            extras=_scan(args.input)[1]
            if sections is not None:
                intermediate=args.out.with_name(args.out.name+'.section-source.png')
                try:
                    write_page(intermediate,info['width'],info['height'],composed(),extras,compress_level=3)
                    write_page(args.out,info['width'],max(1,sum(item['height'] for item in sections if item['visible'])),overlay_bands(arrange_sections(intermediate,info['width'],sections),info['width'],backgrounds,foregrounds),extras,compress_level=args.compress_level)
                finally:
                    intermediate.unlink(missing_ok=True)
            else:
                write_page(args.out,info['width'],info['height']+sum(item['gap'] for item in gaps),overlay_bands(insert_gaps(composed(),info['width'],info['height'],gaps),info['width'],backgrounds,foregrounds),extras,compress_level=args.compress_level)
            result={'path':str(args.out)}
        else:
            result = compose_job(args.job, args.input, args.feather)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        raise SystemExit(1)
