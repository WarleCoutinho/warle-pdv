import type { FormEvent } from 'react';
import type { PaymentMethod } from '../types/payment';
import { formatMoney, parseMoneyInput } from '../utils/money';

type PaymentModalProps = {
  totalInCents: number;
  method: PaymentMethod;
  received: string;
  onMethodChange: (method: PaymentMethod) => void;
  onReceivedChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

const methods: { id: PaymentMethod; icon: string; label: string }[] = [
  { id: 'cash', icon: '💵', label: 'Dinheiro' },
  { id: 'pix', icon: '◈', label: 'Pix' },
  { id: 'debit', icon: '▣', label: 'Débito' },
  { id: 'credit', icon: '▤', label: 'Crédito' },
];

export function PaymentModal({ totalInCents, method, received, onMethodChange, onReceivedChange, onClose, onConfirm }: PaymentModalProps) {
  const receivedInCents = method === 'cash' ? parseMoneyInput(received) : totalInCents;
  const canConfirm = receivedInCents !== null && receivedInCents >= totalInCents;
  const changeInCents = canConfirm && method === 'cash' ? receivedInCents - totalInCents : 0;
  const shortfallInCents = receivedInCents !== null && receivedInCents < totalInCents
    ? totalInCents - receivedInCents
    : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canConfirm) onConfirm();
  }

  return (
    <div className="overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal payment-modal" onSubmit={submit}>
        <div className="modalhead">
          <div><h2>Finalizar venda</h2><div className="sub" style={{ marginTop: 5 }}>Escolha como o cliente vai pagar.</div></div>
          <button aria-label="Fechar pagamento" className="x" onClick={onClose} type="button">×</button>
        </div>
        <div className="modalbody">
          <div className="paytotal"><span>Total a pagar</span><b>{formatMoney(totalInCents)}</b></div>
          <div className="payment-label">Forma de pagamento</div>
          <div className="paymethods" role="group" aria-label="Forma de pagamento">
            {methods.map((item) => (
              <button aria-pressed={method === item.id} className={`method ${method === item.id ? 'selected' : ''}`} key={item.id} onClick={() => onMethodChange(item.id)} type="button">
                <span aria-hidden="true">{item.icon}</span><br />{item.label}
              </button>
            ))}
          </div>
          {method === 'cash' ? (
            <>
              <div className="field"><label htmlFor="payment-received">Valor recebido</label>
                <input autoFocus autoComplete="off" id="payment-received" inputMode="decimal" onChange={(event) => onReceivedChange(event.target.value)} placeholder="Ex.: 30,00" value={received} />
              </div>
              <div aria-live="polite" className={`changebox ${received && !canConfirm ? 'error' : ''}`}>
                <span>{shortfallInCents !== null ? 'Valor insuficiente' : received && receivedInCents === null ? 'Valor inválido' : received ? 'Troco' : 'Troco a devolver'}</span>
                <b>{shortfallInCents !== null ? `Faltam ${formatMoney(shortfallInCents)}` : received && canConfirm ? formatMoney(changeInCents) : '—'}</b>
              </div>
            </>
          ) : <p className="payment-hint">Confirme após receber o pagamento por {itemLabel(method)}.</p>}
        </div>
        <div className="modalfoot">
          <button className="btn secondary" onClick={onClose} type="button">Voltar</button>
          <button className="btn primary" disabled={!canConfirm} type="submit">Confirmar pagamento</button>
        </div>
      </form>
    </div>
  );
}

function itemLabel(method: PaymentMethod): string {
  return ({ cash: 'dinheiro', pix: 'Pix', debit: 'débito', credit: 'crédito' })[method];
}

