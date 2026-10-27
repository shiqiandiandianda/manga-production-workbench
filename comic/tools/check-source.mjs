import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
let checked=0;for(const directory of ['public','lib','tools']){
 for(const file of fs.readdirSync(directory))if(/\.(js|mjs)$/.test(file)){
  const result=spawnSync(process.execPath,['--check',path.join(directory,file)],{stdio:'inherit',windowsHide:true});if(result.status!==0)process.exit(result.status||1);checked++;
 }
}
const result=spawnSync(process.execPath,['--check','server.mjs'],{stdio:'inherit',windowsHide:true});if(result.status!==0)process.exit(result.status||1);
console.log('Syntax checked '+(checked+1)+' files');
