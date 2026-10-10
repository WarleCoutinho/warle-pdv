export type CashOperator = { id: string; name: string; active: boolean; username?: string; role?: 'admin' | 'operator'; hasPassword?: boolean; passwordDigest?: string };

export type StoreSettings = {
  operators?: CashOperator[];
  storeName: string;
  address: string;
  phone: string;
  receiptFooter: string;
};

