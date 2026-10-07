import { useState } from 'react';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { PosPage } from './pages/PosPage';
import { ProductsPage } from './pages/ProductsPage';
import { ReportsPage } from './pages/ReportsPage';
import { loadProducts, saveProducts } from './services/productStorage';
import type { Product } from './types/product';
import type { AppPage } from './types/navigation';

export function App() {
  const [activePage, setActivePage] = useState<AppPage>('pos');
  const [products, setProducts] = useState<Product[]>(loadProducts);

  function updateProducts(nextProducts: Product[]) {
    saveProducts(nextProducts);
    setProducts(nextProducts);
  }

  if (activePage === 'home') return <DashboardPage onNavigate={setActivePage} />;
  if (activePage === 'products') return <ProductsPage onNavigate={setActivePage} onProductsChange={updateProducts} products={products} />;
  if (activePage === 'history') return <HistoryPage onNavigate={setActivePage} />;
  if (activePage === 'reports') return <ReportsPage onNavigate={setActivePage} />;
  return <PosPage onNavigate={setActivePage} products={products} />;
}

