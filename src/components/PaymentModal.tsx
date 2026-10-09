import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';
import { paymentMethodLabels, type SalePayment, type SaleTenderMethod } from '../types/payment';
import { calculatePaymentTotals, createSalePayment, formatMoneyInput } from '../utils/payments';
import { formatMoney, parseMoneyInput } from '../utils/money';
import { getNextWrappedIndex } from '../utils/keyboardNavigation';
import { lookupCustomerCredit } from '../services/saleStorage';

type PaymentModalProps = {
  totalInCents: number;
  payments: SalePayment[];
  onAddPayment: (payment: SalePayment) => void;
  onRemovePayment: (index: number) => void;
  errorMessage: string | null;
  onClose: () => void;
  onFinalize: () => void;
};

const methods: { id: SaleTenderMethod; icon: string; label: string }[] = [
  { id: 'cash', icon: '💵', label: 'Dinheiro' }, { id: 'pix', icon: '◈', label: 'Pix' },
  { id: 'debit', icon: '▣', label: 'Débito' }, { id: 'credit', icon: '▤', label: 'Crédito' },
  { id: 'customer_credit', icon: '🎟', label: 'Crédito cliente' },
];

export function PaymentModal({ totalInCents, payments, onAddPayment, onRemovePayment, errorMessage, onClose, onFinalize }: PaymentModalProps) {
  const dialogRef = useModalFocus(onClose);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const finalizeButtonRef = useRef<HTMLButtonElement>(null);
  const anotherPaymentButtonRef = useRef<HTMLButtonElement>(null);
  const focusStatusAfterAddRef = useRef(false);
  const [method, setMethod] = useState<SaleTenderMethod>('cash');
  const [amountInput, setAmountInput] = useState(() => formatMoneyInput(totalInCents));
  const [creditReceipt, setCreditReceipt] = useState('');
  const [creditAuthCode, setCreditAuthCode] = useState('');
  const [addingPayment, setAddingPayment] = useState(payments.length === 0);
  const { paidInCents, pendingInCents } = calculatePaymentTotals(totalInCents, payments);
  const enteredInCents = parseMoneyInput(amountInput);
  const [verifiedCredit, setVerifiedCredit] = useState<Awaited<ReturnType<typeof lookupCustomerCredit>>>(undefined);
  useEffect(() => {
    let active = true;
    setVerifiedCredit(undefined);
    if (method === 'customer_credit' && creditReceipt && creditAuthCode) {
      void lookupCustomerCredit(creditReceipt, creditAuthCode).then((credit) => { if (active) setVerifiedCredit(credit); }).catch(() => { if (active) setVerifiedCredit(undefined); });
    }
    return () => { active = false; };
  }, [method, creditReceipt, creditAuthCode]);
  const newPayment: SalePayment | null = enteredInCents === null ? null : method === 'customer_credit'
    ? verifiedCredit && enteredInCents > 0 && enteredInCents <= pendingInCents && enteredInCents <= verifiedCredit.balanceInCents - payments.filter((item) => item.customerCreditId === verifiedCredit.id).reduce((sum, item) => sum + item.amountInCents, 0)
      ? { method, amountInCents: enteredInCents, customerCreditId: verifiedCredit.id } : null
    : createSalePayment(method, enteredInCents, pendingInCents);
  const invalidAmount = enteredInCents !== null && method !== 'cash'
    && (enteredInCents > pendingInCents || (method === 'customer_credit' && !!verifiedCredit && enteredInCents > verifiedCredit.balanceInCents - payments.filter((item) => item.customerCreditId === verifiedCredit.id).reduce((sum, item) => sum + item.amountInCents, 0)));
  const isComplete = payments.length > 0 && pendingInCents === 0;

  useEffect(() => {
    if (!focusStatusAfterAddRef.current) return;
    focusStatusAfterAddRef.current = false;
    (isComplete ? finalizeButtonRef.current : anotherPaymentButtonRef.current)?.focus();
  }, [addingPayment, isComplete, payments.length]);

  function handleMethodKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
    if (!(event.target instanceof HTMLButtonElement)) return;
    if (event.key === 'Enter') { event.preventDefault(); const target = event.target; const selected = methods.find((item) => item.id === target.dataset.method); if (selected) selectMethod(selected.id); amountInputRef.current?.focus(); return; }
    if (!direction) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    const currentIndex = buttons.indexOf(event.target); if (currentIndex < 0 || !buttons.length) return;
    event.preventDefault(); const next = buttons[getNextWrappedIndex(currentIndex, direction, buttons.length)]; next.focus(); next.click();
  }
  function selectMethod(nextMethod: SaleTenderMethod) { setMethod(nextMethod); setAmountInput(formatMoneyInput(pendingInCents)); setCreditReceipt(''); setCreditAuthCode(''); }
  function addPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!newPayment) return;
    focusStatusAfterAddRef.current = true; onAddPayment(newPayment);
    setAmountInput(formatMoneyInput(pendingInCents - newPayment.amountInCents)); setAddingPayment(false); setCreditReceipt(''); setCreditAuthCode('');
  }
  function removePayment(index: number) {
    const nextPayments = payments.filter((_, paymentIndex) => paymentIndex !== index);
    onRemovePayment(index); setAmountInput(formatMoneyInput(calculatePaymentTotals(totalInCents, nextPayments).pendingInCents)); setAddingPayment(false);
  }

  return <div className="overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
    <section aria-labelledby="payment-title" aria-modal="true" className="modal payment-modal" ref={dialogRef} role="dialog" tabIndex={-1}>
      <div className="modalhead"><div><h2 id="payment-title">Pagamento</h2><div className="sub" style={{ marginTop: 5 }}>Adicione uma ou mais formas de pagamento.</div></div><button aria-label="Fechar pagamento" className="x" onClick={onClose} type="button">×</button></div>
      <div className="modalbody payment-body">
        {errorMessage && <p className="sale-save-error" role="alert">{errorMessage}</p>}
        <div className="paytotal"><span>Total da venda</span><b>{formatMoney(totalInCents)}</b></div>
        {payments.length > 0 && <section aria-label="Pagamentos adicionados" className="payment-list"><h3>Pagamentos</h3>{payments.map((payment, index) => <div className="payment-item" key={`${payment.method}-${index}`}><div><b>{paymentMethodLabels[payment.method]}</b>{payment.method === 'cash' && payment.changeInCents ? <small>Recebido {formatMoney(payment.amountReceivedInCents ?? payment.amountInCents)} · Troco {formatMoney(payment.changeInCents)}</small> : null}</div><b>{formatMoney(payment.amountInCents)}</b><button aria-label={`Remover pagamento ${paymentMethodLabels[payment.method]}`} className="remove-payment" onClick={() => removePayment(index)} type="button">Remover</button></div>)}</section>}
        <div aria-live="polite" className={`payment-balance ${isComplete ? 'complete' : 'pending'}`}><div><span>Pago</span><b>{formatMoney(paidInCents)}</b></div><div><span>{isComplete ? 'Pagamento completo' : 'Pendente'}</span><b>{formatMoney(pendingInCents)}</b></div></div>
        {!isComplete && !addingPayment && payments.length > 0 && <div className="add-payment-prompt"><p>Falta <b>{formatMoney(pendingInCents)}</b> para concluir esta venda. Deseja adicionar outra forma de pagamento?</p><button className="btn secondary" ref={anotherPaymentButtonRef} onClick={() => { setAmountInput(formatMoneyInput(pendingInCents)); setAddingPayment(true); }} type="button">＋ Adicionar outra forma de pagamento</button></div>}
        {!isComplete && addingPayment && <form className="add-payment-form" onSubmit={addPayment}>
          <div className="payment-label">Forma de pagamento</div><div className="paymethods" role="group" aria-label="Forma de pagamento" onKeyDown={handleMethodKeyDown}>{methods.map((item) => <button aria-pressed={method === item.id} autoFocus={item.id === method} data-initial-focus={item.id === method ? 'true' : undefined} className={`method ${method === item.id ? 'selected' : ''}`} data-method={item.id} key={item.id} onClick={() => selectMethod(item.id)} type="button"><span aria-hidden="true">{item.icon}</span><br />{item.label}</button>)}</div>
          {method === 'customer_credit' && <div className="customer-credit-fields"><label className="field" htmlFor="customer-credit-receipt">Comprovante ou venda original<input autoComplete="off" id="customer-credit-receipt" onChange={(event) => { setVerifiedCredit(undefined); setCreditReceipt(event.target.value); }} placeholder="CR-... ou número da venda" value={creditReceipt} /></label><label className="field" htmlFor="customer-credit-code">Código de autorização<input autoComplete="off" id="customer-credit-code" onChange={(event) => { setVerifiedCredit(undefined); setCreditAuthCode(event.target.value); }} placeholder="Código impresso no comprovante" value={creditAuthCode} /></label>{verifiedCredit && <p>Saldo disponível: <b>{formatMoney(verifiedCredit.balanceInCents)}</b></p>}{creditReceipt && creditAuthCode && !verifiedCredit && <p className="payment-error" role="alert">Comprovante ou código inválido.</p>}</div>}
          <div className="field"><label htmlFor="payment-amount">{method === 'cash' ? 'Valor recebido' : 'Valor'}</label><input ref={amountInputRef} autoComplete="off" id="payment-amount" inputMode="decimal" onChange={(event) => setAmountInput(event.target.value)} placeholder="Ex.: 30,00" value={amountInput} /></div>
          {invalidAmount ? <p className="payment-error" role="alert">O valor excede o saldo pendente ou o crédito disponível.</p> : method === 'cash' && newPayment ? <div className="cash-preview"><span>Aplicado à venda <b>{formatMoney(newPayment.amountInCents)}</b></span><span>Troco <b>{formatMoney(newPayment.changeInCents ?? 0)}</b></span></div> : null}
          <button className="btn secondary add-payment-submit" disabled={!newPayment} type="submit">Adicionar pagamento</button>
        </form>}
      </div>
      <div className="modalfoot"><button className="btn secondary" onClick={onClose} type="button">Voltar</button><button className="btn primary" disabled={!isComplete} onClick={onFinalize} ref={finalizeButtonRef} type="button">Finalizar venda</button></div>
    </section>
  </div>;
}