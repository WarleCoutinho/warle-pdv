import { useEffect, useRef, useState } from 'react';
import { usePdvApplication } from '../application/context';
import { formatMoney } from '../utils/money';
import type { CustomerCredit } from '../types/customerCredit';

export function CustomerCreditLookupPanel() {
  const application = usePdvApplication();
  const request = useRef(0);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; ++request.current; }; }, []);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<Omit<CustomerCredit, 'authCodeHash'>>>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  async function search() {
    const revision = ++request.current;
    try { const found = await application.credits.search(query); if (!active.current || revision !== request.current) return; setResults(found); setSearched(true); setError(''); }
    catch { if (!active.current || revision !== request.current) return; setError('Não foi possível consultar os créditos salvos.'); }
  }
  return <section className="customer-credit-lookup" aria-label="Consulta de créditos do cliente">
    <div><h2>Crédito de cliente</h2><p>Consulte por número do comprovante ou venda original. A autorização não é exibida.</p></div>
    <div className="customer-credit-lookup-form"><input aria-label="Comprovante de crédito ou número da venda" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search(); } }} placeholder="CR-... ou número da venda" value={query} /><button className="btn secondary" onClick={search} type="button">Consultar</button></div>
    {error && <p className="sale-financial-error" role="alert">{error}</p>}
    {searched && results.length === 0 && <p className="customer-credit-empty">Nenhum crédito encontrado.</p>}
    {results.map((credit) => <div className="customer-credit-result" key={credit.id}><div><b>{credit.receiptNumber}</b><span>Venda #{String(credit.originalSaleNumber).padStart(6, '0')} · emitido {new Date(credit.issuedAt).toLocaleString('pt-BR')}</span></div><div><span>Saldo disponível</span><b>{formatMoney(credit.balanceInCents)}</b></div><small>{credit.status === 'available' ? 'Disponível' : credit.status === 'partial' ? 'Uso parcial' : credit.status === 'redeemed' ? 'Utilizado' : 'Cancelado'} · informe o código de autorização no pagamento</small></div>)}
  </section>;
}