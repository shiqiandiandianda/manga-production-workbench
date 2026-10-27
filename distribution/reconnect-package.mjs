import fs from 'node:fs';
import path from 'node:path';
import {writeZip} from '../comic/lib/xlsx.mjs';
import {validateEnvelope} from './updates.mjs';
import {digest} from './code-policy.mjs';
export function buildReconnectPackage(root,envelope){
 const channel=JSON.parse(fs.readFileSync(path.join(root,'distribution/channel.json'))),manifest=validateEnvelope(envelope,channel.publicKey),entries=[],files=[];
 const read=name=>{const bytes=fs.readFileSync(path.join(root,name)),row=manifest.files.find(f=>f.path===name);if(!row||row.bytes!==bytes.length||row.sha256!==digest(bytes))throw Object.assign(Error('连接修复组件正在发布，请稍后重试'),{status:503});return bytes;};
 for(const name of ['distribution/channel.json','comic/public/team-release-channel.json'])files.push({path:name,data:read(name).toString('base64')});
 entries.push({name:'修复同事团队连接.cmd',data:read('distribution/Repair-TeamConnection.cmd')},{name:'Repair-TeamConnection.ps1',data:read('distribution/Repair-TeamConnection.ps1')},{name:'reconnect.mjs',data:read('distribution/reconnect.mjs')},{name:'connection-patch.json',data:JSON.stringify({publicKey:channel.publicKey,manifest,signature:envelope.signature,files},null,2)},{name:'使用说明.txt',data:'\uFEFF同事团队连接修复\r\n\r\n1. 完整解压此压缩包，先打开自己原来的漫画工作台。\r\n2. 双击“修复同事团队连接.cmd”。它会找到当前工具并校验原团队的签名，再修正团队、项目中心和画格接入地址。无需重新安装。\r\n3. 工具空闲时自动校验新版并升级重启；有生成任务时先恢复连接，任务结束后在本机版本管理页安全升级。\r\n\r\n保留工程、图片、账号、设备身份及原配对凭据。若本机有人工代码修改，会保留修改并显示具体提示。\r\n主机电脑无需运行此修复包。\r\n当前主机：'+channel.masterUrl+'\r\n发布版本：'+manifest.version+'\r\n'});
 return {bytes:writeZip(entries),version:manifest.version,masterUrl:channel.masterUrl};
}
