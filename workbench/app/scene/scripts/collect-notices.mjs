import {createRequire} from 'node:module';
import {readFileSync,readdirSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));const seen=new Set(),sections=[];
function collect(name,from){const require=createRequire(path.join(from,'package.json'));let entry;try{entry=require.resolve(name+'/package.json');}catch{try{entry=require.resolve(name);}catch{return;}}let dir=path.dirname(entry);while(!existsSync(path.join(dir,'package.json'))&&path.dirname(dir)!==dir)dir=path.dirname(dir);let pkg;try{pkg=JSON.parse(readFileSync(path.join(dir,'package.json'),'utf8'));}catch{return;}if(pkg.name!==name){const parent=path.dirname(dir);if(existsSync(path.join(parent,'package.json'))){dir=parent;pkg=JSON.parse(readFileSync(path.join(dir,'package.json'),'utf8'));}}const id=pkg.name+'@'+pkg.version;if(seen.has(id))return;seen.add(id);const texts=readdirSync(dir).filter(n=>/^(license|copying|notice)/i.test(n)).map(n=>readFileSync(path.join(dir,n),'utf8'));sections.push(id+'\n'+texts.join('\n'));for(const dep of Object.keys(pkg.dependencies||{}))collect(dep,dir);}
for(const name of ['react','react-dom','lucide-react','mammoth','zod'])collect(name,root);
mkdirSync(path.join(root,'licenses'),{recursive:true});writeFileSync(path.join(root,'licenses','DEPENDENCY-LICENSES.txt'),sections.join('\n\n====================\n\n'));
