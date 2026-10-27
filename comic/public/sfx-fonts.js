// Uses an installed Windows KaiTi face only. No font binary is copied or downloaded.
export const SFX_BRUSH_TYPEFACE='brush-kaiti';
export const SFX_BRUSH_FAMILY='"Comic SFX KaiTi", "KaiTi", "Source Han Serif SC", "SimSun", serif';
export function sfxFontFamily(bubble,fallback){return bubble?.type==='sfx'&&bubble.sfxLibrary===true&&bubble.sfxTypeface===SFX_BRUSH_TYPEFACE?SFX_BRUSH_FAMILY:fallback;}
const loads=new WeakMap();
export function loadSfxBrushFont(doc=globalThis.document){
 if(loads.has(doc))return loads.get(doc);
 const result=(async()=>{try{
  const Face=doc.defaultView?.FontFace||globalThis.FontFace;
  const face=await new Face('Comic SFX KaiTi','local("KaiTi")',{style:'normal',weight:'400'}).load();
  doc.fonts.add(face);return {available:true,family:'KaiTi',label:'已验证本机楷体 · 毛笔楷书笔触'};
 }catch{return {available:false,family:'Source Han Serif SC',label:'未找到本机楷体，退回思源宋体；当前不是毛笔字体'};}})();
 loads.set(doc,result);return result;
}
