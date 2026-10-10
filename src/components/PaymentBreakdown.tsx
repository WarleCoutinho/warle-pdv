import { paymentMethodLabels, type SaleTenderMethod } from '../types/payment';
import { formatMoney } from '../utils/money';

type PaymentBreakdownProps = {
  totals: Record<SaleTenderMethod, number>;
  totalInCents: number;
  showPercentages?: boolean;
};

const methods: SaleTenderMethod[] = ['cash', 'pix', 'debit', 'credit', 'customer_credit'];

export function PaymentBreakdown({ totals, totalInCents, showPercentages = false }: PaymentBreakdownProps) {
  return (
    <div className="payment-breakdown">
      {methods.map((method) => {
        const amount = totals[method];
        const percent = totalInCents === 0 ? 0 : Math.round((amount / totalInCents) * 100);
        const width = totalInCents === 0 ? 0 : Math.min(100, (amount / totalInCents) * 100);
        return (
          <div className="payment-breakdown-row" key={method}>
            <div className="payment-breakdown-heading">
              <span>{paymentMethodLabels[method]}</span>
              <b>{formatMoney(amount)}</b>
            </div>
            <div aria-label={`${paymentMethodLabels[method]}: ${percent}%`} className="payment-breakdown-track" role="img">
              <span className={`payment-breakdown-fill payment-fill-${method}`} style={{ width: `${width}%` }} />
            </div>
            {showPercentages && <small>{percent}% dos pagamentos registrados</small>}
          </div>
        );
      })}
    </div>
  );
}
