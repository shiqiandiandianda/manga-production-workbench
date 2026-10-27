import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {publicGenerationBoard} from '../../distribution/generation-board.mjs';
const root=path.resolve(import.meta.dirname,'../../verification/production-board-20261024');fs.mkdirSync(root,{recursive:true});
test('团队生成卡只输出明细白名单，掉线变待核实，结束状态与改名保持正确',()=>{
 const now=1000000000,input=[{id:'a',token:'SECRET',requestId:'PRIVATE',asset:{name:'宋玄',role:'character',state:'青色儒衫',work:{title:'大周',projectId:'comic_1',secret:'SECRET'}},ownerId:'m1',ownerName:'旧姓名',seenAt:now-1000,createdAt:now-5000,status:'active'},{id:'b',asset:{name:'院子',work:{}},seenAt:now-70000,status:'active'},{id:'c',asset:{name:'茶杯',work:{}},finishedAt:now-100,status:'completed'},{id:'old',asset:{work:{}},finishedAt:now-2*86400000,status:'completed'}],v=publicGenerationBoard(input,[{id:'m1',name:'新姓名',connection:'online',registrationKey:'SECRET'}],now);
 assert.equal(v.items.length,3);assert.equal(v.items[0].ownerName,'新姓名');assert.equal(v.items[0].status,'running');assert.equal(v.items[1].status,'uncertain');assert.equal(v.items[2].status,'completed');assert.doesNotMatch(JSON.stringify(v),/SECRET|PRIVATE|registrationKey|token/);
});
