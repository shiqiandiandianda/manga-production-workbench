import json,sys,os
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
spec=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
candidates=[os.environ.get('SCENE_LABEL_FONT',''),'/System/Library/Fonts/PingFang.ttc','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc']
font_path=next((p for p in candidates if p and Path(p).is_file()),None)
if not font_path:raise RuntimeError('Install a CJK font or set SCENE_LABEL_FONT')
font=ImageFont.truetype(font_path,int(spec['fontSize']))
for index,text in enumerate(spec['labels']):
    lines=['']
    for char in text:
        if font.getlength(lines[-1]+char)>spec['maxWidth']-24:lines.append('')
        lines[-1]+=char
    line_height=int(spec['fontSize']*1.5)
    width=min(spec['maxWidth'],int(max(font.getlength(line) for line in lines))+24)
    image=Image.new('RGBA',(width,line_height*len(lines)+16),(15,23,18,190))
    draw=ImageDraw.Draw(image)
    for y,line in enumerate(lines):draw.text((12,8+y*line_height),line,font=font,fill='white')
    image.save(Path(sys.argv[2])/f'label-{index}.png')
