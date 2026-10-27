/** Imported row hints describe a layout, not pauses in the dialogue. */
export function joinDialogueLines(value){
 return String(value??'').replace(/\r\n?|\u2028|\u2029/g,'\n').replace(/(?<=[A-Za-z0-9,.;:!?])\n+(?=[A-Za-z0-9])/g,' ').replace(/\n+/g,'');
}
export function productionTextContent(record){
 const source=typeof record?.['文本']==='string'?record['文本']:(record?.['分行']||[]).join('\n');
 // Artistic lettering can intentionally use rows; regular dialogue wraps to its frame.
 return /特效|拟声|音效/.test(record?.['类型']||'')?source:joinDialogueLines(source);
}
