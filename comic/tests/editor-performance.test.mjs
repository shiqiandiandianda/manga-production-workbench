import test from 'node:test';
import assert from 'node:assert/strict';
import {createBubbleSizeCache} from '../public/bubble-size-cache.js';
import {createPreviewScheduler} from '../public/preview-scheduler.js';
import {rectangleDragY,nodeDragY,panelPixelHeight} from '../public/panel-size-limits.js';
import {panel} from '../public/model.js';

test('spacing cache survives project clones and linked moves, including absolute tail coordinates; content/font changes invalidate it',()=>{
 let measured=0;const cache=createBubbleSizeCache(null,{measure:(_context,b)=>{measured++;return {w:b.w,h:b.h+10,tail:{tip:{x:b.tail.x,y:b.tail.y}}};}});
 const b={id:'bubble_a',x:100,y:200,w:240,h:100,text:'合成对白',fontSize:30,tail:{mode:'absolute',x:220,y:340}};
 assert.deepEqual(cache.size(b),{w:240,h:110,tail:{tip:{x:120,y:140}}});
 const moved=JSON.parse(JSON.stringify(b));moved.x+=50;moved.y+=100;moved.tail.x+=50;moved.tail.y+=100;
 assert.deepEqual(cache.size(moved),cache.size(b));assert.equal(measured,1);
 moved.text+='修改';cache.size(moved);assert.equal(measured,2);moved.w=260;cache.size(moved);assert.equal(measured,3);
 moved.tail.y+=10;assert.equal(cache.size(moved).tail.tip.y,150);assert.equal(measured,4);
 cache.clear();cache.size(moved);assert.equal(measured,5);
});

test('slider burst renders only the newest value; release flushes and Escape cancels pending previews',()=>{
 let callback=null,requests=0;const values=[],scheduler=createPreviewScheduler({preview:(...args)=>values.push(args),requestFrame:fn=>{requests++;callback=fn;return requests;},cancelFrame:()=>{callback=null;}});
 for(let i=0;i<100;i++)scheduler.schedule('gap-below',i);assert.equal(requests,1);assert.equal(values.length,0);callback();assert.deepEqual(values,[['gap-below',99]]);
 scheduler.schedule('gap-below',6080);scheduler.flush();assert.deepEqual(values.at(-1),['gap-below',6080]);assert.equal(callback,null);
 scheduler.schedule('gap-below',9000);scheduler.cancel();assert.equal(callback,null);assert.equal(values.length,2);
});

test('rectangle drag height caps at 3840 from either edge and free nodes cannot exceed the limit; old geometry is not rewritten',()=>{
 assert.equal(rectangleDragY(100,9000,false)-100,3840);assert.equal(5000-rectangleDragY(5000,-9000,true),3840);assert.equal(rectangleDragY(100,-9000,false)-100,20);
 const f=panel('',0,0,1000,1500);f.points[2].y=nodeDragY(f,2,10);assert.equal(panelPixelHeight(f),3840);
 const old=panel('',0,0,1280,4000);assert.equal(panelPixelHeight(old),4000);assert.equal(old.h,4000);
});
