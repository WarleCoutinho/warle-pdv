export type CashOperator = { id: string; name: string; active: boolean; username?: string; role?: 'admin' | 'operator'; passwordDigest?: string };

export type StoreSettings = {
  operators?: CashOperator[];
  storeName: string;
  address: string;
  phone: string;
  receiptFooter: string;
};

