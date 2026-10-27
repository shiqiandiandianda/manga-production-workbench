const net=require('node:net'),cp=require('node:child_process'),fs=require('node:fs');
const local=h=>!h||['localhost','127.0.0.1','::1','[::1]','0.0.0.0'].includes(String(h));
const deny=message=>{throw Error('QUALITY_GUARD: '+message)};
const originalFetch=globalThis.fetch;globalThis.fetch=async(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!local(u.hostname))deny('non-loopback request '+u.origin);return originalFetch(input,options)};
for(const method of ['connect','createConnection']){const original=net[method];net[method]=function(...args){const first=args[0],host=first&&typeof first==='object'?first.host:typeof args[1]==='string'?args[1]:null;if(!local(host))deny('external socket '+host);return original.apply(this,args)}}
for(const method of ['spawn','spawnSync','execFile','execFileSync','exec','execSync']){const original=cp[method];cp[method]=function(command,...args){const value=String(command);if(/(?:^|[\\/\s])(docker|ssh|scp|sudo|su|codex|dreamina|jimeng|powershell|pwsh|cmd)(?:\.exe|\.cmd)?(?:\s|$)/i.test(value))deny('privileged or live CLI '+value);return original.call(this,command,...args)}}
for(const method of ['readFile','readFileSync']){const original=fs[method];fs[method]=function(file,...args){const p=String(file).replaceAll('\\','/');if(/(?:^|\/)(?:auth\.json|\.env|id_rsa|id_ed25519)$/.test(p)&&!p.startsWith(process.env.QUALITY_STAGE.replaceAll('\\','/')))deny('credential file read');return original.call(this,file,...args)}}
require('node:module').syncBuiltinESMExports();
