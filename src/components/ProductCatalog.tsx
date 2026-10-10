import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Product } from '../types/product';
import { getNextWrappedIndex } from '../utils/keyboardNavigation';
import { ProductCard } from './ProductCard';

type ProductCatalogProps = {
  products: Product[];
  categories: string[];
  selectedCategory: string;
  search: string;
  onCategoryChange: (category: string) => void;
  onSearchChange: (search: string) => void;
  onSelectProduct: (product: Product) => void;
};

export function ProductCatalog({
  products,
  categories,
  selectedCategory,
  search,
  onCategoryChange,
  onSearchChange,
  onSelectProduct,
}: ProductCatalogProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  useEffect(() => setHighlightedIndex(-1), [products]);
  useEffect(() => {
    if (highlightedIndex >= 0) document.getElementById(`pos-product-${products[highlightedIndex]?.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, products]);

  function selectHighlighted() {
    const product = products[highlightedIndex];
    if (!product) return;
    onSelectProduct(product);
    setHighlightedIndex(-1);
    searchRef.current?.focus();
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && products.length) {
      event.preventDefault();
      setHighlightedIndex((current) => getNextWrappedIndex(current, 1, products.length));
    } else if (event.key === 'ArrowUp' && products.length) {
      event.preventDefault();
      setHighlightedIndex((current) => getNextWrappedIndex(current, -1, products.length));
    } else if (event.key === 'Enter' && highlightedIndex >= 0) {
      event.preventDefault();
      selectHighlighted();
    }
  }

  return (
    <section className="catalog-panel" aria-label="Catálogo de produtos">
      <div className="searchrow">
        <div className="search">
          <input
            aria-label="Buscar produto pelo nome"
            aria-controls="pos-product-results"
            aria-activedescendant={highlightedIndex >= 0 ? `pos-product-${products[highlightedIndex]?.id}` : undefined}
            autoComplete="off"
            onChange={(event) => { onSearchChange(event.target.value); setHighlightedIndex(-1); }}
            onKeyDown={handleSearchKeyDown}
            ref={searchRef}
            placeholder="⌕  Buscar produto pelo nome..."
            type="search"
            value={search}
          />
        </div>
      </div>
      <div className="chips" aria-label="Categorias de produtos">
        {categories.map((category) => (
          <button
            aria-pressed={selectedCategory === category}
            className={`chip ${selectedCategory === category ? 'selected' : ''}`}
            key={category}
            onClick={() => onCategoryChange(category)}
            type="button"
          >
            {category}
          </button>
        ))}
      </div>
      <div className="grid products" id="pos-product-results" style={{ marginTop: 15 }}>
        {products.length > 0 ? (
          products.map((product, index) => (
            <ProductCard highlighted={index === highlightedIndex} key={product.id} onSelect={(selected) => { onSelectProduct(selected); setHighlightedIndex(-1); searchRef.current?.focus(); }} product={product} />
          ))
        ) : (
          <div className="catalog-empty" role="status">
            Nenhum produto encontrado.
          </div>
        )}
      </div>
    </section>
  );
}

