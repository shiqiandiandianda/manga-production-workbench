import test from 'node:test';import assert from 'node:assert/strict';

import {bubbleTailGeometry} from '../public/lettering.js';

import {applyBubbleEdit} from '../public/bubble-editor.js';

import {bubbleFieldChange} from '../public/editor-state.js';
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {createStudio} from '../server.mjs';


test('HTTP save accepts legacy inspector tail coordinates without losing dialogue or its exact tip',async t=>{const parent=path.resolve('.runtime/temp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'tail-save-')),fake={status:async()=>({connected:false}),close(){},generate(){throw Error('Real AI forbidden');}},studio=createStudio({dataDir:dir,bridge:fake,jimengBridge:fake,storyboardGenerator:fake});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(async()=>{studio.close();await new Promise(r=>studio.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});const origin='http://127.0.0.1:'+studio.server.address().port,post=await fetch(origin+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'合成尾尖保存'})}),project=await post.json();assert.equal(post.status,201);const bubble={id:'bubble_'+randomUUID(),shotId:project.shots[0].id,x:100,y:500,w:300,h:100,text:'合成对白原文',type:'speech',fontSize:32,visible:true,tail:{mode:'normalized',x:.5,y:-40,visible:true}};project.pages[0].bubbles.push(bubble);const saved=await fetch(origin+'/api/projects/'+project.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(project)}),value=await saved.json();assert.equal(saved.status,200,JSON.stringify(value));const result=value.pages[0].bubbles.find(b=>b.id===bubble.id);assert.equal(result.text,bubble.text);assert.equal(result.tail.mode,'absolute');assert.equal(result.tail.x,250);assert.equal(result.tail.y,-3500);});

