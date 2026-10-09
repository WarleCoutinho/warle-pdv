import type { CartItem, Product } from '../types/product';
import { multiplyMoney } from '../utils/money';

export const CART_STORAGE_KEY = 'raiz-pdv:draft-cart';

type StoredCartItem = {
  productId: string;
  quantity: number;
  unitPriceInCents: number;
};

export function loadDraftCart(products: Product[]): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];

    const storedItems: unknown = JSON.parse(raw);
    if (!Array.isArray(storedItems)) return [];

    return storedItems.flatMap((value: unknown) => {
      if (!isStoredCartItem(value)) return [];
      const product = products.find((item) => item.id === value.productId && item.active);
      if (!product) return [];

      try {
        return [{
          product,
          quantity: value.quantity,
          unitPriceInCents: value.unitPriceInCents,
          subtotalInCents: multiplyMoney(value.unitPriceInCents, value.quantity),
        }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function saveDraftCart(items: CartItem[]): void {
  try {
    const storedItems: StoredCartItem[] = items.map(({ product, quantity, unitPriceInCents }) => ({
      productId: product.id,
      quantity,
      unitPriceInCents,
    }));
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(storedItems));
  } catch {
    // Keep the sale flow usable in memory if browser storage is unavailable.
  }
}

export function clearDraftCart(): void {
  localStorage.removeItem(CART_STORAGE_KEY);
}

function isStoredCartItem(value: unknown): value is StoredCartItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.productId === 'string'
    && Number.isSafeInteger(item.quantity)
    && Number(item.quantity) > 0
    && Number.isSafeInteger(item.unitPriceInCents)
    && Number(item.unitPriceInCents) >= 0;
}

