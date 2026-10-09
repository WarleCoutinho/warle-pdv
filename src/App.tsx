import { ApplicationContext, usePdvApplication, webApplication } from './application/context';
import type { PdvApplication } from './application/createPdvApplication';
import { getOpenCashSession, getPendingCashSessions } from './domain/cashSessions';
import type { CashOperator } from './types/settings';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { OperatorLoginPage } from './pages/OperatorLoginPage';
import { CashPage } from './pages/CashPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { PosPage } from './pages/PosPage';
import { ProductsPage } from './pages/ProductsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { cashLabel } from './utils/cashDay';
import type { CashData, CashMovement } from './types/cash';
import type { Product } from './types/product';
import type { StoreSettings } from './types/settings';
import type { AppPage } from './types/navigation';
import type { CashPaymentTotals } from './utils/cash';

export function App({ application = webApplication }: { application?: PdvApplication } = {}) {
  return <ApplicationContext.Provider value={application}><PdvApp /></ApplicationContext.Provider>;
}
function PdvApp() {
  const application = usePdvApplication();
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const contextRevision = useRef(0);
  const [activePage, setActivePage] = useState<AppPage>('pos');
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [operator, setOperator] = useState<CashOperator | null>(null);
  const [cashState, setCashState] = useState<{ data: CashData; error: string | null }>({ data: { sessions: [], movements: [] }, error: null });
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const { data: cashData, error: cashError } = cashState;

  useEffect(() => {
    let active = true;
    let productRevision = 0;
    setBooting(true); setBootError(null);
    async function initialize() {
      try {
        const initial = await application.bootstrap();
        if (!active) return;
        if (initial.operator) { try { await application.financial.recover(); setRecoveryError(null); } catch (failure) { if (active) setRecoveryError(failure instanceof Error ? failure.message : 'Falha na recuperação financeira.'); } }
        const current = await application.bootstrap();
        if (!active) return;
        setProducts(current.products); setSettings(current.settings); setOperator(current.operator);
        setCashState({ data: current.cash, error: current.cashError });
      } catch (failure) { if (active) setBootError(failure instanceof Error ? failure.message : 'Não foi possível carregar os dados.'); }
      finally { if (active) setBooting(false); }
    }
    const refresh = async () => {
      const revision = ++contextRevision.current;
      try {
        const current = await application.context();
        if (!active || revision !== contextRevision.current) return;
        setSettings(current.settings); setOperator(current.operator); setCashState({ data: current.cash, error: current.cashError });
      } catch (failure) { if (active && revision === contextRevision.current) setCashState((state) => ({ ...state, error: failure instanceof Error ? failure.message : 'Falha ao atualizar o caixa.' })); }
    };
    const refreshProducts = async () => {
      const revision = ++productRevision;
      try { const catalog = await application.products.list(); if (active && revision === productRevision) setProducts(catalog); }
      catch { if (active) setRecoveryError('Não foi possível carregar o catálogo atualizado.'); }
    };
    void initialize();
    const unsubscribe = application.changes.subscribe(['cash', 'settings', 'operator'], () => { void refresh(); });
    const unsubscribeProducts = application.changes.subscribe(['products'], () => { void refreshProducts(); });
    const timer = window.setInterval(() => { void refresh(); }, 1000);
    return () => { active = false; ++contextRevision.current; unsubscribe(); unsubscribeProducts(); window.clearInterval(timer); };
  }, [application, attempt]);

  async function recoverFinancialData() {
    setRecovering(true);
    try { await application.financial.recover(); setRecoveryError(null); await refreshCash(); }
    catch (error) { setRecoveryError(error instanceof Error ? error.message : 'Falha na recuperação financeira. Preserve os dados e procure suporte.'); }
    finally { setRecovering(false); }
  }
  async function refreshCash() {
    const revision = ++contextRevision.current;
    const current = await application.context();
    if (revision !== contextRevision.current) return;
    setSettings(current.settings); setOperator(current.operator); setCashState({ data: current.cash, error: current.cashError });
  }

  async function startCash(openingAmountInCents: number, operatorId: string) {
    setCashState({ data: await application.cash.open(openingAmountInCents, operatorId), error: null });
  }

  async function moveCash(type: CashMovement['type'], amountInCents: number, description: string) {
    const session = getOpenCashSession(cashData);
    if (!session) throw new Error('Abra um caixa antes de registrar movimentações.');
    setCashState({ data: await application.cash.move(session.id, type, amountInCents, description), error: null });
  }

  async function finishCash(sessionId: string, countedInCents: CashPaymentTotals, reviewedFingerprint: string) {
    const session = cashData.sessions.find((item) => item.id === sessionId && item.status === 'open');
    if (!session) throw new Error('Não há caixa aberto para fechar.');
    setCashState({ data: await application.cash.close(session.id, countedInCents, reviewedFingerprint), error: null });
  }

  async function updateProducts(nextProducts: Product[]) {
    await application.products.replaceCatalog(nextProducts);
    setProducts(nextProducts);
  }
  async function updateSettings(nextSettings: StoreSettings, passwords?: Record<string, string>): Promise<StoreSettings> {
    const saved = await application.settings.save(nextSettings, passwords);
    setSettings(saved); return saved;
  }
  async function resetLocalData(): Promise<StoreSettings> {
    await application.backups.clearLocalData();
    const current = await application.bootstrap();
    setProducts(current.products); setSettings(current.settings); await refreshCash(); return current.settings;
  }
  if (booting) return <main className="content"><p role="status">Carregando dados…</p></main>;
  if (bootError || !settings) return <main className="content"><p role="alert">{bootError ?? 'Não foi possível carregar as configurações.'}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</button></main>;
  if (!operator) return <OperatorLoginPage onLogin={async (current) => { setOperator(current); await recoverFinancialData(); setActivePage('cash'); }} />;
  if (recovering) return <main className="content"><p role="status">Conferindo registros financeiros…</p></main>;
  const openSession = getOpenCashSession(cashData);
  const ownedSession = openSession?.operatorId === operator.id ? openSession : undefined;
  const withCashContext = (page: ReactNode) => <>{recoveryError && <div className="cash-error" role="alert">Recuperação financeira pendente: {recoveryError} <button type="button" disabled={recovering} onClick={() => void recoverFinancialData()}>Tentar recuperar</button></div>}<aside className="active-operator-strip" aria-label="Caixa e operador atuais">{openSession ? <><b>{cashLabel(openSession)}</b><span>Entrada: {new Date(openSession.openedAt).toLocaleString('pt-BR')}</span></> : <b>{getPendingCashSessions(cashData).length ? 'Caixa anterior pendente de fechamento · entre em Caixa para continuar' : 'Sem caixa aberto hoje · selecione o operador em Caixa'}</b>}<span>Conectado: {operator.username ?? operator.name} <button type="button" onClick={() => { void application.operators.logout().then(() => { ++contextRevision.current; setOperator(null); }).catch((failure: unknown) => setRecoveryError(failure instanceof Error ? failure.message : 'Não foi possível sair.')); }}>Sair / trocar operador</button></span></aside>{page}</>;
  if (activePage === 'home') return withCashContext(<DashboardPage cashData={cashData} onNavigate={setActivePage} />);
  if (activePage === 'products') return withCashContext(<ProductsPage onNavigate={setActivePage} onProductsChange={updateProducts} products={products} />);
  if (activePage === 'settings') return withCashContext(operator.role === 'admin' ? <SettingsPage onClearLocalData={resetLocalData} onNavigate={setActivePage} onSaveSettings={updateSettings} settings={settings} /> : <main className="content"><h1>Acesso do administrador</h1><p>Somente Admin pode alterar configurações e cadastrar operadores.</p><button className="btn secondary" onClick={() => setActivePage('cash')}>Voltar ao caixa</button></main>);
  if (activePage === 'history') return withCashContext(<HistoryPage onNavigate={setActivePage} settings={settings} />);
  if (activePage === 'reports') return withCashContext(<ReportsPage onNavigate={setActivePage} />);
  if (activePage === 'cash') return withCashContext(<CashPage operators={[operator]} data={cashData} error={cashError} onClose={finishCash} onMovement={moveCash} onNavigate={setActivePage} onOpen={startCash} />);
  return withCashContext(<PosPage cashSessionLabel={ownedSession ? `${ownedSession.businessDate ?? ownedSession.openedAt.slice(0, 10)} · ${ownedSession.operatorName ?? "Operador não informado"}` : undefined} hasPendingCash={getPendingCashSessions(cashData).length > 0} cashSessionId={ownedSession?.id} onNavigate={setActivePage} products={products} settings={settings} />);
}
