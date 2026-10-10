const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const executable = require('electron');
const root = resolve(__dirname,'..');
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.RAIZ_DESKTOP_DEV_URL;
const temp = () => mkdtempSync(join(tmpdir(),'raiz sqlite desktop 12c1 '));
const pause = ms => new Promise(done=>setTimeout(done,ms));
const launch = profile => electron.launch({args:[root,'--raiz-profile='+profile],env,timeout:20000});
async function state(file) {const db=new DatabaseSync(file,{readOnly:true});try{return db.prepare('SELECT * FROM installation_state').get();}finally{db.close();}}
(async()=>{
 const profile=temp();const production=join(profile,'data','raiz-pdv.sqlite');let desktop;
 try{
  desktop=await launch(profile);await (await desktop.firstWindow()).getByRole('heading',{name:'Configurar Raiz PDV'}).waitFor();assert.ok(existsSync(production));const before=await state(production);
  const secondResult=await new Promise((resolveResult,reject)=>{
   const child=spawn(executable,[root,'--raiz-profile='+profile],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',data=>stderr+=data);
   const timer=setTimeout(()=>{child.kill();reject(Error('SECOND_INSTANCE_NOT_BLOCKED'));},10000);
   child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);resolveResult({code,stderr});});
  });assert.equal(secondResult.code,0);assert.match(secondResult.stderr,/INSTANCE_ALREADY_RUNNING/);assert.deepEqual(await state(production),before);
  const otherProfile=temp();const other=await launch(otherProfile);
  try{await (await other.firstWindow()).getByRole('heading',{name:'Configurar Raiz PDV'}).waitFor();assert.ok(existsSync(join(otherProfile,'data','raiz-pdv.sqlite')));}finally{await other.close();}
  await desktop.close();desktop=null;
  desktop=await electron.launch({args:[root,'--raiz-profile='+profile],env:{...env,RAIZ_DESKTOP_DEV_URL:'http://127.0.0.1:5173/'},timeout:20000});
  await (await desktop.firstWindow()).getByRole('heading',{name:'Configurar Raiz PDV'}).waitFor();const development=join(profile,'data','development','raiz-pdv.sqlite');assert.ok(existsSync(development));assert.deepEqual(await state(production),before);await desktop.close();desktop=null;
  console.log('PASS SQLite desktop: main real, instância única por perfil, perfis distintos simultâneos e arquivos dev/produção separados.');
 }finally{if(desktop)await desktop.close();}
 for(const mode of ['corrupt','inaccessible']){
  const profile=temp();const path=join(profile,'data','raiz-pdv.sqlite');const marker=Buffer.from('CORRUPT_SQLITE_KEEP_ORIGINAL');
  if(mode==='corrupt'){mkdirSync(join(profile,'data'),{recursive:true});writeFileSync(path,marker);}else{writeFileSync(join(profile,'data'),'PRESERVE_BLOCKED_DIRECTORY');}
  desktop=await launch(profile);
  try{
   let body='';for(let i=0;i<100&&!body.includes('DATABASE_INITIALIZATION_FAILED');i++){
    body=await desktop.evaluate(async({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='raiz://app/desktop-error.html');if(!window||!window.isVisible())return '';return window.webContents.executeJavaScript('document.body.innerText');});await pause(100);
   }
   assert.match(body,/DATABASE_INITIALIZATION_FAILED/);assert.doesNotMatch(body,/sqlite|AppData|SELECT|CORRUPT_SQLITE_KEEP_ORIGINAL/);
   if(mode==='corrupt')assert.deepEqual(readFileSync(path),marker);else assert.equal(readFileSync(join(profile,'data'),'utf8'),'PRESERVE_BLOCKED_DIRECTORY');
   console.log('PASS SQLite desktop: '+mode+' mostra diagnóstico seguro e preserva os arquivos.');
  }finally{await desktop.close();desktop=null;}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
