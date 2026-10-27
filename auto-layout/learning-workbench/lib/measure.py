"""Measure candidate rectangles in flat comic references; never edits originals."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).parent / "dazhou-samples"


def runs(values, minimum=1, gap=0):
    idx = np.flatnonzero(values)
    if not len(idx):
        return []
    cuts = np.flatnonzero(np.diff(idx) > gap + 1) + 1
    groups = np.split(idx, cuts)
    return [(int(g[0]), int(g[-1]) + 1) for g in groups if g[-1] - g[0] + 1 >= minimum]


def background_profile(a):
    h, w, _ = a.shape
    q = (a.astype(np.uint32) // 8)
    packed = q[:, :, 0] * 1024 + q[:, :, 1] * 32 + q[:, :, 2]
    colors, counts = np.unique(packed, return_counts=True)
    palette = set(int(c) for c in colors[np.argsort(counts)[-40:]])
    del q
    valid = np.zeros(h, dtype=bool)
    bg = np.zeros((h, 3), dtype=float)
    for y in range(h):
        vals, freq = np.unique(packed[y], return_counts=True)
        order = np.argsort(freq)[::-1]
        for j in order[:3]:
            if int(vals[j]) in palette and freq[j] >= w * .12:
                select = packed[y] == vals[j]
                bg[y] = np.median(a[y, select], axis=0)
                valid[y] = True
                break
    known = np.flatnonzero(valid)
    if not len(known):
        raise ValueError("No flat background evidence detected")
    for c in range(3):
        bg[:, c] = np.interp(np.arange(h), known, bg[known, c])
    # Remove isolated image colors without turning true scene changes into noise.
    windows = np.lib.stride_tricks.sliding_window_view(np.pad(bg, ((30, 30), (0, 0)), mode="edge"), 61, axis=0)
    return np.median(windows, axis=2).astype(np.uint8)


def measure(source):
    with Image.open(source) as image:
        width, height = image.size
        scale = width / 640
        small = image.convert("RGB").resize((640, round(height / scale)))
    a = np.asarray(small)
    h, w, _ = a.shape
    bg = background_profile(a)
    delta = np.max(np.abs(a.astype(np.int16) - bg[:, None, :].astype(np.int16)), axis=2)
    raw_mask = delta > 12
    mask_image = Image.fromarray((raw_mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    mask = np.asarray(mask_image) > 0
    first_gap = next(((s, e) for s, e in runs(mask.mean(axis=1) < .025, 12) if s * scale > 1200 and s * scale < 4000), None)
    cover_end = first_gap[0] if first_gap else round(2300 / scale)
    white = (np.min(bg, axis=1) >= 210) & (np.max(bg,axis=1).astype(int)-np.min(bg,axis=1).astype(int)<45)
    ending_start = h
    for start, end in runs(white, round(800 / scale), gap=round(60 / scale)):
        if start > h * .75 and end > h * .94:
            ending_start = start
            break
    tops, bottoms = [], []
    for y in range(cover_end + 1, ending_start):
        add = mask[y] & ~mask[y-1]
        remove = mask[y-1] & ~mask[y]
        if add.sum() >= 105:
            tops.extend((y, l, r) for l, r in runs(add, 105, gap=4))
        if remove.sum() >= 105:
            bottoms.extend((y, l, r) for l, r in runs(remove, 105, gap=4))
    boxes = []
    full_width=[]
    a16=a.astype(np.int16)
    texture=np.mean(np.abs(a16[1:]-a16[:-1]),axis=2)
    left_texture=np.pad(texture[:,:12].mean(axis=1)>1.8,(1,0))
    right_texture=np.pad(texture[:,-12:].mean(axis=1)>1.8,(1,0))
    for top,bottom in runs(left_texture & right_texture, 160, gap=25):
        if top>cover_end+40 and bottom<ending_start and bottom-top<2100:
            full_width.append((3.5,0,top,w,bottom-top))
    for ty, left, right in tops:
        options = []
        for by, bl, br in bottoms:
            if not 80 <= by - ty <= 2100:
                continue
            if abs(left - bl) > 7 or abs(right - br) > 7:
                continue
            l, r = round((left + bl) / 2), round((right + br) / 2)
            inside = mask[ty+3:by-3, l+3:r-3].mean()
            edge = (mask[ty+3:by-3, l:min(l+3,r)].mean() + mask[ty+3:by-3, max(l,r-3):r].mean()) / 2
            outside_l = mask[ty+3:by-3, max(0,l-5):l].mean() if l >= 5 else 0
            outside_r = mask[ty+3:by-3, r:min(w,r+5)].mean() if r <= w-5 else 0
            outside = (outside_l + outside_r) / 2
            if inside < .84 or edge < .62 or outside > .62:
                continue
            score = inside + edge - outside + min(by-ty, 500) / 5000
            options.append((score, l, ty, r-l, by-ty))
        if options:
            boxes.append(max(options))
    # Speech bubbles can obscure horizontal borders. Persistent vertical sides
    # recover those frames without treating the bubble outline as the frame.
    left_edges = mask & ~np.pad(mask[:, :-1], ((0, 0), (1, 0)))
    right_edges = mask & ~np.pad(mask[:, 1:], ((0, 0), (0, 1)))
    lefts, rights = [], []
    for x in range(w):
        lefts.extend((x,s,e) for s,e in runs(left_edges[:, x], 90, gap=36) if s > cover_end and e < ending_start)
        rights.extend((x+1,s,e) for s,e in runs(right_edges[:, x], 90, gap=36) if s > cover_end and e < ending_start)
    for left, ly, le in lefts:
        for right, ry, re in rights:
            if not 105 <= right-left <= w or (abs(ly-ry)>85 and abs(le-re)>85):
                continue
            ty, by = min(ly,ry), max(le,re)
            near_top=[t for t in tops if abs(t[1]-left)<8 and abs(t[2]-right)<8 and abs(t[0]-ty)<85]
            near_bottom=[b for b in bottoms if abs(b[1]-left)<8 and abs(b[2]-right)<8 and abs(b[0]-by)<85]
            if near_top: ty=min(near_top,key=lambda t:abs(t[0]-ty))[0]
            if near_bottom: by=min(near_bottom,key=lambda t:abs(t[0]-by))[0]
            if not 80 <= by-ty <= 2100:
                continue
            inside=mask[ty+3:by-3,left+3:right-3].mean()
            edge=(mask[ty+3:by-3,left:min(left+3,right)].mean()+mask[ty+3:by-3,max(left,right-3):right].mean())/2
            ol=mask[ty+3:by-3,max(0,left-5):left].mean() if left>=5 else 0
            orr=mask[ty+3:by-3,right:min(w,right+5)].mean() if right<=w-5 else 0
            outside=(ol+orr)/2
            left_density=left_edges[ty:by,left].mean()
            right_density=right_edges[ty:by,right-1].mean()
            if inside>.84 and edge>.7 and ol<.48 and orr<.48 and left_density>.52 and right_density>.52:
                boxes.append((inside+edge-outside+.1,left,ty,right-left,by-ty))
    for candidate in full_width:
        _,cx,cy,cw,ch=candidate
        boxes=[b for b in boxes if not (b[1]<5 and b[3]>w-8 and abs(b[2]-cy)<85 and min(b[2]+b[4],cy+ch)>max(b[2],cy))]
    boxes.extend(full_width)
    # Repeated anti-alias/border events produce near-identical rectangles.
    kept = []
    for score, x, y, bw, bh in sorted(boxes, reverse=True):
        duplicate = False
        for b in kept:
            inter = max(0,min(x+bw,b[0]+b[2])-max(x,b[0])) * max(0,min(y+bh,b[1]+b[3])-max(y,b[1]))
            union = bw*bh+b[2]*b[3]-inter
            if inter / union > .85:
                duplicate = True
                break
        if not duplicate:
            kept.append((x,y,bw,bh,score))
    # A balloon crossing one side can split a single vertical border in two.
    # Merge only when the putative gap still contains image, rather than gutter.
    changed=True
    while changed:
        changed=False
        for i,a_box in enumerate(kept):
            for j,b_box in enumerate(kept):
                if i>=j or abs(a_box[0]-b_box[0])>5 or abs(a_box[2]-b_box[2])>8:
                    continue
                first,second=sorted((a_box,b_box),key=lambda b:b[1])
                gap=second[1]-(first[1]+first[3])
                if gap>70 or second[1]+second[3]-first[1]>2100:
                    continue
                y0,y1=first[1]+first[3],second[1]
                if gap>0 and mask[y0:y1,first[0]+4:first[0]+first[2]-4].mean()<.7:
                    continue
                merged=(min(first[0],second[0]),first[1],max(first[2],second[2]),max(first[1]+first[3],second[1]+second[3])-first[1],max(first[4],second[4]))
                kept=[v for k,v in enumerate(kept) if k not in (i,j)]+[merged]
                changed=True
                break
            if changed: break
    kept.sort(key=lambda b:(b[1],b[0]))
    kept=[b for b in kept if b[3] >= b[2]*.36]
    frames = [{"referenceFrameId":f"R{i+1:03d}","x":round(x*scale),"y":round(y*scale),"w":round(bw*scale),"h":round(bh*scale),"detection":"rectangle-edge-candidate","review":"pending"} for i,(x,y,bw,bh,score) in enumerate(kept)]
    return {"sourceWidth":width,"sourceHeight":height,"sourceSha256":hashlib.sha256(source.read_bytes()).hexdigest(),"measurement":"Flat-image boundary measurement; not original project coordinates","coverEnd":round(cover_end*scale),"endingStart":round(ending_start*scale),"frames":frames}, small


def preview(data, small, target):
    overlay = small.copy()
    d = ImageDraw.Draw(overlay)
    factor = small.width / data["sourceWidth"]
    for i, b in enumerate(data["frames"]):
        x,y,w,h = (round(b[k]*factor) for k in ("x","y","w","h"))
        color = "#12ff96"
        d.rectangle((x,y,x+w,y+h),outline=color,width=3)
        d.rectangle((x,y,x+56,y+20),fill="#083d2b")
        d.text((x+3,y+3),b["referenceFrameId"],fill="white")
    tile_height = 1500
    count = (overlay.height+tile_height-1)//tile_height
    cols = 4
    sheet = Image.new("RGB",(cols*320,((count+cols-1)//cols)*780),"#ddd")
    for i in range(count):
        tile=overlay.crop((0,i*tile_height,640,min((i+1)*tile_height,overlay.height)))
        tile=tile.resize((320,round(tile.height/2)))
        x,y=i%cols*320,i//cols*780
        ImageDraw.Draw(sheet).text((x+8,y+5),f"{i+1}: y={round(i*tile_height/factor)}",fill="black")
        sheet.paste(tile,(x,y+25))
    sheet.save(target,quality=92)


if __name__ == "__main__":
    p=argparse.ArgumentParser()
    p.add_argument("episodes",nargs="*",type=int,default=list(range(21,26)))
    args=p.parse_args()
    for episode in args.episodes:
        data, small=measure(ROOT/f"dazhou-ep{episode}-recommended.png")
        data["episode"]=episode
        (ROOT/f"ep{episode}-geometry.json").write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
        preview(data,small,ROOT/f"ep{episode}-geometry-review.jpg")
        print(json.dumps({"episode":episode,"candidates":len(data["frames"]),"coverEnd":data["coverEnd"],"endingStart":data["endingStart"]}),flush=True)
