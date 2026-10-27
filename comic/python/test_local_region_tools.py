import unittest,sys,json,hashlib
from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from local_region_tools import bubble_mask,extract
root=Path(__file__).resolve().parents[2];evidence=root/'verification/local-region-tools-20261022';evidence.mkdir(exist_ok=True)
class LocalRegionTests(unittest.TestCase):
 def test_auto_mask_and_brush_protect_background(self):
  im=Image.new('RGBA',(400,300),'#326550');d=ImageDraw.Draw(im);d.ellipse((100,70,300,230),fill='white',outline='black',width=3);d.text((160,130),'Hello',fill='black');s={'roi':{'x':.2,'y':.1,'w':.6,'h':.8},'expand':4,'sourceSize':im.size};box,m=bubble_mask(im,s);self.assertEqual(m.getpixel((200-box[0],140-box[1])),255);self.assertEqual(m.getpixel((0,0)),0);s['strokes']=[{'kind':'remove','size':12,'points':[{'x':.5,'y':.5}]}];_,m=bubble_mask(im,s);self.assertEqual(m.getpixel((200-box[0],150-box[1])),0)
  with self.assertRaisesRegex(ValueError,'没有识别'):bubble_mask(Image.new('RGBA',(400,300),'#326550'),s)
 def test_real_u2net_and_guided_target(self):
  im=Image.new('RGBA',(420,300),'#e0d9bc');d=ImageDraw.Draw(im);d.ellipse((55,45,170,210),fill='#d74445');d.rectangle((80,180,145,260),fill='#d74445');d.ellipse((250,45,365,210),fill='#296abb');d.rectangle((275,180,340,260),fill='#296abb');src=evidence/'two-targets.png';im.save(src);original=hashlib.sha256(src.read_bytes()).hexdigest();s={'roi':{'x':0,'y':0,'w':1,'h':1},'sourceSize':im.size,'workDir':str(evidence),'strokes':[{'kind':'keep','size':15,'points':[{'x':.26,'y':.40}]},{'kind':'remove','size':35,'points':[{'x':.73,'y':.40}]}]};out,box,mask,info=extract(im,s,root/'.runtime/image-tools/AI工具/models/u2net.onnx');out.save(evidence/'selected-red-target.png');self.assertEqual(out.getpixel((110,120))[3],255);self.assertEqual(out.getpixel((305,120))[3],0);self.assertEqual(out.getpixel((5,5))[3],0);self.assertEqual(out.getpixel((110,240))[3],255);self.assertEqual(out.getpixel((110,120))[:3],im.getpixel((110,120))[:3]);self.assertEqual(original,hashlib.sha256(src.read_bytes()).hexdigest());self.assertEqual(info['engine'],'U²-Net + GrabCut')
if __name__=='__main__':unittest.main(verbosity=2)
