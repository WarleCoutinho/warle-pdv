import type { CartItem, Product } from '../types/product';
import { multiplyMoney } from './money';

export function createCartItem(product: Product): CartItem {
  return {
    product,
    quantity: 1,
    unitPriceInCents: product.priceInCents,
    subtotalInCents: product.priceInCents,
  };
}

export function changeCartItemQuantity(item: CartItem, quantity: number): CartItem {
  return {
    ...item,
    quantity,
    subtotalInCents: multiplyMoney(item.unitPriceInCents, quantity),
  };
}

