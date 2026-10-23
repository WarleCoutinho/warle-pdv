import type { AppPage } from '../types/navigation';

export const guidePages: Record<AppPage, { label: string; explanation: string; questions: string[] }> = {
  home: { label: 'Início', explanation: 'O Início reúne os indicadores de hoje, as formas de pagamento e as vendas recentes. O saldo esperado do caixa se refere ao dinheiro físico.', questions: ['Faturamento é lucro líquido?', 'O que é recebido líquido?', 'O que é ticket médio?'] },
  reports: { label: 'Relatórios', explanation: 'Relatórios mostra vendas e recebimentos no período escolhido: hoje, esta semana ou este mês. Confira o período selecionado antes de comparar os indicadores.', questions: ['O faturamento é líquido ou bruto?', 'O que é recebido líquido?', 'O que mostram as formas de pagamento?'] },
  pos: { label: 'Venda', explanation: 'Nesta tela você monta a venda com os produtos e as quantidades e depois confere o pagamento. É necessário ter um caixa aberto para registrar a venda.', questions: ['Como iniciar uma venda?', 'O que é crédito do cliente?'] },
  cash: { label: 'Caixa', explanation: 'Caixa permite acompanhar a abertura, as movimentações e o fechamento. O saldo esperado representa o dinheiro físico que deve estar na gaveta.', questions: ['O que é saldo esperado?', 'O que é sangria?', 'O que é suprimento?'] },
  products: { label: 'Produtos', explanation: 'Produtos reúne o catálogo utilizado nas vendas. Confira o cadastro e o preço do produto antes de utilizá-lo no atendimento.', questions: ['O que esta tela mostra?', 'Como iniciar uma venda?'] },
  history: { label: 'Histórico', explanation: 'Histórico permite consultar as vendas registradas e seus detalhes. Confira a situação de cada venda e seus registros financeiros.', questions: ['O que é crédito do cliente?', 'O que é recebido líquido?'] },
  settings: { label: 'Configurações', explanation: 'Configurações reúne os ajustes da loja e os cadastros de operadores. Esta área é restrita ao administrador.', questions: ['Quem pode alterar configurações?', 'O que esta tela mostra?'] },
};

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Local documentation only: no access to repositories, operations or external services. */
export function answerOperatorQuestion(question: string, page: AppPage): string {
  const text = normalize(question);
  if (/faturamento|lucro|bruto/.test(text)) return 'O cartão Faturamento soma o valor final das vendas concluídas no período, já considerando os descontos da venda. Vendas canceladas não entram nessa soma. Ele não desconta custos, despesas, impostos ou taxas para calcular lucro, nem subtrai os reembolsos separadamente. Por isso, não é lucro líquido. O indicador Valor recebido líquido tem outro cálculo: recebimentos em dinheiro, Pix e cartões menos reembolsos realizados.';
  if (/recebid|liquido|reembolso/.test(text)) return 'Valor recebido líquido soma os recebimentos em dinheiro, Pix e cartões e desconta os reembolsos realizados no período. Reembolsos pendentes aparecem separadamente. Emitir crédito ao cliente não reduz esse recebido; usar crédito em outra compra não gera novo recebimento. Esse indicador também não representa lucro, pois não desconta custos e despesas.';
  if (/ticket/.test(text)) return 'Ticket médio é o faturamento dividido pela quantidade de vendas concluídas no período. Ele representa o valor médio por venda, e não o lucro médio.';
  if (/formas de pagamento/.test(text)) return 'Formas de pagamento mostra os pagamentos registrados no período, inclusive os de vendas canceladas. Os reembolsos aparecem separadamente. Crédito do cliente usado em uma compra não é um novo recebimento.';
  if (/saldo|gaveta/.test(text)) return 'Saldo esperado é o dinheiro físico previsto na gaveta: abertura mais entradas em dinheiro e suprimentos, menos sangrias e saídas em dinheiro registradas. Pix e cartões não representam dinheiro físico na gaveta. No fechamento, confira o valor contado e a eventual diferença.';
  if (/sangria/.test(text)) return 'Sangria é uma retirada de dinheiro do caixa, por exemplo para guardar valores em outro local. Ela reduz o saldo físico esperado e não altera o faturamento das vendas. O registro deve ser feito pelo operador na tela Caixa.';
  if (/suprimento/.test(text)) return 'Suprimento é uma entrada adicional de dinheiro no caixa, por exemplo para disponibilizar troco. Ele aumenta o saldo físico esperado e não representa uma venda.';
  if (/credito/.test(text)) return 'Crédito do cliente é um valor que pode ser utilizado em uma compra. Emitir crédito não é um reembolso em dinheiro. Usar esse crédito como pagamento não gera um novo recebimento em dinheiro, Pix ou cartão.';
  if (/configur|administrador|permis/.test(text)) return 'Somente o administrador pode alterar as configurações e cadastrar operadores. Se precisar de um ajuste nessa área, solicite ao administrador.';
  if (/iniciar.*venda|como.*vend/.test(text)) return 'Com seu caixa aberto, acesse Venda, selecione os produtos, confira as quantidades e o total e siga para o pagamento. Confira os valores e as formas de pagamento antes de concluir.';
  if (/esta tela|essa tela|tela mostra|tela me|explicar.*tela/.test(text)) return guidePages[page].explanation;
  return 'Ainda não tenho uma orientação local para essa pergunta. Posso explicar esta tela, faturamento, recebido líquido, ticket médio, formas de pagamento, crédito do cliente e movimentações do caixa. Escolha uma sugestão ou informe o nome de um desses indicadores. Para outras dúvidas, consulte o responsável pela loja.';
}
