import fs from 'node:fs';
import {pipeline} from 'node:stream';

// Streams a file to an HTTP response without ever crashing the process.
// A missing or unreadable file becomes an ordinary 404 before any header is sent,
// so the caller's normal JSON error path still works. A read error after the
// headers are out only ends that one response.
// request 可选：传入后按文件大小与修改时间生成 ETag，浏览器再次打开时文件没变就回 304，不再重复下载（字体每个 10 MB 以上）。
export async function sendFile(response,file,headers={},{missingMessage='文件不存在或已被移除',request=null}={}){
  let handle;
  try{
    handle=await fs.promises.open(file,'r');
    const stat=await handle.stat();
    if(!stat.isFile())throw new Error('not a file');
    if(response.destroyed){await handle.close();return;}
    if(request){
      const etag='"'+stat.size.toString(36)+'-'+Math.floor(stat.mtimeMs).toString(36)+'"';headers={...headers,ETag:etag};
      if(request.headers['if-none-match']===etag){await handle.close();response.writeHead(304,headers);response.end();return;}
    }
    response.writeHead(200,{...headers,'Content-Length':stat.size});
  }catch(error){
    await handle?.close().catch(()=>{});
    throw Object.assign(new Error(missingMessage),{status:404});
  }
  await new Promise(resolve=>pipeline(handle.createReadStream(),response,()=>resolve()));
}
