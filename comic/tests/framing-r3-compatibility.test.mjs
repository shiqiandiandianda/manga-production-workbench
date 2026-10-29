import test from 'node:test';import assert from 'node:assert/strict';
import {ensureReflowLetteringMinimum} from '../public/reflow-lettering.mjs';
import {tightenedArtworkView} from '../public/artwork-framing.mjs';
import {bringEpisodeLetteringToFront} from '../public/reflow-lettering-order.mjs';
test('small reflow lettering retains text, frozen rows, proportional geometry and is idempotent',()=>{
 const b={x:20,y:40,w:120,h:80,fontSize:8,text:'两行文字',textBox:{x:10,y:8,w:100,h:60},textLayout:{w:100,h:60,lines:[{x:5,y:5,glyphs:[{x:3,y:4}]}]},tail:{x:10,y:20}};
 assert.equal(ensureReflowLetteringMinimum(b),true);assert.equal(b.fontSize,10);assert.equal(b.text,'两行文字');assert.equal(b.w/b.h,1.5);assert.equal(b.textLayout.lines.length,1);assert.equal(b.textBox.w,125);
 const once=structuredClone(b);assert.equal(ensureReflowLetteringMinimum(b),false);assert.deepEqual(b,once);
 const legal={x:1,y:2,w:120,h:80,fontSize:32};const saved=structuredClone(legal);assert.equal(ensureReflowLetteringMinimum(legal),false);assert.deepEqual(legal,saved);
});
test('tightening protects locked, rotated and custom contours and keeps original image coordinates',()=>{
 const frame={w:400,h:600,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],imageTransform:{x:4,y:8,scale:3}},before=structuredClone(frame),size={width:120,height:180},t=tightenedArtworkView(frame,size);
 assert.ok(t.w<frame.w&&t.h<frame.h);assert.equal(t.imageTransform.x+t.left,frame.imageTransform.x);assert.deepEqual(frame,before);
 for(const f of [{...frame,locked:true},{...frame,imageTransform:{...frame.imageTransform,rotation:15}},{...frame,points:[{x:0,y:0}]}])assert.equal(tightenedArtworkView(f,size),null);
});
test('only target episode visible lettering moves forward; other layers keep relative order',()=>{
 const p={pages:[{storyboard:{episode:1},bubbles:[{id:'a'},{id:'hidden',visible:false}]},{storyboard:{episode:2},bubbles:[{id:'b'}]}],layerOrder:['a','panel','b','hidden']};
 bringEpisodeLetteringToFront(p,1);assert.deepEqual(p.layerOrder,['panel','b','hidden','a']);
});
