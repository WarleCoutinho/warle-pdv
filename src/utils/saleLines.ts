import type { Sale } from '../types/sale';
import type { SaleFinancialData } from '../types/customerCredit';

/** Derived identities never rewrite a historical sale. */
export function getSaleLines(sale: Sale) {
  return sale.items.map((item, index) => ({ ...item, lineId: item.lineId ?? `legacy-line-${index + 1}` }));
}

/** Old returns match original snapshots; indistinguishable equal-price lines use original order. */
export function getReturnedLineQuantities(sale: Sale, financial: SaleFinancialData): Record<string, number> {
  const lines = getSaleLines(sale);
  const totals: Record<string, number> = {};
  if (new Set(lines.map((item) => item.lineId)).size !== lines.length) throw new Error('Identificadores de linhas da venda são ambíguos. Preserve os dados para auditoria.');
  for (const entry of financial.returns.filter((item) => item.saleId === sale.id)) {
    for (const returned of entry.items) {
      let remaining = returned.quantity;
      const candidates = lines.filter((item) => (!returned.lineId || item.lineId === returned.lineId)
        && item.productId === returned.productId && item.productName === returned.productName
        && item.unitPriceInCents * returned.quantity === returned.amountInCents
        && (returned.unitPriceInCents === undefined || item.unitPriceInCents === returned.unitPriceInCents));
      for (const item of candidates) {
        const quantity = Math.min(remaining, item.quantity - (totals[item.lineId] ?? 0));
        totals[item.lineId] = (totals[item.lineId] ?? 0) + quantity;
        remaining -= quantity;
        if (!remaining) break;
      }
      if (remaining) throw new Error('A devolução histórica não corresponde às linhas originais ou excede a quantidade vendida. Preserve os dados para auditoria.');
    }
  }
  return totals;
}
