const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatMoney(amountInCents: number): string {
  assertSafeCents(amountInCents);
  return currencyFormatter.format(amountInCents / 100);
}

export function multiplyMoney(unitPriceInCents: number, quantity: number): number {
  assertSafeCents(unitPriceInCents);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError('A quantidade deve ser um inteiro não negativo.');
  }

  const subtotal = unitPriceInCents * quantity;
  assertSafeCents(subtotal);
  return subtotal;
}

export function sumMoney(amountsInCents: number[]): number {
  return amountsInCents.reduce((total, amount) => {
    assertSafeCents(amount);
    const nextTotal = total + amount;
    assertSafeCents(nextTotal);
    return nextTotal;
  }, 0);
}

/** Parses a Brazilian currency input as integer centavos without float arithmetic. */
export function parseMoneyInput(value: string): number | null {
  const normalized = value.trim();
  if (!normalized || !/^\d+(?:[.,]\d{0,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

function assertSafeCents(amountInCents: number): void {
  if (!Number.isSafeInteger(amountInCents) || amountInCents < 0) {
    throw new RangeError('O valor monetário deve ser um inteiro não negativo em centavos.');
  }
}

