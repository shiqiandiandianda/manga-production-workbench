import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},esbuild:{jsx:'automatic'},server:{proxy:{'/api':'http://127.0.0.1:8765'}},build:{outDir:'dist',emptyOutDir:true}});
