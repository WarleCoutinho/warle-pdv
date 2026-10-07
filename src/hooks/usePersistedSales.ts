import { useEffect, useState } from 'react';
import type { Sale } from '../types/sale';
import { listSales } from '../services/saleStorage';

export function usePersistedSales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSales(listSales());
    } catch {
      setError('Não foi possível carregar as vendas salvas. Verifique os dados no armazenamento local.');
    } finally {
      setLoading(false);
    }
  }, []);

  return { sales, loading, error };
}
