export function episodeBatchLabel(plan,now=Date.now()){
 const prefix='第'+plan.episode+'话 · 已提交 '+plan.submitted+'/'+plan.total+' · 已结束 '+plan.finished+(plan.failed?' · 失败 '+plan.failed:'')+(plan.skipped?' · 跳过 '+plan.skipped:'');
 if(plan.state==='waiting'){const seconds=Math.max(0,Math.ceil((plan.nextAt-now)/1000));return prefix+' · 第 '+(plan.wave+1)+' 批将在 '+Math.floor(seconds/60)+'分'+String(seconds%60).padStart(2,'0')+'秒后提交';}
 if(plan.state==='running')return prefix+' · 第 '+plan.wave+' 批处理中，结束后随机间隔 1–3 分钟';
 if(plan.state==='done')return prefix+' · 自动提交已结束';
 if(plan.state==='stopped')return prefix+' · 已停止后续提交';
 if(plan.state==='failed')return prefix+' · 自动提交已停止：'+plan.message;
 return prefix+' · 正在准备下一批（每批最多 '+plan.batchSize+' 张）';
}
