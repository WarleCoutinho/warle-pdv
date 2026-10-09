import { useEffect, useState } from 'react';
import { loadSaleFinancialData, FINANCIAL_STORAGE_KEY } from '../services/saleFinancialStorage';
import { emptySaleFinancialData } from '../types/customerCredit';
import type { Sale } from '../types/sale';
import { listSales } from '../services/saleStorage';

const SALES_STORAGE_KEY = 'raiz-pdv:completed-sales';

export function usePersistedSales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [financial, setFinancial] = useState(emptySaleFinancialData);
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function refreshSales() {
      try {
        const nextSales = listSales();
        const nextFinancial = loadSaleFinancialData();
        setSales(nextSales); setFinancial(nextFinancial); setReferenceDate(new Date());
        setError(null);
      } catch {
        setError('Não foi possível carregar as vendas ou registros financeiros salvos. Verifique os dados no armazenamento local.');
      } finally {
        setLoading(false);
      }
    }
    function syncSales(event: StorageEvent) {
      if (event.key === SALES_STORAGE_KEY || event.key === FINANCIAL_STORAGE_KEY || event.key === null) refreshSales();
    }
    refreshSales();
    window.addEventListener('storage', syncSales);
    window.addEventListener('raiz-pdv:data-changed', refreshSales);
    window.addEventListener('focus', refreshSales);
    const timer = window.setInterval(refreshSales, 60000);
    return () => window.removeEventListener('storage', syncSales);
      window.removeEventListener('raiz-pdv:data-changed', refreshSales);
      window.removeEventListener('focus', refreshSales);
      window.clearInterval(timer);
  }, []);

  return { sales, financial, referenceDate, loading, error };
}
