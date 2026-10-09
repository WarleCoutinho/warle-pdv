# Raiz PDV — Etapa 12A: preparação da persistência

Data: 09/10/2026. Branch `codex/react-pos-base`, repositório `WarleCoutinho/warle-pdv`.
Base: `b7509ee4859c4125d6bc307ec99ce90ba6816a0a` — Etapa 11.2 publicada.

## A. Diagnóstico inicial

A inspeção confirmou a branch e o git status. Não havia alterações de código não commitadas na base; havia PDFs/PNGs e a pasta `outputs/etapa-11-2/` não rastreados, preservados. O repositório está no subdiretório `warle-pdv`, separado do diretório pai. Não houve reset, checkout destrutivo, commit, push ou limpeza do armazenamento da operação.

Foram lidos `docs/preparacao-electron-sqlite.md`, `docs/etapa-11-2-estabilizacao.md`, os serviços de persistência, tipos financeiros, cálculos, consumidores React e os scripts de teste. A base contava com 88 testes automatizados e três roteiros de UI em Playwright/Edge.

Dependências encontradas:

- App carregava produtos, configurações, operador e caixa de modo síncrono, e distribuía ações concretas às páginas.
- `usePersistedSales` consultava diretamente vendas e ledger; os consumidores gerenciavam eventos storage/focus e eventos locais.
- PDV usava persistência síncrona de carrinho e chamava conclusão com/sem crédito; histórico chamava cancelamento com restauração.
- Configurações chamava backup/restauração e criava verificadores de senha na tela; autenticação lia sessionStorage via serviço.
- Painel financeiro lia ledger/caixa/vendas e coordenava devoluções/resoluções. `utils/cash.ts` fazia leituras escondidas do ledger para calcular apuração.
- Vendas/ledger/caixa/backup compartilham o Web Lock `raiz-pdv:customer-credit-ledger`; autenticação de crédito mantém concessão temporária por verificador/sessão/prazo. Reservas cobrem pagamentos, e recuperação confirma baixas/restaurações ou denuncia inconsistência.

Acessos diretos foram mapeados por `rg`: productStorage, settingsStorage, saleStorage, cashStorage, saleFinancialStorage, cartStorage, backupStorage, operatorAccess e localDataMaintenance. As únicas informações em sessionStorage são sessão do operador e a leitura dessa sessão para verificar a autorização de crédito. Esses acessos não eram equivalentes: dados financeiros persistentes não devem ser confundidos com autorização temporária.

## B. Arquitetura implementada

```text
React / hooks
  └─ ApplicationContext → createPdvApplication(repositories)
       └─ contratos assíncronos por agregado
            └─ createWebRepositories()
                 └─ serviços web estabilizados / localStorage e sessão da aba

Cálculos de domínio ← snapshots explícitos, sem APIs de armazenamento
```

`src/persistence/contracts/index.ts` reúne portas tipadas; `src/persistence/web/createWebRepositories.ts` implementa o web por delegação. `src/persistence/index.ts` exporta a fábrica. `src/application/createPdvApplication.ts` coordena contexto, recuperação e comandos; `src/application/context.tsx` compõe exclusivamente o web e permite injeção em App. Não há condicionais de ambiente nas telas ou adaptador desktop fictício.

`src/domain/cash.ts`, `financial.ts`, `cashSessions.ts` e `errors.ts` contêm a apuração, elegibilidade, seleção de sessões e erro de venda salva com baixa pendente. Os cálculos foram movidos e reutilizados, não copiados com regras alternativas. O antigo `utils/cash.ts` tornou-se uma fachada de compatibilidade usada internamente pelos serviços web e pelos testes antigos. Tipos de backup foram movidos para `src/types/backup.ts`, com reexport compatível pelo serviço antigo.

## C. Contratos

| Porta | Responsabilidade e operações |
|---|---|
| ProductRepository | Listar e substituir catálogo validado; cadastro, edição, ativação/desativação, imagens e categorias permanecem no agregado existente. PDV usa o mesmo catálogo. Não criar exclusão física nova. |
| SettingsRepository | Carregar/salvar estabelecimento e configurações existentes; salvar diretório de operadores e novas senhas junto do agregado de configurações. Verificadores são produzidos no adaptador e permissões são revalidadas. |
| OperatorRepository | Consultar diretório, sessão atual, login/logout e aviso do acesso padrão. Sessão temporária é distinta do cadastro persistente em configurações. |
| SaleRepository | Listar, consultar por ID, concluir venda completa e cancelar com restauração. Itens/lineId, pagamentos combinados, número e eventual crédito pertencem a complete; não expor CRUD de parcelas. |
| CashRepository | Ler sessões/movimentos, abrir, suprir/sangrar, fechar com contagens e fingerprint revisado. Fechamento grava snapshot aprovado. |
| FinancialRepository | Snapshot coerente de vendas/caixa/ledger; registrar devolução por linha; resolver elegibilidade com reembolso/emissão; atualizar pendência; recuperar reservas/baixas/restaurações interrompidas. |
| CustomerCreditRepository | Consulta pública e autenticação com código. Reserva, consumo e restauração pertencem aos comandos financeiros completos e não são oferecidos como CRUD público. |
| DraftRepository | Carregar e salvar o rascunho com preço snapshot. Escritas web são serializadas e propagam falhas; leitura usa a interpretação legada. |
| BackupRepository | Exportar, validar v1/v2, importar o conjunto, consultar cópia de segurança e manutenção administrativa explícita existente. Importação aguarda rascunhos pendentes e delega a compensação/cópia preexistentes. |
| ChangeSubscription | Assinar tópicos e devolver função de cancelamento; o adaptador mapeia storage, foco e eventos locais. É uma assinatura, não uma operação de persistência, por isso não retorna Promise. |

Operações de persistência retornam Promise. Ausência de venda usa null; ausência/crédito não autorizado usa undefined; falhas rejeitam com os erros existentes. `SaleCreditFinalizationPendingError` continua distinguindo venda já gravada de falha sem venda. Não fazer retry automático de comandos: uma rejeição pode exigir recuperação/consulta do resultado salvo. Controles de concorrência e idempotência de recuperação permanecem no adaptador; snapshots usam o mesmo Web Lock dos comandos.

## D. Migração dos consumidores

- App recebe uma aplicação injetável, faz bootstrap assíncrono, exibe carregamento/erro/retry, recupera finanças após autenticação e protege respostas de contexto/catálogo por revisão e desmontagem. Erro do agregado de caixa é sinalizado sem impedir o acesso administrativo ao backup.
- `usePersistedSales` usa snapshot financeiro consistente, inclui caixa no snapshot, ignora respostas antigas, cancela assinaturas/timer ao desmontar e mantém refresh por minuto/foco/eventos.
- Início, Histórico, Relatórios e Caixa recebem dados pelo hook/aplicação. Caixa calcula com vendas, caixa e ledger do mesmo snapshot, e usa notificações após abrir/movimentar/fechar na mesma aba.
- PDV hidrata o carrinho antes de permitir edição ou salvar o estado inicial. Não grava um carrinho vazio enquanto a consulta está pendente. Falha de leitura oferece retry; falha de venda preserva carrinho/pagamentos. Conclusão usa um único comando com cópia do input e trava de submissão. Venda persistida com baixa pendente continua bloqueada contra repetição.
- Pagamento usa autenticação de crédito pela aplicação, ignorando respostas de códigos antigos/desmontagem. Consulta de crédito é assíncrona e usa revisão para evitar resultado obsoleto.
- Histórico usa cancelamento pelo contrato. Painel financeiro usa snapshot, funções puras e comandos de devolução/resolução/pendência; bloqueia comandos financeiros simultâneos.
- Produtos espera a gravação antes de fechar o formulário/alterar o catálogo, mostra erros e impede submissão repetida. Configurações espera salvar, não informa sucesso antes da persistência e delega hashing ao backend web; backup/importação/limpeza são assíncronos e bloqueiam comandos repetidos.
- Login usa consulta/login assíncronos e trava imediata de submissão. Logout mantém o escopo temporário da sessão da aba.

Não restou consumidor React chamando serviços web ou APIs localStorage/sessionStorage. Um teste automatizado verifica essa fronteira. Algoritmos internos web permanecem síncronos onde já estavam estabilizados, adaptados por Promise; é uma exceção de implementação interna, não uma tela ignorando a camada nova.

## E. Integridade financeira

Nenhuma regra financeira aprovada foi alterada. Conclusão continua gerando número/IDs sob bloqueio, validando total, caixa e responsável; pagamento com crédito exige autorização vigente, saldo e cobertura exata de reservas. Cancelamento preserva pagamentos e restaura somente o consumo ainda não restaurado, sem inferir devolução de dinheiro.

Devolução de mercadoria e reembolso continuam eventos distintos. Quantidades e preços são por lineId/snapshot; pendência ocupa elegibilidade, falha libera elegibilidade, e só reembolso concluído de modalidade externa reduz recebido. Emissão de crédito não reduz faturamento nem recebido líquido; uso de crédito não é novo recebimento. Líquido eletrônico negativo permanece aceito.

Suprimento/sangria e fechamento continuam revalidando sessão/operador/saldo. Fingerprint obsoleto rejeita fechamento. Conferência antiga é lida como foi salva, sem recalcular nem sobrescrever snapshots.

Os mecanismos de reservas, Web Locks e recuperação da 11.2 foram mantidos. A nova camada não promete atomicidade real entre chaves localStorage. Futuro SQLite deve executar cada comando com transação própria, respeitando as mesmas invariantes; os contratos não oferecem uma sequência pública de escritas independentes.

## F. Compatibilidade

Chaves e formatos existentes permanecem. Novas vendas continuam gravando lineId e centavos; vendas antigas sem lineId são lidas com `legacy-line-N` somente em memória. Consultas/devoluções não regravam a venda antiga. Sem migração automática de dados por causa dos contratos.

Backup v2 continua exportado; v1/v2 continuam validados e aceitos, com ledger ausente normalizado para vazio em v1. Rascunho não integra backup de negócio. Cópia de segurança anterior e compensação de erro continuam preservadas; snapshot bruto inválido não vira backup aceito artificialmente. Não transferir sessão/código/senha clara para armazenamento persistente menos seguro.

## G. Testes

Validação final: `npm run test:all`, que executou efetivamente `npm test`, `npm run test:ui` e `npm run build`.

| Comando / conjunto | Resultado |
|---|---|
| npm test | 111 testes aprovados: 88 anteriores e 23 da persistência. |
| npm run test:ui | Quatro roteiros aprovados: operadores, devolução/impressão, estabilidade entre abas e estados assíncronos/contratos. |
| npm run build | TypeScript e Vite aprovados. |
| npm run test:all | Pipeline completo aprovado. |
| git diff --check | Sem erros de espaços/patch. |

Os novos testes exercitam a fábrica web e a aplicação, com consultas Promise, injeção, produtos/imagens/eventos, configurações/verificadores/permissões/sessão, venda simples/combinada/crédito, saldo parcial/esgotado, cancelamento/restauração, devolução parcial, pendência/conclusão/falha de reembolso, abertura/fechamento/fingerprint/snapshot, modalidades negativas, recuperação repetível, concorrência, v1/v2, falhas de gravação/importação, rascunho serializado e dados legados. Incluem caixa corrompido com reparo administrativo.

O novo roteiro UI usa apenas um entry point em `tests/async-harness.html`/`.tsx`, fora do build da aplicação, com adaptador real e latência/falhas controladas. Verifica carregamento/retry, carrinho preservado durante hidratação/falha, ausência de sucesso enquanto persistência aguarda, dupla submissão, resposta antiga e desmontagem. Duas abas reais tentam consumir o mesmo crédito pelos novos contratos: apenas uma baixa/venda vence, sem duplicar números/movimentos. Os três roteiros antigos foram preservados.

Falhas investigadas durante o trabalho: três expectativas novas sobre ordem dos caixas/lineId foram corrigidas no teste; um seletor do novo teste UI foi corrigido; a validação completa detectou falta de notificação web de caixa na mesma aba, corrigida no adaptador/assinatura. Nenhuma falha ficou pendente na execução final.

Limitações: testes financeiros usam armazenamento em memória com falhas injetadas; UI usa contextos isolados em Edge e o servidor Vite local. Não simulam desligamento do Windows em toda instrução, corrupção arbitrária externa nem SQLite/IPC, que não existem nesta etapa. O aviso experimental do MockTimers do Node não representa falha. Os dados do navegador da operação não foram apagados/importados pelos testes.

## H. Arquivos

Criados/modificados nesta etapa (nenhum arquivo removido):

- `README.md`
- `docs/etapa-12a-persistencia.md`
- `docs/preparacao-electron-sqlite.md`
- `src/App.tsx`
- `src/application/context.tsx`
- `src/application/createPdvApplication.ts`
- `src/components/CustomerCreditLookupPanel.tsx`
- `src/components/PaymentModal.tsx`
- `src/components/SaleFinancialPanel.tsx`
- `src/domain/cash.ts`
- `src/domain/cashSessions.ts`
- `src/domain/errors.ts`
- `src/domain/financial.ts`
- `src/hooks/usePersistedSales.ts`
- `src/pages/CashPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/HistoryPage.tsx`
- `src/pages/OperatorLoginPage.tsx`
- `src/pages/PosPage.tsx`
- `src/pages/ProductsPage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/persistence/contracts/index.ts`
- `src/persistence/index.ts`
- `src/persistence/web/createWebRepositories.ts`
- `src/services/backupStorage.ts`
- `src/services/cashStorage.ts`
- `src/services/saleFinancialStorage.ts`
- `src/services/saleStorage.ts`
- `src/types/backup.ts`
- `src/utils/cash.ts`
- `tests/async-harness.html`
- `tests/async-harness.tsx`
- `tests/async-ui.cjs`
- `tests/persistence.test.mjs`
- `tests/run-ui.cjs`

Os arquivos de `outputs/` existentes foram preservados. Testes antigos podem atualizar suas evidências isoladas na pasta de outputs; esses artefatos não fazem parte do código necessário da 12A. Não houve instalação de dependências nem alteração de package.json/lockfile.

## I. Pendências e riscos conhecidos

1. Acessos diretos ao armazenamento continuam nos serviços internos web mapeados em A e no adaptador de rascunho. Foram mantidos para delegar aos algoritmos estabilizados; não são dependências de React/aplicação/domínio. `utils/cash.ts` é a única fachada legada de cálculo que carrega o ledger, restrita ao engine web/testes antigos. O domínio novo é puro.
2. Falha abrupta entre chaves de uma importação não tem journal/rollback automático garantido. A cópia anterior permanece a proteção existente; compensação cobre falhas capturadas e denuncia falha também no rollback. Snapshot bruto exige diagnóstico assistido. Não foi inventado um mecanismo de recuperação automática nem nova chave/formato.
3. Venda simples não oferece idempotência durável de invocações independentes repetidas; UI trava submissão em curso e não faz retry automático. Antes de IPC, definir identificadores duráveis de comando/resultado conhecido e erros serializados. Recuperação de créditos já é repetível e continua assim.
4. Catálogo/configurações mantêm atualização de agregado completo e podem sobrescrever uma edição concorrente manual; não foi introduzido versionamento de dados nem regrada a política existente. Decidir controle otimista de versão antes de edição concorrente desktop se necessário.
5. Rascunho permanece compartilhado por abas como antes. A fila ordena escritas de uma instância web; não cria carrinho por operador nem isolamento entre abas. A interpretação de rascunho malformado segue o comportamento antigo; falhas de acesso/gravação são sinalizadas pelo adaptador.
6. Dados/credenciais persistentes continuam no navegador conforme o modelo existente. A futura implementação deve manter os verificadores/autorizações privados no backend; bloquear alterações externas do renderer, não enfraquecer a checagem do código e não usar credenciais retornadas pela UI como fonte de confiança.
7. Os serviços web ainda misturam algumas validações de operação e armazenamento. Isso não impede a troca de adaptador/consumidores, mas portar o engine financeiro para transações SQL exige reaproveitar/extrair essas invariantes com os testes de conformidade, evitando reimplementação divergente.

## J. Preparação para Etapa 12B

A fronteira Promise, a composição/injeção, os comandos completos, o domínio de apuração puro e os testes de consumidores permitem iniciar o planejamento do shell Electron com o backend web preservado. O [modelo preliminar atualizado](preparacao-electron-sqlite.md) descreve tabelas, PK/FK/índices, operadores/verificadores, lineId, pagamentos, devoluções/reembolsos, créditos/reservas/recuperação, snapshots, importações/schema, centavos e valores eletrônicos assinados.

Antes de usar SQLite, finalizar transporte seguro, DTOs/erros/idempotência, sessão temporária e estratégia de migração/cópia externa; executar os mesmos cenários com transações reais. Não há evidência de testes de desktop nesta etapa nem garantia de que a criação de banco pode pular essas decisões.

A 12A termina com o navegador usando o adaptador web e dados compatíveis. Não foi iniciada a 12B/12C, nem realizado commit ou push. Próxima etapa depende de autorização explícita.


## Evolução controlada das portas na 12C.2

O [backend Electron](etapa-12c-2-backend-sqlite.md) implementa as portas financeiras por IPC de domínio. CommandOptions/requestId é opcional para preservar o web; o Electron mantém intenção durável e mesmo ID após timeout/restart. Operadores podem oferecer reauthenticate; o transporte nativo usa hasPassword e créditos públicos sem hash. Emissões distinguem código web de comprovante impresso no main. requiresAuthenticatedReads permite apresentar login sem consultas privadas antes de autenticar. operations é capacidade opcional para conferir/reconhecer/descarte de intenções sem efeitos; não limpa dados comerciais. Portas nativas de backup/limpeza declaram indisponibilidade até 12C.3, sem fallback ao armazenamento web. A composição default não foi alterada.
