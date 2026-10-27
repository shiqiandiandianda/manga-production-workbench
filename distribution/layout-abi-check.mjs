// Compile and link only: never evaluate application code, create services or run model tasks.
import vm from 'node:vm';import path from 'node:path';
let raw='';for await(const b of process.stdin)raw+=b;
const input=JSON.parse(raw),context=vm.createContext({}),cache=new Map(),external=new Map();
const files=new Map(Object.entries(input.files)),symbols=new Set(['default']);
for(const code of files.values())for(const match of code.matchAll(/[A-Za-z_$][\w$]*/g))symbols.add(match[0]);
function moduleFor(name){
 if(cache.has(name))return cache.get(name);
 const code=files.get(name);if(code===undefined)throw Error('排版依赖文件缺失：'+name);
 const m=name.endsWith('.json')?new vm.SyntheticModule(['default'],()=>{},{context,identifier:name}):new vm.SourceTextModule(code,{context,identifier:name});cache.set(name,m);return m;
}
async function load(specifier,referencing){
 if(specifier.startsWith('.')){
  const name=path.posix.normalize(path.posix.join(path.posix.dirname(referencing.identifier),specifier));
  if(name.startsWith('../')||path.posix.isAbsolute(name))throw Error('排版依赖路径越界');
  return moduleFor(name);
 }
 if(!external.has(specifier)){
  // Non-relative packages are outside the ownership boundary. Builtin export names are checked.
  const names=specifier.startsWith('node:')?Object.keys(await import(specifier)):[...symbols];
  external.set(specifier,new vm.SyntheticModule(names,()=>{},{context,identifier:specifier}));
 }
 return external.get(specifier);
}
try{
 for(const name of input.roots){const m=moduleFor(name);if(m.status==='unlinked')await m.link(load);}
 process.stdout.write(JSON.stringify({passed:true,roots:input.roots.length,compiledModules:cache.size,evaluatedModules:0}));
}catch(e){process.stderr.write(e.message);process.exitCode=1;}
