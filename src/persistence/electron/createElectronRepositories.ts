import {desktopFailure} from './errors';
import type { DomainApi, Operation, Operations, FinancialOperation } from '../../../electron/shared/operational.js';
import type { PdvRepositories, ChangeTopic, CommandOptions } from '../contracts';
/** Explicit composition only. The application's default context remains web. */
export function createElectronRepositories(api:DomainApi):PdvRepositories {
 const listeners=new Set<{topics:readonly ChangeTopic[]; listener:()=>void}>();
 const uncertain=new Map<string,string>();
 const notify=(topics:readonly ChangeTopic[])=>{for(const item of listeners)if(item.topics.some(t=>topics.includes(t)))item.listener();};
 const ordinary=async<K extends Operation>(name:K,input:Operations[K]['input'])=>{try{return await api[name](input);}catch(error){throw desktopFailure(error);}};
 async function command<K extends FinancialOperation,R=Operations[K]['output']>(name:K,payload:Omit<Operations[K]['input'],'requestId'>,options:CommandOptions|undefined,topics:readonly ChangeTopic[],afterCommit?:(value:Operations[K]['output'])=>Promise<R>):Promise<R>{
  const key=JSON.stringify([name,payload]);const requestId=options?.requestId??uncertain.get(key)??(await ordinary('operations.prepare',{kind:name,payload})).requestId;uncertain.set(key,requestId);
  try{
  const outcome=await api[name]({...payload,requestId} as Operations[K]['input']);
  const result=afterCommit?await afterCommit(outcome):outcome as R;await api['operations.acknowledge']({requestId});uncertain.delete(key);notify(topics);return result;
  }catch(error){
   const failure=desktopFailure(error,requestId);
   // Only a confirmed rollback can release an intention. Transport/printing failures retain its ID.
   if(['INVALID_REQUEST','SALE_INVALID','ALREADY_RESOLVED','INSUFFICIENT_FUNDS','CASH_UNAVAILABLE','FORBIDDEN','DATABASE_CONSTRAINT'].includes(failure.code)){
    try{const state=await ordinary('operations.read',{requestId});if(state.status==='prepared'){await ordinary('operations.discardPrepared',{requestId});uncertain.delete(key);}else if(state.status==='unknown')uncertain.delete(key);}catch{ /* Retain identity when the rollback cannot be confirmed. */ }
   }
   throw failure;
  }
 }
 const unsupported=async():Promise<never>=>{throw desktopFailure(new Error('UNSUPPORTED_OPERATION'));};
 const all=['sales','cash','financial'] as const;
 return {
  requiresAuthenticatedReads:true,
  operations:{list:()=>ordinary('operations.list',{}),read:requestId=>ordinary('operations.read',{requestId}),discardPrepared:async requestId=>{await ordinary('operations.discardPrepared',{requestId});},acknowledge:async requestId=>{await ordinary('operations.acknowledge',{requestId});}},
  products:{list:()=>ordinary('catalog.list',{}),replaceCatalog:async products=>{await ordinary('catalog.save',{products});notify(['products']);}},
  settings:{load:()=>ordinary('settings.read',{}),save:async(settings,passwords={})=>{const value=await ordinary('settings.update',{settings,passwords});notify(['settings','operator']);return value;}},
  operators:{list:()=>ordinary('operators.list',{}),current:()=>ordinary('operators.current',{}),login:async(username,password)=>{const operator=await ordinary('operators.authenticate',{username,password});notify(['operator','products']);return operator;},logout:async()=>{await ordinary('operators.logout',{});notify(['operator']);},reauthenticate:async password=>{await ordinary('operators.reauthenticate',{password});},hasDefaultPassword:async()=>false},
  sales:{list:()=>ordinary('sales.list',{}),getById:id=>ordinary('sales.get',{id}),complete:input=>{const {requestId,...inputData}=input;const payload={...inputData,items:input.items.map(item=>({productId:item.product.id,quantity:item.quantity,unitPriceInCents:item.unitPriceInCents})),payments:input.payments.map(({capturedAt:_,...payment})=>payment)};return command('sales.complete',payload,{requestId},all);},cancel:(id,reason,note,options)=>command('sales.cancel',{id,reason,...(note?{note}:{})},options,all)},
  cash:{read:()=>ordinary('cash.read',{}),open:(amountInCents,operatorId,options)=>command('cash.open',{amountInCents,operatorId},options,all,()=>ordinary('cash.read',{})),move:(sessionId,type,amountInCents,description,options)=>command('cash.recordMovement',{sessionId,type,amountInCents,description},options,all,()=>ordinary('cash.read',{})),close:(sessionId,counts,reviewedFingerprint,options)=>command('cash.close',{sessionId,counts,reviewedFingerprint},options,all,()=>ordinary('cash.read',{}))},
  financial:{snapshot:()=>ordinary('financial.snapshot',{}),recordReturn:(sale,quantities,cashSessionId,options)=>command('financial.recordReturn',{saleId:sale.id,quantities,...(cashSessionId?{cashSessionId}:{})},options,all,async()=> (await ordinary('financial.snapshot',{})).financial),settle:async(sale,input)=>{const {requestId,...payload}=input;const result=await command('financial.settle',{saleId:sale.id,...payload},{requestId},all,async value=>{for(const credit of value.issuedCredits)await ordinary('credits.printReceipt',{creditId:credit.id});return {data:(await ordinary('financial.snapshot',{})).financial,issuedCredits:value.issuedCredits.map(credit=>({credit,printedByBackend:true as const}))};});return result;},updateRefund:(id,status,cashSessionId,options)=>command('financial.updateRefund',{id,status,...(cashSessionId?{cashSessionId}:{})},options,all,async()=> (await ordinary('financial.snapshot',{})).financial),recover:async()=>{await command('financial.recover',{},undefined,all);}},
  credits:{search:query=>query.trim()?ordinary('credits.list',{query}):Promise.resolve([]),authenticate:async(query,code)=>(await ordinary('credits.authorize',{query,code}))??undefined},
  draft:{load:()=>ordinary('draft.read',{}),save:async items=>{await ordinary('draft.save',{items});notify(['draft']);}},
  backups:{exportJson:unsupported,validateJson:unsupported,import:unsupported,safetyCopy:unsupported,clearLocalData:unsupported},
  changes:{subscribe:(topics,listener)=>{const item={topics,listener};listeners.add(item);return()=>{listeners.delete(item);};}},
 };
}
