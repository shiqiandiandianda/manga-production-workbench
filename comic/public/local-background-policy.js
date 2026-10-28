/** User-confirmed background logic; independent of the episode's frozen layout contract. */
export const LOCAL_BACKGROUND_POLICY=Object.freeze({version:'story-color-evidence-v2',referenceEpisodes:[21,22,23,24,25],neutral:'#d9d7d1',principles:[
 '按剧情段落综合人物、衣料、环境和光线选择衬底；不由黑衣推定黑底。',
 '同场景连贯，仅在实际主色变化时调整，不逐格换色或固定整话单色。',
 '渐变连接前后两段实际颜色，不固定白到黑，不因转场变暗。',
 '渐变只放已有安全留白，避开正文、文字、气泡及泡尾，不增大间隙。',
 '黑底只用于已确认的特殊回忆；深色也须有画面依据。',
 '参考21—25话的配色逻辑，不复制色值，不取整话平均色，排除气泡、标注及外围底色。',
 '依据不足标主色待确认；脚本和同场景参考预配不得冒称成图实测。']});
export const COLOR_WORDS=Object.freeze([
 ['黑色|乌黑|漆黑|墨黑|黑衣','black','#000000'],['白色|雪白|乳白|白衣','white','#ededdf'],
 ['深蓝|藏蓝|靛蓝|蓝黑','blue','#314b67'],['浅蓝|天蓝|湖蓝|湛蓝|蓝色|蓝衣','blue','#7ba6c2'],
 ['青灰|蓝灰|灰蓝','blue','#708594'],['青绿|碧绿|翠绿|墨绿|绿色|绿衣','green','#718c73'],
 ['朱红|绯红|赤红|鲜红|红色|红衣','red','#a8564e'],['橙色|橘色|暖橙','orange','#bd8359'],
 ['金色|金黄|鹅黄|黄色|黄衣','yellow','#b8a269'],['棕色|褐色|木色|赭色','brown','#987c64'],
 ['粉色|粉红','pink','#bd929e'],['紫色|紫红|紫衣','purple','#8f7a9d'],['银灰|灰色|灰白','gray','#a3a4a1']]);
export const colorRGB=color=>/^#[a-f\d]{6}$/i.test(color||'')?[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)):null;
export function colorFamily(color){
 const rgb=colorRGB(color);if(!rgb)return null;const [r,g,b]=rgb.map(x=>x/255),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
 if(delta<.07)return max<.16?'black':min>.85?'white':'gray';
 let hue=max===r?((g-b)/delta+6)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;hue*=60;
 return hue<18||hue>=345?'red':hue<48?(max<.72?'brown':'orange'):hue<72?'yellow':hue<170?'green':hue<255?'blue':hue<300?'purple':'pink';
}
export const blackLike=color=>{const rgb=colorRGB(color);if(!rgb)return false;const linear=rgb.map(x=>{const c=x/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}),luma=linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;return luma<.045&&Math.max(...rgb)-Math.min(...rgb)<24;};
export function scriptColorCues(shot){
 const rows=[['description',shot.description],['sourceFields.画面内容',shot.sourceFields?.['画面内容']],['sourceFields.构图',shot.sourceFields?.['构图']]],cues=[];
 for(const [field,value]of rows){if(typeof value!=='string')continue;
  for(const [pattern,family,color]of COLOR_WORDS)for(const match of value.matchAll(new RegExp(pattern,'g'))){
   const start=Math.max(0,match.index-10),end=Math.min(value.length,match.index+match[0].length+12),quote=value.slice(start,end);
   if(/(?:不|并非|不是|避免|不要|无)[^，。；]{0,5}$/.test(value.slice(start,match.index)))continue;
   const words=[['clothing',/衣|袍|袖|裙|服|披风|甲/g],['light',/天光|灯光|月光|日光|阳光|光线|光照|霞光|照亮/g],['environment',/天空|海|水|河|湖|墙|木|房|屋|地|林|树|山|雪|云|建筑|庭院|环境|背景|帘/g],['person',/头发|发丝|肤|脸|面庞|眼/g]],at=match.index-start;
   const nearest=words.flatMap(([role,re])=>[...quote.matchAll(re)].map(m=>({role,distance:Math.max(0,m.index-(at+match[0].length),at-(m.index+m[0].length))}))).sort((a,b)=>a.distance-b.distance),role=nearest[0]?.distance<=5?nearest[0].role:null;
   if(role)cues.push({family,color,role,field,quote,origin:'script-explicit-color'});
  }
 }
 return cues.filter((c,i,a)=>a.findIndex(x=>x.family===c.family&&x.role===c.role&&x.quote===c.quote)===i);
}
export function confirmedSpecialFlashback(shot){
 const e=shot.backgroundNarrative?.specialFlashback;
 if(e?.confirmed!==true||typeof e.quote!=='string'||!e.quote.trim()||!/(特殊回忆|已确认.{0,4}回忆|明确.{0,4}闪回)/.test(e.quote))return false;
 return [shot.description,...Object.values(shot.sourceFields||{}).filter(v=>typeof v==='string')].some(v=>v?.includes(e.quote));
}
