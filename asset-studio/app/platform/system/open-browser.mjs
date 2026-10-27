/**
 * 打开系统默认浏览器。失败不抛错：启动器不应因为打不开浏览器而退出。
 */
import {spawn} from 'node:child_process';

export function openBrowser(url) {
  if (!url) return false;
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
      return true;
    }
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(command, [url], {detached: true, stdio: 'ignore'});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
