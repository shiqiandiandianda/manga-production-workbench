export function maskBounds(mask, width, height) {
  if (mask.length !== width * height) throw new Error('选区尺寸与原图不一致');
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function paddedCrop(bounds, padding, width, height) {
  const p = Math.max(0, Math.round(padding));
  const x = Math.max(0, bounds.x - p), y = Math.max(0, bounds.y - p);
  const right = Math.min(width, bounds.x + bounds.width + p);
  const bottom = Math.min(height, bounds.y + bounds.height + p);
  return { x, y, width: right - x, height: bottom - y };
}

export function cropMask(mask, width, crop) {
  const out = new Uint8ClampedArray(crop.width * crop.height);
  for (let y = 0; y < crop.height; y++) {
    out.set(mask.subarray((crop.y + y) * width + crop.x, (crop.y + y) * width + crop.x + crop.width), y * crop.width);
  }
  return out;
}

// Feather inward only: every pixel outside the human selection stays untouched.
export function featherMask(mask, width, height, radius) {
  if (!radius) return new Uint8ClampedArray(mask);
  const d = new Float32Array(mask.length), diagonal = Math.SQRT2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      d[i] = mask[i] ? Math.min(x + 1, y + 1, width - x, height - y, radius + 1) : 0;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x) d[i] = Math.min(d[i], d[i - 1] + 1);
      if (y) d[i] = Math.min(d[i], d[i - width] + 1);
      if (x && y) d[i] = Math.min(d[i], d[i - width - 1] + diagonal);
      if (y && x < width - 1) d[i] = Math.min(d[i], d[i - width + 1] + diagonal);
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (x < width - 1) d[i] = Math.min(d[i], d[i + 1] + 1);
      if (y < height - 1) d[i] = Math.min(d[i], d[i + width] + 1);
      if (x < width - 1 && y < height - 1) d[i] = Math.min(d[i], d[i + width + 1] + diagonal);
      if (x && y < height - 1) d[i] = Math.min(d[i], d[i + width - 1] + diagonal);
    }
  }
  return Uint8ClampedArray.from(mask, (value, i) => value * Math.min(1, d[i] / radius));
}

export function composite(base, patch, width, height, crop, mask) {
  if (base.length !== width * height * 4 || patch.length !== crop.width * crop.height * 4 || mask.length !== crop.width * crop.height) {
    throw new Error('图像或选区尺寸不匹配');
  }
  if (crop.x < 0 || crop.y < 0 || crop.x + crop.width > width || crop.y + crop.height > height) throw new Error('局部超出原图');
  const out = new Uint8ClampedArray(base);
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const m = y * crop.width + x, src = m * 4, dst = ((crop.y + y) * width + crop.x + x) * 4;
      const a = mask[m] / 255 * patch[src + 3] / 255;
      if (!a) continue;
      const ba = base[dst + 3] / 255, oa = a + ba * (1 - a);
      for (let channel = 0; channel < 3; channel++) out[dst + channel] = (patch[src + channel] * a + base[dst + channel] * ba * (1 - a)) / oa;
      out[dst + 3] = oa * 255;
    }
  }
  return out;
}

export function aspectMismatch(inputWidth, inputHeight, crop) {
  return Math.abs((inputWidth / inputHeight) / (crop.width / crop.height) - 1) > 0.025;
}
export function ratioUnits(name) {
  const ratio = {'1:1':[1,1], '16:9':[16,9], '9:16':[9,16]}[name];
  if (!ratio) throw new Error('框选比例只能是 1:1、16:9 或 9:16');
  return ratio;
}

export function fixedRatioRect(start, end, name, width, height) {
  const [rw,rh] = ratioUnits(name);
  const ax = Math.max(0,Math.min(width,Math.floor(start.x))), ay = Math.max(0,Math.min(height,Math.floor(start.y)));
  const sx = end.x < start.x ? -1 : 1, sy = end.y < start.y ? -1 : 1;
  const available = Math.floor(Math.min((sx > 0 ? width-ax : ax)/rw, (sy > 0 ? height-ay : ay)/rh));
  const units = Math.min(available,Math.round(Math.max(Math.abs(end.x-start.x)/rw,Math.abs(end.y-start.y)/rh)));
  const w = Math.max(0,units)*rw, h = Math.max(0,units)*rh;
  return {x:sx > 0 ? ax : ax-w, y:sy > 0 ? ay : ay-h, width:w,height:h};
}

export function fixedRatioCrop(bounds, padding, name, width, height) {
  const [rw,rh] = ratioUnits(name);
  const required = Math.ceil(Math.max(bounds.width/rw,bounds.height/rh));
  const maximum = Math.floor(Math.min(width/rw,height/rh));
  if (required > maximum) throw new Error('选区无法放进所选比例框，请重新框选');
  const units = Math.min(maximum,Math.ceil(Math.max((bounds.width+2*padding)/rw,(bounds.height+2*padding)/rh)));
  const w = Math.max(required,units)*rw, h = Math.max(required,units)*rh;
  let x = Math.round(bounds.x+(bounds.width-w)/2), y = Math.round(bounds.y+(bounds.height-h)/2);
  x = Math.max(0,Math.min(width-w,x)); y = Math.max(0,Math.min(height-h,y));
  return {x,y,width:w,height:h};
}
export function moveFixedFrame(frame,dx,dy,width,height){return{...frame,x:Math.max(0,Math.min(width-frame.width,frame.x+Math.round(dx))),y:Math.max(0,Math.min(height-frame.height,frame.y+Math.round(dy)))};}
// Three running box blurs approximate a Gaussian feather, including both sides.
export function gaussianMask(mask,width,height,radius) {
  if(!radius)return new Uint8ClampedArray(mask);
  const ideal=Math.sqrt(4*radius*radius+1);let lower=Math.floor(ideal);if(lower%2===0)lower--;
  const upper=lower+2,count=Math.floor((12*radius*radius-3*lower*lower-12*lower-9)/(-4*lower-4)+.5);
  let data=Float64Array.from(mask);
  for(let pass=0;pass<3;pass++){
    const size=pass<count?lower:upper,r=(size-1)/2,temp=new Float64Array(data.length),out=new Float64Array(data.length);
    for(let y=0;y<height;y++){
      let sum=0;const row=y*width;for(let x=0;x<=Math.min(r,width-1);x++)sum+=data[row+x];
      for(let x=0;x<width;x++){temp[row+x]=sum/size;if(x-r>=0)sum-=data[row+x-r];if(x+r+1<width)sum+=data[row+x+r+1];}
    }
    for(let x=0;x<width;x++){
      let sum=0;for(let y=0;y<=Math.min(r,height-1);y++)sum+=temp[y*width+x];
      for(let y=0;y<height;y++){out[y*width+x]=sum/size;if(y-r>=0)sum-=temp[(y-r)*width+x];if(y+r+1<height)sum+=temp[(y+r+1)*width+x];}
    }
    data=out;
  }
  return Uint8ClampedArray.from(data);
}

// Shared navigation for the main image and annotation viewport.
export function bindWheelNavigation(element,{blocked=()=>false,onPan,onZoom}){
  const handler=event=>{
    event.preventDefault();event.stopPropagation();if(blocked())return;
    const unit=event.deltaMode===1?16:event.deltaMode===2?element.clientHeight:1;
    const x=event.deltaX*unit,y=event.deltaY*unit;
    if(event.ctrlKey){if(y)onZoom(Math.exp(-Math.max(-240,Math.min(240,y))*.002),event);}
    else if(x||y)onPan(x,y);
  };
  element.addEventListener('wheel',handler,{passive:false});return handler;
}

export function ratioFrameAtCenter(frame,ratio,pageWidth,pageHeight){
 const [rw,rh]=ratio.split(':').map(Number),unit=Math.max(1,Math.min(Math.round(Math.sqrt(frame.width*frame.height/(rw*rh))),Math.floor(pageWidth/rw),Math.floor(pageHeight/rh))),width=unit*rw,height=unit*rh;
 return{x:Math.max(0,Math.min(pageWidth-width,Math.round(frame.x+frame.width/2-width/2))),y:Math.max(0,Math.min(pageHeight-height,Math.round(frame.y+frame.height/2-height/2))),width,height};
}
