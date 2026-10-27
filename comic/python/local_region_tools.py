"""Offline masked inpainting / target-guided extraction. Never writes the source."""
import argparse,json,sys,hashlib
from pathlib import Path
runtime=Path(__file__).resolve().parents[2]/'.runtime/image-tools'
sys.path.insert(0,str(runtime/'extras'))
import numpy as np
from PIL import Image,ImageOps,ImageDraw,ImageChops
import cv2

def roi_pixels(selection,size):
 w,h=size;r=selection['roi'];x=max(0,int(r['x']*w));y=max(0,int(r['y']*h));right=min(w,int(np.ceil((r['x']+r['w'])*w)));bottom=min(h,int(np.ceil((r['y']+r['h'])*h)))
 if right-x<4 or bottom-y<4:raise ValueError('框选区域太小')
 return x,y,right,bottom

def strokes_on(mask,selection,box,labels=False):
 x,y,right,bottom=box;w,h=selection['sourceSize'];draw=ImageDraw.Draw(mask);sx=mask.width/(right-x);sy=mask.height/(bottom-y)
 for stroke in selection.get('strokes',[]):
  value=(cv2.GC_FGD if stroke['kind']=='keep' else cv2.GC_BGD) if labels else (255 if stroke['kind']=='keep' else 0)
  radius=max(.5,stroke['size']*min(sx,sy)/2);points=[((p['x']*w-x)*sx,(p['y']*h-y)*sy) for p in stroke['points']]
  if not points:continue
  if len(points)>1:draw.line(points,fill=value,width=max(1,round(radius*2)),joint='curve')
  for px,py in points:draw.ellipse((px-radius,py-radius,px+radius,py+radius),fill=value)
 return mask

def bubble_mask(original,selection):
 box=roi_pixels(selection,original.size);x,y,right,bottom=box;image=np.asarray(original.crop(box).convert('RGB'));h,w=image.shape[:2]
 mode=selection.get('maskMode','auto')
 if mode=='rectangle':mask=np.full((h,w),255,np.uint8)
 elif mode=='brush':mask=np.zeros((h,w),np.uint8)
 else:
  bright=((image.min(2)>205)&(image.max(2)-image.min(2)<48)).astype(np.uint8)
  count,components,stats,centers=cv2.connectedComponentsWithStats(bright,8)
  choices=[i for i in range(1,count) if stats[i,cv2.CC_STAT_AREA]>max(12,w*h*.015)]
  # A bubble interior should be bounded inside the user-drawn search rectangle.
  choices=[i for i in choices if stats[i,0]>0 and stats[i,1]>0 and stats[i,0]+stats[i,2]<w and stats[i,1]+stats[i,3]<h]
  if not choices:raise ValueError('没有识别到完整气泡；请把黑边和尾巴框在范围内，或切换手涂蒙版')
  center=np.array([w/2,h/2]);best=max(choices,key=lambda i:stats[i,cv2.CC_STAT_AREA]/(1+np.linalg.norm(centers[i]-center)/max(w,h)))
  raw=np.uint8(components==best)*255;contours,_=cv2.findContours(raw,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE);mask=np.zeros((h,w),np.uint8);cv2.drawContours(mask,contours,-1,255,cv2.FILLED)
  # Include the printed outline before adding the user's extra margin.
  expand=min(24,max(4,round(min(w,h)*.025)))+int(selection.get('expand',3));mask=cv2.dilate(mask,np.ones((expand*2+1,expand*2+1),np.uint8)) if expand else mask
 selection={**selection,'sourceSize':original.size};mask=strokes_on(Image.fromarray(mask),selection,box);mask=ImageChops.multiply(mask,original.crop(box).getchannel('A'))
 if not mask.getbbox():raise ValueError('去除蒙版为空，请涂出需要去除的区域')
 return box,mask

def inpaint(original,selection,model):
 import onnxruntime as ort
 box,mask=bubble_mask(original,selection);x,y,right,bottom=box;pad=max(48,int(max(right-x,bottom-y)*.65));context=(max(0,x-pad),max(0,y-pad),min(original.width,right+pad),min(original.height,bottom+pad));crop=original.crop(context).convert('RGB');m=Image.new('L',crop.size);m.paste(mask,(x-context[0],y-context[1]))
 # Preserve aspect ratio: letterbox context to the fixed 512-pixel model input.
 factor=min(512/crop.width,512/crop.height);size=(max(1,round(crop.width*factor)),max(1,round(crop.height*factor)));rgb=np.asarray(crop.resize(size,Image.Resampling.LANCZOS));rgb=np.pad(rgb,((0,512-size[1]),(0,512-size[0]),(0,0)),mode='symmetric');binary=np.asarray(m.resize(size,Image.Resampling.NEAREST));binary=np.pad(binary,((0,512-size[1]),(0,512-size[0])))
 options=ort.SessionOptions();options.intra_op_num_threads=4;session=ort.InferenceSession(str(model),sess_options=options,providers=['CPUExecutionProvider']);result=session.run(None,{'image':rgb.transpose(2,0,1)[None].astype(np.float32)/255,'mask':(binary[None,None]>0).astype(np.float32)})[0][0].transpose(1,2,0)
 result=Image.fromarray(np.uint8(np.clip(result,0,255))) .crop((0,0,*size)).resize(crop.size,Image.Resampling.LANCZOS);patch=result.crop((x-context[0],y-context[1],right-context[0],bottom-context[1])).convert('RGBA');patch.putalpha(mask)
 return patch,box,mask,{'engine':'LaMa ONNX FP32','provider':'CPUExecutionProvider','context':list(context),'workingSize':list(size)}

def refine_alpha(crop,alpha,selection,box):
 scale=min(1,1400/max(crop.size));size=(max(4,round(crop.width*scale)),max(4,round(crop.height*scale)));rgb=np.asarray(crop.convert('RGB').resize(size));prior=np.asarray(alpha.resize(size));labels=np.full(prior.shape,cv2.GC_PR_BGD,np.uint8);labels[prior>90]=cv2.GC_PR_FGD
 # Paint directly at the working resolution so a small keep mark survives downsampling.
 labels=np.asarray(strokes_on(Image.fromarray(labels),selection,box,True)).copy()
 labels[0,:]=np.where(labels[0,:]==cv2.GC_FGD,cv2.GC_FGD,cv2.GC_BGD);labels[-1,:]=np.where(labels[-1,:]==cv2.GC_FGD,cv2.GC_FGD,cv2.GC_BGD);labels[:,0]=np.where(labels[:,0]==cv2.GC_FGD,cv2.GC_FGD,cv2.GC_BGD);labels[:,-1]=np.where(labels[:,-1]==cv2.GC_FGD,cv2.GC_FGD,cv2.GC_BGD)
 has_keep=np.any(labels==cv2.GC_FGD)
 # Exclusion-only edits use U2-Net's existing foreground instead of requiring a green mark.
 if np.count_nonzero((labels==cv2.GC_FGD)|(labels==cv2.GC_PR_FGD))<5:raise ValueError('没有足够的目标区域，请在要保留的人物或元素内部补一笔，或缩小框选范围')
 if np.count_nonzero((labels==cv2.GC_BGD)|(labels==cv2.GC_PR_BGD))<5:raise ValueError('请缩小保留标记，留出一些背景区域后重试')
 cv2.setRNGSeed(0);cv2.grabCut(rgb,labels,None,np.zeros((1,65),np.float64),np.zeros((1,65),np.float64),5,cv2.GC_INIT_WITH_MASK);binary=np.uint8((labels==cv2.GC_FGD)|(labels==cv2.GC_PR_FGD))
 if has_keep:
  count,parts=cv2.connectedComponents(binary,8);kept=set(parts[labels==cv2.GC_FGD].tolist());kept.discard(0);binary=np.uint8(np.isin(parts,list(kept)))
 guided=Image.fromarray(binary*255).resize(crop.size,Image.Resampling.LANCZOS)
 # Honor exact source-pixel marks even after the working mask is enlarged again.
 return strokes_on(guided,selection,box)

def extract(original,selection,model):
 from local_image_tools import cutout
 import tempfile
 box=roi_pixels(selection,original.size);crop=original.crop(box)
 with tempfile.TemporaryDirectory(dir=selection['workDir']) as work:
  source=Path(work)/'crop.png';target=Path(work)/'u2net.png';crop.save(source);cutout(source,target,model);alpha=Image.open(target).getchannel('A').copy()
 if selection.get('strokes'):alpha=refine_alpha(crop,alpha,{**selection,'sourceSize':original.size},box)
 crop.putalpha(ImageChops.multiply(crop.getchannel('A'),alpha));
 if not crop.getchannel('A').getbbox():raise ValueError('没有提取到目标，请增加保留标记或缩小框选范围')
 return crop,box,alpha,{'engine':'U²-Net + GrabCut' if selection.get('strokes') else 'U²-Net selected region','provider':'CPUExecutionProvider'}

def main():
 p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--config',required=True);p.add_argument('--model');p.add_argument('--phase',default='process');a=p.parse_args();config=json.loads(Path(a.config).read_text(encoding='utf-8'));selection=config['selection'];source=Path(a.input);out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True);selection['workDir']=str(out.parent);original=ImageOps.exif_transpose(Image.open(source)).convert('RGBA')
 if original.width*original.height>100000000:raise ValueError('图片超过一亿像素，请先选用较低倍率的原图')
 if a.phase=='mask':
  box,mask=bubble_mask(original,selection);mask.save(out);print(json.dumps({'crop':{'x':box[0],'y':box[1],'w':box[2]-box[0],'h':box[3]-box[1]},'sourceSize':list(original.size)}));return
 patch,box,mask,info=inpaint(original,selection,a.model) if config['operation']=='inpaint' else extract(original,selection,a.model);patch.save(out);mask.save(out.with_name('mask.png'));info.update({'crop':{'x':box[0],'y':box[1],'w':box[2]-box[0],'h':box[3]-box[1]},'sourceSize':list(original.size),'alphaBounds':list(patch.getchannel('A').getbbox() or []),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'maskedPixels':int(np.count_nonzero(np.asarray(mask))),'operation':config['operation']});out.with_name('region-report.json').write_text(json.dumps(info,ensure_ascii=False),encoding='utf-8');print(json.dumps(info,ensure_ascii=False))
if __name__=='__main__':main()
