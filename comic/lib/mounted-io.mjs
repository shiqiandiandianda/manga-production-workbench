// Mounted/shared paths use one IO operation at a time. Keep folder scans and
// image previews from competing for CloudDrive2's network connection.
export const isMountedImagePath=value=>/^(K:[\\/]|\\\\)/i.test(String(value));
const configured=Number(process.env.COMIC_MOUNTED_IO_INTERVAL_MS),interval=Number.isFinite(configured)&&configured>=100?Math.min(configured,5000):300;
let queue=Promise.resolve(),last=0;
export function mountedImageIO(file,operation){
 if(!isMountedImagePath(file))return operation();
 const task=queue.then(async()=>{const delay=Math.max(0,last+interval-Date.now());if(delay)await new Promise(resolve=>setTimeout(resolve,delay));last=Date.now();return operation();});
 queue=task.catch(()=>{});return task;
}
