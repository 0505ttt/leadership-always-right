import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
let commit='development';
try { commit=execSync('git rev-parse --short HEAD',{stdio:['ignore','pipe','ignore']}).toString().trim(); } catch { /* First build precedes first commit. */ }
export default defineConfig({base:'/leadership-always-right/',define:{__BUILD_COMMIT__:JSON.stringify(process.env.GITHUB_SHA?.slice(0,7)||commit)},build:{target:'es2022'},server:{port:5173}});
