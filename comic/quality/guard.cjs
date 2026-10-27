// Defence in depth for the repository's synthetic tests. This is not an OS sandbox.
// Each test may connect only to servers it created in its own run directory.
const fs = require('node:fs');
const net = require('node:net');
const cp = require('node:child_process');
const Module = require('node:module');
const path = require('node:path');
const deny = message => { throw new Error('QUALITY_GUARD: ' + message); };
const registry = process.env.QUALITY_PORTS_FILE;
if (!registry || !process.env.QUALITY_STAGE || !process.env.QUALITY_RUN_DIR) deny('missing isolation settings');
const originalRealpath = fs.realpathSync.native || fs.realpathSync;
const originalExists = fs.existsSync;
const roots = [process.env.QUALITY_STAGE, process.env.QUALITY_RUN_DIR].map(p => path.resolve(p).toLowerCase());
const readRoots = [...roots,...JSON.parse(process.env.QUALITY_READ_ROOTS||'[]')].map(p=>{try{return originalRealpath(p).toLowerCase();}catch{return path.resolve(p).toLowerCase();}});
function checkRead(file) {
  if(typeof file==='number')return;
  if(file instanceof URL)file=require('node:url').fileURLToPath(file);
  if(typeof file!=='string'&&!Buffer.isBuffer(file))deny('unknown filesystem read');
  const resolved=path.resolve(String(file));let parent=resolved;
  while(!originalExists(parent)&&path.dirname(parent)!==parent)parent=path.dirname(parent);
  let physical;try{physical=path.resolve(originalRealpath(parent),path.relative(parent,resolved)).toLowerCase();}catch{deny('cannot resolve filesystem read '+resolved);}
  if(!readRoots.some(root=>physical===root||physical.startsWith(root+path.sep)))deny('read outside test directory and declared dependencies '+resolved);
}
function checkWrite(file) {
  if (typeof file === 'number') return;
  if (file instanceof URL) file = require('node:url').fileURLToPath(file);
  if (typeof file !== 'string' && !Buffer.isBuffer(file)) deny('unknown filesystem target');
  const resolved = path.resolve(String(file));
  let parent = resolved;
  while (!originalExists(parent) && path.dirname(parent) !== parent) parent = path.dirname(parent);
  let physical;
  try { physical = path.resolve(originalRealpath(parent), path.relative(parent, resolved)).toLowerCase(); }
  catch { deny('cannot resolve filesystem target ' + resolved); }
  if (!roots.some(root => physical === root || physical.startsWith(root + path.sep))) deny('write outside test directory ' + resolved);
}
for (const method of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync', 'createWriteStream']) {
  const original = fs[method];
  fs[method] = function (file, ...args) { checkWrite(file); return original.call(this, file, ...args); };
}
const changesFile = flags => typeof flags === 'string' ? /[wax+]/.test(flags) : typeof flags === 'number' && !!(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND));
for (const method of ['open','openSync']) {
  const original=fs[method];
  fs[method]=function(file,flags,...args){if(changesFile(flags))checkWrite(file);else checkRead(file);return original.call(this,file,flags,...args);};
}
for (const method of ['writeFile','appendFile','mkdir','mkdtemp','rm','rmdir','unlink']) {
  const original=fs.promises[method];
  if(original)fs.promises[method]=function(file,...args){checkWrite(file);return original.call(this,file,...args);};
}
for (const method of ['rename','copyFile']) {
  const original=fs.promises[method];
  fs.promises[method]=function(from,to,...args){if(method==='rename')checkWrite(from);else checkRead(from);checkWrite(to);return original.call(this,from,to,...args);};
}
const promiseOpen=fs.promises.open;
fs.promises.open=function(file,flags,...args){if(changesFile(flags))checkWrite(file);else checkRead(file);return promiseOpen.call(this,file,flags,...args);};
for (const method of ['rename', 'renameSync', 'copyFile', 'copyFileSync']) {
  const original = fs[method];
  fs[method] = function (from, to, ...args) { if (method.startsWith('rename')) checkWrite(from); else checkRead(from); checkWrite(to); return original.call(this, from, to, ...args); };
}
for(const method of ['readFile','readFileSync','createReadStream','readdir','readdirSync','opendir','opendirSync']){
  const original=fs[method];if(original)fs[method]=function(file,...args){checkRead(file);return original.call(this,file,...args);};
}
for(const method of ['readFile','readdir','opendir']){
  const original=fs.promises[method];if(original)fs.promises[method]=function(file,...args){checkRead(file);return original.call(this,file,...args);};
}
for(const method of ['cp','cpSync']){
  const original=fs[method];if(original)fs[method]=function(from,to,...args){checkRead(from);checkWrite(to);return original.call(this,from,to,...args);};
}
if(fs.promises.cp){const original=fs.promises.cp;fs.promises.cp=function(from,to,...args){checkRead(from);checkWrite(to);return original.call(this,from,to,...args);};}
const loopback = h => !h || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(h).toLowerCase());
function allowedPort(port) {
  try { return fs.readFileSync(registry, 'utf8').split(/\s+/).includes(String(port)); } catch { return false; }
}
const listen=net.Server.prototype.listen;
net.Server.prototype.listen=function(...args){
  if(typeof args[0]==='number'){
    if(typeof args[1]==='function'||args[1]===undefined)args.splice(1,0,'127.0.0.1');
    else if(!loopback(args[1]))deny('server must bind to loopback');
  }else if(args[0]&&typeof args[0]==='object'){
    if(args[0].path)deny('named-pipe or Unix-socket listener');
    if(!loopback(args[0].host))deny('server must bind to loopback');
    args[0]={...args[0],host:args[0].host||'127.0.0.1'};
  }else deny('named-pipe or Unix-socket listener');
  return listen.apply(this,args);
};
const emit = net.Server.prototype.emit;
net.Server.prototype.emit = function (event, ...args) {
  if (event === 'listening') {
    const address = this.address();
    if (address && typeof address === 'object') {
      if (!loopback(address.address)) deny('server must bind to loopback');
      fs.appendFileSync(registry, String(address.port) + '\n');
      this.__qualityPort=String(address.port);
    }
  }
  if(event==='close'&&this.__qualityPort){
    try{const ports=fs.readFileSync(registry,'utf8').split(/\s+/).filter(port=>port&&port!==this.__qualityPort);fs.writeFileSync(registry,ports.join('\n')+'\n');}catch{}
    this.__qualityPort=null;
  }
  return emit.call(this, event, ...args);
};
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // Node normalizes connect arguments to an array in some internal callers.
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  const opts = first && typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (opts.path) deny('named-pipe or Unix-socket access');
  if (!loopback(opts.host) || !allowedPort(opts.port)) deny('unregistered network destination ' + String(opts.host) + ':' + String(opts.port));
  return connect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, options) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!loopback(url.hostname) || !allowedPort(url.port || (url.protocol === 'https:' ? 443 : 80))) deny('unregistered fetch destination ' + url.origin);
  return originalFetch(input, options);
};
for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) {
  const original = cp[method];
  cp[method] = function (command, ...args) {
    const value = String(command);
    if (/(?:^|[\\/\s])(docker|ssh|scp|sudo|su|codex|dreamina|jimeng|powershell|pwsh|cmd)(?:\.exe|\.cmd)?(?:\s|$)/i.test(value)) deny('privileged or live CLI ' + value);
    return original.call(this, command, ...args);
  };
}
const load = Module._load;
Module._load = function (request, parent, main) {
  const value = load.call(this, request, parent, main);
  if (/(?:^|[\\/])playwright(?:-core)?(?:[\\/]|$)/.test(String(request)) && value && value.chromium && typeof value.chromium.launch === 'function' && !value.chromium.__qualityGuarded) {
    const configured = (options = {}) => {
      if (!process.env.QUALITY_BROWSER_PROXY) deny('browser proxy is required');
      options={...options};
      if(process.env.QUALITY_BROWSER_EXECUTABLE){delete options.channel;options.executablePath=process.env.QUALITY_BROWSER_EXECUTABLE;}
      else if(process.platform==='win32'&&!options.channel&&!options.executablePath)options.channel='msedge';
      const args = (options.args || []).filter(x => !/^--proxy-(?:server|bypass-list)/.test(x));
      args.push('--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1');
      return { ...options, args, proxy: { server: process.env.QUALITY_BROWSER_PROXY } };
    };
    const launch = value.chromium.launch.bind(value.chromium);
    value.chromium.launch = async options => {
      try { return await launch(configured(options)); }
      catch (error) {
        // Browser 156 can reject a freshly created isolated profile before a
        // page opens. Retry this exact startup failure once, and mark the run
        // flaky so the report never treats the retry as a clean pass.
        if (!/DevTools remote debugging requires a non-default data directory/i.test(String(error?.message))) throw error;
        process.stderr.write('QUALITY_BROWSER_RETRY: isolated browser profile startup failed; retrying once\n');
        return launch(configured(options));
      }
    };
    const persistent = value.chromium.launchPersistentContext.bind(value.chromium);
    value.chromium.launchPersistentContext = (profile,options) => {checkWrite(profile);return persistent(profile,configured(options));};
    value.chromium.connect = () => deny('remote browser connection');
    value.chromium.connectOverCDP = () => deny('remote browser connection');
    value.chromium.__qualityGuarded = true;
  }
  return value;
};
require('node:module').syncBuiltinESMExports();
