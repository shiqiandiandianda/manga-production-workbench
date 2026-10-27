// Runs the main test suite with the right isolation flag for the installed Node.
// Node 23.6+ names it --test-isolation; Node 22 only accepts --experimental-test-isolation.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [major,minor]=process.versions.node.split('.').map(Number);
const isolation=major>23||(major===23&&minor>=6)?'--test-isolation=none':'--experimental-test-isolation=none';
const files=fs.readdirSync(path.join(root,'tests')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>path.join('tests',name));
const result=spawnSync(process.execPath,['--test',isolation,'--test-concurrency=1',...process.argv.slice(2),...files],{cwd:root,stdio:'inherit',windowsHide:true});
process.exit(result.status??1);
