import test from 'node:test';
import assert from 'node:assert/strict';
import {applyProductionModeDefault} from '../public/production-mode-default.js';
import {productionProject} from '../lib/production-package-document.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {syntheticFiles} from './helpers/two-screen-package.mjs';
test('new screens inherit available defaults; existing screens and explicit single mode stay intact',async()=>{
 const p=productionProject(await inspectProductionPackage(syntheticFiles()));
 applyProductionModeDefault(p,'imported');
 for(const f of p.pages.flatMap(p=>p.panels).filter(f=>f.productionSegment))assert.equal(f.generation.promptSource,'imported');
 const prior=structuredClone(p);applyProductionModeDefault(p,'post-lettering',prior);assert.deepEqual(p,prior);
 p.productionPackage.sourceFormat='single-mode-20261027';const fixed=structuredClone(p);applyProductionModeDefault(p,'post-lettering');assert.deepEqual(p,fixed);
 assert.throws(()=>applyProductionModeDefault(p,'invalid'),/无效/);
});
