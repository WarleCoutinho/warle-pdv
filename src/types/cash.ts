export type CashSession = {
  id: string;
  openedAt: string;
  openingAmountInCents: number;
  closedAt?: string;
  countedAmountInCents?: number;
  expectedAmountInCents?: number;
  differenceInCents?: number;
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

export type CashData = {
  sessions: CashSession[];
  movements: CashMovement[];
};

export type CashSummary = {
  openingInCents: number;
  salesInCents: number;
  suppliesInCents: number;
  withdrawalsInCents: number;
  expectedInCents: number;
};
