const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const value=v=>v===null?'∅':JSON.stringify(v);
export function layoutHistoryRecordMarkup(record,{objectId=''}={}){
  return record.changes.filter(c=>!objectId||c.objectId===objectId||c.pageId===objectId||c.sourceShotId===objectId).map(c=>
    `<section><p><strong>${esc(c.objectType)} · ${esc(c.objectId)}</strong> · ${esc(c.action)}<br>画板 ${esc(c.pageId??'—')} · 源分镜 ${esc(c.sourceShotCode??c.sourceShotId??'—')}<br>模板 ${esc(c.templateId??'未知')} / 版本 ${esc(c.templateVersion??'未知')}${c.copiedFromId?'<br>复制来源 '+esc(c.copiedFromId):''}</p>`+
    '<table style="width:100%;table-layout:fixed"><thead><tr><th>字段</th><th>之前</th><th>之后</th></tr></thead><tbody>'+c.fields.map(f=>`<tr><td style="overflow-wrap:anywhere">${esc(f.field)}</td><td style="overflow-wrap:anywhere">${esc(value(f.before))}</td><td style="overflow-wrap:anywhere">${esc(value(f.after))}</td></tr>`).join('')+'</tbody></table></section>').join('');
}
