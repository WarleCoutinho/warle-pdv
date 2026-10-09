import type { Product } from '../types/product';
import { formatMoney } from '../utils/money';

type ProductCardProps = {
  product: Product;
  onSelect: (product: Product) => void;
  highlighted?: boolean;
};

export function ProductCard({ product, onSelect, highlighted = false }: ProductCardProps) {
  return (
    <button
      className={`product ${highlighted ? 'is-keyboard-highlighted' : ''}`}
      data-testid={`product-${product.id}`}
      id={`pos-product-${product.id}`}
      aria-pressed={highlighted}
      onClick={() => onSelect(product)}
      type="button"
      aria-label={`Adicionar ${product.name}, ${formatMoney(product.priceInCents)}`}
    >
      <span className={`product-visual ${product.imageDataUrl ? 'has-image' : ''}`} aria-hidden="true">{product.imageDataUrl ? <img alt="" src={product.imageDataUrl} /> : <span className="emoji">{product.emoji}</span>}</span>
      <b>{product.name}</b>
      <small>{product.category}</small>
      <strong>{formatMoney(product.priceInCents)}</strong>
    </button>
  );
}

