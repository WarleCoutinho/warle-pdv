import { useEffect, useState } from 'react';
import { CashPage } from './pages/CashPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { PosPage } from './pages/PosPage';
import { ProductsPage } from './pages/ProductsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { clearLocalData } from './services/localDataMaintenance';
import { loadProducts, saveProducts } from './services/productStorage';
import { loadSettings, saveSettings } from './services/settingsStorage';
import { addCashMovement, closeCashSession, getOpenCashSession, loadCashData, openCashSession } from './services/cashStorage';
import type { CashData, CashMovement } from './types/cash';
import type { Product } from './types/product';
import type { StoreSettings } from './types/settings';
import type { AppPage } from './types/navigation';

export function App() {
  const [activePage, setActivePage] = useState<AppPage>('pos');
  const [products, setProducts] = useState<Product[]>(loadProducts);
  const [settings, setSettings] = useState<StoreSettings>(loadSettings);
  const [cashState, setCashState] = useState(() => readCashState());
  const { data: cashData, error: cashError } = cashState;

  useEffect(() => {
    function syncCash(event: StorageEvent) {
      if (event.key === 'raiz-pdv:cash' || event.key === null) refreshCash();
    }
    window.addEventListener('storage', syncCash);
    return () => window.removeEventListener('storage', syncCash);
  }, []);

  function refreshCash() {
    setCashState(readCashState());
  }

  function startCash(openingAmountInCents: number) {
    setCashState({ data: openCashSession(openingAmountInCents), error: null });
  }

  function moveCash(type: CashMovement['type'], amountInCents: number, description: string) {
    const session = getOpenCashSession(cashData);
    if (!session) throw new Error('Abra um caixa antes de registrar movimentações.');
    setCashState({ data: addCashMovement(session.id, type, amountInCents, description), error: null });
  }

  function finishCash(countedAmountInCents: number) {
    const session = getOpenCashSession(cashData);
    if (!session) throw new Error('Não há caixa aberto para fechar.');
    setCashState({ data: closeCashSession(session.id, countedAmountInCents), error: null });
  }

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
    refreshCash();
    return defaults;
  }

  const openSession = cashData.sessions.find((session) => session.status === 'open');
  if (activePage === 'home') return <DashboardPage cashData={cashData} onNavigate={setActivePage} />;
  if (activePage === 'products') return <ProductsPage onNavigate={setActivePage} onProductsChange={updateProducts} products={products} />;
  if (activePage === 'settings') return <SettingsPage onClearLocalData={resetLocalData} onNavigate={setActivePage} onSaveSettings={updateSettings} settings={settings} />;
  if (activePage === 'history') return <HistoryPage onNavigate={setActivePage} settings={settings} />;
  if (activePage === 'reports') return <ReportsPage onNavigate={setActivePage} />;
  if (activePage === 'cash') return <CashPage data={cashData} error={cashError} onClose={finishCash} onMovement={moveCash} onNavigate={setActivePage} onOpen={startCash} />;
  return <PosPage cashSessionId={openSession?.id} onNavigate={setActivePage} products={products} settings={settings} />;
}

function readCashState(): { data: CashData; error: string | null } {
  try { return { data: loadCashData(), error: null }; }
  catch (error) {
    return {
      data: { sessions: [], movements: [] },
      error: error instanceof Error ? error.message : 'Não foi possível carregar o caixa.',
    };
  }
}
