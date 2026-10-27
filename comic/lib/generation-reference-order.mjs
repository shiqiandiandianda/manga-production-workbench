// Prepare only the submitted copy; project prompts, selections and source records remain intact.
const key=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\.(png|jpe?g|webp)$/i,'').replace(/[\s·・_|｜()（）【】\[\]：:，,。；;、\-]/gu,'');
const failure=message=>Object.assign(Error(message),{status:409,code:'prompt_reference_mismatch'});

export function stripPromptAspect(text){
 return String(text||'')
  .replace(/(?:整屏|整幅|画布)?\s*(?:宽\s*[:：]\s*高|宽高比|画幅比例|画面比例|图片比例|图像比例|画幅)\s*(?:为|是|设为|设置为|采用|使用|[:：])?\s*\d+(?:\.\d+)?\s*[:：/]\s*\d+(?:\.\d+)?/gu,'')
  .replace(/\d+(?:\.\d+)?\s*[:：/]\s*\d+(?:\.\d+)?\s*(?:横版|竖版|横幅|竖幅)/gu,'')
  .replace(/(?:横版|竖版|横幅|竖幅)\s*\d+(?:\.\d+)?\s*[:：/]\s*\d+(?:\.\d+)?/gu,'')
  .replace(/，(?=[，。；;])/gu,'');
}

function matching(name,items){
 const n=key(name); if(!n)return [];
 const exact=items.filter(x=>key(x.name)===n);if(exact.length)return exact;
 const raw=String(name).normalize('NFKC').trim().toLowerCase();
 return items.filter(x=>{const v=String(x.name||'').normalize('NFKC').trim().toLowerCase();return v.startsWith(raw)&&/^[\s·|_\-(（【\[]/u.test(v.slice(raw.length));});
}

export function prepareGenerationReferences(input,files){
 // Asset cards and transparent foreground have their own contracts and reference conventions.
 if(input.editScope==='full-image'||input.kind&&input.kind!=='panel'||['scene','prop'].includes(input.shot?.assetVisualContract?.role))return {input,referenceFiles:files};
 const roles=input.referenceRoles||[];
 const source=String(input.shot?.productionPrompt||input.shot?.description||'');
 // Legacy provider clients may submit unnamed references without any numbered claims.
 if(!roles.length&&files.length&&!/图\s*\d+/u.test(source))return {input:{...input,shot:{...input.shot,productionPrompt:stripPromptAspect(source),description:stripPromptAspect(source)}},referenceFiles:files};
 if(roles.length!==files.length)throw failure('参考图片与参考清单数量不一致，请重新选择后再生成');
 const declarations=[...source.matchAll(/图\s*(\d+)\s*(?:是|为|代表|[:：])\s*([^，,、。；;\n]+?)(?=\s*(?:[，,、。；;\n]|$))/gu)];
 const images=roles.map((role,index)=>({...role,_index:index}));
 const texts=input.textAssetReferences||[];const used=new Set(),mapping=new Map(),parts=[];
 for(const m of declarations){
  const number=Number(m[1]),name=m[2].trim();
  if(mapping.has(number))throw failure('提示词中图'+number+'重复定义，请检查图号与参考名称');
  const found=matching(name,images),textFound=matching(name,texts);
  if(found.length>1||(!found.length&&textFound.length>1))throw failure('图'+number+'“'+name+'”对应多个参考，请明确选择');
  if(found.length){const ref=found[0];if(used.has(ref._index))throw failure('多个图号指向同一张参考图：'+name);used.add(ref._index);parts.push(ref);mapping.set(number,{name,index:parts.length});}
  else if(textFound.length)mapping.set(number,{name,text:true});
  else throw failure('图'+number+'“'+name+'”没有对应的已选参考图或文字资产，请先绑定');
 }
 for(const ref of images)if(!used.has(ref._index))parts.push(ref);
 const offset=input.action==='edit'?1:0;
 let prompt=stripPromptAspect(source);
 if(declarations.length){
  // Replace declarations and other mentions in one pass so swaps never cascade.
  prompt=stripPromptAspect(source).replace(/图\s*(\d+)\s*(?:是|为|代表|[:：])\s*([^，,、。；;\n]+?)(?=\s*(?:[，,、。；;\n]|$))|图\s*(\d+)/gu,(all,n,name,other)=>{
   const number=Number(n||other),m=mapping.get(number);if(!m)throw failure('提示词中的图'+number+'没有对应的参考定义');
   if(name!==undefined)return m.text?`${m.name}按文字资产描述绘制`:`图${m.index+offset}是${m.name}`;
   return m.text?`${m.name}（文字描述）`:`图${m.index+offset}`;
  });
 } else {
  for(const m of prompt.matchAll(/图\s*(\d+)/gu))if(Number(m[1])<1||Number(m[1])>roles.length)throw failure('提示词中的图'+m[1]+'没有对应的已选参考图');
  if(offset)prompt=prompt.replace(/图\s*(\d+)/gu,(_,n)=>'图'+(Number(n)+offset));
 }
 const orderedRoles=parts.map(({_index,...r})=>r),orderedFiles=parts.map(r=>files[r._index]);
 return {input:{...input,shot:{...input.shot,productionPrompt:prompt,description:prompt},referenceRoles:orderedRoles,textAssetReferences:texts.map(r=>({...r,description:stripPromptAspect(r.description)}))},referenceFiles:orderedFiles};
}
