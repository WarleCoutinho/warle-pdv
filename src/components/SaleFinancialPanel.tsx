import { useEffect, useState, type FormEvent } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';
import { createPortal } from 'react-dom';
import { printCustomerCreditReceipt } from '../utils/printing';
import type { Sale } from '../types/sale';
import type { PaymentMethod } from '../types/payment';
import { getOpenCashSession, loadCashData } from '../services/cashStorage';
import { loadSaleFinancialData, recordMerchandiseReturn, settleSaleBalance, getSaleEligibleAmount, getSaleResolvedAmount, updatePendingRefund, withCustomerCreditLock } from '../services/saleFinancialStorage';
import { listSales } from '../services/saleStorage';
import { formatMoney, parseMoneyInput, sumMoney } from '../utils/money';
import { getCashSummary } from '../utils/cash';
import { getSaleStatus } from '../utils/saleStatus';
import type { SaleFinancialData } from '../types/customerCredit';
import type { StoreSettings } from '../types/settings';

type IssuedReceipt = { receiptNumber: string; originalSaleNumber: number; issuedAt: string; amountInCents: number; authCode: string };
const refundMethods: Array<PaymentMethod | 'customer_credit'> = ['cash', 'pix', 'debit', 'credit', 'customer_credit'];
const refundLabels: Record<PaymentMethod | 'customer_credit', string> = { cash: 'Dinheiro', pix: 'Pix', debit: 'Débito', credit: 'Crédito', customer_credit: 'Crédito do cliente' };

export function SaleFinancialPanel({ sale, settings }: { sale: Sale; settings: StoreSettings }) {
  const [financial, setFinancial] = useState<SaleFinancialData>(() => loadSaleFinancialData());
  const [showReturn, setShowReturn] = useState(false);
  const [showSettlement, setShowSettlement] = useState(false);
  const [receipts, setReceipts] = useState<IssuedReceipt[]>([]);
  const creditDialogRef = useModalFocus<HTMLElement>(() => setReceipts([]), { active: receipts.length > 0 });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const refresh = () => { try { setFinancial(loadSaleFinancialData()); setError(''); } catch { setError('Não foi possível carregar o histórico financeiro.'); } };
    refresh(); window.addEventListener('storage', refresh); return () => window.removeEventListener('storage', refresh);
  }, []);
  const eligible = getSaleEligibleAmount(sale, financial);
  const resolved = getSaleResolvedAmount(sale.id, financial);
  const available = Math.max(0, eligible - resolved);
  const saleReturns = financial.returns.filter((item) => item.saleId === sale.id);
  const saleRefunds = financial.refunds.filter((item) => item.saleId === sale.id);

  async function saveSettlement(amounts: Record<PaymentMethod | 'customer_credit', number>, statuses: Partial<Record<PaymentMethod, 'completed' | 'pending'>>) {
    if (saving) return;
    setSaving(true); setError('');
    try {
      const cashData = loadCashData();
      const openSession = getOpenCashSession(cashData);
      const actualCash = amounts.cash > 0 && statuses.cash !== 'pending';
      if (actualCash && !openSession) throw new Error('Abra um caixa para registrar uma devolução efetiva em dinheiro.');
      if (actualCash && openSession) {
        const physical = getCashSummary(openSession, cashData.movements, listSales()).expectedInCents;
        if (amounts.cash > physical) throw new Error('O valor do reembolso em dinheiro excede o saldo físico disponível no caixa.');
      }
      const result = await withCustomerCreditLock(() => settleSaleBalance(sale, { amounts, statuses, cashSessionId: openSession?.id }));
      setFinancial(result.data); setReceipts(result.issuedCredits.map(({ credit, authCode }) => ({ receiptNumber: credit.receiptNumber, originalSaleNumber: credit.originalSaleNumber, issuedAt: credit.issuedAt, amountInCents: credit.originalAmountInCents, authCode })));
      setShowSettlement(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível registrar a resolução financeira.'); } finally { setSaving(false); }
  }

  function saveReturn(quantities: Record<string, number>) {
    try { const current = getOpenCashSession(loadCashData()); const next = recordMerchandiseReturn(sale, quantities, current?.id); setFinancial(next); setShowReturn(false); setShowSettlement(true); setError(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível registrar a devolução.'); }
  }

  function failPending(refundId: string) {
    try { setFinancial(updatePendingRefund(refundId, 'failed')); setError(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível registrar a falha.'); }
  }

  function resolvePending(refundId: string) {
    try {
      const open = getOpenCashSession(loadCashData());
      const refund = financial.refunds.find((item) => item.id === refundId);
      if (!refund) return;
      if (refund.method === 'cash' && !open) throw new Error('Abra um caixa para concluir este reembolso em dinheiro.');
      if (refund.method === 'cash' && open) {
        const cashData = loadCashData();
        const physical = getCashSummary(open, cashData.movements, listSales()).expectedInCents;
        if (refund.amountInCents > physical) throw new Error('O reembolso excede o dinheiro físico disponível no caixa.');
      }
      setFinancial(updatePendingRefund(refundId, 'completed', open?.id)); setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar o reembolso.'); }
  }

  return <section className="sale-financial-panel" aria-label="Devoluções e resoluções financeiras">
    <div className="sale-financial-heading"><div><h3>Devoluções e reembolsos</h3><p>1. Selecione os itens recebidos. 2. Escolha como devolver o valor ao cliente.</p></div><span>Ainda pode devolver: {formatMoney(available)}</span></div>
    {error && <p className="sale-financial-error" role="alert">{error}</p>}
    <div className="sale-financial-actions">
      {getSaleStatus(sale) === 'completed' && <button className="btn secondary" onClick={() => setShowReturn(true)} type="button">Devolver produtos</button>}
      {available > 0 && <button className="btn primary" onClick={() => setShowSettlement(true)} type="button">Devolver valor ou gerar crédito</button>}
    </div>
    {saleReturns.length > 0 && <div className="sale-financial-events"><b>Mercadorias devolvidas</b>{saleReturns.map((entry) => <div key={entry.id}><span>{new Date(entry.createdAt).toLocaleString('pt-BR')} · {entry.items.map((item) => `${item.quantity}× ${item.productName}`).join(', ')}</span><b>{formatMoney(entry.amountInCents)}</b></div>)}</div>}
    {financial.creditMovements.filter((item) => item.saleId === sale.id && item.type === 'restored').map((item) => <p key={item.id}>Crédito restaurado no cancelamento: <b>{formatMoney(item.amountInCents)}</b></p>)}
    {saleRefunds.length > 0 && <div className="sale-financial-events"><b>Valores devolvidos e créditos</b>{saleRefunds.map((refund) => <div key={refund.id}><span>{refundLabels[refund.method]} · {refund.status === 'completed' ? 'realizado' : refund.status === 'pending' ? 'pendente' : 'falhou'}{refund.status === 'pending' && <><button className="sale-financial-inline" onClick={() => resolvePending(refund.id)} type="button">Confirmar realização</button><button className="sale-financial-inline" onClick={() => failPending(refund.id)} type="button">Registrar falha</button></>}</span><b>{formatMoney(refund.amountInCents)}</b></div>)}</div>}
    {showReturn && <ReturnModal error={error} sale={sale} financial={financial} onClose={() => setShowReturn(false)} onSave={saveReturn} />}
    {showSettlement && <SettlementModal error={error} saving={saving} maxAmountInCents={available} onClose={() => setShowSettlement(false)} onSave={saveSettlement} />}
    {receipts.length > 0 && createPortal(<div className="overlay success-overlay credit-receipt-overlay"><section className="modal customer-credit-receipt-modal" ref={creditDialogRef} role="dialog" aria-modal="true" aria-labelledby="credit-receipt-title" tabIndex={-1}><div className="modalhead"><h2 id="credit-receipt-title">Crédito emitido</h2><button aria-label="Fechar comprovante de crédito" className="x" onClick={() => setReceipts([])} type="button">×</button></div><div className="modalbody"><p>O código de autorização aparece somente neste momento. Imprima ou anote antes de fechar.</p><button className="btn primary" onClick={printCustomerCreditReceipt} type="button">Imprimir comprovante do crédito (2 vias)</button><div className="customer-credit-print-area">{receipts.flatMap((item) => [<CustomerCreditReceipt copy="Via do cliente" key={`${item.receiptNumber}-customer`} receipt={item} storeName={settings.storeName} />, <CustomerCreditReceipt copy="Via da loja" key={`${item.receiptNumber}-store`} receipt={item} storeName={settings.storeName} />])}</div></div><div className="modalfoot"><button className="btn secondary" onClick={() => setReceipts([])} type="button">Fechar comprovante</button></div></section></div>, document.body)}
  </section>;
}

function ReturnModal({ sale, financial, onClose, onSave, error }: { error: string; sale: Sale; financial: SaleFinancialData; onClose: () => void; onSave: (quantities: Record<string, number>) => void }) {
  const returned: Record<string, number> = {};
  for (const entry of financial.returns.filter((item) => item.saleId === sale.id)) for (const item of entry.items) returned[item.productId] = (returned[item.productId] ?? 0) + item.quantity;
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const amount = sumMoney(sale.items.map((item) => item.unitPriceInCents * (Number(quantities[item.productId] || 0))));
  return <div className="overlay"><form className="modal return-modal" onSubmit={(event: FormEvent) => { event.preventDefault(); onSave(Object.fromEntries(Object.entries(quantities).map(([id, value]) => [id, Number(value || 0)]))); }}><div className="modalhead"><h2>1. Quais produtos voltaram?</h2><button className="x" onClick={onClose} type="button">×</button></div><div className="modalbody"><p>Informe a quantidade recebida de cada produto. Depois, escolha como devolver o valor.</p>{error && <p className="sale-financial-error" role="alert">{error}</p>}<button className="btn secondary" type="button" onClick={() => setQuantities(Object.fromEntries(sale.items.map((item) => [item.productId, String(item.quantity - (returned[item.productId] ?? 0))])))}>Devolver todos os produtos</button>{sale.items.map((item) => <label className="return-item" key={item.productId}><span><b>{item.productName}</b><small>{item.quantity - (returned[item.productId] ?? 0)} unidade(s) disponível(is) · {formatMoney(item.unitPriceInCents)} cada</small></span><input aria-label={`Quantidade devolvida de ${item.productName}`} min="0" max={item.quantity - (returned[item.productId] ?? 0)} step="1" inputMode="numeric" onChange={(event) => setQuantities({ ...quantities, [item.productId]: event.target.value })} type="number" value={quantities[item.productId] ?? '0'} /></label>)}<div className="sale-financial-total"><span>Valor dos produtos selecionados</span><b>{formatMoney(amount)}</b></div></div><div className="modalfoot"><button className="btn secondary" onClick={onClose} type="button">Voltar</button><button className="btn primary" disabled={amount <= 0} type="submit">Confirmar itens e continuar →</button></div></form></div>;
}

function SettlementModal({ maxAmountInCents, onClose, onSave, error, saving }: { maxAmountInCents: number; onClose: () => void; onSave: (amounts: Record<PaymentMethod | 'customer_credit', number>, statuses: Partial<Record<PaymentMethod, 'completed' | 'pending'>>) => Promise<void>; error: string; saving: boolean }) {
  const [method, setMethod] = useState<PaymentMethod | 'customer_credit'>('customer_credit');
  const [mixed, setMixed] = useState(false);
  const [inputs, setInputs] = useState<Record<PaymentMethod | 'customer_credit', string>>({ cash: '', pix: '', debit: '', credit: '', customer_credit: (maxAmountInCents / 100).toFixed(2).replace('.', ',') });
  const [statuses, setStatuses] = useState<Partial<Record<PaymentMethod, 'completed' | 'pending'>>>({});
  const visibleMethods = mixed ? refundMethods : [method];
  const parsed = Object.fromEntries(refundMethods.map((item) => [item, !visibleMethods.includes(item) || inputs[item] === '' ? 0 : parseMoneyInput(inputs[item])])) as Record<PaymentMethod | 'customer_credit', number | null>;
  const total = Object.values(parsed).some((value) => value === null) ? null : sumMoney(Object.values(parsed) as number[]);
  const valid = total !== null && total > 0 && total <= maxAmountInCents;
  function chooseMethod(next: PaymentMethod | 'customer_credit') {
    setMethod(next);
    setInputs({ cash: '', pix: '', debit: '', credit: '', customer_credit: '', [next]: (maxAmountInCents / 100).toFixed(2).replace('.', ',') });
  }
  return <div className="overlay"><form className="modal settlement-modal" aria-label="Como devolver o valor" onSubmit={(event: FormEvent) => { event.preventDefault(); if (valid && !saving) void onSave(parsed as Record<PaymentMethod | 'customer_credit', number>, statuses); }}><div className="modalhead"><div><h2>2. Como devolver o valor?</h2><p>Disponível para o cliente: <b>{formatMoney(maxAmountInCents)}</b></p></div><button className="x" disabled={saving} onClick={onClose} type="button">×</button></div><div className="modalbody">
    {error && <p className="sale-financial-error" role="alert">{error}</p>}
    {!mixed && <label className="field">O que o cliente vai receber?<select disabled={saving} value={method} onChange={(event) => chooseMethod(event.target.value as typeof method)}><option value="customer_credit">Crédito para comprar depois</option><option value="cash">Dinheiro</option><option value="pix">Reembolso por Pix</option><option value="debit">Estorno no cartão de débito</option><option value="credit">Estorno no cartão de crédito</option></select></label>}
    <p className="settlement-help">{!mixed && method === 'customer_credit' ? 'Será gerado um comprovante com código para o cliente usar na próxima compra.' : 'Informe somente o que foi devolvido. Se o estorno ainda não aconteceu, marque como pendente.'}</p>
    {visibleMethods.map((item) => <div className="settlement-line" key={item}><label htmlFor={'settlement-' + item}>{mixed ? refundLabels[item] : 'Valor a devolver'}{item !== 'customer_credit' && <select disabled={saving} aria-label={'Status do reembolso ' + refundLabels[item]} onChange={(event) => setStatuses({ ...statuses, [item]: event.target.value as 'completed' | 'pending' })} value={statuses[item] ?? 'completed'}><option value="completed">Já devolvido</option><option value="pending">Ainda pendente</option></select>}</label><span className="money-input"><span>R$</span><input disabled={saving} id={'settlement-' + item} inputMode="decimal" onChange={(event) => setInputs({ ...inputs, [item]: event.target.value })} value={inputs[item]} placeholder="0,00" /></span></div>)}
    <label className="settlement-mixed"><input disabled={saving} type="checkbox" checked={mixed} onChange={(event) => { setMixed(event.target.checked); if (!event.target.checked) chooseMethod(method); }} />Dividir entre crédito e outras formas</label>
    <div className="sale-financial-total"><span>Total a registrar</span><b>{total === null ? 'Valor inválido' : formatMoney(total)}</b></div>{total !== null && total > maxAmountInCents && <p className="sale-financial-error" role="alert">O valor ultrapassa o disponível para esta devolução.</p>}
    <p className="settlement-help">Você também pode fechar e devolver o valor mais tarde. Os itens recebidos já estão registrados.</p>
  </div><div className="modalfoot"><button className="btn secondary" disabled={saving} onClick={onClose} type="button">Fazer depois</button><button className="btn primary" disabled={!valid || saving} type="submit">{saving ? 'Registrando…' : !mixed && method === 'customer_credit' ? 'Gerar crédito do cliente' : 'Confirmar devolução do valor'}</button></div></form></div>;
}

function CustomerCreditReceipt({ receipt, copy, storeName }: { receipt: IssuedReceipt; copy: string; storeName: string }) {
  const issued = new Date(receipt.issuedAt).toLocaleString('pt-BR');
  return <article className="print-root receipt-paper-80mm"><div className="receipt customer-credit-ticket"><header><b>{storeName}</b><strong>CRÉDITO DE CLIENTE</strong></header><p>Comprovante: <b>{receipt.receiptNumber}</b></p><p>Venda original: <b>#{String(receipt.originalSaleNumber).padStart(6, '0')}</b></p><p>Emitido em: <b>{issued}</b></p><p>Valor: <b>{formatMoney(receipt.amountInCents)}</b></p><div className="customer-credit-code">CÓDIGO DE AUTORIZAÇÃO<br /><b>{receipt.authCode}</b></div><p className="customer-credit-instructions">Apresente este comprovante e informe o código ao vendedor para utilizar o saldo. Guarde o código: ele autoriza o uso do crédito.</p></div><small className="customer-credit-copy-label">{copy}</small></article>;
}
