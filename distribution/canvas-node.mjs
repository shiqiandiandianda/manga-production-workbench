import fs from 'node:fs';import {createNodeAgent} from '../协作/lib/node-core.mjs';import {installShutdown} from './ipc.mjs';
const config=JSON.parse(fs.readFileSync(process.argv[2]));const agent=createNodeAgent({config,logger:(level,message)=>console.log(level+' '+message)});
installShutdown({busy:()=>agent.status().runningTasks.length>0,close:()=>agent.stop()});await agent.start();setInterval(()=>{},60000);
