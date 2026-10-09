import type { KeyboardEvent } from 'react';
import type { CartItem } from '../types/product';
import { formatMoney } from '../utils/money';
import { getAdjacentIndex } from '../utils/keyboardNavigation';
import { CartItemRow } from './CartItemRow';

type CartPanelProps = {
  items: CartItem[];
  totalInCents: number;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onRemove: (productId: string) => void;
  onFinalize: () => void;
};

export function CartPanel({
  items,
  totalInCents,
  onIncrement,
  onDecrement,
  onRemove,
  onFinalize,
}: CartPanelProps) {
  const itemCount = items.reduce((count, item) => count + item.quantity, 0);

  function handleCartKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest('input,select,textarea,[contenteditable=true]')) return;
    const currentRow = target.closest('.cartitem');
    if (!currentRow) return;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.cartitem'));
    const currentIndex = rows.indexOf(currentRow as HTMLElement);
    const nextIndex = getAdjacentIndex(currentIndex, event.key === 'ArrowDown' ? 1 : -1, rows.length);
    const nextRow = nextIndex >= 0 ? rows[nextIndex] : undefined;
    if (!nextRow) return;
    const nextControl = nextRow.querySelector<HTMLButtonElement>('button:not(.remove)');
    if (nextControl) { event.preventDefault(); nextControl.focus(); }
  }

  return (
    <aside className="card cart" aria-label="Carrinho de compras" onKeyDown={handleCartKeyDown}>
      <div className="carthead">
        <h2>Carrinho</h2>
        <span className="badge">{itemCount} {itemCount === 1 ? 'item' : 'itens'}</span>
      </div>
      <div className="cartbody" aria-live="polite">
        {items.length > 0 ? items.map((item) => (
          <CartItemRow
            item={item}
            key={item.product.id}
            onDecrement={() => onDecrement(item.product.id)}
            onIncrement={() => onIncrement(item.product.id)}
            onRemove={() => onRemove(item.product.id)}
          />
        )) : (
          <div className="empty">
            <span className="emoji" aria-hidden="true">🛍️</span>
            Seu carrinho está vazio.<br />Adicione produtos para começar.
          </div>
        )}
      </div>
      <div className="cartfoot">
        <div className="totalrow">
          <span>Total da venda</span>
          <b data-testid="cart-total">{formatMoney(totalInCents)}</b>
        </div>
        <button
          className="btn primary wide"
          disabled={items.length === 0}
          onClick={onFinalize}
          type="button"
        >
          Finalizar venda &nbsp; →
        </button>
      </div>
    </aside>
  );
}

