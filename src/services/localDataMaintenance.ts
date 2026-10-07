import { clearDraftCart } from './cartStorage';
import { clearStoredProducts } from './productStorage';
import { clearStoredSales } from './saleStorage';
import { clearStoredSettings } from './settingsStorage';
import { clearCashData } from './cashStorage';

/** Removes only the localStorage keys owned by Raiz — PDV. */
export function clearLocalData(): void {
  clearStoredSales();
  clearStoredProducts();
  clearDraftCart();
  clearStoredSettings();
  clearCashData();
}
