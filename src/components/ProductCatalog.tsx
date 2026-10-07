import type { Product } from '../types/product';
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
  return (
    <section className="catalog-panel" aria-label="Catálogo de produtos">
      <div className="searchrow">
        <div className="search">
          <input
            aria-label="Buscar produto pelo nome"
            autoComplete="off"
            onChange={(event) => onSearchChange(event.target.value)}
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
      <div className="grid products" style={{ marginTop: 15 }}>
        {products.length > 0 ? (
          products.map((product) => (
            <ProductCard key={product.id} onSelect={onSelectProduct} product={product} />
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

