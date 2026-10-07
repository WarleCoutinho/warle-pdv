import { useMemo, useState, type FormEvent } from 'react';
import { AppPageTopBar } from '../components/AppPageTopBar';
import type { AppPage } from '../types/navigation';
import type { Product } from '../types/product';
import { formatMoney, parseMoneyInput } from '../utils/money';

type ProductDraft = Pick<Product, 'name' | 'category' | 'priceInCents' | 'active'>;
type ProductsPageProps = {
  products: Product[];
  onProductsChange: (products: Product[]) => void;
  onNavigate: (page: AppPage) => void;
};

type ProductFormProps = {
  categories: string[];
  product?: Product;
  onClose: () => void;
  onSave: (draft: ProductDraft) => void;
};

export function ProductsPage({ products, onProductsChange, onNavigate }: ProductsPageProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Todas');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const categories = useMemo(() => ['Todas', ...new Set(products.map((product) => product.category))], [products]);
  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    return products.filter((product) => {
      const matchesSearch = product.name.toLocaleLowerCase('pt-BR').includes(query)
        || product.category.toLocaleLowerCase('pt-BR').includes(query);
      const matchesCategory = category === 'Todas' || product.category === category;
      const matchesStatus = status === 'all' || product.active === (status === 'active');
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [category, products, search, status]);

  function saveDraft(draft: ProductDraft) {
    const next = creating
      ? [...products, { ...draft, id: createProductId(), emoji: '📦' }]
      : products.map((product) => product.id === editing?.id ? { ...product, ...draft } : product);
    try {
      onProductsChange(next);
      setError('');
      setCreating(false);
      setEditing(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o produto.');
    }
  }

  function toggleActive(product: Product) {
    try {
      onProductsChange(products.map((item) => item.id === product.id ? { ...item, active: !item.active } : item));
      setError('');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível atualizar o produto.');
    }
  }

  return (
    <main className="content products-content">
      <AppPageTopBar activePage="products" onNavigate={onNavigate} />
      <div className="title-row products-title-row">
        <div><h1>Produtos</h1><div className="sub">Gerencie o catálogo usado nas vendas.</div></div>
        <button className="btn primary" onClick={() => { setEditing(null); setCreating(true); }} type="button">＋ Novo produto</button>
      </div>

      {error && <div className="products-error" role="alert">{error}</div>}

      <section aria-label="Filtros de produtos" className="products-toolbar">
        <label className="products-search">Pesquisar produto
          <input onChange={(event) => setSearch(event.target.value)} placeholder="Nome ou categoria..." type="search" value={search} />
        </label>
        <label>Categoria
          <select onChange={(event) => setCategory(event.target.value)} value={category}>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>Status
          <select onChange={(event) => setStatus(event.target.value as typeof status)} value={status}>
            <option value="all">Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option>
          </select>
        </label>
      </section>

      <section aria-label="Lista de produtos" className="products-table-panel">
        {products.length === 0 ? (
          <div className="products-empty"><b>Nenhum produto cadastrado.</b><span>Cadastre seu primeiro produto para começar a vender.</span></div>
        ) : filteredProducts.length === 0 ? (
          <div className="products-empty"><b>Nenhum produto encontrado.</b><span>Tente alterar a busca ou os filtros.</span></div>
        ) : (
          <div className="products-table-scroll">
            <table className="products-table">
              <thead><tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Status</th><th>Ações</th></tr></thead>
              <tbody>{filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td><span className="products-name"><span aria-hidden="true">{product.emoji}</span><b>{product.name}</b></span></td>
                  <td>{product.category}</td><td className="products-price">{formatMoney(product.priceInCents)}</td>
                  <td><span className={`products-status ${product.active ? 'is-active' : 'is-inactive'}`}>{product.active ? 'Ativo' : 'Inativo'}</span></td>
                  <td><div className="products-actions">
                    <button className="products-action" onClick={() => { setCreating(false); setEditing(product); }} type="button">Editar</button>
                    <button aria-label={`${product.active ? 'Desativar' : 'Ativar'} ${product.name}`} className="products-action muted" onClick={() => toggleActive(product)} type="button">{product.active ? 'Desativar' : 'Ativar'}</button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {(creating || editing) && <ProductForm categories={categories.filter((item) => item !== 'Todas')} key={editing?.id ?? 'new'} onClose={() => { setCreating(false); setEditing(null); }} onSave={saveDraft} product={editing ?? undefined} />}
    </main>
  );
}

function ProductForm({ categories, product, onClose, onSave }: ProductFormProps) {
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [price, setPrice] = useState(product ? formatPriceInput(product.priceInCents) : '');
  const [active, setActive] = useState(product?.active ?? true);
  const [errors, setErrors] = useState<{ name?: string; category?: string; price?: string }>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedPrice = parseMoneyInput(price);
    const nextErrors = {
      ...(name.trim() ? {} : { name: 'Informe o nome do produto.' }),
      ...(category.trim() ? {} : { category: 'Informe a categoria do produto.' }),
      ...(parsedPrice !== null && parsedPrice > 0 ? {} : { price: 'Informe um preço válido maior que zero.' }),
    };
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || parsedPrice === null) return;
    onSave({ name: name.trim(), category: category.trim(), priceInCents: parsedPrice, active });
  }

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="product-form-title" aria-modal="true" className="modal product-form-modal" role="dialog">
        <div className="modalhead"><h2 id="product-form-title">{product ? 'Editar produto' : 'Novo produto'}</h2><button aria-label="Fechar" className="x" onClick={onClose} type="button">×</button></div>
        <form onSubmit={submit}>
          <div className="modalbody product-form-body">
            <label className="product-field">Nome
              <input autoFocus onChange={(event) => setName(event.target.value)} value={name} />
              {errors.name && <small role="alert">{errors.name}</small>}
            </label>
            <label className="product-field">Categoria
              <input list="product-categories" onChange={(event) => setCategory(event.target.value)} value={category} />
              <datalist id="product-categories">{categories.map((item) => <option key={item} value={item} />)}</datalist>
              {errors.category && <small role="alert">{errors.category}</small>}
            </label>
            <label className="product-field">Preço
              <span className="product-price-input"><span>R$</span><input inputMode="decimal" onChange={(event) => setPrice(event.target.value)} placeholder="0,00" value={price} /></span>
              {errors.price && <small role="alert">{errors.price}</small>}
            </label>
            {product && <label className="product-active-field"><input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" /> Produto ativo</label>}
          </div>
          <div className="modalfoot"><button className="btn secondary" onClick={onClose} type="button">Cancelar</button><button className="btn primary" type="submit">Salvar produto</button></div>
        </form>
      </section>
    </div>
  );
}

function formatPriceInput(priceInCents: number): string {
  const reais = Math.floor(priceInCents / 100);
  const centavos = String(priceInCents % 100).padStart(2, '0');
  return `${reais},${centavos}`;
}

function createProductId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `product-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

