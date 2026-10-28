import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {isFetchBlockedPort,listenForFetch} from '../../tests/fixtures/loopback-http.mjs';

test('隔离 HTTP 夹具避开 Fetch 禁用端口并可实际读取',async t=>{
 for(const port of [6000,6665,6666,6667,6668,6669,10080])assert.equal(isFetchBlockedPort(port),true);
 assert.equal(isFetchBlockedPort(10081),false);
 const server=http.createServer((_req,res)=>res.end('synthetic'));
 t.after(()=>{server.closeAllConnections();server.close();});
 const origin=await listenForFetch(server);
 assert.equal(isFetchBlockedPort(new URL(origin).port),false);
 assert.equal(await (await fetch(origin)).text(),'synthetic');
});

test('运行器在端口不可用时透明重试，只触发一次监听回调',async t=>{
 assert.ok(process.env.QUALITY_PORTS_FILE,'须通过隔离测试运行器执行');
 const server=http.createServer((_req,res)=>res.end('retry-safe')),address=server.address.bind(server);let first=true,listening=0,closed=0,callback=0;
 server.address=()=>{const value=address();if(value&&first){first=false;return {...value,port:1720};}return value;};
 server.on('listening',()=>listening++);server.on('close',()=>closed++);
 t.after(()=>{server.closeAllConnections();server.close();});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({port:0,host:'127.0.0.1'},()=>{callback++;resolve();});});
 assert.equal(first,false);assert.equal(listening,1);assert.equal(callback,1);assert.equal(closed,0);
 const port=server.address().port;assert.equal(isFetchBlockedPort(port),false);
 assert.equal(await (await fetch('http://127.0.0.1:'+port)).text(),'retry-safe');
});
