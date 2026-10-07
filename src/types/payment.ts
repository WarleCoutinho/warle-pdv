export type PaymentMethod = 'cash' | 'pix' | 'debit' | 'credit';

export type SalePayment = {
  method: PaymentMethod;
  /** Amount applied to the sale, in centavos. */
  amountInCents: number;
  amountReceivedInCents?: number;
  changeInCents?: number;
};

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  debit: 'Débito',
  credit: 'Crédito',
};

