import {FONT_FAMILIES,normalizeBubbleStyle,bubbleLayout,svgBubbleMarkup} from './lettering.js';

export const TYPOGRAPHY_DEFAULT={fontFamily:'source-han-sans',fontSize:48,fontWeight:400,letterSpacing:0,lineHeight:1.32,textColor:'#171b20',textAlign:'center',writingMode:'horizontal',textDirection:'ltr',padding:28};
export const TYPOGRAPHY_FIELDS=Object.keys(TYPOGRAPHY_DEFAULT);
export const FONT_LABELS={'source-han-sans':'思源黑体','source-han-serif':'思源宋体','system-sans':'系统黑体','system-serif':'系统宋体'};
const WEIGHTS={300:'细体',400:'常规',500:'中等',600:'半粗',700:'加粗',800:'特粗',900:'重体'};
const fail=message=>{throw Object.assign(new Error(message),{status:400});};

export function validateTypography(input){
  if(!input||!Object.hasOwn(FONT_FAMILIES,input.fontFamily))fail('请选择支持的字体');
  const value={...TYPOGRAPHY_DEFAULT,...Object.fromEntries(TYPOGRAPHY_FIELDS.filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]]))};
  for(const [key,min,max,label] of [['fontSize',1,1024,'字号'],['fontWeight',100,900,'字重'],['letterSpacing',-10,64,'字间距'],['lineHeight',.8,3,'行距倍率'],['padding',0,96,'文字内边距']]){
    value[key]=Number(value[key]);if(!Number.isFinite(value[key])||value[key]<min||value[key]>max)fail(label+'须为 '+min+'–'+max);
  }
  if(!Number.isInteger(value.fontSize)||!Number.isInteger(value.fontWeight)||value.fontWeight%100||!Number.isInteger(value.padding))fail('字号、字重和内边距须为有效整数，字重以 100 为步长');
  if(!/^#[a-f0-9]{6}$/i.test(value.textColor||''))fail('文字颜色须为 #RRGGBB 格式');
  value.textColor=value.textColor.toLowerCase();
  if(!['left','center','right'].includes(value.textAlign)||!['horizontal','vertical'].includes(value.writingMode)||!['ltr','rtl'].includes(value.textDirection))fail('文字对齐、排列或书写方向无效');
  return value;
}
export function readTypographyDefaults(){try{return validateTypography(JSON.parse(globalThis.localStorage?.getItem('comic-unified-typography')||'null'));}catch{return null;}}
export function rememberTypography(input){const value=validateTypography(input);globalThis.localStorage?.setItem('comic-unified-typography',JSON.stringify(value));return value;}
export function projectTypography(project){
  const first=project?.pages?.flatMap(page=>page.bubbles||[]).find(bubble=>['speech','thought','caption'].includes(bubble.type));
  const value={...TYPOGRAPHY_DEFAULT,...(first?normalizeBubbleStyle(first):{}),...project?.typography};
  if(value.fontSize<1||value.fontSize>1024)value.fontSize=TYPOGRAPHY_DEFAULT.fontSize;
  value.letterSpacing=Math.min(64,Math.max(-10,value.letterSpacing));value.padding=Math.min(96,Math.max(0,value.padding));
  try{return validateTypography(value);}catch{return {...TYPOGRAPHY_DEFAULT};}
}
export function applyProjectTypography(project,input){
  const value=validateTypography(input);let changed=0,locked=0;
  for(const page of project.pages){for(const bubble of page.bubbles||[]){
    if(!['speech','thought','caption'].includes(bubble.type))continue;
    if(bubble.locked){locked++;continue;}
    if(TYPOGRAPHY_FIELDS.some(key=>bubble[key]!==value[key])){Object.assign(bubble,value);changed++;}
  }}
  project.typography={...value};
  return {changed,locked};
}

export function typographyMarkup(value,prefix,{scope=false,projectCount=0,trial=false}={}){
  const config=validateTypography({...TYPOGRAPHY_DEFAULT,...value});
  const select=(key,label,choices)=>'<label>'+label+'<select id="'+prefix+'-'+key+'" data-typography-field aria-label="统一'+label+'">'+Object.entries(choices).map(([v,text])=>'<option value="'+v+'" '+(String(config[key])===v?'selected':'')+'>'+text+'</option>').join('')+'</select></label>';
  const number=(key,label,min,max,step=1)=>'<label>'+label+'<input id="'+prefix+'-'+key+'" data-typography-field aria-label="统一'+label+'" type="number" min="'+min+'" max="'+max+'" step="'+step+'" value="'+config[key]+'"></label>';
  return '<section class="unified-typography" data-typography-panel><div class="typography-heading"><div><strong>统一字体</strong><small>对白 · 心声 · 旁白</small></div><button type="button" data-typography-reset>恢复默认</button></div>'
    +'<div class="typography-fields">'+select('fontFamily','字体',FONT_LABELS)+number('fontSize','字号 px',1,1024)
    +select('fontWeight','字重 / 粗细',{...WEIGHTS,...(!Object.hasOwn(WEIGHTS,config.fontWeight)?{[config.fontWeight]:String(config.fontWeight)}:{})})
    +'<label>文字颜色<div class="typography-color"><input id="'+prefix+'-textColor" data-typography-field type="color" value="'+config.textColor+'" aria-label="统一文字颜色"><input id="'+prefix+'-textColorHex" data-typography-field type="text" value="'+config.textColor+'" maxlength="7" spellcheck="false" aria-label="统一颜色 HEX"></div></label>'
    +number('letterSpacing','字间距 px',-10,64,.5)+number('lineHeight','行距 × 字号',.8,3,.05)+'</div>'
    +'<div class="typography-preview" data-typography-preview aria-label="字体预览"></div>'
    +'<details class="typography-advanced"><summary>更多排版：对齐、横竖排、内边距</summary><div class="typography-fields">'+select('textAlign','文字对齐',{left:'靠左',center:'居中',right:'靠右'})+select('writingMode','文字排列',{horizontal:'横排',vertical:'竖排'})+select('textDirection','书写方向',{ltr:'左到右',rtl:'右到左'})+number('padding','文字内边距 px',0,96)+'</div></details>'
    +(scope?'<label>应用范围<select id="'+prefix+'-scope" aria-label="字体应用范围"><option value="project">当前工程全部画板</option><option value="all">全部已保存话（'+projectCount+' 个工程）</option></select></label>':'')
    +'<p class="typography-note">'+(trial?'本次导入各话沿用同一设置。重新试排会按字重、间距和文字排列计算气泡。':'统一对白、心声和旁白，锁定文字需先解锁。修改间距或排列后，可用“分类 / 重排”调整气泡布局。')+'</p>'
    +(trial?'<div class="typography-actions"><button type="button" data-typography-replan class="primary">应用并重新试排</button><button type="button" data-typography-sync>同步全部已保存话</button></div>':'<button type="button" data-typography-apply class="primary wide">统一应用字体</button>')
    +'</section>';
}
export function readTypography(host,prefix){
  const values=Object.fromEntries(TYPOGRAPHY_FIELDS.map(key=>[key,host.querySelector('#'+prefix+'-'+key)?.value??TYPOGRAPHY_DEFAULT[key]]));
  const hex=host.querySelector('#'+prefix+'-textColorHex');if(hex)values.textColor=hex.value;
  return validateTypography(values);
}
export function syncTypographyInput(host,prefix,target){
  const picker=host.querySelector('#'+prefix+'-textColor'),hex=host.querySelector('#'+prefix+'-textColorHex');
  if(target.id===prefix+'-textColor')hex.value=picker.value;
  if(target.id===prefix+'-textColorHex'&&/^#[a-f0-9]{6}$/i.test(hex.value))picker.value=hex.value;
}
export function resetTypography(host,prefix){
  for(const key of TYPOGRAPHY_FIELDS)host.querySelector('#'+prefix+'-'+key).value=TYPOGRAPHY_DEFAULT[key];
  host.querySelector('#'+prefix+'-textColorHex').value=TYPOGRAPHY_DEFAULT.textColor;paintTypographyPreview(host,prefix);return {...TYPOGRAPHY_DEFAULT};
}
export function renderTypographyPreview(context,input,width=240){
  const value=validateTypography(input),scale=2.5,bubble={...value,id:'typography-preview',text:'月色如水\n我们出发吧。',type:'speech',shape:'none',x:0,y:0,w:Math.max(150,width),h:100,fontSize:value.fontSize/scale,letterSpacing:value.letterSpacing/scale,padding:value.padding/scale,outlineWidth:0,visible:true,overflow:'visible',tail:{visible:false}};
  let layout=bubbleLayout(context,bubble);for(let attempt=0;attempt<16&&layout.overflow;attempt++){bubble.h=Math.ceil(bubble.h*1.2+10);layout=bubbleLayout(context,bubble);}
  return {width:bubble.w,height:bubble.h,layout,markup:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+bubble.w+' '+bubble.h+'" width="'+bubble.w+'" height="'+bubble.h+'" role="img" aria-label="字形与间距预览">'+svgBubbleMarkup(context,bubble)+'</svg>'};
}
export function paintTypographyPreview(host,prefix){
  const preview=host.querySelector('[data-typography-preview]');if(!preview)return;
  const value=readTypography(host,prefix),context=document.createElement('canvas').getContext('2d');
  const rgb=value.textColor.match(/[a-f0-9]{2}/g).map(v=>parseInt(v,16));preview.style.background=(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722)>145?'#172633':'#edf3f7';
  preview.innerHTML=renderTypographyPreview(context,value,Math.max(150,preview.clientWidth-24)).markup;
}
