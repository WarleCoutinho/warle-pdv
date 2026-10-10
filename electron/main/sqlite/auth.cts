import { pbkdf2Sync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { DatabaseFailure } from './errors.cjs';
import type { TransactionContext } from './database.cjs';
import { operators } from './read-model.cjs';
import { parseInstallationState } from './installation.cjs';
import type { CashOperator } from '../../../src/types/settings';
export function credential(password:string) {const salt=randomBytes(16).toString('hex');return {salt,verifier:pbkdf2Sync(password,Buffer.from(salt,'hex'),210000,32,'sha256').toString('hex')};}
export function creditVerifier(code:string) {return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');}
function querySaleNumber(query:string){const normalized=query.trim().replace(/^#?0*/,'');const value=/^\d+$/.test(normalized)?Number(normalized):0;return Number.isSafeInteger(value)?value:0;}
function constantEqual(a:string,b:string){const left=Buffer.from(a,'hex'),right=Buffer.from(b,'hex');return left.length===right.length&&timingSafeEqual(left,right);}
interface Session {operatorId:string; generation:number; fingerprint:string; issued:number; touched:number; recent:number; grants:Map<string,number>}
export class BackendAuth {
 private sessions=new Map<number,Session>();
 private attempts=new Map<string,{count:number;until:number}>();
 constructor(private readonly now:()=>number=Date.now){}
 private fingerprint(db:TransactionContext,id:string){const r=db.get('SELECT o.role,o.active,c.salt,c.verifier,c.parameters_json FROM operators o JOIN operator_credentials c ON c.operator_id=o.id WHERE o.id=?',id);return r?JSON.stringify(r):'';}
 private checkPassword(db:TransactionContext,id:string|undefined,password:string){const r=id?db.get('SELECT * FROM operator_credentials WHERE operator_id=?',id):undefined;const salt=String(r?.salt??'00000000000000000000000000000000');const calculated=pbkdf2Sync(password,Buffer.from(salt,'hex'),210000,32,'sha256').toString('hex');return !!r&&r.algorithm==='PBKDF2-SHA256'&&String(r.parameters_json)==='{"iterations":210000,"length":32}'&&constantEqual(calculated,String(r.verifier));}
 private limited(key:string,check:()=>boolean){const time=this.now(),a=this.attempts.get(key);if(a&&a.until>time&&a.count>=5)throw new DatabaseFailure('RATE_LIMITED');if(!check()){const current=a&&a.until>time?a:{count:0,until:time+900000};current.count++;this.attempts.set(key,current);throw new DatabaseFailure('AUTHENTICATION_FAILED');}this.attempts.delete(key);}
 login(db:TransactionContext,owner:number,username:string,password:string):CashOperator {
  const key=username.trim().toLocaleLowerCase('pt-BR');const r=db.get('SELECT id,active FROM operators WHERE normalized_username=?',key);
  this.limited(`login:${key}`,()=>this.checkPassword(db,r?String(r.id):undefined,password)&&r?.active===1);
  const state=parseInstallationState(db.all('SELECT * FROM installation_state'));
  const operator=operators(db).find(o=>o.id===r!.id)!;
  const time=this.now();this.sessions.set(owner,{operatorId:operator.id,generation:state.generation,fingerprint:this.fingerprint(db,operator.id),issued:time,touched:time,recent:time,grants:new Map()});return operator;
 }
 authorize(db:TransactionContext,owner:number,options:{admin?:boolean;recent?:boolean;financial?:boolean}={}):{operator:CashOperator;session:Session} {
  const s=this.sessions.get(owner),state=parseInstallationState(db.all('SELECT * FROM installation_state')),time=this.now();
  if(!s||s.generation!==state.generation||time-s.issued>28800000||time-s.touched>1800000||s.fingerprint!==this.fingerprint(db,s.operatorId)){this.logout(owner);throw new DatabaseFailure('UNAUTHORIZED');}
  const operator=operators(db).find(o=>o.id===s.operatorId&&o.active);if(!operator){this.logout(owner);throw new DatabaseFailure('UNAUTHORIZED');}
  if(options.admin&&operator.role!=='admin')throw new DatabaseFailure('FORBIDDEN');
  if(options.recent&&time-s.recent>300000)throw new DatabaseFailure('REAUTHENTICATION_REQUIRED');
  if(options.financial){
   if(state.status==='ready_for_setup'||!db.get("SELECT o.id FROM operators o JOIN operator_credentials c ON c.operator_id=o.id WHERE o.active=1 AND o.role='admin'")||!String(db.get('SELECT store_name FROM store_settings WHERE id=1')?.store_name??'').trim())throw new DatabaseFailure('INSTALLATION_BLOCKED');
  }
  s.touched=time;return {operator,session:s};
 }
 current(db:TransactionContext,owner:number){try{return this.authorize(db,owner).operator;}catch(e){if(e instanceof DatabaseFailure&&e.code==='UNAUTHORIZED')return null;throw e;}}
 reauthenticate(db:TransactionContext,owner:number,password:string){const {operator,session}=this.authorize(db,owner);this.limited(`reauth:${operator.id}`,()=>this.checkPassword(db,operator.id,password));session.recent=this.now();}
 invalidateAll(){this.sessions.clear();}
 logout(owner:number){this.sessions.delete(owner);}
 revoke(operatorId:string){for(const [owner,s]of this.sessions)if(s.operatorId===operatorId)this.logout(owner);}
 authorizeCredit(db:TransactionContext,owner:number,query:string,code:string){const {session}=this.authorize(db,owner,{financial:true});const rows=db.all('SELECT * FROM customer_credits WHERE upper(receipt_number)=? OR original_sale_number=?',query.trim().toUpperCase(),querySaleNumber(query));let matched:Record<string,unknown>|undefined;
  this.limited(`credit:${session.operatorId}`,()=>{const verifier=creditVerifier(code);matched=rows.find(r=>constantEqual(verifier,String(r.authorization_verifier)));return !!matched;});
  session.grants.set(String(matched!.id),this.now()+300000);const reserved=Number(db.get("SELECT coalesce(sum(amount_cents),0) AS amount FROM customer_credit_reservations WHERE credit_id=? AND state='reserved'",String(matched!.id))!.amount);return {...matched!,balance_cents:Math.max(0,Number(matched!.balance_cents)-reserved)};
 }
 requireCredit(session:Session,id:string){if((session.grants.get(id)??0)<=this.now())throw new DatabaseFailure('CREDIT_UNAUTHORIZED');}
 clearGrants(owner:number){this.sessions.get(owner)?.grants.clear();}
}
