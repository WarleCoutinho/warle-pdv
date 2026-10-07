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
- Exibir o resumo da venda concluída sem persistir a venda definitiva.

O catálogo atual é demonstrativo e definido em `src/data/products.ts`. O rascunho do carrinho fica em `localStorage` no computador/navegador em uso; vendas concluídas não são salvas. O app não solicita serviços externos em tempo de execução e usa Segoe UI do sistema para funcionar sem baixar fontes.

## Referências de design

- `outputs/index.html`: protótipo navegável original.
- `outputs/Direcao-visual.md`: identidade visual, componentes e recomendações de UX.

Persistência definitiva de vendas, histórico, estoque, cadastro de produtos e os demais módulos do protótipo ainda não estão implementados.

