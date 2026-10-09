/** One lock for sales, ledger, cash and restore writes in cooperating browser tabs. */
export async function withFinancialLock<T>(operation: () => Promise<T> | T): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('Este navegador não oferece bloqueio seguro entre abas; a operação financeira foi impedida para evitar duplicidade.');
  return navigator.locks.request('raiz-pdv:customer-credit-ledger', { mode: 'exclusive' }, operation);
}
