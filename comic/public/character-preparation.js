// Production readiness is source evidence, not a costume or a physical form.
// Keep the stored wording and need IDs intact; canonicalize only requirement grouping.
export function characterPreparationNote(value){
 const text=typeof value==='string'?value.trim():'';
 if(!text)return '';
 const readiness=/^(?:具体款式待绑定(?:[；;，,]|$)|文字设计存在|已有文字(?:设计|设定)|仅有文字(?:设计|设定)|(?:实际)?(?:人物)?(?:母版|参考图|设定图|图片|图像版本)(?:尚未提供|未提供|待提供|待绑定)|待(?:提供|绑定)(?:实际)?(?:人物)?(?:母版|参考图|设定图|图片))/u.test(text);
 // A mixed note with an explicit costume must remain a separate requirement.
 const costume=/(?:[黑白青灰红蓝紫黄]色?[衣袍衫裙甲])|长衫|儒衫|官服|长袍|衣袍|衣裙|斗篷|甲胄|夜行衣|劲装|便服|礼服|战甲|尸体|死亡|受伤|重伤|包扎|血迹/u.test(text);
 return readiness&&!costume?text:'';
}
export function characterRequirementState(value){
 const text=typeof value==='string'?value.trim():'';
 return !text||characterPreparationNote(text)||/^(?:未知(?:（待确认）)?|服装未指定|未指定(?:（待确认）)?)$/u.test(text)?'未知（待确认）':text;
}
export function importedCharacterState(...values){
 return values.find(value=>typeof value==='string'&&value.trim()&&!characterPreparationNote(value))?.trim()||'';
}
