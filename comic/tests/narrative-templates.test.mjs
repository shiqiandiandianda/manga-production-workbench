import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createProject,makePage,clone} from "../public/model.js";
import {validateProject,uid} from '../lib/store.mjs';



let native;
try {if(process.env.COMIC_TEST_CANVAS_MODULE)native=createRequire(import.meta.url)(process.env.COMIC_TEST_CANVAS_MODULE);} catch {}
function measurement(){
  if(native)return native.createCanvas(8,8).getContext('2d');
  return {font:'32px sans-serif',measureText(text){const size=Number(this.font.match(/([\d.]+)px/)?.[1]||32);return {width:[...text].reduce((sum,char)=>sum+size*(/[\u0000-\u007f]/.test(char)?.6:1),0)};}};
}
function fixture(){
  const project=createProject('叙事模板测试',true),page=project.pages[0];
  const panel=page.panels[1],bubble=page.bubbles[0];
  panel.imageAssetId=uid('asset');panel.candidates=[panel.imageAssetId,uid('asset')];
  panel.imageTransform={x:-33.4,y:12.8,scale:1.86};
  panel.mask={enabled:true,strokes:[{mode:'hide',size:.08,hardness:.6,opacity:.8,points:[{x:.2,y:.3},{x:.3,y:.4}]}]};
  panel.feather=57;panel.featherEdges={top:10,bottom:30,left:0,right:9};
  bubble.parentPanelId=panel.id;bubble.fontFamily='source-han-serif';bubble.fontSize=48;
  bubble.lineHeight=1.6;bubble.letterSpacing=2;bubble.textBox={x:20,y:8,w:300,h:88};
  bubble.tail={visible:true,mode:'absolute',x:bubble.x+280,y:bubble.y+165,side:'bottom',base:.6};
  project.layerOrder=[...page.panels.map(frame=>frame.id),bubble.id];
  project.gradients=[];
  return {project,page,panel,bubble};
}
















