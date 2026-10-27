import test from 'node:test';import assert from 'node:assert/strict';
import {createProject} from '../public/model.js';
import {missingEpisodePages,assignMissingEpisodes,explicitPageEpisode} from '../public/project-episode-classification.js';
test('首次共享显式补话号，错误输入整批不写，已有话与画格身份不改变',()=>{
 const p=createProject('合成工程'),first=p.pages[0],other=structuredClone(first);other.id='another-page';other.storyboard={episode:8};p.pages.push(other);const original=structuredClone(p);
 for(const value of ['十二','1e2','-1','0','12.1','10000','']){assert.throws(()=>assignMissingEpisodes(p,{[first.id]:value}),/阿拉伯数字/);assert.deepEqual(p,original);}
 assignMissingEpisodes(p,{[first.id]:'0012'});assert.equal(explicitPageEpisode(p,first),12);assert.equal(other.storyboard.episode,8);assert.deepEqual(first.panels,original.pages[0].panels);assert.deepEqual(p.shots,original.shots);assert.equal(missingEpisodePages(p).length,0);
});
test('两块未归属画板必须逐一确认，导入单话资料沿用明确来源',()=>{
 const p=createProject('合成工程');p.pages.push({...structuredClone(p.pages[0]),id:'second'});const original=structuredClone(p);
 assert.throws(()=>assignMissingEpisodes(p,{[p.pages[0].id]:'12'}));assert.deepEqual(p,original);
 assignMissingEpisodes(p,{[p.pages[0].id]:'12',second:'13'});assert.deepEqual(p.pages.map(x=>x.storyboard.episode),[12,13]);
 const imported=createProject();imported.productionPackage={episodes:[{episode:15}]};assert.equal(missingEpisodePages(imported).length,0);
});
