import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AppPageTopBar } from '../components/AppPageTopBar';
import { usePersistedSales } from '../hooks/usePersistedSales';
import { useModalFocus } from '../hooks/useModalFocus';
import type { CashOperator } from '../types/settings';
import { getOpenCashSession, getPendingCashSessions } from '../domain/cashSessions';
import { cashLabel } from '../utils/cashDay';
import type { CashData, CashMovement, CashSession } from '../types/cash';
import type { AppPage } from '../types/navigation';
import type { PaymentMethod } from '../types/payment';
import type { Sale } from '../types/sale';
import { formatMoney, parseMoneyInput } from '../utils/money';
import { getCashReconciliationDraft, paymentMethods, type CashPaymentTotals, type CashReconciliationDraft } from '../domain/cash';
import { getSaleStatus } from '../utils/saleStatus';
import type { SaleFinancialData } from '../types/customerCredit';

type CashPageProps = {
  operators: CashOperator[];
  data: CashData;
  error: string | null;
  onNavigate: (page: AppPage) => void;
  onOpen: (openingAmountInCents: number, operatorId: string) => Promise<void>;
  onMovement: (type: CashMovement['type'], amountInCents: number, description: string) => Promise<void>;
  onClose: (sessionId: string, countedInCents: CashPaymentTotals, reviewedFingerprint: string) => Promise<void>;
};
type ModalKind = 'open' | 'supply' | 'withdrawal' | 'close' | null;
const labels: Record<PaymentMethod | 'customer_credit', string> = { cash: 'Dinheiro', pix: 'Pix', debit: 'Débito', credit: 'Crédito', customer_credit: 'Crédito do cliente' };
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const timeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function CashPage({ operators, data: contextData, error, onNavigate, onOpen, onMovement, onClose }: CashPageProps) {
  const { cash: snapshotCash, sales, financial, loading: salesLoading, error: salesError } = usePersistedSales();
  const data = snapshotCash ?? contextData;
  const actionBusy = useRef(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [operatorId, setOperatorId] = useState('');
  const [closingSessionId, setClosingSessionId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<CashSession | null>(null);
  const openSession = getOpenCashSession(data);
  const pendingSessions = getPendingCashSessions(data);
  const draftState = useMemo(() => {
    if (!openSession || salesLoading || salesError || error) return { draft: null, error: null };
    try { return { draft: getCashReconciliationDraft(openSession, data.movements, sales, financial), error: null }; }
    catch (cause) { return { draft: null, error: cause instanceof Error ? cause.message : 'Não foi possível apurar as vendas.' }; }
  }, [openSession, data.movements, sales, financial, salesLoading, salesError, error]);
  const summary = draftState.draft?.cashSummary ?? null;
  const sessionSales = useMemo(() => openSession ? sales.filter((sale) => sale.cashSessionId === openSession.id) : [], [openSession, sales]);
  const closedSessions = data.sessions.filter((session) => session.status === 'closed');
  const closeBlocked = !!error || !!salesError || salesLoading || !!draftState.error || !draftState.draft;

  const closingSession = data.sessions.find((session) => session.id === closingSessionId) ?? openSession;
  const closingState = useMemo(() => {
    if (!closingSession || salesLoading || salesError || error) return { draft: null, error: null };
    try { return { draft: getCashReconciliationDraft(closingSession, data.movements, sales, financial), error: null }; }
    catch (failure) { return { draft: null, error: failure instanceof Error ? failure.message : 'Não foi possível conferir o caixa.' }; }
  }, [closingSession, data.movements, sales, financial, salesLoading, salesError, error]);

  function showModal(kind: Exclude<ModalKind, null>) {
    setClosingSessionId(null);
    setOperatorId(operators[0]?.id ?? '');
    setAmount('');
    setDescription('');
    setActionError(null);
    setModal(kind);
  }

  async function submitModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || modal === 'close' || actionBusy.current) return;
    const amountInCents = parseMoneyInput(amount);
    if (amountInCents === null || ((modal === 'supply' || modal === 'withdrawal') && amountInCents === 0)) {
      setActionError('Informe um valor válido em reais.');
      return;
    }
    try {
      actionBusy.current = true;
      if (modal === 'open') await onOpen(amountInCents, operatorId);
      if (modal === 'supply' || modal === 'withdrawal') await onMovement(modal, amountInCents, description);
      setModal(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Não foi possível concluir esta operação.');
    } finally { actionBusy.current = false; }
  }

  return <main className="content cash-content">
    <AppPageTopBar activePage="cash" onNavigate={onNavigate} />
    <div className="title-row cash-title-row">
      <div><h1>Caixa</h1><div className="sub">Controle o dinheiro físico da operação e confira cada forma de pagamento.</div></div>
      {openSession && <span className="cash-status is-open"><i /> {cashLabel(openSession)}</span>}
    </div>
    {(error || salesError || draftState.error) && <div className="cash-error" role="alert">{error || salesError || draftState.error}</div>}
    {pendingSessions.length > 0 && <section className="cash-pending-panel" aria-label="Caixas pendentes de fechamento"><h2>Caixas pendentes de fechamento</h2><p>Esses caixas não recebem vendas nem movimentações de hoje. O mesmo operador precisa fechá-los antes de entrar novamente. Outro operador pode abrir o caixa de hoje.</p>{pendingSessions.map((session) => <div className="cash-pending-row" key={session.id}><div><b>{cashLabel(session)}</b><small>Entrada: {dateTimeFormatter.format(new Date(session.openedAt))}</small></div><button className="btn secondary" disabled={salesLoading || !!salesError || !!error} onClick={() => { setClosingSessionId(session.id); setActionError(null); setModal('close'); }} type="button">Fechar caixa pendente</button></div>)}</section>}
    {!openSession ? <section className="cash-closed-card">
      <span aria-hidden="true" className="cash-state-icon">◷</span><h2>Caixa fechado</h2>
      <p>Selecione o operador e abra um caixa para hoje. Operadores com fechamento pendente ficam bloqueados.</p>
      <button className="btn primary" onClick={() => showModal('open')} type="button">＋ Abrir caixa</button>
    </section> : summary && <>
      <section aria-label="Resumo dos recebimentos da sessão" className="cash-open-section">
        <div className="cash-section-title"><div><h2>Recebimentos da sessão</h2><p>Valores aplicados às vendas, separados por forma de pagamento.</p></div><span>{cashLabel(openSession)} · entrada {dateTimeFormatter.format(new Date(openSession.openedAt))}</span></div>
        <div className="cash-summary-grid cash-payment-summary">
          {paymentMethods.map((method) => <div className="cash-summary-card" key={method}><span>{labels[method]}</span><b>{formatMoney(draftState.draft!.paymentTotalsInCents[method])}</b><small>Recebido em vendas</small></div>)}
          <div className="cash-summary-card"><span>Crédito de cliente utilizado</span><b>{formatMoney(draftState.draft!.customerCreditConsumedInCents)}</b><small>Não é recebimento em espécie</small></div><div className="cash-summary-card cash-refund-summary"><span>Reembolsos por modalidade</span><b>{formatMoney(Object.values(draftState.draft!.refundTotalsInCents).reduce((a, b) => a + b, 0))}</b><small>Realizados nesta sessão</small></div><div className="cash-summary-card cash-net-sales"><span>Faturamento das vendas</span><b>{formatMoney(draftState.draft!.totalNetSalesInCents)}</b><small>{draftState.draft!.saleCount} venda(s) concluída(s) · {draftState.draft!.cancelledCount} cancelada(s)</small></div>
          <div className="cash-summary-card"><span>Valor recebido líquido</span><b>{formatMoney(draftState.draft!.netReceivedInCents)}</b><small>Recebimentos menos reembolsos realizados. Crédito emitido não é descontado.</small></div>
        </div>
      </section>
      <section aria-label="Controle do dinheiro físico" className="cash-open-section cash-physical-section">
        <div className="cash-section-title"><div><h2>Dinheiro físico</h2><p>Pix e cartões não compõem o saldo da gaveta.</p></div></div>
        <div className="cash-summary-grid cash-physical-grid">
          <div className="cash-summary-card"><span>Fundo inicial</span><b>{formatMoney(summary.openingInCents)}</b><small>{dateTimeFormatter.format(new Date(openSession.openedAt))}</small></div>
          <div className="cash-summary-card"><span>Vendas em dinheiro</span><b>{formatMoney(summary.salesInCents)}</b><small>Troco não é somado</small></div>
          <div className="cash-summary-card"><span>Suprimentos</span><b>+ {formatMoney(summary.suppliesInCents)}</b><small>Dinheiro adicionado</small></div>
          <div className="cash-summary-card"><span>Sangrias</span><b>− {formatMoney(summary.withdrawalsInCents)}</b><small>Dinheiro retirado</small></div>
          <div className="cash-summary-card"><span>Reembolsos em dinheiro</span><b>− {formatMoney(summary.refundsInCents ?? 0)}</b><small>Saídas efetivamente realizadas</small></div><div className="cash-summary-card cash-expected"><span>Saldo físico esperado</span><b>{formatMoney(summary.expectedInCents)}</b><small>Fundo + dinheiro recebido − devoluções + suprimentos − sangrias</small></div>
        </div>
        <div className="cash-actions">
          <button className="btn secondary" onClick={() => showModal('supply')} type="button">＋ Suprimento</button>
          <button className="btn secondary" onClick={() => showModal('withdrawal')} type="button">− Sangria</button>
          <button className="btn primary" disabled={closeBlocked} onClick={() => showModal('close')} type="button">{salesLoading ? 'Carregando vendas…' : 'Fechar caixa'}</button>
        </div>
      </section>
      <section aria-labelledby="cash-movements-title" className="cash-panel">
        <div className="cash-panel-heading"><div><h2 id="cash-movements-title">Movimentações</h2><p>Vendas com todas as modalidades e movimentos de dinheiro físico desta sessão.</p></div></div>
        <CashMovements financial={financial} sessionId={openSession.id} sales={sessionSales} movements={data.movements.filter((movement) => movement.cashSessionId === openSession.id)} />
        {sessionSales.some((sale) => getSaleStatus(sale) === 'cancelled' && sale.payments.length > 0) && <p className="cash-refund-note">Vendas canceladas permanecem no histórico. Somente reembolsos efetivamente realizados reduzem os recebimentos ou o dinheiro físico.</p>}
      </section>
    </>}

    <section aria-labelledby="cash-history-title" className="cash-panel cash-history-panel">
      <div className="cash-panel-heading"><div><h2 id="cash-history-title">Histórico de caixas</h2><p>Sessões fechadas e valores gravados no momento do fechamento.</p></div><span className="cash-history-count">{closedSessions.length}</span></div>
      {closedSessions.length === 0 ? <div className="cash-empty-history">Nenhum fechamento registrado ainda.</div> : <div className="cash-table-scroll">
        <table className="cash-table"><thead><tr><th>Caixa / operador</th><th>Abertura</th><th>Fechamento</th><th>Esperado</th><th>Contado</th><th>Diferença</th><th></th></tr></thead>
          <tbody>{closedSessions.map((session) => <tr key={session.id}>
            <td>{cashLabel(session)}</td><td>{formatMoney(session.openingAmountInCents)}</td>
            <td>{session.closedAt ? timeFormatter.format(new Date(session.closedAt)) : '—'}</td>
            <td>{formatMoney(session.expectedAmountInCents ?? 0)}</td><td>{formatMoney(session.countedAmountInCents ?? 0)}</td>
            <td className={differenceClass(session.differenceInCents ?? 0)}>{formatSignedMoney(session.differenceInCents ?? 0)}</td>
            <td><button className="cash-detail-button" onClick={() => setSelectedSession(session)} type="button">Detalhes</button></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>

    {modal && modal !== 'close' && <CashActionModal amount={amount} description={description} kind={modal}
      operators={operators} operatorId={operatorId} onOperatorChange={setOperatorId} onAmountChange={setAmount} onClose={() => setModal(null)} onDescriptionChange={setDescription} onSubmit={submitModal} error={actionError} />}
    {modal === 'close' && closingSession && closingState.draft && <CashReconciliationModal
      sessionLabel={cashLabel(closingSession)} draft={closingState.draft} error={actionError} onClose={() => { setModal(null); setActionError(null); }}
      onConfirm={async (counts) => { await onClose(closingSession.id, counts, closingState.draft!.sourceFingerprint); setModal(null); setClosingSessionId(null); }}
      onError={setActionError}
    />}
    {modal === 'close' && closingState.error && <div className="cash-error" role="alert">{closingState.error}<button onClick={() => setModal(null)} type="button">Fechar aviso</button></div>}
    {selectedSession && <ClosedSessionModal session={selectedSession} onClose={() => setSelectedSession(null)} />}
  </main>;
}

function CashMovements({ sales, movements, sessionId, financial }: { sales: Sale[]; movements: CashMovement[]; sessionId: string; financial: SaleFinancialData }) {
  const entries = [
    ...sales.map((sale) => {
      const cancelled = getSaleStatus(sale) === 'cancelled';
      const paymentDetails = sale.payments.map((payment) => `${labels[payment.method]} ${formatMoney(payment.amountInCents)}`).join(' · ');
      return { id: sale.id, at: sale.date, label: `Venda #${String(sale.number).padStart(4, '0')}${cancelled ? ' · cancelada' : ''}`, detail: paymentDetails ? `${cancelled ? 'Registrado (sem evento de estorno): ' : ''}${paymentDetails}` : 'Sem pagamento registrado', cents: sale.totalInCents, type: 'sale' as const };
    }),
    ...financial.refunds.filter((refund) => refund.cashSessionId === sessionId && refund.method !== 'customer_credit').map((refund) => ({ id: refund.id, at: refund.completedAt ?? refund.createdAt, label: 'Reembolso ' + labels[refund.method], detail: 'Venda #' + String(refund.saleNumber).padStart(6, '0') + ' · ' + (refund.status === 'completed' ? 'realizado' : refund.status === 'pending' ? 'pendente' : 'falhou'), cents: refund.amountInCents, type: refund.status === 'completed' ? 'refund' as const : 'credit' as const })),
    ...financial.returns.filter((entry) => entry.cashSessionId === sessionId).map((entry) => ({ id: entry.id, at: entry.createdAt, label: 'Devolução de mercadoria', detail: 'Venda #' + String(entry.saleNumber).padStart(6, '0') + ' · ' + entry.items.map((item) => item.quantity + '× ' + item.productName).join(', '), cents: entry.amountInCents, type: 'credit' as const })),
    ...financial.creditMovements.filter((entry) => entry.type === 'restored' && entry.cashSessionId === sessionId).map((entry) => ({ id: entry.id, at: entry.createdAt, label: 'Crédito de cliente restaurado', detail: 'Cancelamento · crédito ' + entry.creditId, cents: entry.amountInCents, type: 'credit' as const })),
    ...financial.credits.filter((credit) => credit.issuingCashSessionId === sessionId).map((credit) => ({ id: credit.id, at: credit.issuedAt, label: 'Crédito de cliente emitido', detail: 'Venda #' + String(credit.originalSaleNumber).padStart(6, '0') + ' · obrigação criada', cents: credit.originalAmountInCents, type: 'credit' as const })),
    ...movements.map((movement) => ({ id: movement.id, at: movement.createdAt, label: movement.type === 'supply' ? 'Suprimento' : 'Sangria', detail: movement.description || (movement.type === 'supply' ? 'Dinheiro adicionado' : 'Dinheiro retirado'), cents: movement.amountInCents, type: movement.type })),
  ].sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  if (!entries.length) return <div className="cash-empty-history">Ainda não há movimentações nesta sessão.</div>;
  return <ul className="cash-movement-list">{entries.map((entry) => <li key={entry.id}>
    <time>{timeFormatter.format(new Date(entry.at))}</time><div><b>{entry.label}</b><small>{entry.detail}</small></div>
    <strong className={entry.type === 'withdrawal' || entry.type === 'refund' ? 'cash-negative' : entry.type === 'sale' || entry.type === 'credit' ? 'cash-neutral' : 'cash-positive'}>{entry.type === 'withdrawal' || entry.type === 'refund' ? '−' : entry.type === 'sale' || entry.type === 'credit' ? '' : '+'}{formatMoney(entry.cents)}</strong>
  </li>)}</ul>;
}

function CashActionModal(props: {
  operators: CashOperator[]; operatorId: string; onOperatorChange: (value: string) => void;
  amount: string; description: string; kind: 'open' | 'supply' | 'withdrawal'; error: string | null;
  onAmountChange: (value: string) => void; onDescriptionChange: (value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { operators, operatorId, onOperatorChange, amount, description, kind, error, onAmountChange, onDescriptionChange, onClose, onSubmit } = props;
  const dialogRef = useModalFocus(onClose);
  const titles = { open: 'Abrir caixa', supply: 'Registrar suprimento', withdrawal: 'Registrar sangria' };
  return <div className="overlay cash-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
    <section aria-labelledby="cash-modal-title" aria-modal="true" className="modal cash-modal" ref={dialogRef} role="dialog" tabIndex={-1}>
      <div className="modalhead"><div><h2 id="cash-modal-title">{titles[kind]}</h2></div><button aria-label="Fechar" className="x" onClick={onClose} type="button">×</button></div>
      <form onSubmit={onSubmit}><div className="cash-modal-body">{kind === 'open' && <label className="cash-field">Operador conectado<select disabled required value={operatorId} onChange={(event) => onOperatorChange(event.target.value)}><option value="">Selecione o operador</option>{operators.filter((operator) => operator.active).map((operator) => <option value={operator.id} key={operator.id}>{operator.name}</option>)}</select><small>Para usar outro operador, saia e entre com a senha dele.</small></label>}
        <label className="cash-field" htmlFor="cash-amount">{kind === 'open' ? 'Valor inicial do caixa' : 'Valor'}
          <span className="cash-input-wrap"><span>R$</span><input autoFocus id="cash-amount" inputMode="decimal" onChange={(event) => onAmountChange(event.target.value)} placeholder="0,00" value={amount} /></span>
        </label>
        {(kind === 'supply' || kind === 'withdrawal') && <label className="cash-field" htmlFor="cash-description">Descrição ou motivo <small>Opcional</small>
          <input id="cash-description" maxLength={100} onChange={(event) => onDescriptionChange(event.target.value)} placeholder={kind === 'supply' ? 'Ex.: troco' : 'Ex.: retirada para guardar'} value={description} />
        </label>}
        {error && <div className="cash-error" role="alert">{error}</div>}
      </div><div className="modalfoot"><button className="btn secondary" onClick={onClose} type="button">Cancelar</button><button className="btn primary" type="submit">{kind === 'open' ? 'Abrir caixa' : 'Registrar'}</button></div></form>
    </section>
  </div>;
}

function CashReconciliationModal({ sessionLabel, draft, error, onClose, onConfirm, onError }: {
  sessionLabel: string; draft: CashReconciliationDraft; error: string | null; onClose: () => void;
  onConfirm: (counts: CashPaymentTotals) => Promise<void>; onError: (message: string | null) => void;
}) {
  const dialogRef = useModalFocus(onClose);
  const confirming = useRef(false);
  const [inputs, setInputs] = useState<Record<PaymentMethod, string>>({ cash: '', pix: '', debit: '', credit: '' });
  const [counts, setCounts] = useState<CashPaymentTotals | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const reviewedSource = useRef(draft.sourceFingerprint);
  useEffect(() => {
    if (reviewedSource.current === draft.sourceFingerprint) return;
    reviewedSource.current = draft.sourceFingerprint;
    if (reviewing) {
      setReviewing(false);
      setCounts(null);
      onError('Os dados da venda ou do caixa mudaram. Confira os valores atualizados e faça a revisão novamente.');
    }
  }, [draft.sourceFingerprint, reviewing, onError]);
  function handleReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = {} as CashPaymentTotals;
    for (const method of paymentMethods) {
      const value = parseMoneyInput(inputs[method]);
      if (value === null) { onError(`Informe um valor válido para ${labels[method].toLowerCase()}; zero é permitido.`); return; }
      parsed[method] = value;
    }
    setCounts(parsed); setReviewing(true); onError(null);
  }
  async function handleConfirm() {
    if (!counts || confirming.current) return;
    confirming.current = true;
    try { await onConfirm(counts); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível gravar o fechamento.';
      onError(message);
      if (message.includes('mudaram') || message.includes('Reabra')) { setReviewing(false); setCounts(null); }
    } finally { confirming.current = false; }
  }
  const differences = counts ? paymentMethods.map((method) => ({ method, value: counts[method] - draft.expectedByMethodInCents[method] })) : [];
  const shortages = differences.filter((item) => item.value < 0).reduce((total, item) => total - item.value, 0);
  const surpluses = differences.filter((item) => item.value > 0).reduce((total, item) => total + item.value, 0);
  const divergent = differences.filter((item) => item.value !== 0).length;

  return <div className="overlay cash-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
    <section aria-labelledby="cash-close-title" aria-modal="true" className="modal cash-modal cash-reconciliation-modal" ref={dialogRef} role="dialog" tabIndex={-1}>
      <div className="modalhead"><div><h2 id="cash-close-title">{reviewing ? 'Confirme o fechamento' : 'Apuração e fechamento'}</h2>
        <p>{reviewing ? 'Revise os valores registrados antes de fechar a sessão.' : 'Informe o valor que foi efetivamente conferido em cada modalidade.'}</p>
      </div><button aria-label="Fechar" className="x" onClick={onClose} type="button">×</button></div>
      <form onSubmit={handleReview}>
        <div className="cash-modal-body">
          <section className="cash-receipt-summary" aria-label="Resumo das vendas">
            <h3>Resumo das vendas</h3><p>{sessionLabel}</p>
            <div className="cash-receipt-grid">
              {paymentMethods.map((method) => <div key={method}><span>{labels[method]} recebido</span><b>{formatMoney(draft.paymentTotalsInCents[method])}</b></div>)}
            </div>
            <div className="cash-net-total"><span>Faturamento das vendas</span><b>{formatMoney(draft.totalNetSalesInCents)}</b></div>
            <div className="cash-net-total"><span>Valor recebido líquido</span><b>{formatMoney(draft.netReceivedInCents)}</b></div><p>{draft.saleCount} venda(s) concluída(s) · {draft.cancelledCount} cancelada(s)</p><small>Os totais mostram recebimentos registrados e reembolsos concluídos separadamente. Crédito do cliente não é novo recebimento.</small><div className="cash-credit-consumed">Reembolsos: {paymentMethods.map((method) => labels[method] + " " + formatMoney(draft.refundTotalsInCents[method])).join(" · ")}</div><div className="cash-credit-consumed">Crédito do cliente usado em vendas: {formatMoney(draft.customerCreditConsumedInCents)}</div>
          </section>

          <section className="cash-reconcile-section">
            <h3>Conferência por modalidade</h3>
            {reviewing ? <div className="cash-reconcile-list">
              {paymentMethods.map((method) => {
                const expected = draft.expectedByMethodInCents[method], counted = counts![method], difference = counted - expected;
                return <div className="cash-reconcile-row is-review" key={method}>
                  <b>{labels[method]}</b><span>Esperado <strong>{formatMoney(expected)}</strong></span>
                  <span>Conferido <strong>{formatMoney(counted)}</strong></span>
                  <span className={differenceClass(difference)}>Diferença <strong>{formatSignedMoney(difference)}</strong></span>
                </div>;
              })}
            </div> : <div className="cash-reconcile-list">
              {paymentMethods.map((method) => <div className="cash-reconcile-row" key={method}>
                <b>{labels[method]}</b><span>Esperado <strong>{formatMoney(draft.expectedByMethodInCents[method])}</strong></span>
                <label htmlFor={`count-${method}`}>Conferido
                  <span className="cash-input-wrap"><span>R$</span><input autoComplete="off" id={`count-${method}`} inputMode="decimal" onChange={(event) => setInputs({ ...inputs, [method]: event.target.value })} placeholder="0,00" value={inputs[method]} /></span>
                </label>
                {inputs[method] !== '' && parseMoneyInput(inputs[method]) !== null && <span className={differenceClass(parseMoneyInput(inputs[method])! - draft.expectedByMethodInCents[method])}>Diferença <strong>{formatSignedMoney(parseMoneyInput(inputs[method])! - draft.expectedByMethodInCents[method])}</strong></span>}
              </div>)}
            </div>}
          </section>

          <section className="cash-physical-summary">
            <h3>Resumo do dinheiro físico</h3>
            <div><span>Fundo inicial</span><b>{formatMoney(draft.cashSummary.openingInCents)}</b></div>
            <div><span>Vendas recebidas em dinheiro</span><b>{formatMoney(draft.cashSummary.salesInCents)}</b></div>
            <div><span>Suprimentos</span><b>+ {formatMoney(draft.cashSummary.suppliesInCents)}</b></div>
            <div><span>Sangrias</span><b>− {formatMoney(draft.cashSummary.withdrawalsInCents)}</b></div><div><span>Reembolsos em dinheiro</span><b>− {formatMoney(draft.cashSummary.refundsInCents ?? 0)}</b></div>
            <div className="cash-physical-expected"><span>Saldo físico esperado</span><b>{formatMoney(draft.cashSummary.expectedInCents)}</b></div>
            {reviewing && counts && <><div><span>Dinheiro contado</span><b>{formatMoney(counts.cash)}</b></div>
              <div className={differenceClass(counts.cash - draft.expectedByMethodInCents.cash)}><span>Diferença</span><b>{formatSignedMoney(counts.cash - draft.expectedByMethodInCents.cash)}</b></div></>}
          </section>
          <p className="cash-refund-note">Vendas canceladas permanecem no histórico. Os reembolsos pendentes não reduzem o saldo esperado; somente eventos concluídos são considerados.</p>

          {reviewing && divergent > 0 && <div className="cash-variance-warning" role="status">
            <b>Existem divergências em {divergent} modalidade(s).</b>
            <span>Faltas: {formatMoney(shortages)} · Sobras: {formatMoney(surpluses)}. O fechamento mantém os valores conferidos para auditoria.</span>
          </div>}
          {reviewing && divergent === 0 && <div className="cash-no-variance">Conferência sem divergências.</div>}
          {error && <div className="cash-error" role="alert">{error}</div>}
        </div>
        <div className="modalfoot">
          <button className="btn secondary" onClick={() => { if (reviewing) { setReviewing(false); setCounts(null); onError(null); } else onClose(); }} type="button">{reviewing ? 'Voltar e editar' : 'Cancelar'}</button>
          {reviewing ? <button className={divergent ? 'btn danger' : 'btn primary'} onClick={handleConfirm} type="button">{divergent ? 'Fechar com divergência' : 'Confirmar fechamento'}</button>
            : <button className="btn primary" type="submit">Revisar apuração</button>}
        </div>
      </form>
    </section>
  </div>;
}

function ClosedSessionModal({ session, onClose }: { session: CashSession; onClose: () => void }) {
  const dialogRef = useModalFocus(onClose);
  const reconciliation = session.reconciliation;
  return <div className="overlay cash-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
    <section aria-labelledby="cash-detail-title" aria-modal="true" className="modal cash-modal cash-detail-modal" ref={dialogRef} role="dialog" tabIndex={-1}>
      <div className="modalhead"><div><h2 id="cash-detail-title">Fechamento do caixa</h2><p>{dateTimeFormatter.format(new Date(session.openedAt))} — {session.closedAt ? dateTimeFormatter.format(new Date(session.closedAt)) : ''}</p></div>
        <button aria-label="Fechar detalhes" className="x" onClick={onClose} type="button">×</button></div>
      <div className="cash-modal-body">
        {reconciliation ? <>
          <section className="cash-receipt-summary"><h3>Resumo das vendas</h3><p>{cashLabel(session)} · Entrada {dateTimeFormatter.format(new Date(session.openedAt))} · Fechamento {session.closedAt ? dateTimeFormatter.format(new Date(session.closedAt)) : "—"}</p><div className="cash-receipt-grid">
            {paymentMethods.map((method) => <div key={method}><span>{labels[method]} registrado</span><b>{formatMoney(reconciliation.paymentTotalsInCents[method])}</b></div>)}
          </div>{reconciliation.refundTotalsInCents && <p>Reembolsos por modalidade: {paymentMethods.map((method) => labels[method] + " " + formatMoney(reconciliation.refundTotalsInCents![method])).join(" · ")}</p>}{reconciliation.customerCreditConsumedInCents !== undefined && <p>Crédito de cliente consumido: {formatMoney(reconciliation.customerCreditConsumedInCents)}</p>}<div className="cash-net-total"><span>{reconciliation.summaryVersion === 2 ? "Faturamento das vendas" : "Total de vendas gravado no fechamento antigo"}</span><b>{formatMoney(reconciliation.totalNetSalesInCents)}</b></div>{reconciliation.summaryVersion === 2 && <><div className="cash-net-total"><span>Valor recebido líquido</span><b>{formatMoney(reconciliation.netReceivedInCents!)}</b></div><p>{reconciliation.saleCount} venda(s) concluída(s) · {reconciliation.cancelledCount} cancelada(s)</p></>}</section>
          <section className="cash-reconcile-section"><h3>Apuração salva por modalidade</h3><div className="cash-reconcile-list">
            {paymentMethods.map((method) => { const item = reconciliation.methods[method]; return <div className="cash-reconcile-row is-review" key={method}>
              <b>{labels[method]}</b><span>Esperado <strong>{formatMoney(item.expectedInCents)}</strong></span><span>Conferido <strong>{formatMoney(item.countedInCents)}</strong></span>
              <span className={differenceClass(item.differenceInCents)}>Diferença <strong>{formatSignedMoney(item.differenceInCents)}</strong></span>
            </div>; })}
          </div></section>
          <section className="cash-physical-summary"><h3>Dinheiro físico salvo</h3>
            <div><span>Fundo inicial</span><b>{formatMoney(reconciliation.cashSummary.openingInCents)}</b></div>
            <div><span>Vendas em dinheiro</span><b>{formatMoney(reconciliation.cashSummary.salesInCents)}</b></div>
            <div><span>Suprimentos</span><b>+ {formatMoney(reconciliation.cashSummary.suppliesInCents)}</b></div>
            <div><span>Sangrias</span><b>− {formatMoney(reconciliation.cashSummary.withdrawalsInCents)}</b></div>{reconciliation.cashSummary.refundsInCents !== undefined && <div><span>Reembolsos em dinheiro</span><b>− {formatMoney(reconciliation.cashSummary.refundsInCents)}</b></div>}
            <div className="cash-physical-expected"><span>Saldo esperado</span><b>{formatMoney(reconciliation.cashSummary.expectedInCents)}</b></div>
            <div><span>Dinheiro contado</span><b>{formatMoney(reconciliation.methods.cash.countedInCents)}</b></div>
            <div className={differenceClass(reconciliation.methods.cash.differenceInCents)}><span>Diferença</span><b>{formatSignedMoney(reconciliation.methods.cash.differenceInCents)}</b></div>
          </section>
        </> : <>
          <div className="cash-legacy-note"><b>Fechamento antigo</b><span>As modalidades eletrônicas não foram conferidas. O histórico mantém somente os valores gravados naquela época; não há reconstrução de dados ausentes.</span></div>
          <div className="cash-closing-summary">
            <div><span>Fundo inicial</span><b>{formatMoney(session.openingAmountInCents)}</b></div>
            <div className="cash-close-expected"><span>Saldo esperado (dinheiro)</span><b>{formatMoney(session.expectedAmountInCents ?? 0)}</b></div>
            <div><span>Dinheiro contado</span><b>{formatMoney(session.countedAmountInCents ?? 0)}</b></div>
            <div className={`cash-difference ${differenceClass(session.differenceInCents ?? 0)}`}><span>Diferença</span><b>{formatSignedMoney(session.differenceInCents ?? 0)}</b></div>
          </div>
        </>}
      </div>
      <div className="modalfoot"><button className="btn secondary" onClick={onClose} type="button">Voltar</button></div>
    </section>
  </div>;
}
function differenceClass(value: number): string { return value > 0 ? 'cash-positive' : value < 0 ? 'cash-negative' : 'cash-neutral'; }
function formatSignedMoney(value: number): string { return value > 0 ? `+${formatMoney(value)}` : value < 0 ? `−${formatMoney(Math.abs(value))}` : formatMoney(0); }
