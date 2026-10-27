import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

export function isPrimaryInstallation(root) {
  const file = path.join(root, 'runtime-data/distribution/master/master.local.json');
  if (!fs.existsSync(file)) return false;
  const identity = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!identity.privateKey || !identity.publicKey) throw Error('主版本身份文件不完整，请保留原文件并恢复主版本配置');
  return true;
}

function portIsBusy(port) {
  return new Promise(resolve => {
    const socket = net.connect({host: '127.0.0.1', port});
    const finish = busy => { socket.destroy(); resolve(busy); };
    socket.setTimeout(1500, () => finish(true));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

// The signing identity is private to the primary installation and is never in colleague packages.
export async function ensurePrimaryPublisher(root, {port = 18914, hubPort = 18897, comicPort = 18909, launch, timeout = 180000} = {}) {
  if (!isPrimaryInstallation(root)) return null;
  for (const value of [port, hubPort, comicPort]) {
    if (!Number.isSafeInteger(value) || value < 1024 || value > 65535) throw Error('团队中心端口无效：' + value);
  }
  const url = 'http://127.0.0.1:' + port;
  const verify = health => {
    if (health.application !== 'comic-team-publisher' || !health.root || path.resolve(health.root) !== path.resolve(root)) {
      throw Error(port + ' 已由另一套服务使用，未停止或覆盖。');
    }
    return health;
  };
  const health = async () => {
    const response = await fetch(url + '/health', {signal: AbortSignal.timeout(1500)});
    if (!response.ok) throw Error('团队中心健康检查失败：HTTP ' + response.status);
    return verify(await response.json());
  };
  if (await portIsBusy(port)) {
    try { return {url, reused: true, health: await health()}; }
    catch (error) { throw Error('团队中心端口已使用，未启动重复服务：' + error.message); }
  }
  const child = await launch('publisher', 'distribution/launch-master.mjs', [root, '--port', String(port), '--hub-port', String(hubPort), '--comic-port', String(comicPort)]);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) throw Error('团队中心启动失败，请查看 runtime-data/logs/publisher.log');
    try { return {url, reused: false, health: await health()}; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error('团队中心启动超时，请查看 runtime-data/logs/publisher.log');
}
