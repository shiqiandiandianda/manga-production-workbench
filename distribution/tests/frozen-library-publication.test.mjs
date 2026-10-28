import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {collectCode} from '../code-policy.mjs';
const proof=path.resolve('.runtime/frozen-library-publication-test');fs.mkdirSync(proof,{recursive:true});
const put=(root,p,b)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b)};
test('发布使用固定已签名的资料映射，不打包本机规则登记及其他本地版本',()=>{
 const root=fs.mkdtempSync(path.join(proof,'pub-')),body=Buffer.from('{"projects":[{"id":"signed-default"}]}'),sha=createHash('sha256').update(body).digest('hex'),blob='auto-layout/public/bootstrap/blobs/'+sha+'.json';
 put(root,blob,body);put(root,'auto-layout/public/bootstrap/code-library-manifest.json',JSON.stringify({format:'comic-release-library-code-v1',files:[{path:'auto-layout/library/projects.json',blob,bytes:body.length,sha256:sha}]}));
 put(root,'auto-layout/library/projects.json','LOCAL-PROJECTS-AND-RULES');put(root,'auto-layout/library/private/versions/private/project.json','PRIVATE-LOCAL-VERSION');
 const files=collectCode(root);assert.equal(files.get('auto-layout/library/projects.json').toString(),body.toString());assert.equal(files.has('auto-layout/library/private/versions/private/project.json'),false);assert.ok(![...files.values()].some(b=>b.toString().includes('LOCAL-PROJECTS-AND-RULES')));assert.equal(fs.readFileSync(path.join(root,'auto-layout/library/projects.json'),'utf8'),'LOCAL-PROJECTS-AND-RULES');
 put(root,blob,'TAMPERED');assert.throws(()=>collectCode(root),/摘要不匹配/);
});
test('旧版本没有该映射时保留原有代码收集方式',()=>{const root=fs.mkdtempSync(path.join(proof,'legacy-'));put(root,'auto-layout/library/projects.json','legacy');assert.equal(collectCode(root).get('auto-layout/library/projects.json').toString(),'legacy');});
