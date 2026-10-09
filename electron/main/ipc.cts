import type { IpcMainInvokeEvent } from 'electron';
import { operationNames } from '../shared/operational.js';
import type { Operation, Reply } from '../shared/operational.js';
import { authorizeAppInfo } from './security.cjs';
import { DatabaseFailure } from './sqlite/errors.cjs';
import { printCredit } from './credit-printing.cjs';
import { validate } from './validation.cjs';
import type { OperationalBackend } from './sqlite/backend.cjs';
export async function handleOperation(backend:OperationalBackend,event:Pick<IpcMainInvokeEvent,'sender'|'senderFrame'>,name:Operation,args:unknown[],ownsContents:boolean,developmentUrl:string|null,enabled:boolean):Promise<Reply<unknown>>{
 const frame=event.senderFrame;
 const denied=authorizeAppInfo({ownsContents,isMainFrame:frame===event.sender.mainFrame,origin:frame?.origin??'',frameUrl:frame?.url??'',contentsUrl:event.sender.getURL()},developmentUrl,[]);
 if(denied)return {ok:false,error:{code:'UNAUTHORIZED'}};
 if(!enabled)return {ok:false,error:{code:'UNSUPPORTED_OPERATION'}};
 if(!operationNames.includes(name)||args.length!==1)return {ok:false,error:{code:'INVALID_REQUEST'}};
 try{if(name==='credits.printReceipt'){const input=validate('credits.printReceipt',args[0]);await printCredit(backend,event.sender.id,input.creditId);return {ok:true,value:null};}return {ok:true,value:backend.execute(event.sender.id,name,args[0])};}catch(error){return {ok:false,error:{code:error instanceof DatabaseFailure?error.code:'INVALID_REQUEST'}};}
}
