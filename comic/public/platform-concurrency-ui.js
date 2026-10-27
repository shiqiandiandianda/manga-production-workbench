export function mountPlatformConcurrency({host,api,toast}){
 host.innerHTML='<h3>共享生图并发</h3><label>总并发数量<input data-platform-main type="number" min="1" max="20" step="1" aria-label="总生图并发"></label><label>修图最多占用<input data-platform-repair type="number" min="0" max="20" step="1" aria-label="修图并发"></label><button data-platform-save type="button">保存并发设置</button><p data-platform-status role="status"></p>';
 const main=host.querySelector('[data-platform-main]'),repair=host.querySelector('[data-platform-repair]'),save=host.querySelector('[data-platform-save]'),status=host.querySelector('[data-platform-status]');let busy=false,loaded=false;
 const controls=()=>{main.disabled=repair.disabled=save.disabled=busy||!loaded;};
 const display=settings=>{main.value=settings.main;repair.value=settings.repair;repair.max=settings.main;status.textContent=`总并发 ${settings.main} 张，修图最多占用 ${settings.repair} 张；空闲名额供排版生图使用。`;};
 async function load(){if(busy)return;busy=true;controls();try{display(await api('/api/platform-generation-settings'));loaded=true;}catch(e){status.textContent=e.message;}finally{busy=false;controls();}}
 main.oninput=()=>{repair.max=main.value;};save.onclick=async()=>{if(busy||!loaded||!main.reportValidity()||!repair.reportValidity())return;busy=true;controls();try{display(await api('/api/platform-generation-settings','PUT',{main:Number(main.value),repair:Number(repair.value)}));toast('共享并发设置已保存');}catch(e){toast(e.message,true);status.textContent=e.message;}finally{busy=false;controls();}};controls();return {load};
}
