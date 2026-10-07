export function printCurrentReceipt(): void {
  document.body.classList.add('printing-receipt');
  try {
    window.print();
  } finally {
    document.body.classList.remove('printing-receipt');
  }
}
