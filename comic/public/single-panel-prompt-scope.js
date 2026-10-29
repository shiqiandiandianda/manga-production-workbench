import {bounds} from './model.js';

const titles=['一、屏段规格与分格布局','二、实际参考图对应','三、共用画风','四、前情与空间连续性','五、文字处理规则','六、逐格画面提示词','七、跨格与跨屏核对'];
const gridPattern='E\\d+-\\d+';
/** Some imported "single" prompts contain the screen compiler's wrapper.
 * Derive execution text only from an explicitly declared, uniquely keyed grid.
 * Source documents and ordinary / manually edited prompts stay untouched. */
export function singlePanelPromptScope(text,panel){
 const source=panel?.productionGrid||panel?.panelSlice,gridId=source?.panelId;
 if(!gridId||panel.productionSegment||typeof text!=='string'||!/^【一、屏段规格与分格布局】\r?$/mu.test(text))return {text};
 const fail=reason=>({text:'',scopeError:'本格提示词来源需核对：'+reason+'（'+gridId+'）'});
 const headers=[...text.matchAll(/^【([^】\r\n]+)】[ \t]*\r?$/gmu)];
 if(headers.length!==titles.length||headers.some((m,i)=>m[1]!==titles[i]))return fail('屏段模板缺少可识别的单格结构');
 const sections=headers.map((m,i)=>text.slice(m.index+m[0].length,headers[i+1]?.index??text.length).trim());
 const declared=[...sections[0].matchAll(new RegExp('^独立单格[：:]\\s*('+gridPattern+')(?:[；;。\\s]|$)','gmu'))];
 if(declared.length!==1||declared[0][1]!==gridId)return fail('独立单格编号不对应');
 const shots=[...sections[5].matchAll(new RegExp('^第\\d+格〔('+gridPattern+')〕[：:]','gmu'))];
 if(shots.length!==1||shots[0][1]!==gridId||shots[0].index!==0)return fail('画面内容没有唯一对应本格');
 const references=[...sections[1].matchAll(/使用格号[：:]([^。\r\n）)]+)/gu)];
 if(references.some(m=>[...m[1].matchAll(new RegExp(gridPattern,'gu'))].some(id=>id[0]!==gridId)))return fail('参考清单混入其他格');
 const box=Array.isArray(panel.points)&&panel.points.length?bounds(panel):panel,width=Math.round(box.w),height=Math.round(box.h);
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1)return fail('单格尺寸无效');
 const drawing=sections[5].slice(shots[0][0].length).trim().split(/\r?\n/u).filter(line=>!/^画格位置与尺寸[：:]/u.test(line)).join('\n');
 if(!/^本格画面[：:]\s*\S/mu.test(drawing))return fail('缺少本格画面描述');
 const style=sections[2].split(/\r?\n/u).filter(line=>line!=='共用要求只写一次，各格不重复堆叠。').join('\n').replaceAll('每格表现一个动作瞬间','本格表现一个动作瞬间').replaceAll('各格剧情','本格剧情');
 const continuity=sections[3].split(/\r?\n/u).filter(line=>!/^进入本屏时的状态[：:]/u.test(line)).join('\n').replace(/^进入本格的前接状态〔[^〕]+〕[：:]/mu,'进入本格前的状态：').replaceAll('不要求每格展示','不要求本格展示');
 const lettering=sections[4].replaceAll('按各格要求','按本格要求').replaceAll('按各格清单','按本格清单');
 return {text:[
  '【单格规格】\n单格编号：'+gridId+'\n画布：'+width+'×'+height+'，宽高比'+width+':'+height+'。\n只生成这一格的一幅完整画面，铺满画布；不拼接其他格，不保留父屏坐标、白缝或外部留白。',
  '【本格画面】\n'+drawing,
  '【本格参考图对应】\n'+sections[1],
  '【画风】\n'+style,
  '【空间与前情】\n以下仅作为本格连续性背景，不绘制前后格。\n'+continuity,
  '【文字处理规则】\n'+lettering
 ].join('\n\n'),scopeAdapted:true};
}
