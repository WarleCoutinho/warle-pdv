import type { CartItem } from '../types/product';
import { formatMoney } from '../utils/money';

type CartItemRowProps = {
  item: CartItem;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
};

export function CartItemRow({ item, onIncrement, onDecrement, onRemove }: CartItemRowProps) {
  return (
    <div className="cartitem" data-testid={`cart-item-${item.product.id}`}>
      <div>
        <b>{item.product.name}</b>
        <small>{formatMoney(item.unitPriceInCents)} cada</small>
        <button className="remove" onClick={onRemove} type="button">
          Remover
        </button>
      </div>
      <div className="qty" aria-label={`Quantidade de ${item.product.name}`}>
        <button aria-label={`Diminuir ${item.product.name}`} onClick={onDecrement} type="button">−</button>
        <b aria-live="polite">{item.quantity}</b>
        <button aria-label={`Aumentar ${item.product.name}`} onClick={onIncrement} type="button">+</button>
      </div>
      <div className="cartitem-subtotal">{formatMoney(item.subtotalInCents)}</div>
    </div>
  );
}

