import { useState } from 'react';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { PosPage } from './pages/PosPage';
import { ReportsPage } from './pages/ReportsPage';
import type { AppPage } from './types/navigation';

export function App() {
  const [activePage, setActivePage] = useState<AppPage>('pos');

  if (activePage === 'home') return <DashboardPage onNavigate={setActivePage} />;
  if (activePage === 'history') return <HistoryPage onNavigate={setActivePage} />;
  if (activePage === 'reports') return <ReportsPage onNavigate={setActivePage} />;
  return <PosPage onNavigate={setActivePage} />;
}
