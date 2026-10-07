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

O catálogo atual é demonstrativo e definido em `src/data/products.ts`. O rascunho e as vendas concluídas ficam em chaves distintas do `localStorage` no computador/navegador em uso. O app não solicita serviços externos em tempo de execução e usa Segoe UI do sistema para funcionar sem baixar fontes.

## Referências de design

- `outputs/index.html`: protótipo navegável original.
- `outputs/Direcao-visual.md`: identidade visual, componentes e recomendações de UX.

Dashboard, relatórios, estoque, cadastro de produtos, clientes, cancelamento e os demais módulos do protótipo ainda não estão implementados.
