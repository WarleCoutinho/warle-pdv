import { DatabaseFailure } from './sqlite/errors.cjs';
import type { Operation, Operations } from '../shared/operational.js';
type Check=(value:unknown)=>void;
const fail=():never=>{throw new DatabaseFailure('INVALID_REQUEST');};
export const text=(max=200,min=1):Check=>v=>{if(typeof v!=='string'||v.length<min||v.length>max||v.includes('\0'))fail();};
export const integer=(min=0):Check=>v=>{if(!Number.isSafeInteger(v)||Number(v)<min)fail();};
const boolean:Check=v=>{if(typeof v!=='boolean')fail();};
const enumeration=(...allowed:string[]):Check=>v=>{if(!allowed.includes(v as string))fail();};
const optional=(check:Check):Check=>v=>{if(v!==undefined)check(v);};
export const object=(fields:Record<string,Check>):Check=>v=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)fail();const r=v as Record<string,unknown>;if(Object.keys(r).some(k=>!Object.hasOwn(fields,k)))fail();for(const [k,check] of Object.entries(fields))check(r[k]);};
const array=(check:Check,max=1000):Check=>v=>{if(!Array.isArray(v)||v.length>max)fail();for(const item of v as unknown[])check(item);};
const record=(check:Check,max=1000):Check=>v=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).length>max)fail();for(const [k,item]of Object.entries(v as object)){text(200)(k);check(item);}};
const money=integer(),id=text(200),req={requestId:id};
const product=object({id,name:text(200),priceInCents:money,category:text(100),active:boolean,emoji:text(30,0),imageDataUrl:optional(text(14000000))});
const item=object({product,quantity:integer(1),unitPriceInCents:money,subtotalInCents:money});
const items=array(item,1000);
const operator=object({id,name:text(80),active:boolean,username:optional(text(80)),role:optional(enumeration('admin','operator')),hasPassword:optional(boolean)});
const settings=object({storeName:text(200),address:text(500,0),phone:text(100,0),receiptFooter:text(200,0),operators:optional(array(operator,1000))});
const amounts=object({cash:money,pix:money,debit:money,credit:money,customer_credit:money});
const counts=object({cash:money,pix:money,debit:money,credit:money});
const empty=object({});
const checks:Record<Operation,Check>={
 'lifecycle.status':empty,'lifecycle.setup':object({settings,username:text(80),name:text(80),password:text(128,6),confirmation:text(128,6),mode:enumeration('testing','production'),confirmed:boolean}),'lifecycle.activate':object({confirmed:boolean}),
 'backup.create':object({secret:text(128,12)}),'backup.verify':object({secret:text(128,12)}),'backup.restore':object({secret:text(128,12),proofId:id,confirmed:boolean}),
 'import.preview':empty,'import.legacyPreview':empty,'import.apply':object({secret:text(128,12),previewId:id,proofId:id,confirmed:boolean}),
 'lifecycle.prepare':object({secret:text(128,12),proofId:id,first:boolean,second:boolean,phrase:text(30)}),'credits.recoverReceipt':object({query:text(200),code:text(200)}),
 'operators.authenticate':object({username:text(80),password:text(128)}),'operators.reauthenticate':object({password:text(128)}),'operators.current':empty,'operators.logout':empty,'operators.list':empty,
 'catalog.list':empty,'catalog.save':object({products:array(product)}),'settings.read':empty,'settings.update':object({settings,passwords:record(text(128),1000)}),'installation.read':empty,
 'sales.list':empty,'sales.get':object({id}),'sales.complete':object({...req,items:array(object({productId:id,quantity:integer(1),unitPriceInCents:money}),1000),totalInCents:money,cashSessionId:id,payments:array(object({method:enumeration('cash','pix','debit','credit','customer_credit'),amountInCents:integer(1),amountReceivedInCents:optional(money),changeInCents:optional(money),customerCreditId:optional(id),capturedAt:optional(text(24))}),100)}),
 'sales.cancel':object({...req,id,reason:enumeration('launch_error','customer_cancelled','payment_error','other'),note:optional(text(300,0))}),
 'cash.read':empty,'cash.open':object({...req,amountInCents:money,operatorId:id}),
 'cash.recordMovement':object({...req,sessionId:id,type:enumeration('supply','withdrawal'),amountInCents:integer(1),description:text(300,0)}),
 'cash.close':object({...req,sessionId:id,counts,reviewedFingerprint:text(1000000)}),
 'financial.snapshot':empty,'financial.recordReturn':object({...req,saleId:id,quantities:record(integer()),cashSessionId:optional(id),reason:optional(text(300))}),
 'financial.settle':object({...req,saleId:id,amounts,statuses:optional(object({cash:optional(enumeration('completed','pending')),pix:optional(enumeration('completed','pending')),debit:optional(enumeration('completed','pending')),credit:optional(enumeration('completed','pending'))})),cashSessionId:optional(id)}),
 'financial.updateRefund':object({...req,id,status:enumeration('completed','failed'),cashSessionId:optional(id)}),'financial.recover':object(req),
 'credits.list':object({query:text(200,0)}),'credits.authorize':object({query:text(200),code:text(200)}),'credits.printReceipt':object({creditId:id}),'credits.readMovements':object({creditId:id}),
 'operations.prepare':object({kind:enumeration('sales.complete','sales.cancel','cash.open','cash.recordMovement','cash.close','financial.recordReturn','financial.settle','financial.updateRefund','financial.recover'),payload:()=>{}}),'operations.acknowledge':object({requestId:id}),'operations.discardPrepared':object({requestId:id}),'operations.list':empty,'operations.read':object({requestId:id}),'draft.read':empty,'draft.save':object({items}),
};
export function validate<K extends Operation>(name:K,payload:unknown):Operations[K]['input'] {
 // IPC structured clone already strips executable objects; bound serialization before recursive checks.
 let encoded:string;try{encoded=JSON.stringify(payload);}catch{return fail();}
 if(!encoded||Buffer.byteLength(encoded)>16000000)fail();
 checks[name](payload);return payload as Operations[K]['input'];
}
