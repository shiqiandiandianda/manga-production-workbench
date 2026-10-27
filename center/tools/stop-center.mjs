import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),directory=path.resolve(process.env.ASSET_CENTER_DATA||path.join(root,'data')),file=path.join(directory,'server.local.json');
if(!fs.existsSync(file))console.log('没有本中心启动会话，未停止任何其他进程。');
else{const owner=JSON.parse(fs.readFileSync(file));if(!/^[a-f0-9]{48}$/.test(owner.session))throw Error('启动会话无效');fs.writeFileSync(path.join(directory,'stop.local.json'),JSON.stringify({session:owner.session}));console.log('已请求本中心停止；正在处理的上传会先完成。');}
