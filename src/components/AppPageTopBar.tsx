import type { AppPage } from '../types/navigation';
import { PageNavigation } from './PageNavigation';

type AppPageTopBarProps = {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
};

export function AppPageTopBar({ activePage, onNavigate }: AppPageTopBarProps) {
  return (
    <header className="app-page-topbar">
      <div className="pos-brand">
        <span aria-hidden="true" className="logo">✳</span>
        raiz
        <span className="local-status">• &nbsp;<b>Operação local</b></span>
      </div>
      <PageNavigation activePage={activePage} onNavigate={onNavigate} />
    </header>
  );
}
