import { useState, type FormEvent } from 'react';
import { paymentMethodLabels, type PaymentMethod, type SalePayment } from '../types/payment';
import { calculatePaymentTotals, createSalePayment, formatMoneyInput } from '../utils/payments';
import { formatMoney, parseMoneyInput } from '../utils/money';

type PaymentModalProps = {
  totalInCents: number;
  payments: SalePayment[];
  onAddPayment: (payment: SalePayment) => void;
  onRemovePayment: (index: number) => void;
  errorMessage: string | null;
  onClose: () => void;
  onFinalize: () => void;
};

const methods: { id: PaymentMethod; icon: string; label: string }[] = [
  { id: 'cash', icon: '💵', label: 'Dinheiro' },
  { id: 'pix', icon: '◈', label: 'Pix' },
  { id: 'debit', icon: '▣', label: 'Débito' },
  { id: 'credit', icon: '▤', label: 'Crédito' },
];

export function PaymentModal({ totalInCents, payments, onAddPayment, onRemovePayment, errorMessage, onClose, onFinalize }: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amountInput, setAmountInput] = useState(() => formatMoneyInput(totalInCents));
  const [addingPayment, setAddingPayment] = useState(payments.length === 0);
  const { paidInCents, pendingInCents } = calculatePaymentTotals(totalInCents, payments);
  const enteredInCents = parseMoneyInput(amountInput);
  const newPayment = enteredInCents === null
    ? null
    : createSalePayment(method, enteredInCents, pendingInCents);
  const invalidNonCashAmount = method !== 'cash'
    && enteredInCents !== null
    && enteredInCents > pendingInCents;
  const isComplete = payments.length > 0 && pendingInCents === 0;

  function selectMethod(nextMethod: PaymentMethod) {
    setMethod(nextMethod);
    setAmountInput(formatMoneyInput(pendingInCents));
  }

  function addPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newPayment) return;
    const remainingAfterPayment = pendingInCents - newPayment.amountInCents;
    onAddPayment(newPayment);
    setAmountInput(formatMoneyInput(remainingAfterPayment));
    setAddingPayment(false);
  }

  function removePayment(index: number) {
    const nextPayments = payments.filter((_, paymentIndex) => paymentIndex !== index);
    const nextPending = calculatePaymentTotals(totalInCents, nextPayments).pendingInCents;
    onRemovePayment(index);
    setAmountInput(formatMoneyInput(nextPending));
    setAddingPayment(false);
  }

  return (
    <div className="overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="payment-title" aria-modal="true" className="modal payment-modal" role="dialog">
        <div className="modalhead">
          <div><h2 id="payment-title">Pagamento</h2><div className="sub" style={{ marginTop: 5 }}>Adicione uma ou mais formas de pagamento.</div></div>
          <button aria-label="Fechar pagamento" className="x" onClick={onClose} type="button">×</button>
        </div>
        <div className="modalbody payment-body">
          {errorMessage && <p className="sale-save-error" role="alert">{errorMessage}</p>}
          <div className="paytotal"><span>Total da venda</span><b>{formatMoney(totalInCents)}</b></div>

          {payments.length > 0 && (
            <section aria-label="Pagamentos adicionados" className="payment-list">
              <h3>Pagamentos</h3>
              {payments.map((payment, index) => (
                <div className="payment-item" key={`${payment.method}-${index}`}>
                  <div>
                    <b>{paymentMethodLabels[payment.method]}</b>
                    {payment.method === 'cash' && payment.changeInCents ? (
                      <small>Recebido {formatMoney(payment.amountReceivedInCents ?? payment.amountInCents)} · Troco {formatMoney(payment.changeInCents)}</small>
                    ) : null}
                  </div>
                  <b>{formatMoney(payment.amountInCents)}</b>
                  <button aria-label={`Remover pagamento ${paymentMethodLabels[payment.method]}`} className="remove-payment" onClick={() => removePayment(index)} type="button">Remover</button>
                </div>
              ))}
            </section>
          )}

          <div aria-live="polite" className={`payment-balance ${isComplete ? 'complete' : 'pending'}`}>
            <div><span>Pago</span><b>{formatMoney(paidInCents)}</b></div>
            <div><span>{isComplete ? 'Pagamento completo' : 'Pendente'}</span><b>{formatMoney(pendingInCents)}</b></div>
          </div>

          {!isComplete && !addingPayment && payments.length > 0 && (
            <div className="add-payment-prompt">
              <p>Falta <b>{formatMoney(pendingInCents)}</b> para concluir esta venda. Deseja adicionar outra forma de pagamento?</p>
              <button className="btn secondary" onClick={() => {
                setAmountInput(formatMoneyInput(pendingInCents));
                setAddingPayment(true);
              }} type="button">＋ Adicionar outra forma de pagamento</button>
            </div>
          )}

          {!isComplete && addingPayment && (
            <form className="add-payment-form" onSubmit={addPayment}>
              <div className="payment-label">Forma de pagamento</div>
              <div className="paymethods" role="group" aria-label="Forma de pagamento">
                {methods.map((item) => (
                  <button aria-pressed={method === item.id} className={`method ${method === item.id ? 'selected' : ''}`} key={item.id} onClick={() => selectMethod(item.id)} type="button">
                    <span aria-hidden="true">{item.icon}</span><br />{item.label}
                  </button>
                ))}
              </div>
              <div className="field"><label htmlFor="payment-amount">{method === 'cash' ? 'Valor recebido' : 'Valor'}</label>
                <input autoFocus autoComplete="off" id="payment-amount" inputMode="decimal" onChange={(event) => setAmountInput(event.target.value)} placeholder="Ex.: 30,00" value={amountInput} />
              </div>
              {invalidNonCashAmount ? (
                <p className="payment-error" role="alert">O valor máximo para esta forma é {formatMoney(pendingInCents)}.</p>
              ) : method === 'cash' && newPayment ? (
                <div className="cash-preview">
                  <span>Aplicado à venda <b>{formatMoney(newPayment.amountInCents)}</b></span>
                  <span>Troco <b>{formatMoney(newPayment.changeInCents ?? 0)}</b></span>
                </div>
              ) : null}
              <button className="btn secondary add-payment-submit" disabled={!newPayment} type="submit">Adicionar pagamento</button>
            </form>
          )}
        </div>
        <div className="modalfoot">
          <button className="btn secondary" onClick={onClose} type="button">Voltar</button>
          <button className="btn primary" disabled={!isComplete} onClick={onFinalize} type="button">Finalizar venda</button>
        </div>
      </section>
    </div>
  );
}
