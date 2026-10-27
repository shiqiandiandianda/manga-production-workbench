// Detect copies and mirrors. Passing is not proof of correct spatial geometry.
export const SCENE_SIGNATURE={width:96,height:54};
function correlation(a,b){
 let sa=0,sb=0,saa=0,sbb=0,sab=0;const n=a.length;
 for(let i=0;i<n;i++){sa+=a[i];sb+=b[i];saa+=a[i]*a[i];sbb+=b[i]*b[i];sab+=a[i]*b[i];}
 const va=saa-sa*sa/n,vb=sbb-sb*sb/n;
 return va/n<1||vb/n<1?0:(sab-sa*sb/n)/Math.sqrt(va*vb);
}
function edges(a,width,height){const out=[];for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=y*width+x;out.push(a[i+1]-a[i-1],a[i+width]-a[i-width]);}return out;}
export function assessSceneReverse(front,reverse,{width,height}=SCENE_SIGNATURE){
 if(front.length!==width*height||reverse.length!==front.length)throw Error('场景校验图尺寸无效');
 const scores=[];
 for(const mirrored of [false,true]){
  const projected=new Float32Array(front.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++)projected[y*width+x]=front[y*width+(mirrored?width-1-x:x)];
  let gap=0;for(let i=0;i<front.length;i++)gap+=Math.abs(projected[i]-reverse[i]);gap/=front.length;
  const toneCorrelation=correlation(projected,reverse),edgeCorrelation=correlation(edges(projected,width,height),edges(reverse,width,height));
  scores.push({mirrored,gap,toneCorrelation,edgeCorrelation,duplicate:gap<=2.5||toneCorrelation>=0.985&&edgeCorrelation>=0.94});
 }
 const hit=scores.filter(s=>s.duplicate).sort((a,b)=>a.gap-b.gap)[0];
 return {version:2,status:hit?'rejected':'passed-duplicate-check',reason:hit?(hit.mirrored?'反打结果是正视图的水平镜像或其轻微重绘':'反打结果复用了正视图或其轻微重绘'):'',scores};
}
