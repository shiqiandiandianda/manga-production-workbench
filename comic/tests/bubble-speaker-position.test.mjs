import test from 'node:test';
import assert from 'node:assert/strict';
import {badgePosition} from '../public/bubble-speaker.js';
const area={left:350,top:90,right:1620,bottom:960},box=(left,top,w=220,h=160)=>({left,top,right:left+w,bottom:top+h});
const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
test('人物卡始终在气泡两侧，靠边时换侧，不挡住尾尖控制点',()=>{
 for(const body of [box(800,300),box(360,300),box(1380,300),box(800,92),box(800,850)]){
  const controls=[box(body.left-90,body.top,75,50),box(body.right-5,body.bottom-5,10,10)];
  const p=badgePosition(body,area,110,85,controls);
  assert.ok(p.right<body.left||p.left>body.right,'只能在侧边');
  assert.ok(p.left>=area.left&&p.right<=area.right);
  assert.ok(p.top>=area.top&&p.bottom<=area.bottom);
  for(const c of controls)assert.equal(overlap(p,c),false,'不能盖住控制点');
 }
});
