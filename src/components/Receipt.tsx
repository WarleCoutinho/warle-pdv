import type { Sale } from '../types/sale';
import { paymentMethodLabels } from '../types/payment';
import { formatMoney, sumMoney } from '../utils/money';

export type ReceiptPaperSize = '58mm' | '80mm' | 'a4';

type ReceiptProps = {
  sale: Sale;
  paperSize: ReceiptPaperSize;
};

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function Receipt({ sale, paperSize }: ReceiptProps) {
  const cashPayments = sale.payments.filter((payment) => payment.method === 'cash');
  const cashReceivedInCents = sumMoney(cashPayments.map((payment) => payment.amountReceivedInCents ?? payment.amountInCents));
  const changeInCents = sumMoney(cashPayments.map((payment) => payment.changeInCents ?? 0));
  const saleDate = new Date(sale.date);

  return (
    <article className={`print-root receipt-paper-${paperSize}`}>
      <div className="receipt">
        <header className="receipt-header">
          <h3>Raiz — PDV</h3>
          <p>COMPROVANTE DE VENDA</p>
        </header>
        <div className="receipt-meta">
          <div><span>Venda</span><b>#{String(sale.number).padStart(6, '0')}</b></div>
          <div><span>Data</span><b>{dateFormatter.format(saleDate)}</b></div>
          <div><span>Hora</span><b>{timeFormatter.format(saleDate)}</b></div>
        </div>

        <hr />
        <div className="receipt-items">
          {sale.items.map((item) => (
            <div className="receipt-item" key={`${item.productId}-${item.productName}`}>
              <b>{item.productName}</b>
              <div><span>{item.quantity} × {formatMoney(item.unitPriceInCents)}</span><b>{formatMoney(item.subtotalInCents)}</b></div>
            </div>
          ))}
        </div>
        <hr />

        <div className="receipt-total"><b>TOTAL</b><b>{formatMoney(sale.totalInCents)}</b></div>
        <div className="receipt-payments">
          <b className="receipt-section-title">{sale.payments.length === 1 ? 'PAGAMENTO' : 'PAGAMENTOS'}</b>
          {sale.payments.map((payment, index) => (
            <div className="receipt-line" key={`${payment.method}-${index}`}>
              <span>{paymentMethodLabels[payment.method]}</span>
              <b>{formatMoney(payment.amountInCents)}</b>
            </div>
          ))}
          {cashPayments.length > 0 && (
            <div className="receipt-cash-details">
              <div className="receipt-line"><span>Dinheiro recebido</span><b>{formatMoney(cashReceivedInCents)}</b></div>
              {changeInCents > 0 && <div className="receipt-line receipt-change"><span>TROCO</span><b>{formatMoney(changeInCents)}</b></div>}
            </div>
          )}
        </div>
        <hr />
        <p className="receipt-thanks">Obrigado pela preferência!</p>
      </div>
    </article>
  );
}
