import type { PaymentMethod } from './payment';

export type CustomerCreditStatus = 'available' | 'partial' | 'redeemed' | 'cancelled';
export type CustomerCredit = {
  id: string;
  receiptNumber: string;
  authCodeHash: string;
  originalSaleId: string;
  originalSaleNumber: number;
  issuedAt: string;
  originalAmountInCents: number;
  balanceInCents: number;
  status: CustomerCreditStatus;
  issuingCashSessionId?: string;
};

export type MerchandiseReturn = {
  id: string;
  saleId: string;
  saleNumber: number;
  createdAt: string;
  cashSessionId?: string;
  items: Array<{ lineId?: string; unitPriceInCents?: number; productId: string; productName: string; quantity: number; amountInCents: number }>;
  amountInCents: number;
};

export type FinancialRefund = {
  id: string;
  saleId: string;
  saleNumber: number;
  returnId?: string;
  method: PaymentMethod | 'customer_credit';
  amountInCents: number;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  cashSessionId?: string;
  creditId?: string;
};

export type CustomerCreditMovement = {
  id: string;
  creditId: string;
  type: 'issued' | 'redeemed' | 'restored';
  amountInCents: number;
  createdAt: string;
  saleId?: string;
  refundId?: string;
  cashSessionId?: string;
};

export type CreditReservation = {
  id: string;
  creditId: string;
  saleId: string;
  amountInCents: number;
  createdAt: string;
};

export type SaleFinancialData = {
  returns: MerchandiseReturn[];
  refunds: FinancialRefund[];
  credits: CustomerCredit[];
  creditMovements: CustomerCreditMovement[];
  creditReservations: CreditReservation[];
};

export const emptySaleFinancialData = (): SaleFinancialData => ({ returns: [], refunds: [], credits: [], creditMovements: [], creditReservations: [] });