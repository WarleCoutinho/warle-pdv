# Raiz PDV — relatório da Etapa 11.2

## A. Diagnóstico

Branch conferida: `codex/react-pos-base`, base `9be691a`. Antes das alterações, havia somente quatro evidências de teste não rastreadas em outputs; os arquivos de aplicação estavam commitados. Não houve checkout, reset, descarte de código, limpeza do armazenamento do usuário, commit ou push nesta etapa. `docs/preparacao-electron-sqlite.md`, serviços de vendas/ledger/caixa/backup, tipos, componentes e testes foram examinados.

| Arquivo | Problema e causa |
|---|---|
| `src/pages/PosPage.tsx` | Categorias memorizadas sem dependências e filtro sem products: catálogo montado não acompanhava edições. Categoria removida podia permanecer selecionada. |
| `src/App.tsx`, `productStorage.ts` | Catálogo não escutava gravação em outra aba; recuperação antes de autenticar tinha erros descartados. |
| `src/hooks/usePersistedSales.ts` | O retorno de cleanup encerrava a função antes de remover os demais ouvintes e o timer. |
| `saleFinancialStorage.ts`, `SaleFinancialPanel.tsx`, `backupStorage.ts` | Devoluções agrupadas por productId confundiam linhas repetidas, especialmente preços distintos. O backup também procurava somente a primeira linha. |
| `saleStorage.ts`, `saleFinancialStorage.ts` | Consumo não verificava cobertura exata entre reservas e pagamentos; reservas podiam ser repetidas; recuperação usava snapshot de vendas anterior ao bloqueio e liberava reservas de vendas canceladas sem registrar baixa/restauração. |
| `saleStorage.ts` | Falha após persistir a venda tentava apagar o documento salvo para compensar. Falha durante compensação deixava diagnóstico incompleto. Cancelamento com restauração tinha problema semelhante. |
| `saleFinancialStorage.ts`, `PaymentModal.tsx` | Consulta retornava o hash do código; disponibilidade precisava descontar parcelas do mesmo crédito já selecionadas. Serviço de finalização não exigia autorização recente independente da tela. |
| `cashStorage.ts`, `backupStorage.ts` | Caixa e restauração não compartilhavam o bloqueio do ledger. Backup não verificava cobertura de pagamento com crédito quando faltavam movimentos e podia exportar relações inconsistentes. |

Dependências: vendas guardam snapshots de itens e pagamentos e identificam o caixa; devoluções liberam valor elegível da venda; reembolsos reservam/consomem elegibilidade e somente realizados geram saída; crédito emitido referencia venda e resolução originais; utilização liga reserva e baixa à venda nova; cancelamento restaura os créditos dessa venda. Caixa agrega pagamentos e reembolsos de sua sessão; fechamento grava snapshot independente. Backup deve validar todas essas relações antes de escrever.

## B. Correções

- Dependências do catálogo completas, atualização dentro da aba e via storage entre abas; categoria que deixou de existir volta para Todos. Layout preservado.
- Novos itens de venda recebem lineId estável. Devoluções guardam lineId, produto/nome, preço unitário, quantidade e valor originais. Identificador somente do produto é aceito para chamadas legadas quando há exatamente uma linha desse produto.
- Validação de quantidades acumuladas por linha, preço/valor e identificadores duplicados. Tela e backup usam a mesma interpretação das linhas históricas. Chaves React no detalhe da venda deixam de repetir.
- Web Lock exclusivo compartilhado por vendas com/sem crédito, cancelamentos, devoluções, resoluções, confirmação/falha de pendência, caixa e restauração. Sem Web Locks, gravações financeiras falham de modo explícito; não existe fallback sem proteção.
- Autorização do código válida por cinco minutos, em memória e vinculada ao acesso do operador e ao verificador atual. Finalização exige essa autorização; consulta comum retorna somente dados públicos. Autorização e consumo passam pela mesma entrada de serviço, inclusive durante hot reload. Código não é persistido ou registrado em logs.
- Baixa combina parcelas do mesmo crédito e exige correspondência exata entre os pagamentos e as reservas. Repetir o commit confirmado é idempotente. Saldo é validado novamente sob o bloqueio. Número da venda é definido usando a lista atual dentro do bloqueio.
- Falha depois da venda gravada preserva venda e reserva e informa pendência, sem apresentar sucesso. Tela impede repetir aquela finalização e esvazia seu rascunho temporário. Recuperação remove somente rascunho exatamente igual ao snapshot da venda interrompida.
- Falha de restauração após cancelar preserva o cancelamento e movimentos para recuperação. Restauração calcula o que falta por crédito e rejeita excesso em vez de limitar silenciosamente o saldo. Antes de cancelar, é conferido se restaurar os créditos excederia compensações anteriores.
- Recuperação após autenticar relê vendas sob o bloqueio: reserva sem venda é liberada; reserva de venda gravada é baixada; se a venda está cancelada, registra baixa e restauração. Inconsistências permanecem bloqueadas, com alerta e tentativa de recuperação na interface.
- Formulários de caixa aguardam gravação e bloqueiam submissão duplicada. Revisão de fechamento acompanha alterações financeiras e revalida fingerprint no serviço. Identificadores de movimentações e datas financeiras são validados.
- Backup v2 verifica linhas devolvidas, vínculos com caixa e cobertura dos pagamentos por baixa ou reserva. Exportação também verifica relações. Restauração compartilha o bloqueio, conserva cópia anterior e relata reversão incompleta; registros anteriores inconsistentes são preservados como snapshot bruto.

## C. Integridade financeira

As regras aprovadas nas etapas anteriores foram preservadas:

| Evento | Faturamento das concluídas | Recebido líquido | Dinheiro físico |
|---|---|---|---|
| Cancelamento sem reembolso | Exclui a venda cancelada | Conserva os pagamentos recebidos | Não altera |
| Devolução física | Preserva a venda e a contagem originais; valor devolvido é registrado separadamente | Não altera sozinho | Não altera sozinho |
| Reembolso pendente | Reserva elegibilidade, não equivale a saída | Não desconta | Não desconta |
| Reembolso em dinheiro realizado | Não desconta novamente um cancelamento | Desconta uma única vez | Desconta do caixa onde foi realizado |
| Reembolso Pix/cartão realizado | Evento separado | Desconta a modalidade | Não altera gaveta |
| Crédito emitido | Evento separado | Não desconta recebimento | Não altera gaveta |
| Crédito utilizado | Faz parte do valor da venda nova | Não é recebimento de dinheiro novo | Somente eventual complemento em dinheiro entra |
| Crédito restaurado | Não altera snapshots da venda | Não cria dinheiro | Restaura somente o crédito efetivamente usado |

O indicador de mercadoria líquida pode deduzir itens devolvidos; isso é distinto do faturamento original e do recebido líquido exibidos nas telas. Nenhum cancelamento cria automaticamente reembolso. Reembolso concluído sem indicação de caixa atual não é atribuído retroativamente a um caixa fechado. Fechamentos anteriores continuam lendo o snapshot salvo, sem recálculo ou movimentação de vendas antigas.

Cenários executados:

| Cenário | Resultado |
|---|---|
| A: fundo 100 + venda dinheiro 40; cancelar; reembolsar dinheiro 40 | 140 após venda e após cancelamento; 100 após reembolso efetivo. Fechamento registra reembolso 40. |
| B: fundo 100 + venda dinheiro 40; cancelar e emitir crédito 40; nova venda 65 usando crédito 30 + dinheiro 35 | Saldo físico 175; crédito restante 10; dinheiro recebido 75; crédito usado 30 separado; faturamento das concluídas 65. Backup e fechamento preservam esses valores. |

## D. Compatibilidade

Não há regravação ou migração automática dos snapshots históricos. Linha de venda sem lineId é interpretada como legacy-line-N pela posição original. Devolução antiga sem lineId é conferida pelo produto, nome, preço inferido do valor/quantidade e quantidade disponível. Linhas indistinguíveis com o mesmo preço são alocadas pela ordem original apenas em memória; o dado antigo não é alterado. Registro que não corresponde aos snapshots ou excede quantidades exige auditoria, sem reconstrução silenciosa.

Campos novos de linhas são opcionais para registros antigos. O backup permanece versão 2, com vendas, produtos, configurações/operadores, caixas, movimentos, devoluções, reembolsos, créditos, movimentos de crédito e reservas. Backup v1 continua aceito sem inventar ledger. Estados interrompidos com reserva exata e venda gravada são preservados no backup e recuperados após autenticação. Dados sem baixa nem reserva correspondente são rejeitados. Alterações de preço/catálogo não modificam vendas concluídas ou apurações antigas.

## E. Testes

Validação final: `npm run test:all` concluído com sucesso: 88 testes de domínio, três scripts de interface e build. Nenhum teste previsto ficou sem execução.

- Domínio: 88 testes aprovados, zero falhas. Incluem pagamentos combinados, quantidades/valores, linhas repetidas e registros legados, reembolso pendente/concluído/falha, emissão e código inválido/expirado, consumo parcial/total, múltiplos créditos e vendas, restauração idempotente, concorrência, reservas incompatíveis, falhas antes/depois da venda/baixa/cancelamento, recuperação autenticada, rascunho interrompido, cenários A/B, fechamento, backup v1/v2 e falha na reversão.
- Interface: operadores, devolução/impressão/Esc/analytics, e estabilização do catálogo/linhas/crédito. A suíte usa Microsoft Edge headless com Playwright 1.62.1, contexto isolado e servidor Vite em 127.0.0.1:5173. Emissão e consumo são disputados por duas abas usando Web Locks reais; o pagamento com código também é concluído pela tela.
- Build TypeScript/Vite aprovado também no encerramento da campanha final.
- `npm test` descobre todos os arquivos *.test.mjs. `npm run test:ui` é separado porque requer navegador e servidor ativos. Playwright foi incluído como dependência de desenvolvimento. As evidências desta execução ficam em outputs/etapa-11-2.

Os testes financeiros fixam a data de referência em seu próprio contexto, para não depender do dia real da máquina.

Limites dos testes: exceções de armazenamento foram injetadas e estados de interrupção foram reconstruídos em fixtures; não se simulou queda real de energia nem se garantiu durabilidade do navegador. Não houve pagamento em adquirente, impressora física ou integração externa. Os testes de interface não acessaram dados da aba do usuário.

## F. Arquivos

### Criados

- `docs/etapa-11-2-estabilizacao.md`
- `src/services/financialLock.ts`
- `src/utils/saleLines.ts`
- `tests/run-ui.cjs`
- `tests/stability-ui.cjs`

### Modificados

- `README.md`
- `docs/preparacao-electron-sqlite.md`
- `package-lock.json`
- `package.json`
- `src/App.tsx`
- `src/components/CustomerCreditLookupPanel.tsx`
- `src/components/PaymentModal.tsx`
- `src/components/SaleFinancialPanel.tsx`
- `src/hooks/usePersistedSales.ts`
- `src/pages/CashPage.tsx`
- `src/pages/HistoryPage.tsx`
- `src/pages/PosPage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/services/backupStorage.ts`
- `src/services/cashStorage.ts`
- `src/services/productStorage.ts`
- `src/services/saleFinancialStorage.ts`
- `src/services/saleStorage.ts`
- `src/types/customerCredit.ts`
- `src/types/sale.ts`
- `tests/backup.test.mjs`
- `tests/cash.test.mjs`
- `tests/devolution-ui.cjs`
- `tests/financial.test.mjs`

Evidências PDF/PNG de testes são artefatos gerados, fora da lista de código. Nenhum Electron, SQLite, instalador, IPC ou atualizador foi adicionado.

## G. Pendências e riscos do localStorage

1. Web Locks coordena somente abas que usam os serviços desta aplicação; não torna diferentes chaves transacionais nem impede edição manual do armazenamento.
2. Reserva/baixa no mesmo documento financeiro é gravada em uma chave, mas venda e ledger ainda são chaves distintas. A recuperação cobre os estados testados e preserva evidências; não representa atomicidade completa.
3. Restauração preserva snapshot e compensa exceções, porém o navegador encerrado no meio de várias escritas pode deixar uma importação parcial. Snapshot é preservado, mas uma recuperação manual pode ser necessária. SQLite precisa transacionar a importação inteira.
4. Falta de espaço, disco/navegador corrompido, perfil apagado ou gravação externa podem impedir inclusive reversão e recuperação. Cópia no mesmo localStorage não substitui backup externo.
5. Código de crédito é apresentado uma vez e armazenado só como verificador. Encerrar o navegador após emitir e antes de entregar o comprovante conserva o crédito/saldo, mas pode perder o código em memória. Reemissão/invalidação exige política e fluxo auditados; nenhuma regra de reemissão foi inventada nesta etapa.
6. Reservas incompatíveis, vendas sem cobertura financeira ou retornos históricos incompatíveis não são corrigidos por adivinhação; permanecem bloqueados para conferência.
7. Autenticação local e checksum FNV do backup não constituem uma fronteira de segurança contra alguém com acesso direto aos arquivos/armazenamento do computador.

Na migração, usar transações de venda + itens + pagamentos + baixa, cancelamento + restauração, fechamento + snapshot e importação completa; constraints/índices devem assegurar IDs/números únicos, relações, quantidades e centavos, com operações idempotentes e auditoria.

## H. Próxima etapa

O projeto está preparado para iniciar o trabalho controlado da Etapa 12A: regras atuais estão documentadas, há regressões financeiras e de interface reproduzíveis, operações críticas esperam confirmação e os estados de falha preservam evidências. Isso não significa que a persistência atual tenha garantias transacionais.

Antes de importar qualquer base para SQLite, atualizar o schema preliminar da Etapa 11 para incluir operadores, linhas estáveis, devoluções, resoluções, créditos, movimentos e reservas; preservar valores eletrônicos líquidos negativos e apurações históricas. Definir contratos assíncronos e testar o mesmo domínio no futuro adaptador, depois validar transações e migração usando cópia externa. A Etapa 12A não foi iniciada automaticamente.
