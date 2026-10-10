import { DatabaseFailure } from './sqlite/errors.cjs';
import { randomUUID } from 'node:crypto';
import { BrowserWindow, session } from 'electron';
import type { OperationalBackend } from './sqlite/backend.cjs';
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Dedicated receipt renderer has no preload/API, no network and no permissions. Secret never crosses IPC. */
export async function openCreditReceipt(backend:OperationalBackend,owner:number,creditId:string):Promise<BrowserWindow>{
 const receipt=backend.receipt(owner,creditId),store=receipt.settings,c=receipt.credit;
 const partition=session.fromPartition(`raiz-receipt-${randomUUID()}`);
 partition.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));partition.setPermissionCheckHandler(()=>false);
 const window=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,webviewTag:false,session:partition}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.webContents.on('will-attach-webview',event=>event.preventDefault());
 const issued=new Date(c.issuedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
 const copies=['Via do cliente','Via da loja'].map(copy=>`<article><h1>${escape(store.storeName)}</h1><p>COMPROVANTE DE CRÉDITO</p><p>${escape(c.receiptNumber)}</p><p>Venda de origem: ${c.originalSaleNumber}</p><p>Emitido em: ${escape(issued)}</p><p>Valor: R$ ${(c.originalAmountInCents/100).toFixed(2).replace('.',',')}</p><p>Código de autorização:<br><strong>${escape(receipt.authCode)}</strong></p><p>Guarde este código e apresente-o para utilizar seu crédito.</p><p>${escape(store.receiptFooter)}</p><small>${copy}</small></article>`).join('');
 const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Comprovante de crédito</title><style>body{font:12px monospace;max-width:72mm;margin:4mm auto}article{break-inside:avoid;margin-bottom:8mm;border-bottom:1px dashed black;padding-bottom:4mm}h1{font-size:16px}p{overflow-wrap:anywhere}@page{margin:4mm}</style>${copies}</html>`;
 const url=`raiz://receipt/${randomUUID()}`;
 partition.protocol.handle('raiz',request=>request.method==='GET'&&request.url===url?new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}}):new Response('Forbidden',{status:403}));
 window.on('closed',()=>partition.protocol.unhandle('raiz'));
 try{await window.loadURL(url);return window;}catch{window.destroy();throw new DatabaseFailure('PRINT_FAILED');}
}

export async function printCredit(backend:OperationalBackend,owner:number,creditId:string):Promise<void>{
 const window=await openCreditReceipt(backend,owner,creditId);
 try{await new Promise<void>((resolve,reject)=>window.webContents.print({silent:false,printBackground:false},success=>success?resolve():reject(new DatabaseFailure('PRINT_FAILED'))));}finally{window.destroy();}
}
