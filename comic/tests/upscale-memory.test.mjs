import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {runOnnxUpscale} from '../lib/upscale-engines.mjs';
import {localImageMessage} from '../public/local-image-messages.js';

const root=path.resolve('../verification/upscale-memory-20261029');
fs.mkdirSync(root,{recursive:true});
function fixture(){const dir=fs.mkdtempSync(path.join(root,'case-'));return {python:'fake-python',script:'upscale.py',input:path.join(dir,'input.png'),output:path.join(dir,'output.png'),model:'same-model.onnx',scale:2,availableMemory:8*1024**3};}

test('allocation failures retry in exited workers with smaller tiles, same source/model/scale and full diagnostics',async()=>{
 const f=fixture(),calls=[],progress=[];fs.writeFileSync(f.input,'original');
 await runOnnxUpscale({...f,progress:value=>progress.push(value),run:async(_cmd,args,report)=>{calls.push(args);if(calls.length<3)throw Object.assign(Error('failed'),{log:'Traceback: bad allocation'});report('{"progress":1,"total":2,"percent":50}');fs.writeFileSync(f.output,'result');return 'completed';}});
 assert.deepEqual(calls.map(args=>args[args.indexOf('--tile')+1]),['192','128','64']);
 for(const args of calls){assert.equal(args[args.indexOf('--input')+1],f.input);assert.equal(args[args.indexOf('--model')+1],f.model);assert.equal(args[args.indexOf('--scale')+1],'2');assert.equal(args[args.indexOf('--overlap')+1],'32');}
 assert.equal(fs.readFileSync(f.input,'utf8'),'original');assert.match(fs.readFileSync(path.join(path.dirname(f.output),'upscale.log'),'utf8'),/bad allocation[\s\S]*completed/);assert.match(progress.at(-1),/50%/);
});
test('low memory starts at 64 and reports readable failure without endless retries',async()=>{
 const f=fixture();let calls=0;
 await assert.rejects(runOnnxUpscale({...f,availableMemory:512*1024**2,run:async(_cmd,args)=>{calls++;assert.equal(args[args.indexOf('--tile')+1],'64');throw Object.assign(Error('bad allocation'),{log:'Traceback\n'+[...'bad allocation'].join('\0')});}}),/内存或显存不足/);
 assert.equal(calls,2);assert.equal(fs.existsSync(f.output),false);
});
test('Windows commit limit may lower effective tile; do not retry a larger tile',async()=>{
 const f=fixture();let calls=0;
 await assert.rejects(runOnnxUpscale({...f,run:async()=>{calls++;throw Object.assign(Error('bad allocation'),{log:'{"tile":64,"requestedTile":192}\nbad allocation'});}}),/内存或显存不足/);assert.equal(calls,2);
});
test('unrelated model errors are not retried and stored history stays readable',async()=>{
 let calls=0;await assert.rejects(runOnnxUpscale({...fixture(),run:async()=>{calls++;throw Object.assign(Error('failed'),{log:'ONNXRuntimeError: unsupported operator'});}}),/详细原因已记录/);assert.equal(calls,1);
 assert.equal(localImageMessage('处理完成'),'处理完成');assert.doesNotMatch(localImageMessage('Traceback\n\u001b[31m'+[...'bad allocation'].join('\0')),/Traceback|\0|\u001b/);
});

test('exhausted GPU memory falls back once to CPU with the original model and scale',async()=>{
 const f=fixture(),providers=[];await runOnnxUpscale({...f,availableMemory:512*1024**2,run:async(_cmd,args)=>{const provider=args[args.indexOf('--provider')+1];providers.push(provider);assert.equal(args[args.indexOf('--model')+1],f.model);assert.equal(args[args.indexOf('--scale')+1],'2');if(provider==='auto')throw Error('bad allocation');return 'completed on CPU';}});assert.deepEqual(providers,['auto','cpu']);
});
