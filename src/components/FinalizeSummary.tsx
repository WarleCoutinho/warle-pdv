import type { CartItem } from '../types/product';
import { formatMoney } from '../utils/money';

type FinalizeSummaryProps = {
  items: CartItem[];
  totalInCents: number;
  onStartNewSale: () => void;
  onClose: () => void;
};

export function FinalizeSummary({ items, totalInCents, onStartNewSale, onClose }: FinalizeSummaryProps) {
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
          <h2 id="finalize-title">Resumo da venda</h2>
          <p className="sub">O fluxo foi finalizado. Esta venda ainda não foi salva.</p>
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
          <div className="successactions">
            <button className="btn secondary" onClick={onClose} type="button">Voltar ao carrinho</button>
            <button className="btn primary" onClick={onStartNewSale} type="button">＋ Nova venda</button>
          </div>
        </div>
      </section>
    </div>
  );
}

