import { useState } from 'react';
import { HistoryPage } from './pages/HistoryPage';
import { PosPage } from './pages/PosPage';

export function App() {
  const [activePage, setActivePage] = useState<'pos' | 'history'>('pos');

  return activePage === 'pos'
    ? <PosPage onOpenHistory={() => setActivePage('history')} />
    : <HistoryPage onBackToSale={() => setActivePage('pos')} />;
}
