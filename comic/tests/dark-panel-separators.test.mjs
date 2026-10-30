import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {detectSliceRegions,cropSliceImages} from '../lib/panel-slices-images.mjs';
import {detectDarkPanelSeparators} from '../lib/dark-panel-separators.mjs';
const require=createRequire(import.meta.url);
process.env.COMIC_CANVAS_MODULE ||= new URL('../../runtime/node/node_modules/@napi-rs/canvas',import.meta.url).pathname.replace(/^\/(\w:)/,'$1');
const {createCanvas,loadImage}=require(decodeURI(process.env.COMIC_CANVAS_MODULE));
process.env.COMIC_CANVAS_MODULE=decodeURI(process.env.COMIC_CANVAS_MODULE);
const expected=Array.from({length:3},(_,i)=>({'格ID':'P'+i,'排':i+1}));
function picture({lines=2,partial=false,white=false}={}){
 const c=createCanvas(300,900),ctx=c.getContext('2d');ctx.fillStyle='#b9cbdc';ctx.fillRect(0,0,300,900);
 for(let i=0;i<lines;i++){ctx.beginPath();ctx.moveTo(partial?60:0,(lines===3?190+i*210:280+i*300));ctx.lineTo(partial?240:300,(lines===3?220+i*210:310+i*300));ctx.lineWidth=white?22:3;ctx.strokeStyle=white?'white':'#151515';ctx.stroke();}
 return c;
}
test('black diagonal seams preserve native image size and polygon transparency',async()=>{
 const data=picture().toBuffer('image/png'),d=await detectSliceRegions(data,expected);
 assert.equal(d.matched,true);assert.equal(d.method,'continuous-dark-separators');assert.deepEqual(Object.keys(d.regions),['P0','P1','P2']);
 assert.equal(d.width,300);assert.equal(d.height,900);assert.notEqual(d.regions.P1.points[0].y,d.regions.P1.points[1].y);
 const crops=await cropSliceImages(data,d.regions),im=await loadImage(crops[1].bytes),c=createCanvas(im.width,im.height),ctx=c.getContext('2d');ctx.drawImage(im,0,0);
 assert.equal(im.width,300);assert.equal(ctx.getImageData(im.width-2,1,1,1).data[3],0);assert.equal(ctx.getImageData(150,80,1,1).data[3],255);
});
test('missing, extra and partial seams do not guess equal splits',async()=>{
 for(const options of [{lines:0},{lines:1},{lines:3},{partial:true}])assert.equal((await detectSliceRegions(picture(options).toBuffer('image/png'),expected)).matched,false,JSON.stringify(options));
});
test('dark fallback rejects multi-column storyboard and tiny inputs',()=>{
 const c=picture(),px=c.getContext('2d').getImageData(0,0,300,900).data;
 assert.equal(detectDarkPanelSeparators(px,300,900,[{...expected[0]},{...expected[1],'排':1},expected[2]]),null);
 assert.equal(detectDarkPanelSeparators(new Uint8Array(16),2,2,expected),null);
});
test('existing white gutter detection retains priority',async()=>{
 const c=createCanvas(300,900),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,300,900);ctx.fillStyle='#8798ab';for(let i=0;i<3;i++)ctx.fillRect(0,i*300+10,300,280);
 const d=await detectSliceRegions(c.toBuffer('image/png'),expected);assert.equal(d.matched,true);assert.notEqual(d.method,'continuous-dark-separators');assert.equal(Object.keys(d.regions).length,3);
});
