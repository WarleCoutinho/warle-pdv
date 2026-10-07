import { useState } from 'react';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { PosPage } from './pages/PosPage';
import { ProductsPage } from './pages/ProductsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { clearLocalData } from './services/localDataMaintenance';
import { loadProducts, saveProducts } from './services/productStorage';
import { loadSettings, saveSettings } from './services/settingsStorage';
import type { Product } from './types/product';
import type { StoreSettings } from './types/settings';
import type { AppPage } from './types/navigation';

export function App() {
  const [activePage, setActivePage] = useState<AppPage>('pos');
  const [products, setProducts] = useState<Product[]>(loadProducts);
  const [settings, setSettings] = useState<StoreSettings>(loadSettings);

  function updateProducts(nextProducts: Product[]) {
    saveProducts(nextProducts);
    setProducts(nextProducts);
  }

  function updateSettings(nextSettings: StoreSettings): StoreSettings {
    const saved = saveSettings(nextSettings);
    setSettings(saved);
    return saved;
  }

  function resetLocalData(): StoreSettings {
    clearLocalData();
    const restoredProducts = loadProducts();
    const defaults = loadSettings();
    setProducts(restoredProducts);
    setSettings(defaults);
    return defaults;
  }

  if (activePage === 'home') return <DashboardPage onNavigate={setActivePage} />;
  if (activePage === 'products') return <ProductsPage onNavigate={setActivePage} onProductsChange={updateProducts} products={products} />;
  if (activePage === 'settings') return <SettingsPage onClearLocalData={resetLocalData} onNavigate={setActivePage} onSaveSettings={updateSettings} settings={settings} />;
  if (activePage === 'history') return <HistoryPage onNavigate={setActivePage} settings={settings} />;
  if (activePage === 'reports') return <ReportsPage onNavigate={setActivePage} />;
  return <PosPage onNavigate={setActivePage} products={products} settings={settings} />;
}

