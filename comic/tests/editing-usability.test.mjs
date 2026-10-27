import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';
import {createProject,id} from '../public/model.js';import {renderSceneSvg} from '../public/scene-svg.js';import {bubbleSpeaker,speakerAvatar} from '../public/bubble-speaker.js';import {keepToolsInView} from '../public/floating-tools.js';import {createStudio} from '../server.mjs';
const require=createRequire(import.meta.url),canvas=require(process.env.COMIC_TEST_CANVAS_MODULE);
test('闭合边命中区域位于所有节点下方，第一个节点不会触发边线上加点',()=>{
 const project=createProject('合成节点测试',true),page=project.pages[0],frame=page.panels[0],state={mode:'continuous',zoom:.5,currentPageId:page.id,window:{startY:0,endY:page.height}};
 const scene=renderSceneSvg(project,state,{assets:new Map(),measurement:canvas.createCanvas(10,10).getContext('2d'),selection:{type:'panel',id:frame.id},tool:'nodes',escape:v=>String(v),shotFor:()=>project.shots[0],activeJob:()=>null});
 const firstNode=scene.content.indexOf('data-node="0"');assert.ok(firstNode>0);for(let i=0;i<frame.points.length;i++)assert.ok(scene.content.indexOf('data-edge="'+i+'"')<firstNode);
 assert.equal((scene.content.match(/data-node=/g)||[]).length,frame.points.length);assert.match(scene.content,/data-node="0"[^>]*pointer-events="all"/);
});
test('浮动工具栏调整后完整保留在当前窗口，负坐标和旧窗口位置会修正',()=>{
 assert.deepEqual(keepToolsInView({x:2000,y:2000},{width:284,height:50},{width:300,height:800}),{x:8,y:742});assert.deepEqual(keepToolsInView({x:-20,y:-30},{width:400,height:44},{width:1200,height:900}),{x:8,y:8});
});
test('姓名读取原分镜，不猜测同名多状态角色图；显式头像绑定优先',()=>{
 const p=createProject('合成人物测试',true),b=p.pages[0].bubbles[0];b.speaker='测试人物甲';const a={id:id('asset'),name:'CHAR_01_测试人物甲_少年.png',libraryRole:'character'},c={id:id('asset'),name:'CHAR_01_测试人物甲_成年.png',libraryRole:'character'};
 assert.equal(bubbleSpeaker(p,b).name,'测试人物甲');assert.equal(speakerAvatar(p,b,[a]),a);assert.equal(speakerAvatar(p,b,[a,c]),null);p.speakerAvatars={'测试人物甲':c.id};assert.equal(speakerAvatar(p,b,[a,c]),c);delete b.speaker;assert.equal(bubbleSpeaker(p,b).known,false);assert.equal(speakerAvatar(p,b,[a,c]),null);
});
test('说话人头像的路径随工程导出和导入保留，原页面图像与文字不变',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-speaker-')),fake={close(){}},studio=createStudio({dataDir:directory,bridge:fake,jimengBridge:fake,storyboardGenerator:fake});
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(async()=>{studio.close();await new Promise(r=>studio.server.close(r));assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
 const filePath=path.join(directory,'synthetic-avatar.png');fs.writeFileSync(filePath,canvas.createCanvas(40,40).toBuffer('image/png'));
 const call=async(url,method='GET',body)=>{const response=await fetch('http://127.0.0.1:'+studio.server.address().port+url,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.ok,true,await response.clone().text());return response.json();};
 const asset=await call('/api/assets','POST',{filePath}),project=createProject('合成头像工程',true);project.pages[0].bubbles[0].speaker='测试人物甲';project.speakerAvatars={'测试人物甲':asset.id};studio.store.db.projects.push(project);studio.store.save();
 const exported=await call('/api/projects/'+project.id+'/export');assert.ok(exported.assets.some(a=>a.id===asset.id&&a.filePath===filePath));
 const imported=await call('/api/projects/import','POST',exported);assert.ok(imported.speakerAvatars['测试人物甲']);assert.equal(imported.pages[0].bubbles[0].text,project.pages[0].bubbles[0].text);assert.equal(imported.pages[0].bubbles[0].speaker,'测试人物甲');
});
