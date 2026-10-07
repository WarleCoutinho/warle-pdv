# Raiz — PDV

Aplicação local para ponto de venda de um pequeno negócio de alimentação. A implementação atual inicia pelo fluxo de nova venda e mantém o protótipo visual original em `outputs/` como referência.

## Executar localmente

```bash
npm install
npm run dev
```

## Verificar a compilação

```bash
npm run build
```

## Funcionalidade implementada

- Buscar produtos locais e filtrar por categoria.
- Adicionar produtos ao carrinho, alterar quantidades e remover itens.
- Calcular subtotal e total usando valores inteiros em centavos.
- Salvar localmente o rascunho atual do carrinho no navegador para recuperação após recarga.
- Combinar pagamentos em dinheiro, Pix, débito e crédito; em dinheiro, validar o valor recebido e calcular troco em centavos.
- Persistir vendas concluídas localmente com número sequencial e snapshot de itens e pagamentos.
- Exibir comprovante e imprimir em papel térmico de 58/80 mm ou em A4.
- Consultar vendas salvas no Histórico, com busca por número, filtros de período e pagamento, detalhes históricos e reimpressão.
- Consultar no Início faturamento e pagamentos de hoje, última venda e vendas recentes.
- Analisar faturamento, ticket médio, maior venda, tendências por período e divisão dos pagamentos em Relatórios.
- Cadastrar, editar, pesquisar, filtrar, ativar e desativar produtos com persistência local; a Nova venda usa o catálogo atualizado.
- Abrir uma sessão de caixa com valor inicial e registrar suprimentos e sangrias, com bloqueio de retirada acima do saldo esperado.
- Associar cada venda à sessão de caixa aberta; somente a parcela em dinheiro aplicada à venda entra no saldo físico, sem contar troco.
- Fechar o caixa informando o valor contado, conferir diferença e consultar o histórico de fechamentos.
- Configurar nome, endereço, telefone e rodapé do comprovante; limpar os dados locais do PDV com confirmação explícita.

Os produtos demonstrativos de `src/data/products.ts` e as configurações padrão são salvos na primeira execução. Produtos, configurações, rascunho do carrinho, vendas concluídas e dados do caixa ficam em chaves distintas do `localStorage` no computador/navegador em uso. Uma venda só pode ser concluída com uma sessão aberta e grava o identificador dessa sessão; vendas antigas sem essa referência permanecem no histórico, sem serem atribuídas a um caixa. O saldo do caixa considera valor inicial, dinheiro aplicado às vendas, suprimentos e sangrias; Pix, débito, crédito e troco não são contados como entradas físicas. A tela Configurações personaliza os dados e o rodapé dos comprovantes e oferece a limpeza confirmada dessas chaves locais. O app não solicita serviços externos em tempo de execução e usa Segoe UI do sistema para funcionar sem baixar fontes.

## Referências de design

- `outputs/index.html`: protótipo navegável original.
- `outputs/Direcao-visual.md`: identidade visual, componentes e recomendações de UX.

Os dados de Início e Relatórios vêm exclusivamente das vendas concluídas salvas localmente. Estoque, clientes, cancelamento e os demais módulos do protótipo ainda não estão implementados.
