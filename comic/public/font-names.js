export function fontNameInChinese(name,index=1){
 const text=String(name||'').replace(/\.(?:otf|ttf|ttc|woff2?)$/i,'');
 if(/[\u3400-\u9fff]/.test(text))return text;
 const known=[[/source[ -]?han[ -]?sans|sourcehansans|noto[ -]?sans.*(?:sc|cjk)/i,'思源黑体'],[/source[ -]?han[ -]?serif|sourcehanserif|noto[ -]?serif.*(?:sc|cjk)/i,'思源宋体'],[/microsoft[ -]?yahei|msyh/i,'微软雅黑'],[/simsun/i,'宋体'],[/simhei/i,'黑体'],[/fangsong/i,'仿宋'],[/kaiti|simkai/i,'楷体'],[/arial/i,'无衬线体'],[/times[ -]?new[ -]?roman/i,'罗马衬线体'],[/comic[ -]?sans/i,'漫画手写体']];
 return known.find(([pattern])=>pattern.test(text))?.[1]||'网盘字体 '+index;
}
