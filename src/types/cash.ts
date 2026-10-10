import type { PaymentMethod } from './payment';

export type CashMethodReconciliation = {
  expectedInCents: number;
  countedInCents: number;
  differenceInCents: number;
};

export type CashReconciliation = {
  /** Pagamentos das vendas registrados na sessão, antes dos reembolsos. */
  paymentTotalsInCents: Record<PaymentMethod, number>;
  /** Reembolsos efetivamente concluídos na sessão. Ausente em fechamentos legados. */
  refundTotalsInCents?: Record<PaymentMethod, number>;
  /** Valor pago com crédito de cliente, separado das modalidades recebidas. */
  customerCreditConsumedInCents?: number;
  methods: Record<PaymentMethod, CashMethodReconciliation>;
  totalNetSalesInCents: number;
  /** New summaries separate sales from actual net receipts; old snapshots stay unchanged. */
  summaryVersion?: 2;
  netReceivedInCents?: number;
  saleCount?: number;
  cancelledCount?: number;
  cashSummary: CashSummary;
};

export type CashSession = {
  operatorId?: string;
  operatorName?: string;
  businessDate?: string;
  id: string;
  openedAt: string;
  openingAmountInCents: number;
  closedAt?: string;
  countedAmountInCents?: number;
  expectedAmountInCents?: number;
  differenceInCents?: number;
  reconciliation?: CashReconciliation;
  status: 'open' | 'closed';
};

export type CashMovement = {
  id: string;
  cashSessionId: string;
  type: 'supply' | 'withdrawal';
  amountInCents: number;
  description?: string;
  createdAt: string;
};

export type CashData = { sessions: CashSession[]; movements: CashMovement[] };

export type CashSummary = {
  openingInCents: number;
  salesInCents: number;
  suppliesInCents: number;
  withdrawalsInCents: number;
  /** Reembolsos em espécie concluídos; ausente em snapshots legados. */
  refundsInCents?: number;
  expectedInCents: number;
};