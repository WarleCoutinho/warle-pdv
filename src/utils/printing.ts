export function printCurrentReceipt(): void {
  document.body.classList.add('printing-receipt');
  try {
    window.print();
  } finally {
    document.body.classList.remove('printing-receipt');
  }
}

/** Print credit slips independently of the underlying sale dialog. */
export function printCustomerCreditReceipt(): void {
  document.body.classList.add('printing-credit');
  try { window.print(); }
  finally { document.body.classList.remove('printing-credit'); }
}
