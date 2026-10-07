export type PaymentMethod = 'cash' | 'pix' | 'debit' | 'credit';

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  debit: 'Débito',
  credit: 'Crédito',
};

