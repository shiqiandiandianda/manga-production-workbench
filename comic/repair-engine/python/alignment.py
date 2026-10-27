"""Conservative scale/translation registration using unchanged crop context only."""
from PIL import Image,ImageFilter
import numpy as np

def _edges(image):
    a=np.asarray(image,dtype=np.float32)
    gx=np.zeros_like(a);gy=np.zeros_like(a)
    gx[:,1:-1]=(a[:,2:]-a[:,:-2])*.5;gy[1:-1,:]=(a[2:,:]-a[:-2,:])*.5
    return gx,gy

def align_context(original,patch,editable,feather=0):
    report={'applied':False,'scalePercent':100.0,'offsetX':0.0,'offsetY':0.0,'reason':'未找到足够可靠的未修改区域匹配，保持原尺寸'}
    if original.size!=patch.size or min(original.size)<96:return patch,report
    ratio=min(1,176/max(original.size));size=(max(1,round(original.width*ratio)),max(1,round(original.height*ratio)))
    ref=original.convert('L').resize(size,Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(.65));target=patch.convert('L').resize(size,Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(.65))
    mask=editable.resize(size,Image.Resampling.NEAREST);radius=max(2,round(feather*3*ratio));mask=mask.filter(ImageFilter.MaxFilter(radius*2+1))
    context=np.asarray(mask)<5;context[:7]=False;context[-7:]=False;context[:,:7]=False;context[:,-7:]=False
    gx,gy=_edges(ref);energy=gx*gx+gy*gy;context&=energy>9
    if context.sum()<450:return patch,report
    h,w=context.shape
    if sum(context[y:y+h//2,x:x+w//2].sum()>60 for y in [0,h//2] for x in [0,w//2])<3:return patch,report
    rx,ry=gx[context],gy[context];norm=float(np.sqrt((rx*rx+ry*ry).sum()))
    def score(ex,ey):
        tx,ty=ex[context],ey[context];denom=norm*float(np.sqrt((tx*tx+ty*ty).sum()))
        return float((rx*tx+ry*ty).sum()/denom) if denom>1e-6 else -1
    base=score(*_edges(target));best=(base,1.0,0.0,0.0)
    cx,cy=(w-1)/2,(h-1)/2
    for scale in np.arange(.95,1.0501,.005):
        warped=target.transform(size,Image.Transform.AFFINE,(float(scale),0,cx*(1-scale),0,float(scale),cy*(1-scale)),Image.Resampling.BILINEAR)
        ex,ey=_edges(warped)
        for dy in range(-3,4):
            for dx in range(-3,4):
                value=score(np.roll(ex,(-dy,-dx),(0,1)),np.roll(ey,(-dy,-dx),(0,1)))
                if value>best[0]:best=(value,float(scale),float(dx),float(dy))
    for scale in np.arange(best[1]-.004,best[1]+.0041,.001):
        for dy in np.arange(best[3]-.5,best[3]+.501,.25):
            for dx in np.arange(best[2]-.5,best[2]+.501,.25):
                warped=target.transform(size,Image.Transform.AFFINE,(float(scale),0,cx*(1-scale)+dx,0,float(scale),cy*(1-scale)+dy),Image.Resampling.BILINEAR)
                value=score(*_edges(warped))
                if value>best[0]:best=(value,float(scale),float(dx),float(dy))
    confidence,scale,dx,dy=best
    report.update(confidence=round(confidence,4),nominalConfidence=round(base,4))
    if confidence<.72 or confidence-base<.035 or not(.95<=scale<=1.05):return patch,report
    dx/=ratio;dy/=ratio;cx,cy=(patch.width-1)/2,(patch.height-1)/2
    aligned=patch.transform(patch.size,Image.Transform.AFFINE,(scale,0,cx*(1-scale)+dx,0,scale,cy*(1-scale)+dy),Image.Resampling.BICUBIC)
    report.update(applied=True,scalePercent=round(100/scale,3),offsetX=round(-dx/scale,3),offsetY=round(-dy/scale,3),reason='根据未修改的周边线条自动校正生成图的构图缩放与位移')
    return aligned,report
