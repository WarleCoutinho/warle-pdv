import { useState } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';
import { paymentMethodLabels } from '../types/payment';
import type { Sale } from '../types/sale';
import type { StoreSettings } from '../types/settings';
import { formatMoney, sumMoney } from '../utils/money';
import { printCurrentReceipt } from '../utils/printing';
import { Receipt, type ReceiptPaperSize } from './Receipt';

type FinalizeSummaryProps = {
  sale: Sale;
  onStartNewSale: () => void;
  settings: StoreSettings;
};

const saleDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function FinalizeSummary({ sale, onStartNewSale, settings }: FinalizeSummaryProps) {
  const dialogRef = useModalFocus(onStartNewSale);
  const [paperSize, setPaperSize] = useState<ReceiptPaperSize>('80mm');
  const changeInCents = sumMoney(sale.payments.map((payment) => payment.changeInCents ?? 0));

  return (
    <div className="overlay success-overlay">
      <section aria-labelledby="finalize-title" aria-modal="true" className="modal finalize-modal" ref={dialogRef} role="dialog" tabIndex={-1}>
        <div className="success">
          <div className="finalize-overview">
            <div className="successicon" aria-hidden="true">✓</div>
            <h2 id="finalize-title">Venda concluída!</h2>
            <p className="sub">Venda #{String(sale.number).padStart(6, '0')} · {saleDateFormatter.format(new Date(sale.date))}</p>
            {changeInCents > 0 && (
              <div aria-label={`Troco a devolver: ${formatMoney(changeInCents)}`} className="change-highlight" role="status">
                <span aria-hidden="true" className="change-highlight-icon">$</span>
                <span className="change-highlight-label">Troco a devolver</span>
                <strong>{formatMoney(changeInCents)}</strong>
              </div>
            )}
            <div className="finalize-total"><span>Total</span><b>{formatMoney(sale.totalInCents)}</b></div>
            <div className="finalize-sale-payments">
              {sale.payments.map((payment, index) => (
                <div className="finalize-payment" key={`${payment.method}-${index}`}>
                  <span>{paymentMethodLabels[payment.method]}</span><b>{formatMoney(payment.amountInCents)}</b>
                </div>
              ))}
            </div>
            <div className="receipt-controls">
              <label htmlFor="receipt-paper-size">Largura do papel</label>
              <select id="receipt-paper-size" onChange={(event) => setPaperSize(event.target.value as ReceiptPaperSize)} value={paperSize}>
                <option value="58mm">Térmica 58 mm</option>
                <option value="80mm">Térmica 80 mm</option>
                <option value="a4">Impressora comum (A4)</option>
              </select>
            </div>
            <div className="successactions">
              <button className="btn secondary" onClick={printCurrentReceipt} type="button">▤ Imprimir comprovante</button>
              <button className="btn primary" onClick={onStartNewSale} type="button">＋ Nova venda</button>
            </div>
            </div>
          <Receipt paperSize={paperSize} sale={sale} settings={settings} />

        </div>
      </section>
    </div>
  );
}

