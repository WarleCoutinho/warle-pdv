import type { Product } from '../types/product';
import { formatMoney } from '../utils/money';

type ProductCardProps = {
  product: Product;
  onSelect: (product: Product) => void;
};

export function ProductCard({ product, onSelect }: ProductCardProps) {
  return (
    <button
      className="product"
      data-testid={`product-${product.id}`}
      onClick={() => onSelect(product)}
      type="button"
      aria-label={`Adicionar ${product.name}, ${formatMoney(product.priceInCents)}`}
    >
      <span className="emoji" aria-hidden="true">{product.emoji}</span>
      <b>{product.name}</b>
      <small>{product.category}</small>
      <strong>{formatMoney(product.priceInCents)}</strong>
    </button>
  );
}

