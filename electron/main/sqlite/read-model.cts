import type { TransactionContext } from './database.cjs';
import type { CashData, CashReconciliation } from '../../../src/types/cash';
import type { Sale } from '../../../src/types/sale';
import type { SaleFinancialData, CustomerCredit } from '../../../src/types/customerCredit';
import type { CashOperator, StoreSettings } from '../../../src/types/settings';
import type { Product } from '../../../src/types/product';
import { paymentMethods } from '../../../src/domain/cash';
export type Reader = Pick<TransactionContext,'all'|'get'>;
function optional<T>(name:string,value:T|null|undefined):Record<string,T>{return value==null?{}:{[name]:value};}
export function operators(db:Reader):CashOperator[] {
  return db.all('SELECT o.*,c.operator_id AS credential FROM operators o LEFT JOIN operator_credentials c ON c.operator_id=o.id ORDER BY o.id').map(r=>({id:String(r.id),name:String(r.name),username:String(r.username),role:r.role as CashOperator['role'],active:r.active===1,hasPassword:!!r.credential}));
}
export function settings(db:Reader):StoreSettings {
  const r=db.get('SELECT * FROM store_settings WHERE id=1');
  return {storeName:String(r?.store_name??''),address:String(r?.address??''),phone:String(r?.phone??''),receiptFooter:String(r?.receipt_footer??''),operators:operators(db)};
}
export function products(db:Reader):Product[] {
  return db.all('SELECT p.*,c.name AS category,i.mime_type,i.data FROM products p JOIN categories c ON c.id=p.category_id LEFT JOIN product_images i ON i.id=p.image_id ORDER BY p.id').map(r=>({id:String(r.id),name:String(r.name),priceInCents:Number(r.price_cents),category:String(r.category),active:r.active===1,emoji:String(r.emoji??''),...optional('imageDataUrl',r.data?`data:${r.mime_type};base64,${Buffer.from(r.data as Uint8Array).toString('base64')}`:null)}));
}
export function sales(db:Reader):Sale[] {
  return db.all('SELECT s.*,c.cancelled_at,c.reason,c.note FROM sales s LEFT JOIN sale_cancellations c ON c.sale_id=s.id ORDER BY s.number DESC').map(r=>({id:String(r.id),number:Number(r.number),date:String(r.occurred_at),...optional('cashSessionId',r.cash_session_id as string|null),status:r.status as Sale['status'],totalInCents:Number(r.total_cents),...optional('cancelledAt',r.cancelled_at as string|null),...optional('cancellationReason',r.reason as Sale['cancellationReason']),...optional('cancellationNote',r.note as string|null),
    items:db.all('SELECT * FROM sale_items WHERE sale_id=? ORDER BY position',String(r.id)).map(i=>({lineId:String(i.line_id),productId:String(i.product_id),productName:String(i.product_name_snapshot),unitPriceInCents:Number(i.unit_price_cents),quantity:Number(i.quantity),subtotalInCents:Number(i.subtotal_cents)})),
    payments:db.all('SELECT * FROM sale_payments WHERE sale_id=? ORDER BY position',String(r.id)).map(p=>({method:p.method as Sale['payments'][number]['method'],amountInCents:Number(p.amount_cents),...(p.method==='cash'?{amountReceivedInCents:Number(p.received_cents),changeInCents:Number(p.change_cents)}:{}),...optional('customerCreditId',p.credit_id as string|null),...optional('capturedAt',p.captured_at as string|null)}))}));
}
export function credit(r:Record<string,unknown>):CustomerCredit {return {id:String(r.id),receiptNumber:String(r.receipt_number),originalSaleId:String(r.original_sale_id),originalSaleNumber:Number(r.original_sale_number),issuedAt:String(r.issued_at),originalAmountInCents:Number(r.original_cents),balanceInCents:Number(r.balance_cents),status:r.status as CustomerCredit['status'],...optional('issuingCashSessionId',r.issuing_cash_session_id as string|null)};}
export function financial(db:Reader):SaleFinancialData {
 return {
  credits:db.all('SELECT * FROM customer_credits ORDER BY issued_at,id').map(credit),
  creditReservations:db.all("SELECT * FROM customer_credit_reservations WHERE state='reserved' ORDER BY created_at,id").map(r=>({id:String(r.id),creditId:String(r.credit_id),saleId:String(r.sale_id),amountInCents:Number(r.amount_cents),createdAt:String(r.created_at)})),
  creditMovements:db.all('SELECT * FROM customer_credit_movements ORDER BY occurred_at,id').map(r=>({id:String(r.id),creditId:String(r.credit_id),type:r.type as SaleFinancialData['creditMovements'][number]['type'],amountInCents:Number(r.amount_cents),createdAt:String(r.occurred_at),...optional('saleId',r.sale_id as string|null),...optional('refundId',r.refund_id as string|null),...optional('cashSessionId',r.cash_session_id as string|null)})),
  refunds:db.all('SELECT * FROM financial_refunds ORDER BY requested_at,id').map(r=>({id:String(r.id),saleId:String(r.sale_id),saleNumber:Number(r.sale_number_snapshot),method:r.method as SaleFinancialData['refunds'][number]['method'],amountInCents:Number(r.amount_cents),status:r.status as SaleFinancialData['refunds'][number]['status'],createdAt:String(r.requested_at),...optional('completedAt',r.completed_at as string|null),...optional('cashSessionId',r.cash_session_id as string|null),...optional('creditId',r.credit_id as string|null),...optional('returnId',r.return_id as string|null)})),
  returns:db.all('SELECT * FROM merchandise_returns ORDER BY occurred_at,id').map(r=>({id:String(r.id),saleId:String(r.sale_id),saleNumber:Number(r.sale_number_snapshot),createdAt:String(r.occurred_at),amountInCents:Number(r.amount_cents),...optional('cashSessionId',r.cash_session_id as string|null),items:db.all('SELECT * FROM merchandise_return_items WHERE return_id=? ORDER BY position',String(r.id)).map(i=>({lineId:String(i.line_id),productId:String(i.product_id),productName:String(i.product_name_snapshot),unitPriceInCents:Number(i.unit_price_cents),quantity:Number(i.quantity),amountInCents:Number(i.amount_cents)}))})),
 };
}
export function cash(db:Reader):CashData {
 return {movements:db.all('SELECT * FROM cash_movements ORDER BY occurred_at,id').map(r=>({id:String(r.id),cashSessionId:String(r.cash_session_id),type:r.type as 'supply'|'withdrawal',amountInCents:Number(r.amount_cents),...optional('description',r.description as string|null),createdAt:String(r.occurred_at)})),sessions:db.all('SELECT * FROM cash_sessions ORDER BY opened_at,id').map(r=>{
  const snapshot=db.get('SELECT * FROM cash_reconciliation_snapshots WHERE cash_session_id=?',String(r.id));
  let reconciliation:CashReconciliation|undefined;
  if(snapshot){
   const methods={} as CashReconciliation['methods'],received={} as CashReconciliation['paymentTotalsInCents'],refunded={} as CashReconciliation['paymentTotalsInCents'];
   const rows=db.all('SELECT * FROM cash_reconciliation_methods WHERE cash_session_id=?',String(r.id));
   for(const method of paymentMethods){const m=rows.find(i=>i.method===method)!; methods[method]={expectedInCents:Number(m.expected_cents),countedInCents:Number(m.counted_cents),differenceInCents:Number(m.difference_cents)};received[method]=Number(m.received_cents);refunded[method]=Number(m.refunded_cents);}
   reconciliation={paymentTotalsInCents:received,refundTotalsInCents:refunded,customerCreditConsumedInCents:Number(snapshot.credit_used_cents),methods,totalNetSalesInCents:Number(snapshot.revenue_cents),summaryVersion:2,netReceivedInCents:Number(snapshot.net_received_cents),saleCount:Number(snapshot.sale_count),cancelledCount:Number(snapshot.cancelled_count),cashSummary:{openingInCents:Number(snapshot.opening_cents),salesInCents:Number(snapshot.cash_sales_cents),suppliesInCents:Number(snapshot.supplies_cents),withdrawalsInCents:Number(snapshot.withdrawals_cents),refundsInCents:Number(snapshot.refunds_cents),expectedInCents:Number(snapshot.physical_expected_cents)}};
  }
  return {id:String(r.id),...optional('operatorId',r.operator_id as string|null),...optional('operatorName',r.operator_name_snapshot as string|null),...optional('businessDate',r.business_date as string|null),openedAt:String(r.opened_at),...optional('closedAt',r.closed_at as string|null),openingAmountInCents:Number(r.opening_cents),status:r.status as 'open'|'closed',...(reconciliation?{reconciliation,expectedAmountInCents:reconciliation.cashSummary.expectedInCents,countedAmountInCents:reconciliation.methods.cash.countedInCents,differenceInCents:reconciliation.methods.cash.differenceInCents}:{})};
 })};
}
