# Preparação para Electron + SQLite — histórico 12A/12B, fundação 12C.1 e backend 12C.2

Data: 09/10/2026. Repositório `WarleCoutinho/warle-pdv`, branch `codex/react-pos-base`.
Base publicada: `b7509ee` (Etapa 11.2). Este documento substitui o planejamento preliminar da Etapa 11; o diagnóstico financeiro detalhado permanece em [Etapa 11.2](etapa-11-2-estabilizacao.md).

## 1. Estado na conclusão da Etapa 12A e fronteiras

Na conclusão da Etapa 12A, o sistema funcionava exclusivamente no navegador. A estrutura Electron foi adicionada na Etapa 12B; A fundação SQLite chegou na 12C.1 e o backend operacional na 12C.2; migração/ativação continuam planejadas para a 12C.3.

A Etapa 12A implementou `React → aplicação → contratos Promise → adaptador web`. `createWebRepositories()` compõe os serviços estabilizados; `createPdvApplication(repositories)` permite injetar outra implementação. `ApplicationContext` distribui a aplicação; apenas o ponto de composição seleciona o web. As telas não importam os serviços de armazenamento. A seleção futura deve ocorrer nesse ponto, usando um único backend por execução, sem dual-write.

Cálculos de caixa, elegibilidade e seleção de sessões ficam em `src/domain`, recebem snapshots explicitamente e não conhecem armazenamento. Os algoritmos financeiros compostos continuam internos aos serviços web, com validações e recuperação da Etapa 11.2. Não basta transformar CRUD em IPC: o futuro adaptador deve implementar cada comando completo com as mesmas invariantes dentro da transação. A extração adicional desses algoritmos deverá manter os testes de conformidade, sem mudar regras aprovadas.

## 2. Persistência e compatibilidade atuais

| Chave | Conteúdo |
|---|---|
| `raiz-pdv:products` | Catálogo completo, categoria, ativo, emoji, imagem data URL opcional. |
| `raiz-pdv:settings` | Estabelecimento, preferências existentes e diretório de operadores/verificadores PBKDF2. |
| `raiz-pdv:completed-sales` | Vendas, itens snapshot com lineId nas novas vendas, pagamentos, caixa e cancelamento. |
| `raiz-pdv:cash` | Sessões, operador/data comercial, suprimentos, sangrias e conferências históricas. |
| `raiz-pdv:sale-financial-data` | Devoluções, reembolsos, créditos, movimentos e reservas. |
| `raiz-pdv:draft-cart` | Rascunho temporário, excluído do backup. |
| `raiz-pdv:restore-safety-backup` | Backup anterior ou snapshot bruto de recuperação. |
| `raiz-pdv:operator-session` (**sessionStorage**) | Sessão temporária ligada ao operador e ao verificador atual. |

Não houve alteração de chaves, centavos, IDs, formatos financeiros ou versões de backup. A inicialização de Admin permanece a regra preexistente; não é uma migração criada pela Etapa 12A. Web Locks serializa operações financeiras cooperantes. Reservas e compensações ajudam a recuperar falhas, mas múltiplas chaves localStorage **não formam uma transação atômica real**. Alteração externa do armazenamento não participa desses bloqueios.

## 3. Contratos e transações futuras

| Comando | Unidade transacional exigida no futuro SQLite |
|---|---|
| `sales.complete` | Validar operador/caixa/itens/pagamentos; autenticação do crédito; número único; inserir venda/linhas/pagamentos e reservas/baixas de crédito. |
| `sales.cancel` | Revalidar status; registrar cancelamento; restaurar exatamente os créditos consumidos ainda não restaurados. Não produzir reembolso implícito. |
| `financial.recordReturn` | Reler venda e devoluções; validar quantidades por linha; registrar recebimento de mercadoria. |
| `financial.settle` | Revalidar elegibilidade e dinheiro disponível; inserir resoluções/reembolsos e créditos/movimento de emissão juntos. |
| `financial.updateRefund` | Somente pendente → concluído/falhou; associar conclusão ao caixa atual e validar físico quando aplicável. |
| `cash.close` | Validar sessão, permissão, fingerprint, contagens; gravar fechamento, snapshot e quatro modalidades juntos. |
| `backups.import` | Validar todo o conjunto e versões; importar relacionamentos e marcador de importação numa única transação, com cópia externa anterior. |
| `financial.recover` | Examinar estados interrompidos, validar cobertura de reservas/baixas/restaurações; compensar somente o comprovadamente recuperável. |
| `financial.snapshot` | Leitura consistente de vendas, caixa e ledger usada na apuração. |

Falha não autoriza retry cego. Uma venda web salva com baixa pendente retorna `SaleCreditFinalizationPendingError` com saleId; a UI preserva o documento, bloqueia repetição e encaminha recuperação. Um adaptador IPC deverá reconstruir esse erro de domínio ao receber uma resposta serializada, e distinguir falha sem gravação de resultado confirmado/pendente. Cancelamento também pode estar salvo quando a restauração falha: consultar/recuperar antes de tentar de novo.

O contrato de crédito separa consulta pública de autenticação. A autorização deve ser mantida no backend, limitada à sessão/operador/crédito e ao prazo, e verificada novamente em `complete`. Nunca aceitar uma baixa só porque o renderer enviou customerCreditId. Reserva/consumo/restauração são internos aos comandos; não expor CRUD do ledger.

## 4. Convenções do modelo planejado na Etapa 12A

Este era o modelo conceitual da Etapa 12A; a Etapa 12C.1 implementou o DDL descrito na atualização ao final. PKs textuais preservam os IDs existentes; linhas/pagamentos legados recebem identidade determinística na cópia migrada. FKs normalmente usam RESTRICT para preservar auditoria. Relações ausentes no legado permanecem NULL, nunca ligadas artificialmente a um operador, caixa ou produto atual.

Todos os valores monetários são `INTEGER` em centavos, limitados também ao intervalo de inteiros seguros do TypeScript. Quantidades são INTEGER positivas; ativo é 0/1; status e modalidade têm domínio fechado. Instantes usam TEXT ISO 8601 UTC e datas comerciais `YYYY-MM-DD` na zona America/Sao_Paulo, calculadas pelo processo responsável. Não depender da zona local do Windows para classificar o dia comercial.

Esperado eletrônico e recebido líquido **podem ser negativos** se os reembolsos superarem os recebimentos. Somente dinheiro físico esperado, valores recebidos/emitidos/reservados, saldos de crédito e contagens exigem não negatividade conforme a regra atual. Diferenças são assinadas.

## 5. Tabelas, chaves e índices planejados

| Tabela | Chaves e conteúdo | Restrições e índices |
|---|---|---|
| `categories` | id PK, name | Nome normalizado único; preservar grafia de exibição. |
| `product_images` | id PK, mime_type, data BLOB ou referência controlada, content_hash | Hash indexado; limite de tamanho; referências locais controladas, sem caminhos arbitrários enviados pelo renderer. |
| `products` | id PK, name, category_id FK, price_cents, active, emoji, image_id FK opcional | price >= 0; índice (active,category_id,name); desativação, sem apagar histórico. |
| `store_settings` | id PK singleton, store_name, address, phone, receipt_footer, preferences_json versionado | Uma linha por estabelecimento; preservar opções atuais de impressão/apresentação e extensões versionadas. |
| `operators` | id PK, name, username, normalized_username, role, active | normalized_username UNIQUE; índice ativo; ao menos um admin ativo validado na transação. |
| `operator_credentials` | operator_id PK/FK, algorithm, parameters, salt, verifier, changed_at | Somente verificadores, nunca senha clara; guardar PBKDF2 existente sem enfraquecimento automático. |
| `cash_sessions` | id PK, operator_id FK opcional legado, operator_name_snapshot, business_date, opened_at, closed_at, opening_cents, status | Fundo >= 0; índice (status,business_date); UNIQUE parcial business_date onde aberta; UNIQUE parcial operador não NULL onde aberta, compatível com bloqueio de pendências. Legados conflitantes exigem diagnóstico anterior à migração. |
| `cash_movements` | id PK, cash_session_id FK, operator_id FK opcional, type, amount_cents, description, occurred_at | Valor > 0, supply/withdrawal; índice (cash_session_id,occurred_at). |
| `sale_sequence` | id PK singleton, next_number | Incrementar dentro da transação de venda; também UNIQUE no número de venda. |
| `sales` | id PK, number, occurred_at, cash_session_id FK opcional legado, operator_id FK opcional, status, total_cents | number UNIQUE, total >= 0; índices data, (cash_session_id,data), (status,data). |
| `sale_items` | (sale_id FK,line_id) PK, position, product_id legado, catalog_product_id FK opcional, product_name_snapshot, unit_price_cents, quantity, subtotal_cents | UNIQUE(sale_id,position); quantity > 0, unit >= 0; subtotal=unit*quantity; catálogo opcional não altera snapshot. |
| `sale_payments` | id PK, sale_id FK, position, method, amount_cents, received_cents, change_cents, credit_id FK opcional, captured_at | UNIQUE(sale_id,position); valores >= 0; crédito interno exige credit_id; troco só dinheiro; índices (method,sale_id), credit_id. |
| `sale_cancellations` | sale_id PK/FK, operator_id FK opcional, cancelled_at, reason, note | Um cancelamento por venda; não apagar itens/pagamentos nem inventar estorno. |
| `merchandise_returns` | id PK, sale_id FK, sale_number_snapshot, cash_session_id FK opcional, operator_id FK opcional, occurred_at, amount_cents | Valor > 0; índice (sale_id,occurred_at). |
| `merchandise_return_items` | (return_id FK,position) PK, sale_id, line_id, product/name/unit snapshots, quantity, amount_cents | FK composta (sale_id,line_id) para sale_items; quantity > 0; quantidades acumuladas <= vendidas, verificadas em transação. |
| `financial_refunds` | id PK, sale_id FK, return_id FK opcional, method, amount_cents, status, requested_at, completed_at, cash_session_id FK opcional, credit_id opcional | Valor > 0; índices (sale_id,status), (cash_session_id,completed_at), (status,requested_at). return_id continua opcional pois o web resolve elegibilidade agregada. Não inventar FK payment_id: resolução atual pode não identificar pagamento original. |
| `customer_credits` | id PK, receipt_number, original_sale_id FK, issued_at, original_cents, balance_cents, status, authorization_verifier, issuing_cash_session_id FK opcional | receipt_number UNIQUE; original > 0; 0 <= balance <= original; índices original_sale_id e (status,issued_at). Código claro nunca persistido. |
| `customer_credit_movements` | id PK, credit_id FK, type, amount_cents, occurred_at, sale_id FK opcional, refund_id FK opcional, cash_session_id FK opcional | amount > 0; issued/redeemed/restored; emissão única por crédito; baixa/restauração únicas por (credit_id,sale_id,type) na representação agregada atual; índices (credit_id,occurred_at), sale_id. |
| `operation_requests` | request_id PK, kind, status, payload_hash, result_reference, created_at, completed_at | Idempotência de comando IPC: mesmo ID/conteúdo retorna resultado conhecido; ID com conteúdo diferente rejeita. Não retry automático com ID novo após timeout. |
| `customer_credit_reservations` | id PK, credit_id FK, operation_request_id FK, sale_id candidato, amount_cents, created_at, state | UNIQUE(credit_id,sale_id), valor > 0, índice sale_id/state. sale_id candidato pode preceder a venda e não deve ter FK imediata obrigatória. FK para operação permite recuperar reserva órfã antes da venda. |
| `recovery_events` | id PK, operation_request_id FK, kind, outcome, occurred_at, diagnostic_code | Log técnico sem códigos/senhas; não substituir evidências financeiras. |
| `cash_reconciliation_snapshots` | cash_session_id PK/FK, summary_version, revenue_cents, net_received_cents, sale_count, cancelled_count, credit_used_cents, opening/cash_sales/supplies/withdrawals/refunds/physical_expected_cents, source_fingerprint, closed_at, legacy_snapshot_json opcional | Inserção única; não atualizar/recalcular históricos. Versão ausente legado permanece ausente. net_received é assinado. |
| `cash_reconciliation_methods` | (cash_session_id FK,method) PK, received_cents, refunded_cents, expected_cents, counted_cents, difference_cents | Quatro métodos físicos/eletrônicos; contado >= 0; diferença=contado-esperado; expected eletrônico pode ser negativo. |
| `backup_imports` | id PK, operation_request_id FK, source_version, payload_digest, started_at, completed_at, status, safety_copy_reference, diagnostic_code | Índice (payload_digest,status), idempotência por operação; definir política explícita de reimportação deliberada. Não tratar checksum FNV como autenticação ou hash criptográfico. |
| `schema_migrations` | version INTEGER PK, applied_at, migration_digest | Versões únicas, execução controlada e verificável. |

Sessões de autenticação e autorizações de crédito ficam temporárias e privadas no processo responsável, com identificadores opacos e expiração; não criar tabela de senhas em sessão nem levar sessionStorage para um localStorage global. Metadados de sessões encerradas para auditoria, se necessários, não incluem tokens/verificadores de sessão. Os DTOs de operadores no desktop devem preservar a indicação de senha cadastrada que a UI usa, sem devolver o verificador real; o backend decide manter/trocar a credencial e revalida permissão. O web mantém o escopo já existente.

O ciclo crédito/reembolso é resolvido pela ordem de inserção e FKs diferidas quando necessário: inserir resolução com crédito ainda não associado, criar crédito e movimento, vincular ambos antes de COMMIT. Não permitir uma transação final com vínculo incompleto.

## 6. Integridade e operações

Ativar e verificar foreign_keys em cada conexão; indexar FKs consultadas. Uma transação explícita engloba validação, leituras e todas as escritas do comando. O futuro adaptador deve controlar concorrência/SQLITE_BUSY e rollback; não assumir que todo erro do SQLite automaticamente desfaz o comando inteiro. Estas decisões seguem a documentação oficial de [transações](https://www.sqlite.org/lang_transaction.html) e [chaves estrangeiras](https://www.sqlite.org/foreignkeys.html).

CHECK/UNIQUE/FK cobrem limites locais e relações. Somatórios de itens/pagamentos, reservas disponíveis, quantidade devolvida acumulada e elegibilidade resolvida são revalidados pelo comando dentro da transação; não confiar apenas em CHECK de uma linha. Ver [CREATE TABLE](https://www.sqlite.org/lang_createtable.html).

Faturamento conta vendas concluídas pelo valor original. Cancelamento não devolve dinheiro automaticamente; emissão/restauração de crédito é obrigação interna, não saída física. Uso de crédito não é novo recebimento. Só reembolso concluído em modalidade externa reduz recebido/físico. Guardar snapshots aprovados de fechamento, inclusive modalidades negativas e sem reconstruir dados ausentes de fechamentos antigos.

Preservar autorização, Web Locks e recuperação nos testes web enquanto o adaptador SQL não existir. Transações SQL substituem a coordenação de escritas do backend; o renderer não deve implementar reservas por chamadas separadas.

## 7. Importação legada e backups

O web exporta v2 e aceita v1/v2 com validação de formato, checksum, relações e limite de 10 MB. V1 normaliza ledger ausente para vazio sem inventar eventos. Snapshot bruto de recuperação não é backup importável; exige diagnóstico assistido. A restauração web conserva a cópia anterior e tenta compensar todas as chaves se houver erro; se compensação falhar, comunica falha e mantém a cópia. Interrupção abrupta entre chaves não tem recuperação automática garantida e deverá ser tratada com a cópia preservada. A 12A não cria journal nem muda esses formatos.

Migração futura, somente com autorização:

1. Exportar/certificar cópia externa do conjunto original; não apagar as chaves web.
2. Validar v1/v2 e todas as relações antes da importação SQL. Diagnosticar IDs/números/caixas incompatíveis, sem corrigir retroativamente o legado.
3. Preservar IDs e lineId existentes. Para linhas antigas usar `legacy-line-N` com posição iniciando em 1, como a leitura atual; resolver devoluções antigas por snapshots/ordem original. Não sobrescrever a venda original.
4. Importar catálogo/configurações/operadores, sessões, vendas/linhas/pagamentos/cancelamentos, devoluções/reembolsos/créditos/movimentos/reservas, snapshots e marcador de importação num único comando transacional. Relações diferidas e registros de operação tratam ciclos e reservas anteriores à venda.
5. Manter o nome/ID de produto histórico, mesmo sem produto atual; FK catálogo fica opcional. Não atribuir responsável inexistente a registros antigos.
6. Importar contagens/expected/diferenças históricas como foram gravadas, sem recálculo. Imagens data URL precisam de conversão reversível com limite/MIME e verificação de preview/export.
7. Duplicatas com conteúdo divergente abortam o conjunto; idempotência usa operação/digest validado. Reler e comparar contagens, totais, movimentos, vínculos e snapshots antes de aceitar a migração.
8. Gravar versão de schema/importação, verificar integridade referencial e confirmar; em falha rollback + cópia externa preservada. Só selecionar SQL após validação, sem dual-write.

## 8. Prontidão para 12B

Há uma fronteira assíncrona utilizável e testada, com composição e domínio de apuração independente. A 12B pode planejar o shell Electron e a segurança de execução sem migrar dados nem trocar o backend financeiro. Exige autorização separada.

Antes da etapa SQLite, escolher biblioteca, configuração de conexão/backup, limites IPC, códigos de erro serializados, gestão temporária de autenticação e identificadores duráveis de comandos idempotentes; portar comandos financeiros mantendo testes de conformidade. O backend web atual não garante idempotência durável de duas invocações completas de venda simples: a UI bloqueia submissão simultânea e não aplica retry automático. Esse limite deve ser resolvido no contrato de transporte/aplicação antes de aceitar retries por IPC, sem reescrever telas ou regras financeiras.

Não existe adaptador Electron fictício, banco simulado ou código de instalação nesta etapa. Resultados e limitações da implementação estão no [relatório 12A](etapa-12a-persistencia.md).


## Atualização da Etapa 12B

Electron 44.7.0 está implementado em main/preload/shared separados, com sandbox, isolamento, Node desabilitado no renderer e somente o IPC tipado getAppInfo. Ambos os ambientes usam createWebRepositories; não há IPC financeiro, banco ou migração nesta etapa.

O build usa raiz://app/index.html, origem padrão e segura que mantém localStorage, Web Locks e Web Crypto. O main serve somente index e assets autorizados. O perfil Windows é %APPDATA%\Raiz PDV, com partições distintas de desenvolvimento e produção. Os dados do navegador não são copiados automaticamente. CSP, restrições de navegação/rede/janelas, negação de permissões e validação de origem real/frame/WebContents protegem a fronteira. Downloads limitam-se ao backup JSON iniciado pelo usuário, com diálogo nativo.

### Preparação para a Etapa 12C

O caminho previsto é React → aplicação → contratos → adaptador Electron → preload tipado → IPC validado → main → SQLite. Selecionar um único backend no ponto de composição, sem dual-write. Cada comando financeiro completo deverá validar autorização do operador e autenticação de crédito no backend, ter identificador idempotente e resultado durável, e executar todas as escritas relacionadas em transação real. Não expor SQL, caminhos ou IPC arbitrário ao renderer.

O modelo relacional acima permanece válido, incluindo centavos INTEGER, integridade referencial, reservas/recuperação, históricos imutáveis e modalidades eletrônicas líquidas negativas quando reembolsos superam recebimentos. A migração deverá ser explícita e versionada, com validação de backups v1/v2, cópia anterior e histórico de importação. Distinguir credenciais persistentes de sessões temporárias; não confiar em autorização informada pelo renderer.

A estrutura está preparada para iniciar a implementação futura, condicionada a testes de conformidade, concorrência e falhas para o novo adaptador. Banco, instalador, assinatura e atualização automática permanecem fora desta etapa. Veja [o relatório da Etapa 12B](etapa-12b-electron.md).


## Atualização da Etapa 12C.1 — schema real, backend operacional ainda web

A infraestrutura `electron/main/sqlite` usa `node:sqlite` do Electron, com banco persistente controlado por userData, WAL, synchronous FULL, foreign_keys ON e busy_timeout 1500 ms, todos verificados. O build local usa data/raiz-pdv.sqlite e desenvolvimento data/development/raiz-pdv.sqlite. Testes usam data/test dentro de perfis temporários; testes gráficos também usam perfis temporários quando exercitam o modo production. Uma única instância por userData protege cada perfil; desenvolvimento e build no mesmo perfil não abrem simultaneamente. SQLite continua responsável por bloqueios entre conexões.

A migration 1 cria as 26 tabelas (incluindo schema_migrations e installation_state), índices e constraints. O digest SHA-256 do SQL efetivo, user_version, integrity_check, foreign_key_check e comparação dos objetos sqlite_schema são verificados. Migrations pendentes usam uma transação; falhas não apagam o banco. Alterações retroativas serão proibidas após publicação; alterações seguintes devem adicionar versões.

### Divergências e decisões do DDL

- Todas as tabelas são STRICT; números possuem CHECK de intervalo seguro. FKs usam RESTRICT, vínculos legados previstos continuam opcionais.
- product_images usa BLOB limitado a 10 MiB com MIME permitido e hash. Referência a arquivo não foi implementada; uma estratégia de arquivos exigirá migration e controle pelo main.
- operator_credentials separa algoritmo PBKDF2-SHA256, parâmetros JSON, salt e verifier. Não há senha clara, operador inicial ou credencial semeada no SQLite; a futura importação deverá preservar os parâmetros existentes.
- operation_requests usa result_json para resultado completo durável, além de result_reference opcional. Estados são pending, committed e interrupted. Efeito e resultado são confirmados na mesma transação; interrupção anterior ao commit reverte ambos. Registros interrompidos existentes são diagnosticados, sem reexecução automática.
- Vínculos de devolução/resolução com venda usam FKs compostas para impedir associação cruzada. Crédito associado à resolução tem FK diferida para permitir o ciclo de inserção na mesma transação.
- snapshot e métodos de fechamento têm triggers que impedem UPDATE/DELETE comum. A manutenção extraordinária futura precisará tratar esses triggers dentro da operação administrativa autorizada, restaurando o mesmo schema antes de confirmar. Nenhuma exceção de manutenção existe agora.
- Quantidade devolvida acumulada, saldo disponível considerando reservas, somatórios de pagamentos/itens, elegibilidade e autorização continuam sendo validações agregadas dos futuros comandos. O schema não deve ser interpretado como implementação desses comandos.
- Datas UTC são ISO canônicas com milissegundos; a infraestrutura fornece data comercial por America/Sao_Paulo. A migração deverá validar/normalizar datas na cópia, preservando o significado do instante original.
- installation_state é singleton, estados testing/ready_for_setup/production, geração positiva segura e ativação UTC obrigatória em production. Ambos os modos começam em testing; abrir o build não equivale a ativação oficial.

### Preparar para uso oficial — estratégia para 12C.3

Só testing poderá entrar no fluxo normal de preparação. Exigir administrador autorizado no backend, reautenticação recente, dupla confirmação e frase ZERAR RAIZ PDV. Bloquear operações concorrentes, concluir backup consistente externo com mecanismo SQLite de backup online (ou fechamento/checkpoint validado em procedimento controlado) e provar recuperabilidade antes de qualquer exclusão. Copiar somente o arquivo principal durante escritas WAL não é backup confiável.

A futura transação deverá remover todo o catálogo, configuração comercial, operadores/credenciais de teste, sessões/movimentos de caixa, vendas/itens/pagamentos/cancelamentos, devoluções/reembolsos, créditos/movimentos/reservas, snapshots, requests, recovery_events e backup_imports. Preservar schema/migrations, metadados técnicos e backups externos; reiniciar sale_sequence.next_number em 1; incrementar generation e definir ready_for_setup. Tratar FKs/triggers em ordem controlada, nunca desabilitando proteção global para o renderer. Rollback deverá preservar a base anterior se algo falhar.

Após commit, invalidar sessões, autorizações e rascunhos do ciclo anterior; os futuros tokens/requests devem ser vinculados à geração. A configuração inicial deverá cadastrar explicitamente o primeiro administrador e estabelecimento, sem senha padrão silenciosa no SQLite, bloquear vendas até concluir e só então ativar production. Em production, esconder/bloquear a preparação normal; eventual restauração de fábrica exige procedimento extraordinário separado.

Na 12C.1 existe somente estado persistente, restrições, leitura e planejamento interno puro de transição, sem alteração do estado, exclusão, botão ou IPC administrativo. O planejador não autentica: suas evidências terão de ser produzidas pelo backend futuro, jamais confiadas ao renderer.

### Pendências para 12C.2/12C.3

Portar comandos completos e autenticação para o main; vincular requests à geração/operador e não incluir segredos no payload hash; assegurar idempotência com o mesmo requestId após timeout. Implementar o adaptador real somente após testes de conformidade. Depois implementar backup SQLite recuperável, importação v1/v2 e migração explícita, ativação e preparação administrativa. Até lá, todos os dados operacionais permanecem no web, sem dual-write.

Fontes técnicas: [node:sqlite Node 24](https://nodejs.org/download/release/v24.21.0/docs/api/sqlite.html), [WAL SQLite](https://www.sqlite.org/wal.html), [transações SQLite](https://www.sqlite.org/lang_transaction.html), [backup online SQLite](https://www.sqlite.org/backup.html). Relatório e resultados: [Etapa 12C.1](etapa-12c-1-sqlite.md).


## Backend operacional validável — atualização 12C.2

A [12C.2](etapa-12c-2-backend-sqlite.md) adiciona o adaptador Electron e comandos financeiros reais no main. A composição operacional permanece web; não há ativação, migração, dual-write ou limpeza automática. O estágio anterior deste documento é histórico; a API deixou de ser limitada a getAppInfo, mas não permite SQL/filesystem genérico nem alterar instalação.

Migration 1 permanece publicada/imutável. Migration 2 acrescenta autoria/generation em requests e vendas, snapshots de autoria, motivo de devolução, autoria de reembolsos/movimentos/fechamento e ciphertext para impressão. Dinheiro continua INTEGER seguro em centavos; eletrônico líquido pode ser negativo. Sessões são internas ao main e vinculadas à geração. Todos os efeitos financeiros e resultados idempotentes confirmam juntos com BEGIN IMMEDIATE.

Requests preparados guardam somente hash de intenção, sem efeito financeiro/segredo. Prepare/execute/read/acknowledge/discardPrepared permitem recuperar resultados perdidos sem gerar novo ID. Troca de payload com resultado incerto bloqueia nova tentativa até conferência explícita. Descarte não exclui registros e só aceita intenção preparada sem reserva ou confirmação.

A migração 12C.3 deve preservar backups web v1/v2 e formatos históricos, principalmente lineId ausente, autoria opcional, recebimentos cancelados e snapshots sem campos v2. O mapper SQL moderno não substitui o importador/mapeamento de fechamento legado. Importar verifier de crédito não permite inventar código secreto de reimpressão; DPAPI não substitui backup portátil. Preparação oficial, geração nova, reinicialização autorizada de dados fictícios e sequência, backup consistente externo e ativação continuam exclusivamente planejados.


## Implementação da Etapa 12C.3

Electron normal passa a SQLite único por composição confiável; navegador conserva adaptador web. A migration 3 aditiva traz `installation_id` único por instalação (32 hex), `installation_audit` (PK UUID, tipo/geração/data/JSON técnico), `native_drafts` (PK operador+geração, FK operador), `legacy_records` (PK tipo+ID, JSON original) e `sale_items.legacy_line`. Migrations 1/2 não mudam. Request e geração são a fronteira de idempotência; nova geração exige intenção preparada no main. Valores financeiros continuam INTEGER, incluindo líquidos eletrônicos negativos. Snapshots históricos não são recalculados.

Backup usa API online SQLite, manifesto SHA-256 e payload AES-GCM derivado por scrypt; DPAPI é custódia local, não formato portátil. Restauração verifica em perfil isolado e usa fechamento/bloqueio, journal durável e anterior preservado. Importação v1/v2 aplica todos os agregados em transação, preserva JSON legado e valida contagens/totais; não faz merge. Setup e preparação são commits completos e auditáveis. Limpeza testing restaura triggers dentro da mesma transação, incrementa geração e reinicia sequência; produção bloqueia reset comum.

Consulte [12C.3: arquitetura, evidências e procedimentos](etapa-12c-3-ativacao-sqlite.md). Não excluir WAL ou substituir banco aberto. Próximas etapas de empacotamento/instalador não foram iniciadas.
