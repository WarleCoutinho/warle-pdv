import type { AppPage } from '../types/navigation';
import { PageNavigation } from './PageNavigation';

type PosHeaderProps = {
  onNavigate: (page: AppPage) => void;
};

export function PosHeader({ onNavigate }: PosHeaderProps) {
  return (
    <div className="pos-top">
      <div className="pos-brand">
        <span className="logo" aria-hidden="true">✳</span>
        raiz
        <span className="local-status">• &nbsp;<b>Operação local</b> · pronto para vender</span>
      </div>
      <PageNavigation activePage="pos" onNavigate={onNavigate} />
    </div>
  );
}
