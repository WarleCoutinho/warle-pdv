# Raiz — direção visual e UX do PDV

## Conceito

Uma interface acolhedora e direta, com verde profundo como sinal de confiança e ação. O nome provisório **Raiz** e o símbolo de broto dão personalidade ao negócio sem deixar a experiência infantil. A composição usa superfícies claras, bordas discretas e números grandes para facilitar a leitura durante o atendimento.

## Sistema visual

- **Primária:** verde `#176B51`; hover `#10583F`; verde suave `#E8F4EE`.
- **Fundo:** `#F5F7F5`; superfícies `#FFFFFF`; texto `#172521`; texto secundário `#73817B`.
- **Estados:** sucesso usa verde; erro `#BB4D42` sobre `#FFF1EF`; alerta usa âmbar `#EEA34A` sobre fundo claro.
- **Bordas e elevação:** `#E5EBE7`, sombra difusa sutil e raio padrão de 14 px (controles 9–10 px).
- **Tipografia:** DM Sans para interface e Manrope para títulos e valores. A escala privilegia título 24 px, texto 14 px, auxiliares 11–12 px.
- Botões têm hover visível, estado pressionado com leve redução, e controles indisponíveis ficam esmaecidos. Cards de produto reagem ao hover e ao clique.

## Navegação e telas

Sidebar permanente com Início, Nova venda, Histórico, Relatórios, Produtos e Configurações. O estado selecionado é marcado por fundo verde suave e texto verde. Em larguras menores, a barra reduz para ícones; o caixa continua sendo a tela mais importante.

- **Início:** quatro indicadores de hoje, lista de vendas recentes, recebimentos por método e chamada destacada para iniciar uma venda.
- **Nova venda:** busca e categorias no painel de produtos; cards grandes com nome e preço; carrinho persistente à direita, quantidade ajustável e total sempre visível. A ação principal ocupa toda a largura do rodapé do carrinho.
- **Pagamento:** modal com total, quatro formas de pagamento e dinheiro selecionado por padrão. Campo numérico mostra o troco em destaque; valor insuficiente fica vermelho e bloqueia a confirmação. Pix, débito e crédito não pedem valor recebido.
- **Conclusão:** confirmação clara, identificador e resumo da venda; oferece comprovante e nova venda.
- **Histórico:** tabela com data, horário, total e método; filtros de data e pagamento; ação de detalhes por venda.
- **Relatórios:** abas Hoje, Semana e Mês, indicadores essenciais, gráfico de barras simples e distribuição por pagamento.
- **Produtos:** lista com nome, categoria, preço e status; cadastro/edição em modal. Estoque não aparece.
- **Comprovante:** coluna tipográfica monoespaçada, separadores tracejados, quantidades alinhadas e total em destaque; largura estreita para térmica e centralizada em folha convencional.

## Componentes reutilizáveis para React

`Sidebar`, `PageHeader`, `StatCard`, `ProductCard`, `CategoryChip`, `CartPanel`, `CartItem`, `PaymentModal`, `PaymentMethodButton`, `StatusBadge`, `DataTable`, `PeriodTabs`, `BarChart`, `ReceiptPreview`, `SuccessPanel`, `Toast` e `FormField`. Variantes de estado devem ser controladas por props/classes (selecionado, desabilitado, erro, sucesso), evitando estilos exclusivos de uma tela.

## Fluxo de atendimento

1. Nova venda → selecionar categoria ou buscar produto.
2. Clicar no produto uma vez por unidade (ou ajustar +/− no carrinho).
3. Conferir total e finalizar.
4. Selecionar pagamento; em dinheiro, informar valor recebido e conferir troco.
5. Confirmar quando válido → tela de sucesso → prévia do comprovante ou nova venda.

## Recomendações de UX para implementação

- Manter o foco de teclado na busca e permitir navegação por teclado e Enter/Espaço nos produtos.
- Dar feedback imediato ao adicionar item e atualizar quantidade sem abrir diálogos.
- Preencher dinheiro recebido com atalhos de valores comuns e permitir teclado numérico; sempre mostrar insuficiência antes de habilitar confirmação.
- Evitar perda acidental do carrinho ao trocar de tela ou fechar pagamento; pedir confirmação apenas ao descartar uma venda em andamento.
- Formatar moeda em pt-BR e manter alvos de clique confortáveis. Respeitar foco visível, contraste e leitores de tela.
- Para impressão futura, preparar CSS de impressão com largura configurável (58/80 mm e A4), margens e ocultação da navegação. A impressão real e persistência offline ficam para a etapa de implementação.

## Escopo desta prévia

Protótipo navegável com dados demonstrativos e interações locais para avaliar layout e fluxo. Não persiste vendas/produtos, não valida regras de negócio completas e o botão de impressão apenas demonstra a prévia; não envia trabalho à impressora.

## Ajuste de contraste da tela de venda

A tela de caixa usa agora fundo verde acinzentado de brilho menor, painel de produtos em cinza esverdeado e carrinho em verde escuro. O carrinho, o total e o botão de finalizar formam a hierarquia primária; cards de produto têm preços mais evidentes e estados de hover reforçados. O cabeçalho compacto mantém o nome do PDV e o estado local, enquanto o botão de saída permanece secundário. Em telas estreitas, os painéis continuam empilhados e os cards seguem com contraste reforçado.

