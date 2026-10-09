import { useEffect, useState } from 'react';
import { usePdvApplication } from '../application/context';
import { emptySaleFinancialData } from '../types/customerCredit';
import type { CashData } from '../types/cash';
import type { Sale } from '../types/sale';
export function usePersistedSales() {
  const application = usePdvApplication();
  const [cash, setCash] = useState<CashData | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [financial, setFinancial] = useState(emptySaleFinancialData);
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true; let revision = 0;
    async function refresh() {
      const request = ++revision;
      try {
        const snapshot = await application.financial.snapshot();
        if (!active || request !== revision) return;
        setCash(snapshot.cash); setSales(snapshot.sales); setFinancial(snapshot.financial); setReferenceDate(new Date()); setError(null);
      } catch { if (active && request === revision) setError('Não foi possível carregar as vendas ou registros financeiros salvos. Verifique os dados no armazenamento local.'); }
      finally { if (active && request === revision) setLoading(false); }
    }
    void refresh();
    const unsubscribe = application.changes.subscribe(['sales', 'financial', 'cash'], () => { void refresh(); });
    const timer = window.setInterval(() => { void refresh(); }, 60000);
    return () => { active = false; ++revision; unsubscribe(); window.clearInterval(timer); };
  }, [application]);
  return { cash, sales, financial, referenceDate, loading, error };
}
