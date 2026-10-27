import {rename} from 'node:fs/promises';
// Windows readers (including archive copies) can briefly hold a file against replacement.
export async function replaceFile(temporary,target){
  for(let attempt=0;;attempt++){
    try{await rename(temporary,target);return;}
    catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=8)throw error;await new Promise(resolve=>setTimeout(resolve,Math.min(200,20*(attempt+1))));}
  }
}
