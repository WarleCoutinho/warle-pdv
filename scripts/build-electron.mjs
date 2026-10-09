import { build } from 'vite';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { dirname, basename, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const tsc=resolve(dirname(require.resolve('typescript/package.json')),'bin','tsc');
const check=spawnSync(process.execPath,[tsc,'-p','tsconfig.electron.json','--noEmit'],{cwd:root,stdio:'inherit',windowsHide:true});
if(check.status!==0)process.exit(check.status??1);
function entries(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?entries(join(directory,entry.name)):entry.name.endsWith('.cts')?[join(directory,entry.name)]:[]);}
for(const input of entries(join(root,'electron'))){
 const output=join(root,'dist-electron',relative(join(root,'electron'),dirname(input)));
 await build({root,configFile:false,logLevel:'error',publicDir:false,ssr:{noExternal:true},build:{ssr:input,target:'node24',outDir:output,emptyOutDir:false,minify:false,sourcemap:false,rolldownOptions:{external:specifier=>specifier==='electron'||specifier.startsWith('node:'),output:{format:'cjs',entryFileNames:basename(input,'.cts')+'.cjs',exports:'named',codeSplitting:false}}}});
}
console.log('Main/preload compilados; domínio compartilhado incluído em CommonJS.');
