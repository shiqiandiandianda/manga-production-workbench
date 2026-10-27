import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
import {assetMetadata} from '../public/asset-metadata.js';import {inspectAssetBindings,planAssetBindings} from '../public/asset-auto-bind.js';import {normalizeRows,id} from '../public/model.js';import {ensureProjectPanelGeneration,panelContentKey} from '../public/panel-generation.js';import {setPanelReferences,referencesForPanel} from '../public/panel-references.js';import {validateProject} from '../lib/store.mjs';import {createStudio} from '../server.mjs';
const require=createRequire(import.meta.url),native=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')),root=fileURLToPath(new URL('../',import.meta.url));
const asset=(name,role='other')=>({id:id('asset'),name,filePath:'D:/synthetic/'+name,libraryRole:role});

test('读取真实文件命名：编号、全角分隔符、人物状态、场景区域和版本分开，原文件不改名',()=>{const a=asset('宋凌天｜初遇金袍状态.png'),before=structuredClone(a),m=assetMetadata(a);assert.equal(m.name,'宋凌天');assert.equal(m.state,'初遇金袍状态');assert.deepEqual(a,before);const s=assetMetadata(asset('SUP_SCENE_024_DETAIL_聚缘阁_二层雅间_细节_细节_v2.png'));assert.equal(s.role,'scene');assert.equal(s.name,'聚缘阁 · 二层雅间');assert.equal(s.kind,'细节');assert.equal(s.version,'2');});





