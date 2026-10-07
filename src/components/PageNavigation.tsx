import type { AppPage } from '../types/navigation';

type PageNavigationProps = {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
};

const pages: { id: AppPage; label: string }[] = [
  { id: 'home', label: 'Início' },
  { id: 'pos', label: 'Nova venda' },
  { id: 'products', label: 'Produtos' },
  { id: 'history', label: 'Histórico' },
  { id: 'reports', label: 'Relatórios' },
];

export function PageNavigation({ activePage, onNavigate }: PageNavigationProps) {
  return (
    <nav aria-label="Navegação principal" className="page-nav">
      {pages.map((page) => (
        <button
          aria-current={activePage === page.id ? 'page' : undefined}
          className={activePage === page.id ? 'active' : ''}
          key={page.id}
          onClick={() => onNavigate(page.id)}
          type="button"
        >
          {page.label}
        </button>
      ))}
    </nav>
  );
}

