/** Convert the structured empty-frame dialect without rewriting any scene prose.
 * The imported source is immutable; the derived variant is labelled separately.
 */
export function cleanPromptVariant(source){
 const text=String(source||'');
 if(!/^(?:屏段编号|单格编号)：/m.test(text)||!/^本格画面：/m.test(text)||!text.includes('空框按工程指定位置和合并样式呈现'))return '';
 const lines=text.split(/\r?\n/).filter(line=>!/^\s*(?:\d+[｜|](?:对白|心声|内心|旁白)[｜|]空框[｜|]|所有对白、心声、旁白仅后期排字|按\d+号字排版容量留框|只绘指定空框|使用合并样式图中的|尾尖指向|尾线|容量：)/.test(line)).map(line=>line.replace(/空框按工程指定位置和合并样式呈现，框内完全留白，禁止生成对白、心声、旁白及占位符；/g,''));
 lines.splice(1,0,'文字处理：画面不绘制气泡、对白框、内心框、旁白框或尾尖；不生成台词、占位符或参考图示例字。保留构图中的排字留白，所有对白、心声与旁白由工具后期摆放。');
 return lines.join('\n');
}
