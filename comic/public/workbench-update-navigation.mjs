export function editorReturnUrl(value, origin) {
 const home=new URL('/',origin);
 try { const url=new URL(value||'/',home);if(url.origin===home.origin&&['/','/index.html'].includes(url.pathname)&&!url.username&&!url.password)return url; } catch {}
 return home;
}
export function localUpdateUrl(control, editor) {
 const source=new URL(editor),target=new URL(control);
 if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.username||target.password)throw Error('本机更新地址无效');
 target.pathname='/';target.search='';target.hash='';
 const back=editorReturnUrl(source.href,source.origin);target.searchParams.set('returnTo',back.pathname+back.search+back.hash);return target.href;
}
export function teamDashboardUrl(editor) {
 const source=new URL(editor),target=new URL('/team-dashboard.html',source);
 const back=editorReturnUrl(source.href,source.origin);target.searchParams.set('returnTo',back.pathname+back.search+back.hash);return target.href;
}
