import { useEffect, useState, type ReactNode } from 'react';
import { OperatorLoginPage } from './pages/OperatorLoginPage';
import { getCurrentOperator, logoutOperator, requireAdministrator } from './services/operatorAccess';
import { CashPage } from './pages/CashPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { PosPage } from './pages/PosPage';
import { ProductsPage } from './pages/ProductsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { clearLocalData } from './services/localDataMaintenance';
import { cashLabel } from './utils/cashDay';
import { recoverCreditReservations } from './services/saleFinancialStorage';
import { loadProducts, saveProducts } from './services/productStorage';
import { loadSettings, saveSettings, initializeOperatorAccess } from './services/settingsStorage';
import { addCashMovement, closeCashSession, getOpenCashSession, getPendingCashSessions, loadCashData, openCashSession } from './services/cashStorage';
import type { CashData, CashMovement } from './types/cash';
import type { Product } from './types/product';
import type { StoreSettings } from './types/settings';
import type { AppPage } from './types/navigation';
import type { CashPaymentTotals } from './utils/cash';

export function App() {
  const [activePage, setActivePage] = useState<AppPage>('pos');
  const [products, setProducts] = useState<Product[]>(loadProducts);
  const [settings, setSettings] = useState<StoreSettings>(initializeOperatorAccess);
  const [operator, setOperator] = useState(getCurrentOperator);
  const [cashState, setCashState] = useState(() => readCashState());
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const { data: cashData, error: cashError } = cashState;

  useEffect(() => {
    function syncCash(event: StorageEvent) {
      if (event.key === 'raiz-pdv:cash' || event.key === null) refreshCash();
      if (event.key === 'raiz-pdv:products' || event.key === null) { try { setProducts(loadProducts()); } catch { setRecoveryError('Não foi possível carregar o catálogo atualizado.'); } }
    }
    const syncProducts = () => { try { setProducts(loadProducts()); } catch { setRecoveryError('Não foi possível carregar o catálogo atualizado.'); } };
    window.addEventListener('raiz-pdv:products-changed', syncProducts);
    window.addEventListener('storage', syncCash);
    window.addEventListener('focus', refreshCash);
    const timer = window.setInterval(refreshCash, 1000);
    return () => { window.removeEventListener('raiz-pdv:products-changed', syncProducts); window.removeEventListener('storage', syncCash); window.removeEventListener('focus', refreshCash); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!operator) return;
    void recoverFinancialData();
  }, [operator?.id]);

  async function recoverFinancialData() {
    setRecovering(true);
    try { await recoverCreditReservations(); setRecoveryError(null); refreshCash(); }
    catch (error) { setRecoveryError(error instanceof Error ? error.message : 'Falha na recuperação financeira. Preserve os dados e procure suporte.'); }
    finally { setRecovering(false); }
  }

  function refreshCash() {
    setCashState(readCashState());
    setOperator(getCurrentOperator());
    setSettings(loadSettings());
  }

  async function startCash(openingAmountInCents: number, operatorId: string) {
    setCashState({ data: await openCashSession(openingAmountInCents, operatorId), error: null });
  }

  async function moveCash(type: CashMovement['type'], amountInCents: number, description: string) {
    const session = getOpenCashSession(cashData);
    if (!session) throw new Error('Abra um caixa antes de registrar movimentações.');
    setCashState({ data: await addCashMovement(session.id, type, amountInCents, description), error: null });
  }

  async function finishCash(sessionId: string, countedInCents: CashPaymentTotals, reviewedFingerprint: string) {
    const session = cashData.sessions.find((item) => item.id === sessionId && item.status === 'open');
    if (!session) throw new Error('Não há caixa aberto para fechar.');
    setCashState({ data: await closeCashSession(session.id, countedInCents, reviewedFingerprint), error: null });
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
    requireAdministrator();
    clearLocalData();
    const restoredProducts = loadProducts();
    const defaults = loadSettings();
    setProducts(restoredProducts);
    setSettings(defaults);
    refreshCash();
    return defaults;
  }

  if (!operator) return <OperatorLoginPage onLogin={(current) => { setOperator(current); setSettings(loadSettings()); refreshCash(); setActivePage('cash'); }} />;
  if (recovering) return <main className="content"><p role="status">Conferindo registros financeiros…</p></main>;
  const openSession = getOpenCashSession(cashData);
  const ownedSession = openSession?.operatorId === operator.id ? openSession : undefined;
  const withCashContext = (page: ReactNode) => <>{recoveryError && <div className="cash-error" role="alert">Recuperação financeira pendente: {recoveryError} <button type="button" disabled={recovering} onClick={() => void recoverFinancialData()}>Tentar recuperar</button></div>}<aside className="active-operator-strip" aria-label="Caixa e operador atuais">{openSession ? <><b>{cashLabel(openSession)}</b><span>Entrada: {new Date(openSession.openedAt).toLocaleString('pt-BR')}</span></> : <b>{getPendingCashSessions(cashData).length ? 'Caixa anterior pendente de fechamento · entre em Caixa para continuar' : 'Sem caixa aberto hoje · selecione o operador em Caixa'}</b>}<span>Conectado: {operator.username ?? operator.name} <button type="button" onClick={() => { logoutOperator(); setOperator(null); }}>Sair / trocar operador</button></span></aside>{page}</>;
  if (activePage === 'home') return withCashContext(<DashboardPage cashData={cashData} onNavigate={setActivePage} />);
  if (activePage === 'products') return withCashContext(<ProductsPage onNavigate={setActivePage} onProductsChange={updateProducts} products={products} />);
  if (activePage === 'settings') return withCashContext(operator.role === 'admin' ? <SettingsPage onClearLocalData={resetLocalData} onNavigate={setActivePage} onSaveSettings={updateSettings} settings={settings} /> : <main className="content"><h1>Acesso do administrador</h1><p>Somente Admin pode alterar configurações e cadastrar operadores.</p><button className="btn secondary" onClick={() => setActivePage('cash')}>Voltar ao caixa</button></main>);
  if (activePage === 'history') return withCashContext(<HistoryPage onNavigate={setActivePage} settings={settings} />);
  if (activePage === 'reports') return withCashContext(<ReportsPage onNavigate={setActivePage} />);
  if (activePage === 'cash') return withCashContext(<CashPage operators={[operator]} data={cashData} error={cashError} onClose={finishCash} onMovement={moveCash} onNavigate={setActivePage} onOpen={startCash} />);
  return withCashContext(<PosPage cashSessionLabel={ownedSession ? `${ownedSession.businessDate ?? ownedSession.openedAt.slice(0, 10)} · ${ownedSession.operatorName ?? "Operador não informado"}` : undefined} hasPendingCash={getPendingCashSessions(cashData).length > 0} cashSessionId={ownedSession?.id} onNavigate={setActivePage} products={products} settings={settings} />);
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
