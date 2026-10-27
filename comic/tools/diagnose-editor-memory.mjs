// Read-only local measurements; never writes project data or starts an AI channel.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {frameGaps} from '../public/frame-shortcuts.js';
import {bubbleLayout} from '../public/lettering.js';
import {resizeEmptyGap} from '../public/strip-space.js';
import {layoutEditSnapshot,preserveLayoutHistory} from '../public/layout-history.js';
const require=createRequire(import.meta.url),canvas=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));
const context=canvas.createCanvas(1,1).getContext('2d');
if(!process.argv[2])throw Error('请传入待只读测量的本地漫画工程JSON路径');
const project=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]),'utf8'));
const sizes=Object.entries(project).map(([key,value])=>({key,kb:Math.round(JSON.stringify(value).length/1024)})).sort((a,b)=>b.kb-a.kb);
const timed=fn=>{const start=performance.now();const result=fn();return {ms:Math.round(performance.now()-start),result};};
const bubbles=timed(()=>Object.fromEntries(project.pages.flatMap(p=>p.bubbles).map(b=>[b.id,bubbleLayout(context,b)])));
const frame=project.pages.find(page=>page.panels.length)?.panels[0];if(!frame)throw Error('工程暂无画格');const gaps=timed(()=>frameGaps(project,frame.id,{bubbleSizes:bubbles.result})),snapshot=timed(()=>layoutEditSnapshot(project));
let resize=null;if(gaps.result?.below&&!gaps.result.below.blocked)resize=timed(()=>preserveLayoutHistory(project,resizeEmptyGap(snapshot.result,{...gaps.result.below,height:6000,bubbleSizes:bubbles.result}).project));
console.log(JSON.stringify({sizes,panels:project.pages.map(p=>p.panels.length),bubbles:project.pages.map(p=>p.bubbles.length),timings:{bubbleSizes:bubbles.ms,gaps:gaps.ms,snapshot:snapshot.ms,resize:resize?.ms},processMB:Math.round(process.memoryUsage().rss/1024/1024)},null,2));
