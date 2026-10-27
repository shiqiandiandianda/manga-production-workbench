import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';import {decodeRelease} from './updates.mjs';import {safeTarget,digest} from './code-policy.mjs';
export async function buildDelivery(root,destination,{python}={}){
 const channel=JSON.parse(fs.readFileSync(path.join(root,'distribution/channel.json'))),publisher=process.env.TEAM_PUBLISHER_BUILD_URL||channel.masterUrl,envelope=await fetch(publisher+'/api/releases/latest').then(r=>r.json()),response=await fetch(publisher+'/releases/'+envelope.manifest.contentId+'.json.gz');if(!response.ok)throw Error('主版本发布包不可读');const bundle=decodeRelease(Buffer.from(await response.arrayBuffer()),channel.publicKey),code=path.join(destination,'漫画制作工作台');if(fs.existsSync(code)&&fs.readdirSync(code).length)throw Error('交付代码目录非空，未覆盖：'+code);fs.mkdirSync(code,{recursive:true});
 for(const [relative,bytes]of bundle.files){const target=safeTarget(code,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}fs.writeFileSync(path.join(code,'RELEASE.json'),JSON.stringify({manifest:bundle.manifest,signature:bundle.signature},null,2));
 const archive=path.join(destination,'漫画制作工作台_主机同源代码_'+bundle.manifest.version.replaceAll(' ','_')+'.zip'),pythonBin=python||process.env.COMIC_PYTHON_BIN||path.resolve(root,'../runtime/python/python.exe');
 const script=`import sys,zipfile,pathlib,hashlib,json
root=pathlib.Path(sys.argv[1]); archive=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted(root.rglob('*')):
  if p.is_file(): z.write(p,'漫画制作工作台/'+p.relative_to(root).as_posix())
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 meta=json.loads(z.read('漫画制作工作台/RELEASE.json'))
 assert len(z.namelist())==len(meta['manifest']['files'])+1
 for row in meta['manifest']['files']:
  b=z.read('漫画制作工作台/'+row['path']);assert len(b)==row['bytes'] and hashlib.sha256(b).hexdigest()==row['sha256']
print(json.dumps({'verified':True,'files':len(z.namelist())}))`;
 const built=spawnSync(pythonBin,['-B','-c',script,code,archive],{encoding:'utf8',windowsHide:true});if(built.status!==0)throw Error('压缩包回读验证失败：'+built.stderr);const report={archive,code,version:bundle.manifest.version,files:bundle.manifest.files.length+1,bytes:fs.statSync(archive).size,sha256:digest(fs.readFileSync(archive)),zipReadbackVerified:true,accountsIncluded:false,userProjectsIncluded:false,modelsDownloadedSeparately:true};fs.writeFileSync(path.join(destination,'交付校验.json'),JSON.stringify(report,null,2));
 for(const name of ['同事Codex接入指南.md','主版本发布与升级说明.md'])fs.copyFileSync(path.join(code,name),path.join(destination,name));return report;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){const root=path.resolve(process.argv[2]||path.join(path.dirname(fileURLToPath(import.meta.url)),'..')),destination=path.resolve(process.argv[3]||'./delivery');console.log(JSON.stringify(await buildDelivery(root,destination)));}
