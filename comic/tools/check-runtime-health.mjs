import fs from 'node:fs';
const log='merge-audit/performance/regression-r5.log';if(fs.existsSync(log))console.log(fs.readFileSync(log,'utf8').slice(-2600));
for(const file of ['.runtime/r5-session.stderr.log','.runtime/r5-session.stdout.log'])if(fs.existsSync(file))console.log(file,fs.readFileSync(file,'utf8').slice(-5000));
for(const port of [18896,19080,14426]){try{const r=await fetch('http://127.0.0.1:'+port+'/api/health',{signal:AbortSignal.timeout(1500)});console.log({port,status:r.status});}catch(e){console.log({port,error:e.message});}}
