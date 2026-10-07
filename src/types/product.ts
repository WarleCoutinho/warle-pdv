/** Monetary amounts use integer centavos to avoid floating-point arithmetic. */
export type Product = {
  id: string;
  name: string;
  priceInCents: number;
  category: string;
  active: boolean;
  emoji: string;
};

export type CartItem = {
  product: Product;
  quantity: number;
  unitPriceInCents: number;
  subtotalInCents: number;
};

