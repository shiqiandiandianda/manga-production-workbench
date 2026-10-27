import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AssetCenterClient} from '../sdk/client.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),directory=path.resolve(process.env.ASSET_CENTER_DATA||path.join(root,'data')),credentials=JSON.parse(fs.readFileSync(path.join(directory,'首次连接凭据.local.json'))),client=new AssetCenterClient({url:'http://127.0.0.1:'+(process.env.ASSET_CENTER_PORT||19080),token:credentials.admin});
const result=await client.request('/api/v1/backup',{method:'POST',data:{}});console.log('备份已保存：'+path.join(directory,'backups',result.name)+'；图片 '+result.images+' 张。');
