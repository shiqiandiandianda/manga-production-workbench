import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),dependencies=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies');
const env={...process.env,TEMP:path.join(root,'.runtime/temp'),TMP:path.join(root,'.runtime/temp'),COMIC_CANVAS_MODULE:process.env.COMIC_CANVAS_MODULE||path.join(dependencies,'node/node_modules/@napi-rs/canvas'),COMIC_TEST_CANVAS_MODULE:process.env.COMIC_TEST_CANVAS_MODULE||path.join(dependencies,'node/node_modules/@napi-rs/canvas'),COMIC_PYTHON_BIN:process.env.COMIC_PYTHON_BIN||path.join(dependencies,'python/python.exe'),PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'};
const additions=['panel-reference-completeness','board-height-tail-save','frame-display-name','dialogue-tail-repair','asset-workbench-client','asset-generator.integration','comic-art-direction','breakout-production','prompt-source','browser-prompt-source','browser-low-resolution-fill','panel-generation','jimeng','generation-queue.integration'];
const files=[...additions,...(process.argv.includes('--generation-shortcuts')?['page-generation','browser-generation-shortcuts','browser-page-generation','browser-panel-generation','browser-toolbar-layout','browser-episode-workspace','frame-shortcuts','episode-workspace','generation-frame-sizing','editor-performance','browser-editor-performance','browser-connection-height','half-pair','browser-half-pair','storyboard-layout-batch']:['browser-generation-shortcuts','page-generation','editor-performance','generation-frame-sizing','codex','frame-shortcuts','gap-background','browser-editor-performance','browser-connection-height','asset-center.integration','source-plan-preview','browser-directory-picker','directory-assets','asset-auto-match','asset-bindings','asset-production','project-asset-library','episode-workspace','half-pair','storyboard-layout-batch','storyboard-production','start-integrated','generation-slots','native-image-channel','browser-half-pair','browser-storyboard-layout-batch','browser-project-asset-library'])].map(name=>'tests/'+name+'.test.mjs');
// One file per child, awaited to exit before the next. No cross-file browser overlap or retained fixtures.
let total=0;
for(const file of files){
 const result=spawnSync(process.execPath,['--test','--test-isolation=none','--test-concurrency=1','--test-reporter=spec',file],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:2*1024*1024});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');total+=Number(/tests (\d+)/.exec(result.stdout||'')?.[1]||0);
 if(result.status!==0){console.error('Stopped after '+file+': '+(result.error?.message||result.status));process.exitCode=1;break;}
}
if(!process.exitCode)console.log('SERIAL_TOTAL tests='+total+'; failed=0; browsers never overlap across files');
