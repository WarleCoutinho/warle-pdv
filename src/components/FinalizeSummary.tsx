import type { CartItem } from '../types/product';
import type { SalePayment } from '../types/payment';
import { paymentMethodLabels } from '../types/payment';
import { formatMoney } from '../utils/money';
import { sumMoney } from '../utils/money';

type FinalizeSummaryProps = {
  items: CartItem[];
  totalInCents: number;
  payments: SalePayment[];
  onStartNewSale: () => void;
  onClose: () => void;
};

export function FinalizeSummary({ items, totalInCents, payments, onStartNewSale, onClose }: FinalizeSummaryProps) {
  const changeInCents = sumMoney(payments.map((payment) => payment.changeInCents ?? 0));
  return (
    <div className="overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section
        aria-labelledby="finalize-title"
        aria-modal="true"
        className="modal finalize-modal"
        role="dialog"
      >
        <div className="success">
          <div className="successicon" aria-hidden="true">✓</div>
          <h2 id="finalize-title">Venda concluída</h2>
          <p className="sub">Pagamento confirmado. Esta venda ainda não foi salva.</p>
          <div className="finalize-lines">
            {items.map((item) => (
              <div className="payrow" key={item.product.id}>
                <span>{item.quantity} × {item.product.name}</span>
                <b>{formatMoney(item.subtotalInCents)}</b>
              </div>
            ))}
          </div>
          <div className="finalize-total">
            <span>Total</span>
            <b>{formatMoney(totalInCents)}</b>
          </div>
          <div className="finalize-payments">
            <b>Pagamentos</b>
            {payments.map((payment, index) => (
              <div className="finalize-payment" key={`${payment.method}-${index}`}>
                <span>{paymentMethodLabels[payment.method]}</span>
                <b>{formatMoney(payment.amountInCents)}</b>
              </div>
            ))}
          </div>
          <div className="finalize-payment"><span>Troco</span><b>{formatMoney(changeInCents)}</b></div>
          <div className="successactions">
            <button className="btn secondary" onClick={onClose} type="button">Fechar resumo</button>
            <button className="btn primary" onClick={onStartNewSale} type="button">＋ Nova venda</button>
          </div>
        </div>
      </section>
    </div>
  );
}

