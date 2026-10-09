import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { canonicalJson, SqliteFoundation } from './database.cjs';
import type { TransactionContext, JsonValue } from './database.cjs';
import { DatabaseFailure } from './errors.cjs';
import { BackendAuth, credential, creditVerifier } from './auth.cjs';
import { commercialDate } from './installation.cjs';
import * as read from './read-model.cjs';
import { validate } from '../validation.cjs';
import type { Operation, Operations } from '../../shared/operational.js';
import type { CashOperator, StoreSettings } from '../../../src/types/settings';
import type { Sale } from '../../../src/types/sale';
import type { Product, CartItem } from '../../../src/types/product';
import { sumMoney, multiplyMoney } from '../../../src/utils/money';
import { getSaleUnresolvedAmount, getSaleResolvedAmount } from '../../../src/domain/financial';
import { getCashSummary, getCashReconciliationDraft, createCashReconciliation, paymentMethods } from '../../../src/domain/cash';
function fail(code:ConstructorParameters<typeof DatabaseFailure>[0]):never{throw new DatabaseFailure(code);}
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
const normalized=(value:string)=>value.trim().toLocaleLowerCase('pt-BR');
export class OperationalBackend {
 readonly auth:BackendAuth;
 private drafts=new Map<number,CartItem[]>();
 constructor(readonly database:SqliteFoundation,private readonly now:()=>number=Date.now,private readonly vault?:{seal:(secret:string)=>Uint8Array;open:(ciphertext:Uint8Array)=>string}){this.auth=new BackendAuth(now);}
 private assertLedger(db:TransactionContext){
  const data=read.financial(db),sales=read.sales(db);
  for(const c of data.credits){const movements=data.creditMovements.filter(m=>m.creditId===c.id),redeemed=sumMoney(movements.filter(m=>m.type==='redeemed').map(m=>m.amountInCents)),restored=sumMoney(movements.filter(m=>m.type==='restored').map(m=>m.amountInCents)),reserved=sumMoney(data.creditReservations.filter(r=>r.creditId===c.id).map(r=>r.amountInCents));if(c.balanceInCents!==c.originalAmountInCents-redeemed+restored||reserved>c.balanceInCents)fail('RECOVERY_BLOCKED');}
  for(const sale of sales){const used=new Map<string,number>();for(const p of sale.payments)if(p.method==='customer_credit')used.set(p.customerCreditId!,sumMoney([used.get(p.customerCreditId!)??0,p.amountInCents]));for(const [id,amount]of used){const redeemed=sumMoney(data.creditMovements.filter(m=>m.creditId===id&&m.saleId===sale.id&&m.type==='redeemed').map(m=>m.amountInCents)),restored=sumMoney(data.creditMovements.filter(m=>m.creditId===id&&m.saleId===sale.id&&m.type==='restored').map(m=>m.amountInCents));if(redeemed!==amount||(sale.status==='cancelled'?restored!==amount:restored!==0)||data.creditReservations.some(r=>r.saleId===sale.id))fail('RECOVERY_BLOCKED');}}
 }
 private instant(){return new Date(this.now()).toISOString();}
 /** Main-only extension point for the future setup coordinator. No IPC/default password/state transition. */
 configureInitialAdministrator(input:{username:string;name:string;password:string;storeName:string}){
  if(!input.username.trim()||input.username.length>80||!input.name.trim()||input.name.length>80||input.password.length<6||input.password.length>128||!input.storeName.trim()||input.storeName.length>200)fail('INVALID_REQUEST');
  return this.database.transaction(db=>{const state=db.get('SELECT * FROM installation_state')!;if(state.status==='production'||db.get('SELECT id FROM operators LIMIT 1'))fail('FORBIDDEN');const id=randomUUID(),c=credential(input.password);
   db.run("INSERT INTO operators(id,name,username,normalized_username,role,active) VALUES(?,?,?,?,'admin',1)",id,input.name.trim(),input.username.trim(),normalized(input.username));this.writeCredential(db,id,c);
   db.run("INSERT INTO store_settings VALUES(1,?,'','','',1,'{}')",input.storeName.trim());return id;
  });
 }
 private writeCredential(db:TransactionContext,id:string,c:ReturnType<typeof credential>){db.run("INSERT INTO operator_credentials VALUES(?,'PBKDF2-SHA256',?, ?,?,?) ON CONFLICT(operator_id) DO UPDATE SET parameters_json=excluded.parameters_json,salt=excluded.salt,verifier=excluded.verifier,changed_at=excluded.changed_at",id,'{"iterations":210000,"length":32}',c.salt,c.verifier,this.instant());}
 receipt(owner:number,creditId:string){return this.query(owner,(db,operator)=>{const r=db.get('SELECT c.*,f.operator_id AS issuer FROM customer_credits c JOIN financial_refunds f ON f.credit_id=c.id WHERE c.id=?',creditId);if(!r||!r.receipt_ciphertext||!this.vault||(r.issuer!==operator.id&&operator.role!=='admin'))fail('FORBIDDEN');return {credit:read.credit(r),settings:read.settings(db),authCode:this.vault.open(r.receipt_ciphertext as Uint8Array)};},{recent:true,financial:true});}
 disconnect(owner:number){this.auth.logout(owner);this.drafts.delete(owner);}
 private command<T>(owner:number,name:Operation,input:{requestId:string},work:(db:TransactionContext,operator:CashOperator)=>T):T {
  const {requestId,...payload}=input;
  const recent=['sales.cancel','financial.settle','financial.updateRefund','cash.close','financial.recover'].includes(name);
  let operator:CashOperator|undefined;
  return this.database.executeRequest({requestId,kind:name,payload:json(payload)},db=>{
   db.run('UPDATE operation_requests SET operator_id=?,generation=? WHERE request_id=?',operator!.id,this.database.installationState().generation,requestId);
   try{return json(work(db,operator!));}catch(error){if(error instanceof RangeError)fail('INVALID_REQUEST');throw error;}
  },db=>{
   const auth=this.auth.authorize(db,owner,{financial:true,recent});operator=auth.operator;
   if(name!=='financial.recover')this.assertLedger(db);
   const previous=db.get('SELECT operator_id,generation FROM operation_requests WHERE request_id=?',requestId);
   if(previous&&(previous.operator_id!==operator.id||previous.generation!==auth.session.generation))fail('FORBIDDEN');
  }) as T;
 }
 private activeCash(db:TransactionContext,operator:CashOperator,id:string,today=true){const cash=read.cash(db);const session=cash.sessions.find(s=>s.id===id);if(!session||session.status!=='open'||(session.operatorId!==operator.id&&(today||operator.role!=='admin'))||(today&&session.businessDate!==commercialDate(this.instant())))fail('CASH_UNAVAILABLE');return {cash,session};}
 private sale(db:TransactionContext,id:string){return read.sales(db).find(s=>s.id===id)??fail('SALE_INVALID');}
 private available(db:TransactionContext,id:string){const r=db.get('SELECT * FROM customer_credits WHERE id=?',id);if(!r||r.status==='cancelled')fail('CREDIT_UNAUTHORIZED');const reserved=db.get("SELECT coalesce(sum(amount_cents),0) AS amount FROM customer_credit_reservations WHERE credit_id=? AND state='reserved'",id)!;return {r,amount:Number(r.balance_cents)-Number(reserved.amount)};}
 private setBalance(db:TransactionContext,id:string,balance:number){const original=Number(db.get('SELECT original_cents FROM customer_credits WHERE id=?',id)?.original_cents);if(!Number.isSafeInteger(balance)||balance<0||balance>original)fail('INSUFFICIENT_FUNDS');db.run('UPDATE customer_credits SET balance_cents=?,status=? WHERE id=?',balance,balance===0?'redeemed':balance===original?'available':'partial',id);}
 private writeCatalog(db:TransactionContext,products:Product[]){
  const ids=new Set<string>();for(const p of products){if(ids.has(p.id)||!p.name.trim()||!p.category.trim())fail('INVALID_REQUEST');ids.add(p.id);const category=normalized(p.category);let cid=db.get('SELECT id FROM categories WHERE normalized_name=?',category)?.id as string|undefined;if(!cid){cid=randomUUID();db.run('INSERT INTO categories VALUES(?,?,?)',cid,p.category.trim(),category);}
   let imageId:string|null=null;if(p.imageDataUrl){const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/]+={0,2})$/.exec(p.imageDataUrl);if(!match)fail('INVALID_REQUEST');const bytes=Buffer.from(match[2],'base64');if(bytes.length<1||bytes.length>10485760||bytes.toString('base64')!==match[2])fail('INVALID_REQUEST');const hash=createHash('sha256').update(bytes).digest('hex');imageId=db.get('SELECT id FROM product_images WHERE content_hash=? AND mime_type=?',hash,match[1])?.id as string??randomUUID();if(!db.get('SELECT id FROM product_images WHERE id=?',imageId))db.run('INSERT INTO product_images VALUES(?,?,?,?)',imageId,match[1],bytes,hash);}
   db.run('INSERT INTO products VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category_id=excluded.category_id,price_cents=excluded.price_cents,active=excluded.active,emoji=excluded.emoji,image_id=excluded.image_id',p.id,p.name.trim(),cid,p.priceInCents,p.active?1:0,p.emoji,imageId);
  }
  for(const r of db.all('SELECT id FROM products'))if(!ids.has(String(r.id)))db.run('UPDATE products SET active=0 WHERE id=?',String(r.id));
 }
 private updateSettings(db:TransactionContext,settings:StoreSettings,passwords:Record<string,string>){
  if(!settings.storeName.trim())fail('INVALID_REQUEST');
  const existing=read.operators(db),directory=settings.operators??existing,ids=new Set<string>(),names=new Set<string>();
  if(existing.some(o=>!directory.some(next=>next.id===o.id)))fail('FORBIDDEN');
  for(const o of directory){const username=(o.username??'').trim(),key=normalized(username);if(!o.name.trim()||!key||ids.has(o.id)||names.has(key))fail('INVALID_REQUEST');ids.add(o.id);names.add(key);if(!existing.some(v=>v.id===o.id)&&!passwords[o.id])fail('INVALID_REQUEST');}
  if(Object.keys(passwords).some(id=>!ids.has(id)))fail('INVALID_REQUEST');
  for(const o of directory){db.run('INSERT INTO operators VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,username=excluded.username,normalized_username=excluded.normalized_username,role=excluded.role,active=excluded.active',o.id,o.name.trim(),o.username!.trim(),normalized(o.username!),o.role??'operator',o.active?1:0);if(passwords[o.id]){if(passwords[o.id].length<6)fail('INVALID_REQUEST');this.writeCredential(db,o.id,credential(passwords[o.id]));}}
  if(!db.get("SELECT o.id FROM operators o JOIN operator_credentials c ON c.operator_id=o.id WHERE o.active=1 AND o.role='admin'"))fail('FORBIDDEN');
  db.run("INSERT INTO store_settings VALUES(1,?,?,?,?,1,'{}') ON CONFLICT(id) DO UPDATE SET store_name=excluded.store_name,address=excluded.address,phone=excluded.phone,receipt_footer=excluded.receipt_footer",settings.storeName.trim(),settings.address,settings.phone,settings.receiptFooter);
  return read.settings(db);
 }
 private complete(db:TransactionContext,owner:number,operator:CashOperator,input:Operations['sales.complete']['input']):Sale{
  this.activeCash(db,operator,input.cashSessionId);if(!input.items.length)fail('SALE_INVALID');const catalog=read.products(db);
  const items=input.items.map((item,index)=>{const p=catalog.find(p=>p.id===item.productId&&p.active);if(!p||item.unitPriceInCents!==p.priceInCents)fail('SALE_INVALID');return {lineId:`line-${index+1}`,productId:p.id,productName:p.name,unitPriceInCents:p.priceInCents,quantity:item.quantity,subtotalInCents:multiplyMoney(p.priceInCents,item.quantity)};});
  const total=sumMoney(items.map(i=>i.subtotalInCents));if(total<=0||total!==input.totalInCents||sumMoney(input.payments.map(p=>p.amountInCents))!==total||input.payments.filter(p=>p.method==='cash').length>1)fail('SALE_INVALID');
  const payments=input.payments.map(p=>{if(p.method==='customer_credit'&&!p.customerCreditId||p.method!=='customer_credit'&&p.customerCreditId)fail('SALE_INVALID');const received=p.method==='cash'?(p.amountReceivedInCents??p.amountInCents):p.amountInCents;if(received<p.amountInCents)fail('SALE_INVALID');return {...p,received,change:received-p.amountInCents};});
  const credits=new Map<string,number>();for(const p of payments)if(p.method==='customer_credit')credits.set(p.customerCreditId!,sumMoney([credits.get(p.customerCreditId!)??0,p.amountInCents]));
  const auth=this.auth.authorize(db,owner,{financial:true});for(const [id,amount]of credits){this.auth.requireCredit(auth.session,id);if(this.available(db,id).amount<amount)fail('INSUFFICIENT_FUNDS');}
  const id=randomUUID(),date=this.instant(),number=Number(db.get('SELECT next_number FROM sale_sequence WHERE id=1')!.next_number);if(!Number.isSafeInteger(number+1))fail('SALE_INVALID');
  for(const [creditId,amount]of credits)db.run("INSERT INTO customer_credit_reservations VALUES(?,?,?,?,?,?,'reserved')",randomUUID(),creditId,input.requestId,id,amount,date);
  db.run("INSERT INTO sales(id,number,occurred_at,cash_session_id,operator_id,status,total_cents,generation,operator_name_snapshot) VALUES(?,?,?,?,?,'completed',?,?,?)",id,number,date,input.cashSessionId,operator.id,total,auth.session.generation,operator.name);
  items.forEach((i,index)=>db.run('INSERT INTO sale_items VALUES(?,?,?,?,?,?,?,?,?)',id,i.lineId,index,i.productId,i.productId,i.productName,i.unitPriceInCents,i.quantity,i.subtotalInCents));
  payments.forEach((p,index)=>db.run('INSERT INTO sale_payments VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),id,index,p.method,p.amountInCents,p.received,p.change,p.customerCreditId??null,date));
  for(const [creditId,amount]of credits){const r=db.get('SELECT balance_cents FROM customer_credits WHERE id=?',creditId)!;this.setBalance(db,creditId,Number(r.balance_cents)-amount);db.run("INSERT INTO customer_credit_movements(id,credit_id,type,amount_cents,occurred_at,sale_id,cash_session_id,operator_id) VALUES(?,?,'redeemed',?,?,?,?,?)",randomUUID(),creditId,amount,date,id,input.cashSessionId,operator.id);db.run("UPDATE customer_credit_reservations SET state='consumed' WHERE sale_id=? AND credit_id=?",id,creditId);}
  db.run('UPDATE sale_sequence SET next_number=? WHERE id=1',number+1);return this.sale(db,id);
 }
 private cancel(db:TransactionContext,operator:CashOperator,input:Operations['sales.cancel']['input']){
  if(input.reason==='other'&&!input.note?.trim())fail('INVALID_REQUEST');
  const sale=this.sale(db,input.id);if(sale.status==='cancelled')fail('ALREADY_RESOLVED');const data=read.financial(db),redemptions=data.creditMovements.filter(m=>m.saleId===sale.id&&m.type==='redeemed');
  const restore=sumMoney(redemptions.map(m=>m.amountInCents));if(sumMoney([getSaleResolvedAmount(sale.id,data),restore])>sale.totalInCents)fail('ALREADY_RESOLVED');
  db.run("UPDATE sales SET status='cancelled' WHERE id=?",sale.id);db.run('INSERT INTO sale_cancellations VALUES(?,?,?,?,?)',sale.id,operator.id,this.instant(),input.reason,input.note?.trim()||null);
  for(const m of redemptions){const r=db.get('SELECT balance_cents FROM customer_credits WHERE id=?',m.creditId)!;this.setBalance(db,m.creditId,sumMoney([Number(r.balance_cents),m.amountInCents]));db.run("INSERT INTO customer_credit_movements(id,credit_id,type,amount_cents,occurred_at,sale_id,cash_session_id,operator_id) VALUES(?,?,'restored',?,?,?,?,?)",randomUUID(),m.creditId,m.amountInCents,this.instant(),sale.id,sale.cashSessionId??null,operator.id);}
  return this.sale(db,sale.id);
 }
 private recordReturn(db:TransactionContext,operator:CashOperator,input:Operations['financial.recordReturn']['input']){
  const sale=this.sale(db,input.saleId);if(sale.status==='cancelled')fail('ALREADY_RESOLVED');if(input.cashSessionId)this.activeCash(db,operator,input.cashSessionId);
  const data=read.financial(db),keys=new Set(sale.items.map(i=>i.lineId!));if(Object.keys(input.quantities).some(k=>!keys.has(k)))fail('INVALID_REQUEST');
  const items=sale.items.flatMap(i=>{const quantity=input.quantities[i.lineId!]??0,returned=data.returns.filter(r=>r.saleId===sale.id).flatMap(r=>r.items).filter(r=>r.lineId===i.lineId).reduce((n,r)=>n+r.quantity,0);if(quantity+returned>i.quantity)fail('ALREADY_RESOLVED');return quantity?[{...i,quantity,amount:multiplyMoney(i.unitPriceInCents,quantity)}]:[];});
  const amount=sumMoney(items.map(i=>i.amount));if(amount<=0)fail('INVALID_REQUEST');const id=randomUUID();db.run('INSERT INTO merchandise_returns(id,sale_id,sale_number_snapshot,cash_session_id,operator_id,occurred_at,amount_cents,reason) VALUES(?,?,?,?,?,?,?,?)',id,sale.id,sale.number,input.cashSessionId??null,operator.id,this.instant(),amount,input.reason??'returned_merchandise');
  items.forEach((i,index)=>db.run('INSERT INTO merchandise_return_items VALUES(?,?,?,?,?,?,?,?,?)',id,index,sale.id,i.lineId!,i.productId,i.productName,i.unitPriceInCents,i.quantity,i.amount));return read.financial(db).returns.find(entry=>entry.id===id)!;
 }
 private settle(db:TransactionContext,operator:CashOperator,input:Operations['financial.settle']['input']){
  const sale=this.sale(db,input.saleId),data=read.financial(db),total=sumMoney(Object.values(input.amounts));if(total<=0||total>getSaleUnresolvedAmount(sale,data))fail('ALREADY_RESOLVED');if(input.cashSessionId)this.activeCash(db,operator,input.cashSessionId);
  if(input.amounts.cash){if(!input.cashSessionId)fail('CASH_UNAVAILABLE');if((input.statuses?.cash??'completed')==='completed'){const {cash,session}=this.activeCash(db,operator,input.cashSessionId);if(getCashSummary(session,cash.movements,read.sales(db),data).expectedInCents<input.amounts.cash)fail('INSUFFICIENT_FUNDS');}}
  const issuedCredits=[],refundIds:string[]=[];for(const method of [...paymentMethods,'customer_credit'] as const){const amount=input.amounts[method];if(!amount)continue;const id=randomUUID(),date=this.instant(),status=method==='customer_credit'?'completed':input.statuses?.[method]??'completed';let creditId:string|null=null;refundIds.push(id);
   if(method==='customer_credit'){if(!this.vault)fail('UNSUPPORTED_OPERATION');creditId=randomUUID();const code=randomBytes(12).toString('hex').toUpperCase();db.run('INSERT INTO customer_credits(id,receipt_number,original_sale_id,original_sale_number,issued_at,original_cents,balance_cents,status,authorization_verifier,issuing_cash_session_id,receipt_ciphertext) VALUES(?,?,?,?,?,?,?,?,?,?,?)',creditId,`CR-${sale.number}-${randomBytes(8).toString('hex').toUpperCase()}`,sale.id,sale.number,date,amount,amount,'available',creditVerifier(code),input.cashSessionId??null,this.vault.seal(code));issuedCredits.push(read.credit(db.get('SELECT * FROM customer_credits WHERE id=?',creditId)!));/* Encrypted custody for main-controlled printing; never included in reply/request. */}
   db.run('INSERT INTO financial_refunds(id,sale_id,sale_number_snapshot,method,amount_cents,status,requested_at,completed_at,cash_session_id,credit_id,operator_id,completed_by_operator_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,sale.id,sale.number,method,amount,status,date,status==='completed'?date:null,input.cashSessionId??null,creditId,operator.id,status==='completed'?operator.id:null);
   if(creditId)db.run("INSERT INTO customer_credit_movements(id,credit_id,type,amount_cents,occurred_at,sale_id,refund_id,cash_session_id,operator_id) VALUES(?,?,'issued',?,?,?,?,?,?)",randomUUID(),creditId,amount,date,sale.id,id,input.cashSessionId??null,operator.id);
  }return {refunds:read.financial(db).refunds.filter(refund=>refundIds.includes(refund.id)),issuedCredits};
 }
 private refund(db:TransactionContext,operator:CashOperator,input:Operations['financial.updateRefund']['input']){
  const r=db.get('SELECT * FROM financial_refunds WHERE id=?',input.id);if(!r||r.status!=='pending'||r.method==='customer_credit')fail('ALREADY_RESOLVED');if(input.cashSessionId)this.activeCash(db,operator,input.cashSessionId);
  if(input.status==='completed'&&r.method==='cash'){if(!input.cashSessionId)fail('CASH_UNAVAILABLE');const {cash,session}=this.activeCash(db,operator,input.cashSessionId);if(getCashSummary(session,cash.movements,read.sales(db),read.financial(db)).expectedInCents<Number(r.amount_cents))fail('INSUFFICIENT_FUNDS');}
  db.run('UPDATE financial_refunds SET status=?,completed_at=?,cash_session_id=?,completed_by_operator_id=? WHERE id=?',input.status,input.status==='completed'?this.instant():null,input.status==='completed'?input.cashSessionId??null:r.cash_session_id as string|null,input.status==='completed'?operator.id:null,input.id);return read.financial(db).refunds.find(refund=>refund.id===input.id)!;
 }
 private open(db:TransactionContext,operator:CashOperator,input:Operations['cash.open']['input']){if(input.operatorId!==operator.id)fail('FORBIDDEN');const day=commercialDate(this.instant());if(db.get("SELECT id FROM cash_sessions WHERE status='open' AND (business_date=? OR operator_id=? OR operator_id IS NULL)",day,operator.id))fail('CASH_UNAVAILABLE');const id=randomUUID();db.run("INSERT INTO cash_sessions VALUES(?,?,?,?,?,NULL,?,'open')",id,operator.id,operator.name,day,this.instant(),input.amountInCents);return read.cash(db).sessions.find(session=>session.id===id)!;}
 private move(db:TransactionContext,operator:CashOperator,input:Operations['cash.recordMovement']['input']){const {cash,session}=this.activeCash(db,operator,input.sessionId);if(input.type==='withdrawal'&&getCashSummary(session,cash.movements,read.sales(db),read.financial(db)).expectedInCents<input.amountInCents)fail('INSUFFICIENT_FUNDS');const id=randomUUID();db.run('INSERT INTO cash_movements VALUES(?,?,?,?,?,?,?)',id,input.sessionId,operator.id,input.type,input.amountInCents,input.description,this.instant());return read.cash(db).movements.find(movement=>movement.id===id)!;}
 private close(db:TransactionContext,operator:CashOperator,input:Operations['cash.close']['input']){const {cash,session}=this.activeCash(db,operator,input.sessionId,false),draft=getCashReconciliationDraft(session,cash.movements,read.sales(db),read.financial(db));if(draft.sourceFingerprint!==input.reviewedFingerprint)fail('STALE_RECONCILIATION');const reconciliation=createCashReconciliation(draft,input.counts),s=reconciliation.cashSummary,date=this.instant();
  db.run('INSERT INTO cash_reconciliation_snapshots(cash_session_id,summary_version,revenue_cents,net_received_cents,sale_count,cancelled_count,credit_used_cents,opening_cents,cash_sales_cents,supplies_cents,withdrawals_cents,refunds_cents,physical_expected_cents,source_fingerprint,closed_at,closed_by_operator_id) VALUES(?,2,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',session.id,reconciliation.totalNetSalesInCents,reconciliation.netReceivedInCents!,reconciliation.saleCount!,reconciliation.cancelledCount!,reconciliation.customerCreditConsumedInCents!,s.openingInCents,s.salesInCents,s.suppliesInCents,s.withdrawalsInCents,s.refundsInCents!,s.expectedInCents,draft.sourceFingerprint,date,operator.id);
  for(const method of paymentMethods){const m=reconciliation.methods[method];db.run('INSERT INTO cash_reconciliation_methods VALUES(?,?,?,?,?,?,?)',session.id,method,reconciliation.paymentTotalsInCents[method],reconciliation.refundTotalsInCents![method],m.expectedInCents,m.countedInCents,m.differenceInCents);}
  db.run("UPDATE cash_sessions SET status='closed',closed_at=? WHERE id=?",date,session.id);return read.cash(db).sessions.find(closed=>closed.id===session.id)!;
 }
 private recover(db:TransactionContext,operator:CashOperator,currentRequestId:string){
  for(const r of db.all("SELECT r.*,o.status AS request_status FROM customer_credit_reservations r JOIN operation_requests o ON o.request_id=r.operation_request_id WHERE r.state='reserved'")){
   const sale=db.get('SELECT * FROM sales WHERE id=?',String(r.sale_id));
   if(sale){
    if(r.request_status!=='committed')fail('RECOVERY_BLOCKED');
    const paid=Number(db.get("SELECT coalesce(sum(amount_cents),0) AS amount FROM sale_payments WHERE sale_id=? AND credit_id=? AND method='customer_credit'",String(r.sale_id),String(r.credit_id))!.amount);if(paid!==r.amount_cents)fail('RECOVERY_BLOCKED');
    const redeemed=db.get("SELECT amount_cents FROM customer_credit_movements WHERE credit_id=? AND sale_id=? AND type='redeemed'",String(r.credit_id),String(r.sale_id));
    if(redeemed&&redeemed.amount_cents!==paid)fail('RECOVERY_BLOCKED');
    if(!redeemed){const credit=db.get('SELECT balance_cents FROM customer_credits WHERE id=?',String(r.credit_id))!;this.setBalance(db,String(r.credit_id),Number(credit.balance_cents)-paid);db.run("INSERT INTO customer_credit_movements(id,credit_id,type,amount_cents,occurred_at,sale_id,cash_session_id,operator_id) VALUES(?,?,'redeemed',?,?,?,?,?)",randomUUID(),String(r.credit_id),paid,this.instant(),String(r.sale_id),sale.cash_session_id as string|null,operator.id);}
    if(sale.status==='cancelled'&&!db.get("SELECT id FROM customer_credit_movements WHERE credit_id=? AND sale_id=? AND type='restored'",String(r.credit_id),String(r.sale_id))){const current=this.sale(db,String(r.sale_id));if(sumMoney([getSaleResolvedAmount(current.id,read.financial(db)),paid])>current.totalInCents)fail('RECOVERY_BLOCKED');const credit=db.get('SELECT balance_cents FROM customer_credits WHERE id=?',String(r.credit_id))!;this.setBalance(db,String(r.credit_id),sumMoney([Number(credit.balance_cents),paid]));db.run("INSERT INTO customer_credit_movements(id,credit_id,type,amount_cents,occurred_at,sale_id,cash_session_id,operator_id) VALUES(?,?,'restored',?,?,?,?,?)",randomUUID(),String(r.credit_id),paid,this.instant(),String(r.sale_id),sale.cash_session_id as string|null,operator.id);}
    db.run("UPDATE customer_credit_reservations SET state='consumed' WHERE id=?",String(r.id));db.run("INSERT INTO recovery_events VALUES(?,?,'credit_reservation','recovered',?,'COMMITTED_RESERVATION_RECONCILED')",randomUUID(),String(r.operation_request_id),this.instant());continue;
   }
   if(r.request_status==='committed')fail('RECOVERY_BLOCKED');
   db.run("UPDATE customer_credit_reservations SET state='released' WHERE id=?",String(r.id));db.run("UPDATE operation_requests SET status='interrupted' WHERE request_id=? AND status='pending'",String(r.operation_request_id));db.run("INSERT INTO recovery_events VALUES(?,?,'credit_reservation','recovered',?,'RESERVATION_RELEASED')",randomUUID(),String(r.operation_request_id),this.instant());
  }
  for(const r of db.all("SELECT request_id FROM operation_requests WHERE status='pending' AND coalesce(result_reference,'')<>'prepared' AND request_id<>?",currentRequestId)) {db.run("UPDATE operation_requests SET status='interrupted' WHERE request_id=?",String(r.request_id));db.run("INSERT INTO recovery_events VALUES(?,?,'operation_request','detected',?,'REQUEST_INTERRUPTED')",randomUUID(),String(r.request_id),this.instant());}
  this.assertLedger(db);return null;
 }
 execute<K extends Operation>(owner:number,name:K,payload:unknown):Operations[K]['output']{
  const p=validate(name,payload);const handlers:{[N in Operation]:(input:Operations[N]['input'])=>Operations[N]['output']}={
   'operators.authenticate':i=>this.database.transaction(db=>this.auth.login(db,owner,i.username,i.password)),
   'operators.reauthenticate':i=>this.database.transaction(db=>{this.auth.reauthenticate(db,owner,i.password);return null;}),
   'operators.current':()=>this.database.transaction(db=>this.auth.current(db,owner)),
   'operators.logout':()=>{this.disconnect(owner);return null;},
   'operators.list':()=>this.query(owner,db=>read.operators(db)),
   'catalog.list':()=>this.query(owner,db=>read.products(db)),
   'catalog.save':i=>this.query(owner,db=>{this.writeCatalog(db,i.products);return null;},{admin:true,recent:true}),
   'settings.read':()=>this.query(owner,db=>read.settings(db)),
   'settings.update':i=>{const result=this.query(owner,db=>this.updateSettings(db,i.settings,i.passwords),{admin:true,recent:true});for(const o of result.operators??[])if(i.passwords[o.id])this.auth.revoke(o.id);return result;},
   'installation.read':()=>this.query(owner,db=>{const r=db.get('SELECT status,generation FROM installation_state')!;return {status:r.status as Operations['installation.read']['output']['status'],generation:Number(r.generation)};}),
   'sales.list':()=>this.query(owner,db=>read.sales(db)),
   'sales.get':i=>this.query(owner,db=>read.sales(db).find(s=>s.id===i.id)??null),
   'sales.complete':i=>{const result=this.command(owner,name,i,(db,op)=>this.complete(db,owner,op,i));this.auth.clearGrants(owner);return result;},
   'sales.cancel':i=>this.command(owner,name,i,(db,op)=>this.cancel(db,op,i)),
   'cash.read':()=>this.query(owner,db=>read.cash(db)),
   'cash.open':i=>{const result=this.command(owner,name,i,(db,op)=>this.open(db,op,i));this.auth.clearGrants(owner);return result;},
   'cash.recordMovement':i=>this.command(owner,name,i,(db,op)=>this.move(db,op,i)),
   'cash.close':i=>{const result=this.command(owner,name,i,(db,op)=>this.close(db,op,i));this.auth.clearGrants(owner);return result;},
   'financial.snapshot':()=>this.query(owner,db=>({sales:read.sales(db),cash:read.cash(db),financial:read.financial(db)})),
   'financial.recordReturn':i=>this.command(owner,name,i,(db,op)=>this.recordReturn(db,op,i)),
   'financial.settle':i=>this.command(owner,name,i,(db,op)=>this.settle(db,op,i)),
   'financial.updateRefund':i=>this.command(owner,name,i,(db,op)=>this.refund(db,op,i)),
   'financial.recover':i=>this.command(owner,name,i,(db,op)=>this.recover(db,op,i.requestId)),
   'credits.list':i=>this.query(owner,db=>{const data=read.financial(db);return data.credits.filter(c=>!i.query||c.receiptNumber.toUpperCase().includes(i.query.trim().toUpperCase())||String(c.originalSaleNumber)===i.query.trim().replace(/^#?0*/,'')).map(c=>({...c,balanceInCents:c.balanceInCents-sumMoney(data.creditReservations.filter(r=>r.creditId===c.id).map(r=>r.amountInCents))}));}),
   'credits.authorize':i=>this.database.transaction(db=>read.credit(this.auth.authorizeCredit(db,owner,i.query,i.code))),
   'credits.printReceipt':()=>fail('UNSUPPORTED_OPERATION'),
   'credits.readMovements':i=>this.query(owner,db=>read.financial(db).creditMovements.filter(m=>m.creditId===i.creditId)),
   'operations.prepare':i=>this.query(owner,(db,op)=>{if(!i.payload||typeof i.payload!=='object'||Array.isArray(i.payload)||Object.getPrototypeOf(i.payload)!==Object.prototype||Object.hasOwn(i.payload,'requestId'))fail('INVALID_REQUEST');const checked=validate(i.kind,{...(i.payload as object),requestId:'prepared-validation'});const {requestId:_,...payload}=checked;const hash=createHash('sha256').update(canonicalJson(json(payload))).digest('hex'),generation=this.database.installationState().generation;const prior=db.get("SELECT request_id FROM operation_requests WHERE kind=? AND payload_hash=? AND operator_id=? AND generation=? AND coalesce(result_reference,'')<>'acknowledged' ORDER BY created_at DESC LIMIT 1",i.kind,hash,op.id,generation);if(prior)return {requestId:String(prior.request_id)};if(db.get("SELECT request_id FROM operation_requests WHERE kind=? AND operator_id=? AND generation=? AND coalesce(result_reference,'')<>'acknowledged' LIMIT 1",i.kind,op.id,generation))fail('REQUEST_INTERRUPTED');const requestId=randomUUID();db.run("INSERT INTO operation_requests(request_id,kind,status,payload_hash,created_at,result_reference,operator_id,generation) VALUES(?,?,'pending',?,?,'prepared',?,?)",requestId,i.kind,hash,this.instant(),op.id,generation);return {requestId};},{financial:true}),
   'operations.acknowledge':i=>this.query(owner,(db,op)=>{const r=db.get('SELECT operator_id,generation,status FROM operation_requests WHERE request_id=?',i.requestId);if(!r||r.operator_id!==op.id||r.generation!==this.database.installationState().generation||r.status!=='committed')fail('FORBIDDEN');db.run("UPDATE operation_requests SET result_reference='acknowledged' WHERE request_id=?",i.requestId);return null;}),
   'operations.discardPrepared':i=>this.query(owner,(db,op)=>{const r=db.get('SELECT * FROM operation_requests WHERE request_id=?',i.requestId);if(!r||r.operator_id!==op.id||r.generation!==this.database.installationState().generation||r.status!=='pending'||r.result_reference!=='prepared'||db.get('SELECT id FROM customer_credit_reservations WHERE operation_request_id=?',i.requestId))fail('FORBIDDEN');db.run("UPDATE operation_requests SET status='interrupted',result_reference='acknowledged' WHERE request_id=?",i.requestId);return null;},{recent:true}),
   'operations.list':()=>this.query(owner,(db,op)=>db.all("SELECT request_id,kind,status,created_at FROM operation_requests WHERE operator_id=? AND generation=? AND coalesce(result_reference,'')<>'acknowledged' ORDER BY created_at",op.id,this.database.installationState().generation).map(r=>({requestId:String(r.request_id),kind:String(r.kind),status:String(r.status),createdAt:String(r.created_at)}))),
   'operations.read':i=>this.query(owner,(db,op)=>{const r=db.get('SELECT * FROM operation_requests WHERE request_id=?',i.requestId);if(!r)return {status:'unknown'};if(r.operator_id!==op.id||r.generation!==this.database.installationState().generation)fail('FORBIDDEN');return r.status==='committed'?{status:'committed',result:JSON.parse(String(r.result_json))}:r.status==='pending'&&r.result_reference==='prepared'?{status:'prepared'}:{status:'interrupted'};}),
   'draft.read':()=>this.query(owner,()=>structuredClone(this.drafts.get(owner)??[])),
   'draft.save':i=>this.query(owner,()=>{this.drafts.set(owner,structuredClone(i.items));return null;}),
  };
  return handlers[name](p);
 }
 private query<T>(owner:number,work:(db:TransactionContext,operator:CashOperator)=>T,options:Parameters<BackendAuth['authorize']>[2]={}){return this.database.transaction(db=>{const {operator}=this.auth.authorize(db,owner,options);return work(db,operator);});}
}

export { SqliteFoundation };
