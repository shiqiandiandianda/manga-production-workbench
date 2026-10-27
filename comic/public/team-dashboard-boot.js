// Independent of the module import graph: an unavailable module must not leave
// the static page showing a connection spinner forever.
setTimeout(()=>{
 if(document.documentElement.dataset.teamDashboardSettled)return;
 const find=id=>document.getElementById(id),loaded=document.documentElement.dataset.teamDashboardLoaded;
 find('message').textContent=loaded?'读取团队状态超时，请点击“刷新状态”重试。':'团队页面脚本未加载完整，请刷新页面；若仍失败，请升级工具后重开。';
 for(const id of ['online','version','watching','environment'])find(id).textContent='未连接';
 find('published').textContent='尚未取得版本信息';find('self-name').textContent='团队姓名暂未读取';
 find('members').innerHTML='<tr><td colspan="6" class="empty">连接未完成，可以重试。</td></tr>';
 find('updated').textContent='状态读取未完成';
 if(!loaded)find('refresh').onclick=()=>location.reload();
},8000);
