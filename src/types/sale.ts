import type { SalePayment } from './payment';

export type SaleItem = {
  productId: string;
  productName: string;
  unitPriceInCents: number;
  quantity: number;
  subtotalInCents: number;
};

export type SaleStatus = 'completed' | 'cancelled';
export type SaleCancellationReason = 'launch_error' | 'customer_cancelled' | 'payment_error' | 'other';
export const saleCancellationReasonLabels: Record<SaleCancellationReason, string> = {
  launch_error: 'Erro no lançamento',
  customer_cancelled: 'Cliente desistiu',
  payment_error: 'Pagamento incorreto',
  other: 'Outro',
};

export type Sale = {
  id: string;
  number: number;
  date: string;
  /** Cash register session active when the sale was completed. Missing on legacy sales. */
  cashSessionId?: string;
  /** Missing on legacy sales; interpret it as completed. */
  status?: SaleStatus;
  cancelledAt?: string;
  cancellationReason?: SaleCancellationReason;
  cancellationNote?: string;
  items: SaleItem[];
  totalInCents: number;
  payments: SalePayment[];
};
