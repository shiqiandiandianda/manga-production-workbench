import {build} from 'vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await build({root,configFile:fileURLToPath(new URL('../vite.config.mjs',import.meta.url))});
await build({root,configFile:false,ssr:{noExternal:['zod']},build:{ssr:'server/index.mjs',outDir:'runtime',emptyOutDir:false,target:'node22',rollupOptions:{external:[/^node:/],output:{entryFileNames:'server.mjs',chunkFileNames:'chunks/[name]-[hash].mjs'}}}});
