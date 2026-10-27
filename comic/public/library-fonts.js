import {fontNameInChinese} from './font-names.js';
import {FONT_FAMILIES} from './lettering.js';import {FONT_LABELS} from './unified-typography.js';
const loaded=new Map();
export async function loadLibraryFont(font){
 FONT_FAMILIES[font.key]='"'+font.family+'", "Microsoft YaHei", sans-serif';FONT_LABELS[font.key]=fontNameInChinese(font.name,loaded.size+1);
 if(!loaded.has(font.key)){const face=new FontFace(font.family,`url("${font.url}")`);loaded.set(font.key,face.load().then(result=>{document.fonts.add(result);return result;}).catch(error=>{loaded.delete(font.key);throw error;}));}await loaded.get(font.key);return font.key;
}
export async function loadSavedLibraryFonts(api){const result=await api('/api/library/fonts');await Promise.allSettled(result.items.map(loadLibraryFont));}
