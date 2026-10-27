import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';


import {readXlsx,writeXlsx} from '../lib/xlsx.mjs';

import {panel,polygonFor} from '../public/model.js';
import {uid} from '../lib/store.mjs';

import {segmentEffectWord,placePanelSfx,atmosphereKind,sfxWordsFrom,sfxCategory} from '../public/sfx-placement.js';
import {comicStyles} from '../public/comic-styles.js';


const require=createRequire(import.meta.url);
const canvas=require(process.env.COMIC_TEST_CANVAS_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));
const context=()=>canvas.createCanvas(10,10).getContext('2d');

// 与甲方实际交付的写法一致：台词带“说话人：”和引号，没有台词写“无”。

const CALM=n=>[n,'叶麟','传功阁门前','晴','午后','中景','侧面平视','叶麟收剑入鞘。','无','无',''];

const FIGHT=[
 [1,'叶麟、李磊','传功阁门前','晴','午后','全景','侧面平视','叶麟在左、李磊在右相隔三丈站立。','执法队队长（画外）：“可以开始了！”','无',''],
 [2,'李磊','传功阁门前','晴','午后','近景','低位仰视','李磊掐着剑诀，飞剑指向左边。','李磊：“去！”','嗡嗡',''],
 [3,'叶麟','传功阁门前','晴','午后','中景','贴地仰视','叶麟持剑向右冲出，前脚踏中的石地下沉。','无','砰',''],
 [4,'叶麟、李磊','传功阁门前','晴','午后','近景','斜侧平视','两把剑正面相撞，火星迸在交点。','无','当！',''],
 [5,'叶麟、李磊','传功阁门前','晴','午后','中近景','侧面平视','叶麟与李磊的身体刚刚交错，剑刃贯入。','无','噗',''],
 [6,'叶麟、李磊','传功阁门前','晴','午后','远景','叶麟肩后平视','石地外围一片死寂，所有人的目光都停在剑上。','无','无',''],
 [7,'叶麟、李磊','传功阁门前','晴','午后','中景','低位仰视','叶麟退开一步拱手。','叶麟：“李磊师兄，承让了！”\n旁白：“此战，胜负已分。”\n叶麟（心声）：“还好隐藏了法力。”','无',''],
 [8,'小强','古戒空间','不适用','夜','全景','俯视','小强举起双钳。','小强（精神交流）：“主人，长出来了！”','叽叽',''],
];













test('特效字：字形完全一致才用素材，叠字逐个放，缺字用原文毛笔字效；避开气泡',()=>{
 assert.deepEqual(segmentEffectWord('嗡嗡'),['嗡','嗡']);assert.deepEqual(segmentEffectWord('咔嚓咔嚓'),['咔嚓','咔嚓']);
 assert.equal(segmentEffectWord('当！'),null,'不会把“当”换成别的字');
 assert.ok(comicStyles.filter(s=>s.kind==='sfx').every(s=>[...s.word].length<=4),'素材目录里每个字效的“字”都是拟声字本身');
 assert.deepEqual(sfxWordsFrom('嗖／唳~~~\n无'),['嗖','唳~~~']);assert.equal(sfxCategory('砰'),'impact');
 const page={width:1280,height:4000},frame={x:100,y:500,w:900,h:700,layoutIntent:{}},bubble={x:120,y:520,w:300,h:180};
 let n=0;const makeId=p=>p+'_'+(++n);
 const image=placePanelSfx({words:['砰'],frame,page,intensity:5,letters:[bubble],makeId,key:'k'});
 assert.equal(image.length,1);assert.ok(image[0].visualStyleId&&image[0].sfxLibrary);
 const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
 assert.equal(overlap(image[0],bubble),0,'字效避开气泡');
 assert.equal(placePanelSfx({words:['嗡嗡'],frame,page,makeId}).length,2);
 const text=placePanelSfx({words:['唳~~~'],frame,page,makeId});assert.equal(text[0].text,'唳~~~');assert.ok(!text[0].visualStyleId);
 const missing=placePanelSfx({words:['砰'],frame,page,makeId,available:()=>false});assert.equal(missing[0].text,'砰','素材文件不在本机时改用文字字效');
 const inside=placePanelSfx({words:['砰'],frame,page,intensity:5,makeId,contain:true})[0];
 assert.ok(inside.x>=frame.x&&inside.x+inside.w<=frame.x+frame.w&&inside.y+inside.h<=frame.y+frame.h,'规则试排时保持在画格内');
 assert.equal(atmosphereKind({beat:'高潮',intensity:5,words:['嗖']}),'速度线');assert.equal(atmosphereKind({beat:'高潮',intensity:5}),'集中线');
 assert.equal(atmosphereKind({setting:'无',beat:'高潮',intensity:5}),null);assert.equal(atmosphereKind({beat:'推进',intensity:3}),null);
});


