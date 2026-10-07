import type { SalePayment } from './payment';

export type SaleItem = {
  productId: string;
  productName: string;
  unitPriceInCents: number;
  quantity: number;
  subtotalInCents: number;
};

export type Sale = {
  id: string;
  number: number;
  date: string;
  /** Cash register session active when the sale was completed. Missing on legacy sales. */
  cashSessionId?: string;
  items: SaleItem[];
  totalInCents: number;
  payments: SalePayment[];
};
