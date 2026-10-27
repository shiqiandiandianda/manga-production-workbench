const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function projectManagerMarkup({projects=[],deletedProjects=[],currentProjectId=null,jobs=[]}={}) {
  const current=projects.map(project=>{
    const busy=jobs.some(job=>job.projectId===project.id&&['queued','running'].includes(job.status));
    return '<div class="project-manager-row"><div class="project-manager-info"><strong>'+escape(project.title)+'</strong><small>'+project.pages.length+' 页 · '+project.shots.length+' 个镜头'+(project.id===currentProjectId?' · 当前项目':'')+(busy?' · 正在生成':'')+'</small></div><div class="project-manager-actions"><button data-open-project="'+escape(project.id)+'">打开</button><button data-delete-project="'+escape(project.id)+'" class="danger-button" '+(busy?'disabled title="生成任务完成或取消后可删除"':'')+'>删除</button></div></div>';
  }).join('')||'<p class="sub-note">暂无项目，可以新建项目或恢复下方已删除项目。</p>';
  const deleted=deletedProjects.map(project=>'<div class="project-manager-row"><div class="project-manager-info"><strong>'+escape(project.title)+'</strong><small>'+project.pageCount+' 页 · '+project.shotCount+' 个镜头 · '+(project.purgePending?'清理未完成，可重试':'已删除')+'</small></div><div class="project-manager-actions">'+(project.purgePending?'':'<button data-restore-project="'+escape(project.id)+'">恢复</button>')+'<button data-purge-project="'+escape(project.id)+'" class="danger-button">'+(project.purgePending?'重试清理':'彻底删除')+'</button></div></div>').join('')||'<p class="sub-note">没有已删除项目。</p>';
  return '<div class="project-manager"><h3>漫画项目</h3>'+current+'<details class="project-trash" '+(projects.length?'':'open')+'><summary>已删除项目（'+deletedProjects.length+'）</summary>'+deleted+'</details></div>';
}
