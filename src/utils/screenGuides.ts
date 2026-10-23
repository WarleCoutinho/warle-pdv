import type { AppPage } from '../types/navigation';

export type GuideStep = { target: string; title: string; text: string };

export const screenGuides: Partial<Record<AppPage, GuideStep[]>> = {
  home: [
    { target: '.analytics-title-row', title: 'Visão geral da operação', text: 'O Início reúne os indicadores de hoje e as vendas recentes. Use este resumo para acompanhar o atendimento.' },
    { target: '.analytics-stat-grid', title: 'Faturamento não é lucro', text: 'Faturamento hoje soma o valor final das vendas concluídas, com os descontos da venda. Não representa lucro líquido, pois não desconta custos, despesas, impostos ou taxas.' },
    { target: '.analytics-financial-summary', title: 'Entenda o recebido líquido', text: 'Valor recebido líquido considera recebimentos em dinheiro, Pix e cartões menos reembolsos realizados. Emitir crédito não reduz esse recebido; usar crédito em uma compra não gera novo recebimento.' },
    { target: '.recent-sales-panel', title: 'Últimos atendimentos', text: 'As vendas recentes mostram as últimas vendas concluídas. Para consultar os detalhes de uma venda, acesse Histórico.' },
  ],
  reports: [
    { target: '.period-tabs', title: 'Escolha o período', text: 'Selecione Hoje, Esta semana ou Este mês. Os indicadores e gráficos acompanham o período escolhido.' },
    { target: '.analytics-stat-grid', title: 'Indicadores das vendas', text: 'Faturamento soma as vendas concluídas no período. Ticket médio é o faturamento dividido pela quantidade de vendas. Esses indicadores não calculam lucro.' },
    { target: '.analytics-financial-summary', title: 'Recebimentos e devoluções', text: 'Recebido líquido desconta os reembolsos realizados dos recebimentos. Valores pendentes e créditos emitidos aparecem separadamente. Esse líquido também não é lucro.' },
    { target: '.analytics-report-grid', title: 'Gráficos e pagamentos', text: 'O gráfico acompanha o faturamento ao longo do período. Formas de pagamento inclui pagamentos registrados de vendas canceladas; reembolsos são apresentados separadamente.' },
  ],
  products: [
    { target: '.products-title-row', title: 'Seu catálogo de produtos', text: 'Aqui você encontra o catálogo usado na venda. Novo produto abre o formulário de cadastro; o guia apenas explica os controles.' },
    { target: '.products-toolbar', title: 'Localize um produto', text: 'Use a pesquisa e os filtros para encontrar um produto. Se não aparecer nenhum resultado, confira os filtros selecionados.' },
    { target: '.products-table-panel', title: 'Confira cadastro e preço', text: 'A lista mostra nome, categoria, preço e situação. Produtos inativos não aparecem no catálogo de venda. Editar permite revisar o cadastro.' },
  ],
  history: [
    { target: '.history-title-row', title: 'Consulte as vendas', text: 'O histórico permite consultar vendas e reimprimir comprovantes. Vendas canceladas continuam registradas com sua situação identificada.' },
    { target: '.history-filters', title: 'Encontre o atendimento', text: 'Ajuste os filtros para localizar as vendas. Confira os critérios antes de interpretar a lista e os totais.' },
    { target: '.analytics-financial-summary', title: 'Totais das vendas filtradas', text: 'Os totais correspondem às vendas filtradas. Os reembolsos apresentados pertencem a essas vendas, mesmo quando realizados depois. Faturamento e recebido líquido têm cálculos diferentes.' },
  ],
  cash: [
    { target: '.cash-title-row', title: 'Controle do caixa', text: 'Esta tela acompanha a sessão do caixa. Os recebimentos por modalidade e o dinheiro físico da gaveta são apresentados separadamente.' },
    { target: '.cash-closed-card', title: 'Abertura do caixa', text: 'Abrir caixa permite informar o fundo inicial para troco. Verifique o operador e eventuais fechamentos pendentes antes de iniciar.' },
    { target: '.cash-payment-summary', title: 'Recebimentos da sessão', text: 'Confira os valores recebidos em cada forma de pagamento e os reembolsos. Crédito do cliente utilizado em uma compra não é um novo recebimento em espécie.' },
    { target: '.cash-physical-grid', title: 'Dinheiro esperado na gaveta', text: 'O saldo físico esperado soma o fundo inicial, dinheiro recebido e suprimentos, descontando reembolsos em dinheiro e sangrias. Pix e cartões não entram no dinheiro da gaveta.' },
    { target: '.cash-actions', title: 'Movimentações e fechamento', text: 'Suprimento adiciona dinheiro; sangria retira dinheiro. No fechamento você confere o contado por modalidade. O guia não registra movimentações nem fecha o caixa.' },
    { target: '.cash-history-panel', title: 'Fechamentos anteriores', text: 'O histórico de caixas apresenta as sessões fechadas e os valores gravados na conferência: esperado, contado e diferença.' },
  ],
  settings: [
    { target: '.settings-title-row', title: 'Configurações da loja', text: 'Esta área é restrita ao administrador. Aqui são configurados os dados do estabelecimento e outros ajustes do sistema.' },
    { target: '#settings-store-title', title: 'Dados do estabelecimento', text: 'Confira os dados da loja usados pelo PDV e no comprovante. Alterações no formulário só são gravadas ao salvar.' },
    { target: '.settings-backup-card', title: 'Cópia de segurança', text: 'Exportar backup permite guardar uma cópia dos dados. Confira o arquivo antes de restaurar. O guia não exporta, restaura nem apaga informações.' },
    { target: '.settings-actions', title: 'Salvar alterações', text: 'Revise os ajustes antes de salvar. Avançar ou concluir este guia não salva as alterações do formulário.' },
  ],
};
