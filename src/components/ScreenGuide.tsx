import { useEffect, useRef, useState } from 'react';
import { GuideAvatar } from './GuideAvatar';
import type { AppPage } from '../types/navigation';
import { screenGuides } from '../utils/screenGuides';
import { guidePages } from '../utils/operatorGuide';

const saleSteps = [
  { target: '.page-nav [data-guide="pos"]', title: 'Sua tela de venda', text: 'Em Nova venda você monta o atendimento. Vou mostrar onde buscar produtos, conferir o carrinho e seguir para o pagamento.' },
  { target: '.searchrow', title: 'Encontre o produto', text: 'Digite o nome do produto nesta busca. Você também pode usar as categorias logo abaixo para filtrar o catálogo.' },
  { target: '.catalog-panel .chips', title: 'Escolha uma categoria', text: 'As categorias ajudam a encontrar os produtos. A opção Todos mostra o catálogo completo, respeitando o texto da busca.' },
  { target: '#pos-product-results', title: 'Adicione ao carrinho', text: 'Clique no produto para adicioná-lo à venda. Cada novo clique no mesmo produto aumenta a quantidade no carrinho.' },
  { target: '.carthead', title: 'Confira o carrinho', text: 'Os produtos escolhidos aparecem aqui. Confira os itens e use os controles de quantidade ou remoção quando precisar.' },
  { target: '.cartfoot', title: 'Total e pagamento', text: 'Confira o total antes de clicar em Finalizar venda. Esse botão fica disponível quando o carrinho tem itens. Depois, informe e confira os pagamentos para concluir.' },
];
const blockedSteps = [{ target: '.cash-closed-card', title: 'Primeiro, abra seu caixa', text: 'Para acessar os produtos e registrar uma venda, entre em Caixa e abra o caixa do operador. Depois volte a Nova venda e inicie este guia novamente.' }];

export function ScreenGuide({ page, onClose, onAsk }: { page: AppPage; onClose: () => void; onAsk: () => void }) {
  const [index, setIndex] = useState(0);
  const [steps] = useState(() => {
    const available = page === 'pos' ? (document.querySelector('.cash-closed-card') ? blockedSteps : saleSteps) : screenGuides[page] ?? [];
    const visible = available.filter(item => { const element = document.querySelector<HTMLElement>(item.target); return element && element.getClientRects().length > 0; });
    return visible.length ? visible : [{ target: 'main h1', title: guidePages[page].label, text: guidePages[page].explanation }];
  });
  const [layout, setLayout] = useState<{ left: number; top: number; target: { left: number; top: number; width: number; height: number }; right: boolean } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const step = steps[index];
  useEffect(() => { next.current?.focus(); }, []);
  useEffect(() => {
    const target = document.querySelector<HTMLElement>(step.target);
    if (!target) { setLayout(null); return; }
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    function position() {
      const rect = target!.getBoundingClientRect();
      const width = panel.current?.offsetWidth ?? 470;
      const height = panel.current?.offsetHeight ?? 250;
      const gap = 16;
      const maxTop = Math.max(12, window.innerHeight - height - 12);
      const below = rect.bottom + gap;
      const above = rect.top - height - gap;
      const top = below <= maxTop ? below : above >= 12 ? above : maxTop;
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      setLayout({ left, top, target: { left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }, right: rect.left + rect.width / 2 > left + width / 2 });
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(target); if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [step]);
  return <div className="sale-guide" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    {layout && <div className="guide-highlight" aria-hidden="true" style={layout.target}/>}
    <section ref={panel} className="guide-coach" role="region" aria-label={`Guia: ${guidePages[page].label}`} style={layout ? { left: layout.left, top: layout.top } : { right: 12, bottom: 85 }}>
      <div className="guide-character"><GuideAvatar pose={layout?.right ? 'right' : 'left'}/></div>
      <div className="guide-bubble">
        <button type="button" className="guide-close" aria-label="Fechar guia" onClick={onClose}>×</button>
        <div aria-live="polite" aria-atomic="true"><small>Assistente Raiz · {index + 1} de {steps.length}</small><h2>{step.title}</h2><p>{step.text}</p></div>
        {!layout && <p className="guide-missing">Esta área ainda não está disponível. Reabra o guia quando a tela terminar de carregar.</p>}
        <nav aria-label="Etapas do guia"><button type="button" disabled={index === 0} onClick={() => setIndex(value => value - 1)}>Anterior</button><button ref={next} className="guide-next" type="button" onClick={() => index === steps.length - 1 ? onClose() : setIndex(value => value + 1)}>{index === steps.length - 1 ? 'Concluir' : 'Próximo'}</button></nav>
        <button type="button" className="guide-ask" onClick={onAsk}>Tenho uma dúvida</button>
      </div>
    </section>
  </div>;
}
