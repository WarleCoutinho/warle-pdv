export type PaymentMethod = 'cash' | 'pix' | 'debit' | 'credit';
export type SaleTenderMethod = PaymentMethod | 'customer_credit';

export type SalePayment = {
  method: SaleTenderMethod;
  /** Amount applied to the sale, in centavos. */
  amountInCents: number;
  amountReceivedInCents?: number;
  changeInCents?: number;
  /** Set only for customer credit tender. */
  customerCreditId?: string;
  /** Operator-confirmed timestamp set when a completed sale is persisted. Missing on legacy records. */
  capturedAt?: string;
};

export const paymentMethodLabels: Record<SaleTenderMethod, string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  debit: 'Débito',
  credit: 'Crédito',
  customer_credit: 'Crédito do cliente',
};