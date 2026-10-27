import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startMaster} from './publisher.mjs';
import {installShutdown} from './ipc.mjs';

const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : Number(process.argv[index + 1]); };
const port = option('--port', 18914), hubPort = option('--hub-port', 18897), comicPort = option('--comic-port', 18909);
let existing;
try { existing = await fetch('http://127.0.0.1:' + port + '/health', {signal: AbortSignal.timeout(1500)}).then(r => r.json()); } catch {}
if (existing) {
  if (existing.application !== 'comic-team-publisher' || path.resolve(existing.root || '') !== root) throw Error(port + ' 已由另一套服务使用，未停止或覆盖。');
  console.log('主版本发布服务已经运行：http://127.0.0.1:' + port + '/');
} else {
  const privateSettings = path.join(root, 'runtime-data/distribution/master-launch.local.json');
  const config = fs.existsSync(privateSettings) ? JSON.parse(fs.readFileSync(privateSettings)) : {};
  const instance = await startMaster(root, {port, hubPort, comicPort,
    environmentDirectory: config.environmentDirectory || process.env.COMIC_ENVIRONMENT_PACKAGES,
    mokuSessionFile: config.mokuSessionFile || process.env.COMIC_MOKU_SESSION_FILE});
  const close = async () => { await instance.publisher.close(); await instance.hub?.close(); };
  installShutdown({busy: () => instance.publisher.busy || instance.hub?.hub?.state.tasks.some(task => ['running', 'uploading', 'verifying'].includes(task.status)), details:()=>[...instance.publisher.upgradeBlockers,...(instance.hub?.hub?.state.tasks||[]).filter(task=>['running','uploading','verifying'].includes(task.status)).map(()=>({target:'团队画格任务',status:'执行中',message:'正在生成、上传或核验团队画格。',nextAction:'任务结束后即可升级。'}))], close});
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void close().then(() => process.exit(0)).catch(error => console.error(error.message)));
}
