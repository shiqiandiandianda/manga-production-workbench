import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import os from 'node:os';import {createRequire} from 'node:module';


import {Store,uid,imageInfo,validateProject} from '../lib/store.mjs';import {createProject} from '../public/model.js';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),graphics=require(process.env.COMIC_TEST_CANVAS_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));
const copy=v=>structuredClone(v);function dir(t){const parent=path.join(root,'.runtime','temp');fs.mkdirSync(parent,{recursive:true});const d=fs.mkdtempSync(path.join(parent,'design-repair-'));t.after(()=>{assert.equal(path.dirname(d),parent);fs.rmSync(d,{recursive:true,force:true});});return d;}
function sourcePNG(){const c=graphics.createCanvas(32,32),ctx=c.getContext('2d');ctx.fillStyle='#1155cc';ctx.fillRect(0,0,32,32);return c.toBuffer('image/png');}
async function bodyJSON(req){const chunks=[];for await(const v of req)chunks.push(v);return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}function sendJSON(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;}async function close(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}



test('store rejects malformed native dimensions while preserving valid optional preferences',()=>{const p=createProject('导入校验');p.pages[0].panels[0].nativeSizing={version:1,mode:'model-long',provider:'codex',request:{width:1280}};assert.throws(()=>validateProject(p),/原生像素/);p.pages[0].panels[0].nativeSizing={version:1,mode:'model-long',provider:'codex',request:{ratio:'1:3'}};assert.doesNotThrow(()=>validateProject(p));});
