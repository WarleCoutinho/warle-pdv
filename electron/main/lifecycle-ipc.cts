import {BrowserWindow,dialog} from 'electron';
import {readFileSync,lstatSync,existsSync} from 'node:fs';
import type {IpcMainInvokeEvent} from 'electron';
import type {LifecycleOperation} from '../shared/lifecycle';
import {validate} from './validation.cjs';
import {DatabaseFailure} from './sqlite/errors.cjs';
import type {LifecycleCoordinator} from './sqlite/lifecycle.cjs';
import {printCredit} from './credit-printing.cjs';
export async function handleLifecycle(c:LifecycleCoordinator,event:Pick<IpcMainInvokeEvent,'sender'>,name:LifecycleOperation,payload:unknown){
 const window=BrowserWindow.fromWebContents(event.sender);if(!window)throw new DatabaseFailure('UNAUTHORIZED');const owner=event.sender.id;
 const confirm=async(message:string)=>{const result=await dialog.showMessageBox(window,{type:'warning',title:'Raiz PDV',message,buttons:['Cancelar','Confirmar'],defaultId:0,cancelId:0,noLink:true});return result.response===1;};
 const select=async(extension:string)=>{const r=await dialog.showOpenDialog(window,{title:'Selecionar backup',properties:['openFile'],filters:[{name:'Backup Raiz PDV',extensions:[extension]}]});return r.canceled?null:r.filePaths[0];};
 const destination=async()=>{const r=await dialog.showSaveDialog(window,{title:'Salvar backup externo protegido',defaultPath:'raiz-pdv-'+new Date().toISOString().replaceAll(':','-')+'.raizbackup',filters:[{name:'Backup protegido',extensions:['raizbackup']}]});if(r.canceled||!r.filePath)return null;return r.filePath;};
 switch(name){
 case 'lifecycle.status':validate(name,payload);return {...c.status(),legacyWebDataAvailable:await event.sender.executeJavaScript("Boolean(localStorage.getItem('raiz-pdv:completed-sales')||localStorage.getItem('raiz-pdv:products'))")};
 case 'lifecycle.setup':return c.setup(owner,validate(name,payload));
 case 'lifecycle.activate':return c.activate(owner,validate(name,payload).confirmed);
 case 'backup.create':{const i=validate(name,payload),path=await destination();if(!path)return null;const overwrite=existsSync(path);if(overwrite&&!await confirm('Este arquivo já existe. Preservar uma cópia anterior e substituir o backup selecionado?'))return null;return c.backup(owner,path,i.secret,overwrite);}
 case 'backup.verify':{const i=validate(name,payload),path=await select('raizbackup');return path?c.verify(owner,path,i.secret):null;}
 case 'backup.restore':{const i=validate(name,payload),path=await select('raizbackup');if(!path)return null;if(!i.confirmed||!await confirm('Restaurar este backup? O banco atual será preservado. Todas as sessões serão encerradas.'))throw new DatabaseFailure('CONFIRMATION_REQUIRED');return c.restore(owner,path,i.secret,i.proofId,i.confirmed);}
 case 'import.legacyPreview':{validate(name,payload);const data=await event.sender.executeJavaScript("(()=>{const keys={products:'raiz-pdv:products',settings:'raiz-pdv:settings',sales:'raiz-pdv:completed-sales',cash:'raiz-pdv:cash',financial:'raiz-pdv:sale-financial-data'};return Object.fromEntries(Object.entries(keys).map(([name,key])=>[name,localStorage.getItem(key)]));})()");const parsed:Record<string,unknown>={};try{for(const key of ['products','settings','sales','cash']){if(data[key]===null)throw 0;parsed[key]=JSON.parse(data[key]);}if(data.financial!==null)parsed.financial=JSON.parse(data.financial);}catch{throw new DatabaseFailure('IMPORT_INVALID');}const serialized=JSON.stringify(parsed);let hash=0x811c9dc5;for(let n=0;n<serialized.length;n++){hash^=serialized.charCodeAt(n);hash=Math.imul(hash,0x01000193);}return c.preview(owner,JSON.stringify({format:'raiz-pdv-backup',version:data.financial===null?1:2,exportedAt:new Date().toISOString(),data:parsed,integrity:{algorithm:'fnv1a-32',checksum:(hash>>>0).toString(16).padStart(8,'0')}}));}
 case 'import.preview':{validate(name,payload);const path=await select('json');if(!path)return null;if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()||lstatSync(path).size>10*1024*1024)throw new DatabaseFailure('IMPORT_INVALID');return c.preview(owner,readFileSync(path,'utf8'));}
 case 'import.apply':{const i=validate(name,payload);return c.import(owner,i.previewId,i.proofId,i.confirmed,i.secret);}
 case 'lifecycle.prepare':{const i=validate(name,payload);if(c.status().status!=='testing')throw new DatabaseFailure('FORBIDDEN');if(!await confirm('SEGUNDA CONFIRMAÇÃO: remover todos os dados de teste e exigir novo administrador e estabelecimento?'))throw new DatabaseFailure('CONFIRMATION_REQUIRED');return c.prepare(owner,i);}
 case 'credits.recoverReceipt':{const i=validate(name,payload);const id=c.backend.database.transaction(db=>{c.backend.auth.authorize(db,owner,{admin:true,recent:true,financial:true});const credit=c.backend.auth.authorizeCredit(db,owner,i.query,i.code) as Record<string,unknown>;if(!credit)throw new DatabaseFailure('CREDIT_UNAUTHORIZED');db.run('UPDATE customer_credits SET receipt_ciphertext=? WHERE id=?',c.backend.custody!.seal(i.code.trim().toUpperCase()),String(credit.id));return String(credit.id);});await printCredit(c.backend,owner,id);return null;}
 }
}
