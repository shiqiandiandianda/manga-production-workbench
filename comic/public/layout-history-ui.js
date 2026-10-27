import {exportLayoutHistory,layoutHistorySummary,queryLayoutHistory,HISTORY_LIMITS} from './layout-history.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceLabels={manual:'人工',automatic:'自动排版',undo:'撤销',redo:'重做',unknown:'未知'};
const value=v=>v===null?'∅':JSON.stringify(v);
export function layoutHistoryRecordMarkup(record,{objectId=''}={}){
  return record.changes.filter(c=>!objectId||c.objectId===objectId||c.pageId===objectId||c.sourceShotId===objectId).map(c=>
    `<section><p><strong>${esc(c.objectType)} · ${esc(c.objectId)}</strong> · ${esc(c.action)}<br>画板 ${esc(c.pageId??'—')} · 源分镜 ${esc(c.sourceShotCode??c.sourceShotId??'—')}<br>模板 ${esc(c.templateId??'未知')} / 版本 ${esc(c.templateVersion??'未知')}${c.copiedFromId?'<br>复制来源 '+esc(c.copiedFromId):''}</p>`+
    '<table style="width:100%;table-layout:fixed"><thead><tr><th>字段</th><th>之前</th><th>之后</th></tr></thead><tbody>'+c.fields.map(f=>`<tr><td style="overflow-wrap:anywhere">${esc(f.field)}</td><td style="overflow-wrap:anywhere">${esc(value(f.before))}</td><td style="overflow-wrap:anywhere">${esc(value(f.after))}</td></tr>`).join('')+'</tbody></table></section>').join('');
}
/** Uses the existing modal and download facilities; no service or image loading. */
export function mountLayoutHistoryUI({getProject,modal,closeModal,download,toast,flushSave=async()=>{},body=()=>document.querySelector('#modal-body')}){
  let filter={objectId:'',operation:'',source:''},offset=0;
  async function exportFile(kind){
    await flushSave();const p=getProject();if(!p)return;
    const text=kind==='json'?JSON.stringify(exportLayoutHistory(p),null,2):layoutHistorySummary(p);
    download(new Blob([text],{type:kind==='json'?'application/json':'text/plain;charset=utf-8'}),p.title+'_排版调整记录.'+(kind==='json'?'json':'txt'));
    toast('调整记录已导出');
  }
  function render(){
    const p=getProject();if(!p)return toast('请先打开工程',true);
    const h=p.layoutHistory,records=queryLayoutHistory(p,{...filter,offset,limit:50}),hasNext=queryLayoutHistory(p,{...filter,offset:offset+50,limit:1}).length>0;
    modal('画板调整记录',`<p>记录已完成操作的前后值。初始基线保留；旧工程从首次启用时的当前布局开始。模板版本缺失时为未知。</p><p>已记录 ${h?.records.length??0} 条；保留上限 ${h?.limits.records??2000} 条 / ${Number(((h?.limits.bytes??HISTORY_LIMITS.bytes)/1024/1024).toFixed(2))} MiB；记录或工程达到保存大小上限时，自动删除最早一半历史记录，保留最新记录，持续循环。当前画面、图片、文字和初始基线保留。</p>`+
      '<p>已自动清理最旧 '+(h?.evictedRecords||0)+' 条；初始基线保留。'+(h?.unrecordedOperations?'旧版本暂停期间有 '+h.unrecordedOperations+' 次操作未记录，现已恢复。':'')+'</p>'+
      '<div class="field-grid"><label>对象 / 画板 / 分镜 ID<input id="adjustment-object" value="'+esc(filter.objectId)+'"></label><label>操作关键词<input id="adjustment-operation" placeholder="move / resize / crop / paste / arrangement" value="'+esc(filter.operation)+'"></label><label>来源<select id="adjustment-source"><option value="">全部</option>'+Object.entries(sourceLabels).map(([key,label])=>'<option value="'+key+'" '+(filter.source===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label></div><button id="adjustment-filter">查询</button> '+
      '<button id="adjustment-prev" '+(!offset?'disabled':'')+'>上一页</button> <button id="adjustment-next" '+(!hasNext?'disabled':'')+'>下一页</button><p>第 '+(Math.floor(offset/50)+1)+' 页，每页最多 50 条；展开操作查看前后变化。</p>'+
      (records.length?records.map(r=>'<details data-adjustment-id="'+esc(r.id)+'"><summary>'+esc(r.at)+' · '+esc(sourceLabels[r.source]||r.source)+' · '+esc(r.operation)+' · '+r.changes.length+' 个对象</summary><div data-adjustment-content></div></details>').join(''):'<p>没有符合条件的记录。</p>'),
      [{label:'导出 JSON',run:()=>exportFile('json')},{label:'导出可读汇总',run:()=>exportFile('txt')},{label:'关闭',primary:true,run:closeModal}]);
    const root=body();
    root.querySelector('#adjustment-filter').onclick=()=>{filter={objectId:root.querySelector('#adjustment-object').value.trim(),operation:root.querySelector('#adjustment-operation').value.trim(),source:root.querySelector('#adjustment-source').value};offset=0;render();};
    root.querySelector('#adjustment-prev').onclick=()=>{offset=Math.max(0,offset-50);render();};root.querySelector('#adjustment-next').onclick=()=>{offset+=50;render();};
    for(const detail of root.querySelectorAll('[data-adjustment-id]'))detail.addEventListener('toggle',()=>{if(!detail.open||detail.dataset.loaded)return;const record=records.find(r=>r.id===detail.dataset.adjustmentId);detail.querySelector('[data-adjustment-content]').innerHTML=layoutHistoryRecordMarkup(record,filter);detail.dataset.loaded='true';});
  }
  return {open(){filter={objectId:'',operation:'',source:''};offset=0;render();},exportFile};
}
