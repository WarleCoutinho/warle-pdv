import { useMemo, useState, type FormEvent } from 'react';
import { AppPageTopBar } from '../components/AppPageTopBar';
import { usePersistedSales } from '../hooks/usePersistedSales';
import type { CashData, CashMovement, CashSession, CashSummary } from '../types/cash';
import type { AppPage } from '../types/navigation';
import { formatMoney, parseMoneyInput } from '../utils/money';
import { formatMoneyInput } from '../utils/payments';
import { getCashSummary, getSessionCashSales } from '../utils/cash';

type CashPageProps = {
  data: CashData;
  error: string | null;
  onNavigate: (page: AppPage) => void;
  onOpen: (openingAmountInCents: number) => void;
  onMovement: (type: CashMovement['type'], amountInCents: number, description: string) => void;
  onClose: (countedAmountInCents: number) => void;
};

type ModalKind = 'open' | 'supply' | 'withdrawal' | 'close' | null;

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const timeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function CashPage({ data, error, onNavigate, onOpen, onMovement, onClose }: CashPageProps) {
  const { sales, error: salesError } = usePersistedSales();
  const [modal, setModal] = useState<ModalKind>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<CashSession | null>(null);
  const openSession = data.sessions.find((session) => session.status === 'open');
  const summary = useMemo(() => openSession ? getCashSummary(openSession, data.movements, sales) : null, [openSession, data.movements, sales]);
  const cashSales = useMemo(() => openSession ? getSessionCashSales(openSession, sales) : [], [openSession, sales]);
  const closedSessions = data.sessions.filter((session) => session.status === 'closed');

  function showModal(kind: Exclude<ModalKind, null>) {
    setAmount(kind === 'close' && summary ? formatMoneyInput(summary.expectedInCents) : '');
    setDescription('');
    setActionError(null);
    setModal(kind);
  }

  function submitModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountInCents = parseMoneyInput(amount);
    if (amountInCents === null || ((modal === 'supply' || modal === 'withdrawal') && amountInCents === 0)) {
      setActionError('Informe um valor válido em reais.');
      return;
    }
    try {
      if (modal === 'open') onOpen(amountInCents);
      if (modal === 'supply' || modal === 'withdrawal') onMovement(modal, amountInCents, description);
      if (modal === 'close') onClose(amountInCents);
      setModal(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Não foi possível concluir esta operação.');
    }
  }

  return (
    <main className="content cash-content">
      <AppPageTopBar activePage="cash" onNavigate={onNavigate} />
      <div className="title-row cash-title-row">
        <div><h1>Caixa</h1><div className="sub">Controle o dinheiro físico da operação.</div></div>
        {openSession && <span className="cash-status is-open"><i /> Caixa aberto</span>}
      </div>

      {(error || salesError) && <div className="cash-error" role="alert">{error || salesError}</div>}
      {!openSession ? (
        <section className="cash-closed-card">
          <span aria-hidden="true" className="cash-state-icon">◷</span>
          <h2>Caixa fechado</h2>
          <p>Nenhum caixa está aberto no momento. Abra o caixa antes de iniciar uma venda.</p>
          <button className="btn primary" onClick={() => showModal('open')} type="button">＋ Abrir caixa</button>
        </section>
      ) : summary && (
        <>
          <section aria-label="Resumo do caixa aberto" className="cash-summary-grid">
            <div className="cash-summary-card"><span>Abertura</span><b>{dateTimeFormatter.format(new Date(openSession.openedAt))}</b><small>Início da sessão</small></div>
            <div className="cash-summary-card"><span>Valor inicial</span><b>{formatMoney(openSession.openingAmountInCents)}</b><small>Dinheiro na abertura</small></div>
            <div className="cash-summary-card"><span>Vendas em dinheiro</span><b>{formatMoney(summary.salesInCents)}</b><small>{cashSales.length} {cashSales.length === 1 ? 'venda' : 'vendas'} · Pix e cartões não entram</small></div>
            <div className="cash-summary-card"><span>Suprimentos</span><b>{formatMoney(summary.suppliesInCents)}</b><small>Dinheiro adicionado</small></div>
            <div className="cash-summary-card"><span>Sangrias</span><b>{formatMoney(summary.withdrawalsInCents)}</b><small>Dinheiro retirado</small></div>
            <div className="cash-summary-card cash-expected"><span>Saldo esperado</span><b>{formatMoney(summary.expectedInCents)}</b><small>Dinheiro que deve estar no caixa</small></div>
          </section>

          <div className="cash-actions">
            <button className="btn secondary" onClick={() => showModal('supply')} type="button">＋ Suprimento</button>
            <button className="btn secondary" onClick={() => showModal('withdrawal')} type="button">− Sangria</button>
            <button className="btn primary" onClick={() => showModal('close')} type="button">Fechar caixa</button>
          </div>

          <section aria-labelledby="cash-movements-title" className="cash-panel">
            <div className="cash-panel-heading"><div><h2 id="cash-movements-title">Movimentações</h2><p>Vendas em dinheiro, suprimentos e sangrias desta sessão.</p></div></div>
            <CashMovements sales={cashSales} movements={data.movements.filter((movement) => movement.cashSessionId === openSession.id)} />
          </section>
        </>
      )}

      <section aria-labelledby="cash-history-title" className="cash-panel cash-history-panel">
        <div className="cash-panel-heading"><div><h2 id="cash-history-title">Histórico de caixas</h2><p>Sessões fechadas e respectivos valores de conferência.</p></div><span className="cash-history-count">{closedSessions.length}</span></div>
        {closedSessions.length === 0 ? <div className="cash-empty-history">Nenhum fechamento registrado ainda.</div> : (
          <div className="cash-table-scroll"><table className="cash-table"><thead><tr><th>Data</th><th>Abertura</th><th>Fechamento</th><th>Esperado</th><th>Contado</th><th>Diferença</th><th></th></tr></thead>
            <tbody>{closedSessions.map((session) => <tr key={session.id}>
              <td>{dateFormatter.format(new Date(session.openedAt))}</td>
              <td>{formatMoney(session.openingAmountInCents)}</td>
              <td>{session.closedAt ? timeFormatter.format(new Date(session.closedAt)) : '—'}</td>
              <td>{formatMoney(session.expectedAmountInCents ?? 0)}</td>
              <td>{formatMoney(session.countedAmountInCents ?? 0)}</td>
              <td className={differenceClass(session.differenceInCents ?? 0)}>{formatSignedMoney(session.differenceInCents ?? 0)}</td>
              <td><button className="cash-detail-button" onClick={() => setSelectedSession(session)} type="button">Detalhes</button></td>
            </tr>)}</tbody></table></div>
        )}
      </section>

      {modal && <CashActionModal
        amount={amount} description={description} kind={modal} onAmountChange={setAmount}
        onClose={() => setModal(null)} onDescriptionChange={setDescription} onSubmit={submitModal}
        summary={summary} error={actionError}
      />}
      {selectedSession && <ClosedSessionModal session={selectedSession} movements={data.movements.filter((item) => item.cashSessionId === selectedSession.id)} sales={sales} onClose={() => setSelectedSession(null)} />}
    </main>
  );
}

function CashMovements({ sales, movements }: { sales: ReturnType<typeof getSessionCashSales>; movements: CashMovement[] }) {
  const entries = [
    ...sales.map((sale) => ({ id: sale.id, at: sale.date, label: `Venda #${String(sale.number).padStart(4, '0')}`, detail: 'Dinheiro aplicado à venda', cents: sale.payments.filter((payment) => payment.method === 'cash').reduce((total, payment) => total + payment.amountInCents, 0), type: 'sale' as const })),
    ...movements.map((movement) => ({ id: movement.id, at: movement.createdAt, label: movement.type === 'supply' ? 'Suprimento' : 'Sangria', detail: movement.description || (movement.type === 'supply' ? 'Dinheiro adicionado' : 'Dinheiro retirado'), cents: movement.amountInCents, type: movement.type })),
  ].sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  if (entries.length === 0) return <div className="cash-empty-history">Ainda não há movimentações nesta sessão.</div>;
  return <ul className="cash-movement-list">{entries.map((entry) => <li key={entry.id}>
    <time>{timeFormatter.format(new Date(entry.at))}</time><div><b>{entry.label}</b><small>{entry.detail}</small></div>
    <strong className={entry.type === 'withdrawal' ? 'cash-negative' : 'cash-positive'}>{entry.type === 'withdrawal' ? '−' : '+'}{formatMoney(entry.cents)}</strong>
  </li>)}</ul>;
}

function CashActionModal(props: {
  amount: string; description: string; kind: Exclude<ModalKind, null>; summary: CashSummary | null; error: string | null;
  onAmountChange: (value: string) => void; onDescriptionChange: (value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { amount, description, kind, summary, error, onAmountChange, onDescriptionChange, onClose, onSubmit } = props;
  const titles = { open: 'Abrir caixa', supply: 'Registrar suprimento', withdrawal: 'Registrar sangria', close: 'Resumo e fechamento' };
  const parsed = parseMoneyInput(amount);
  const difference = parsed === null || !summary ? null : parsed - summary.expectedInCents;
  return <div className="overlay cash-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
    <section aria-labelledby="cash-modal-title" aria-modal="true" className="modal cash-modal" role="dialog">
      <div className="modalhead"><div><h2 id="cash-modal-title">{titles[kind]}</h2>{kind === 'close' && <p>Confira os valores e informe o dinheiro contado.</p>}</div><button aria-label="Fechar" className="x" onClick={onClose} type="button">×</button></div>
      <form onSubmit={onSubmit}>
        <div className="cash-modal-body">
          {kind === 'close' && summary && <div className="cash-closing-summary">
            <div><span>Valor inicial</span><b>{formatMoney(summary.openingInCents)}</b></div>
            <div><span>Vendas em dinheiro</span><b>{formatMoney(summary.salesInCents)}</b></div>
            <div><span>Suprimentos</span><b>{formatMoney(summary.suppliesInCents)}</b></div>
            <div><span>Sangrias</span><b>{formatMoney(summary.withdrawalsInCents)}</b></div>
            <div className="cash-close-expected"><span>Saldo esperado</span><b>{formatMoney(summary.expectedInCents)}</b></div>
          </div>}
          <label className="cash-field" htmlFor="cash-amount">{kind === 'open' ? 'Valor inicial do caixa' : kind === 'close' ? 'Valor contado' : 'Valor'}
            <span className="cash-input-wrap"><span>R$</span><input autoFocus id="cash-amount" inputMode="decimal" onChange={(event) => onAmountChange(event.target.value)} placeholder="0,00" value={amount} /></span>
          </label>
          {(kind === 'supply' || kind === 'withdrawal') && <label className="cash-field" htmlFor="cash-description">Descrição ou motivo <small>Opcional</small>
            <input id="cash-description" maxLength={100} onChange={(event) => onDescriptionChange(event.target.value)} placeholder={kind === 'supply' ? 'Ex.: troco' : 'Ex.: retirada para guardar'} value={description} />
          </label>}
          {kind === 'close' && difference !== null && <div className={`cash-difference ${differenceClass(difference)}`}><span>Diferença</span><b>{formatSignedMoney(difference)}</b></div>}
          {error && <div className="cash-error" role="alert">{error}</div>}
        </div>
        <div className="modalfoot"><button className="btn secondary" onClick={onClose} type="button">Cancelar</button><button className="btn primary" type="submit">{kind === 'close' ? 'Confirmar fechamento' : kind === 'open' ? 'Abrir caixa' : 'Registrar'}</button></div>
      </form>
    </section>
  </div>;
}

function ClosedSessionModal({ session, movements, sales, onClose }: { session: CashSession; movements: CashMovement[]; sales: ReturnType<typeof getSessionCashSales>; onClose: () => void }) {
  const summary = getCashSummary(session, movements, sales);
  return <div className="overlay cash-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
    <section aria-labelledby="cash-detail-title" aria-modal="true" className="modal cash-modal cash-detail-modal" role="dialog">
      <div className="modalhead"><div><h2 id="cash-detail-title">Fechamento do caixa</h2><p>{dateTimeFormatter.format(new Date(session.openedAt))} — {session.closedAt ? dateTimeFormatter.format(new Date(session.closedAt)) : ''}</p></div><button aria-label="Fechar detalhes" className="x" onClick={onClose} type="button">×</button></div>
      <div className="cash-modal-body"><div className="cash-closing-summary">
        <div><span>Valor inicial</span><b>{formatMoney(session.openingAmountInCents)}</b></div><div><span>Vendas em dinheiro</span><b>{formatMoney(summary.salesInCents)}</b></div>
        <div><span>Suprimentos</span><b>{formatMoney(summary.suppliesInCents)}</b></div><div><span>Sangrias</span><b>{formatMoney(summary.withdrawalsInCents)}</b></div>
        <div className="cash-close-expected"><span>Saldo esperado</span><b>{formatMoney(session.expectedAmountInCents ?? summary.expectedInCents)}</b></div>
        <div><span>Valor contado</span><b>{formatMoney(session.countedAmountInCents ?? 0)}</b></div>
        <div className={`cash-difference ${differenceClass(session.differenceInCents ?? 0)}`}><span>Diferença</span><b>{formatSignedMoney(session.differenceInCents ?? 0)}</b></div>
      </div></div>
      <div className="modalfoot"><button className="btn secondary" onClick={onClose} type="button">Voltar</button></div>
    </section>
  </div>;
}

function differenceClass(value: number): string { return value > 0 ? 'cash-positive' : value < 0 ? 'cash-negative' : 'cash-neutral'; }
function formatSignedMoney(value: number): string { return value > 0 ? `+${formatMoney(value)}` : value < 0 ? `−${formatMoney(Math.abs(value))}` : formatMoney(0); }
