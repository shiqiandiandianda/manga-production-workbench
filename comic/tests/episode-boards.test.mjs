import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createProject,id,clone,panel,rectangle} from '../public/model.js';
import {migrateLayerDocument} from '../public/layers.js';
import {ensureEpisodeBoards,resolveBoard,boardContext,boardTextLayout,boardAssetIds,remapBoardAssets,validateEpisodeBoards} from '../public/episode-boards.js';
import {episodeExportLayout} from '../public/episode-board-export.js';
import {readEpisodeOutline,createEpisodeBoardSharing} from '../lib/episode-boards.mjs';
import {renderStripSegment,exportEpisode} from '../public/render.js';
import {createStudio} from '../server.mjs';
import {writeXlsx} from '../lib/xlsx.mjs';


const require=createRequire(import.meta.url),runtime=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),canvas=require(path.join(runtime,'@napi-rs/canvas'));
const qaRoot=path.resolve('../verification/inline-boards-20261022'),output=path.join(qaRoot,'evidence');fs.mkdirSync(output,{recursive:true});
const outline={version:1,sourceKey:'synthetic-outline',workTitle:'合成测试漫画',episodes:[{episode:11,title:'长生会与两个月后的消息'},{episode:14,title:'第一战'},{episode:15,title:'第二战'},{episode:21,title:'终局'}]};
const fixture=(number=14)=>{const p=migrateLayerDocument(createProject('合成测试漫画')).project;p.pages[0].storyboard={episode:number};p.pages[0].height=500;p.pages[0].panels=[];p.shots=[];p.layerOrder=[];p.episodeOutline=clone(outline);ensureEpisodeBoards(p);return p;};

test('细纲优先、中文话数、自动下一话以及单话修改 / 恢复',()=>{
 const parsed=readEpisodeOutline([{name:'交付总览',table:[['《合成作品》'],['话数','话名'],[14,'旧名字']]},{name:'分话细纲',table:[['话数','话名'],['第十四话','第一战'],[15,'第二战'],[21,'终局']]}],{fileKey:'hash',sheet:'第十四话'});
 assert.equal(parsed.workTitle,'合成作品');assert.equal(parsed.currentEpisode,14);assert.equal(parsed.episodes[0].title,'第一战');
 const p=fixture();p.episodeOutline=parsed;assert.equal(boardContext(p,14).episodeTitle,'第一战');assert.equal(boardContext(p,14).nextEpisodeTitle,'第二战');
 p.episodeBoards.episodes[14]={episodeTitle:'本话改名',nextEpisodeTitle:'手填下话',episodeNumber:30};assert.equal(boardContext(p,14).episodeTitle,'本话改名');assert.equal(boardContext(p,15).episodeTitle,'第二战');assert.deepEqual(resolveBoard(p,'tail',14).layers,[]);
 delete p.episodeBoards.episodes[14].episodeTitle;assert.equal(boardContext(p,14).episodeTitle,'第一战');assert.equal(boardContext(p,21).nextMissing,true);validateEpisodeBoards(p);
});

test('长话名保留指定字号 / 换行 / 竖排共用测量，独立底图与工程资产映射',()=>{
 const p=fixture(11),ctx=canvas.createCanvas(100,100).getContext('2d'),title={...p.episodeBoards.templates.cover.layers[2],text:boardContext(p,11).episodeTitle};const small=boardTextLayout(ctx,title);assert.equal(small.fontSize,title.fontSize);assert.equal(small.glyphs.map(g=>g.text).join(''),title.text);
 const wrapped=boardTextLayout(ctx,{...title,fit:'wrap',h:500});assert.equal(wrapped.fontSize,title.fontSize);assert.ok(wrapped.glyphs.length>=2);
 const vertical=boardTextLayout(ctx,{...title,writingMode:'vertical',fit:'wrap',h:500,w:500});assert.ok(vertical.glyphs.length>=title.text.length);assert.ok(vertical.glyphs.every(g=>g.x>=title.x&&g.x<=title.x+500));
 const common=id('asset'),own=id('asset');p.episodeBoards.templates.cover.backgroundAssetId=common;p.episodeBoards.episodes[11]={cover:{useOwnBackground:true,backgroundAssetId:own}};
 assert.equal(resolveBoard(p,'cover',11).backgroundAssetId,own);assert.equal(resolveBoard(p,'cover',14).backgroundAssetId,common);assert.deepEqual(new Set(boardAssetIds(p)),new Set([common,own]));
 const nextCommon=id('asset'),nextOwn=id('asset');remapBoardAssets(p,new Map([[common,nextCommon],[own,nextOwn]]));assert.equal(resolveBoard(p,'cover',11).backgroundAssetId,nextOwn);validateEpisodeBoards(p);
 p.episodeBoards.templates.cover.layers[0].fontSize=NaN;assert.throws(()=>validateEpisodeBoards(p),/文字外观/);
});

test('共用模板跨同一作品生效，单话覆盖保留',()=>{
 const a=fixture(14),b=fixture(11);b.episodeBoards.episodes[11]={episodeTitle:'这话单独改'};const store={db:{projects:[a,b]}},sharing=createEpisodeBoardSharing(store);const next=sharing.view(a);next.episodeBoards.templates.cover.background='#334455';sharing.accept(a,next);
 assert.equal(sharing.view(b).episodeBoards.templates.cover.background,'#334455');assert.equal(boardContext(sharing.view(b),11).episodeTitle,'这话单独改');assert.equal(b.revision,1);
});



test('多话与分散的同话画板只各加一组封面 / 尾图，按指定话数完整导出',()=>{
 const p=fixture(14),second=clone(p.pages[0]);second.id=id('page');second.storyboard.episode=15;const third=clone(p.pages[0]);third.id=id('page');p.pages.push(second,third);
 const all=episodeExportLayout(p);assert.deepEqual(all.episodeBoardParts.map(p=>p.kind),['cover','comic','comic','tail','cover','comic','tail']);const only=episodeExportLayout(p,{episode:14});assert.equal(only.height,4600);assert.deepEqual(only.episodeBoardParts.filter(p=>p.kind==='comic').map(p=>p.sourceY),[0,1000]);assert.equal(episodeExportLayout(p,{episode:21}).height,0);
});

test('封面、漫画、尾图按序合成，跨分段不移动漫画坐标',async()=>{
 const p=fixture();p.pages[0].background='#0055ff';p.episodeBoards.templates.cover.background='#ff3300';p.episodeBoards.templates.tail.background='#00cc55';for(const kind of ['cover','tail'])p.episodeBoards.templates[kind].layers.forEach(l=>l.visible=false);
 const before=clone(p),plan=episodeExportLayout(p);assert.equal(plan.height,4100);assert.deepEqual(plan.episodeBoardParts.map(p=>p.kind),['cover','comic','tail']);
 const factory=()=>{const c=canvas.createCanvas(1,1);c.toBlob=callback=>callback(new Blob([c.toBuffer('image/png')],{type:'image/png'}));return c;},segment=await renderStripSegment(plan,{y:1750,height:1060},{project:p,canvasFactory:factory}),ctx=segment.getContext('2d');
 assert.deepEqual([...ctx.getImageData(10,10,1,1).data],[255,51,0,255]);assert.deepEqual([...ctx.getImageData(10,50,1,1).data],[0,85,255,255]);assert.deepEqual([...ctx.getImageData(10,549,1,1).data],[0,85,255,255]);assert.deepEqual([...ctx.getImageData(10,550,1,1).data],[0,204,85,255]);
 const session='export_11111111-1111-4111-8111-111111111111',request=async(url,init)=>{const input=JSON.parse(init.body),data=url.endsWith('/parts')?{received:input.index+1,nextY:Math.min(plan.height,input.y+4096)}:url.endsWith('/complete')?{width:1280,height:plan.height,files:1,url:'/api/strip-exports/'+session+'/download'}:{id:session,width:1280,height:plan.height};return {ok:true,json:async()=>data};};let downloaded;const result=await exportEpisode(p,()=>{},{canvasFactory:factory,request,downloadURL:(url,name)=>downloaded={url,name}});assert.equal(result.height,4100);assert.equal(result.partsRendered,2);assert.match(downloaded.name,/整话\.png$/);assert.deepEqual(p,before);
});


// Fixed-frame browser interaction coverage: episode-board-fixed-frame.test.mjs.
