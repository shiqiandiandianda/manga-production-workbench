import sys,json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'comic/python'))
import local_region_tools as tools
from PIL import Image,ImageDraw
import numpy as np
crop=Image.new('RGBA',(320,240),'#dedbc2');d=ImageDraw.Draw(crop)
d.rectangle((35,40,125,210),fill='#d74445');d.rectangle((195,40,285,210),fill='#296abb')
alpha=Image.new('L',crop.size);a=ImageDraw.Draw(alpha);a.rectangle((35,40,125,210),fill=255);a.rectangle((195,40,285,210),fill=255)
box=(0,0,320,240)
def stroke(kind,x,y,size=12):return {'kind':kind,'size':size,'points':[{'x':x/320,'y':y/240}]}
selection={'sourceSize':crop.size,'strokes':[stroke('remove',240,120)]}
mask=tools.refine_alpha(crop,alpha,selection,box)
assert mask.getpixel((80,120))==255
assert mask.getpixel((240,120))==0
assert mask.getpixel((5,5))==0
selection['strokes'].append(stroke('keep',80,120))
mask=tools.refine_alpha(crop,alpha,selection,box)
assert mask.getpixel((80,120))==255 and mask.getpixel((240,120))==0
# A tiny mark on a large source must survive the 1400px working-size limit.
large=crop.resize((6400,4800));prior=alpha.resize(large.size)
small={'sourceSize':large.size,'strokes':[{'kind':'keep','size':1,'points':[{'x':.25,'y':.5}]}]}
mask=tools.refine_alpha(large,prior,small,(0,0,*large.size))
assert mask.getpixel((1600,2400))==255 and mask.getpixel((4800,2400))==0
try:tools.refine_alpha(crop,Image.new('L',crop.size),{'sourceSize':crop.size,'strokes':[stroke('remove',240,120)]},box)
except ValueError as error:assert '保留' in str(error)
else:raise AssertionError('Empty foreground must provide an actionable error')
print(json.dumps({'exclusionOnly':True,'explicitKeep':True,'smallMarkAtLargeSize':True,'emptyForegroundMessage':True}))
