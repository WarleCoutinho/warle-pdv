# Raiz PDV — Etapa 12C.1: fundação SQLite

Data: 09/10/2026. Repositório WarleCoutinho/warle-pdv. Branch codex/react-pos-base.

## A. Diagnóstico inicial

Base confirmada: 1a637da9f67722847270471b8524ca8ee88c1844, Etapa 12B publicada. O código estava limpo; outputs/credito-impressao.pdf, credito-impressao.png, dashboard-financeiro.png, devolucao-simplificada.png e outputs/etapa-11-2 estavam não rastreados e foram preservados. Nenhum reset, checkout destrutivo ou limpeza foi executado.

Foram examinados os documentos 11.2, 12A, 12B e planejamento SQLite; contratos, createWebRepositories, createPdvApplication e ApplicationContext; serviços de vendas, ledger, caixa, autenticação e backups; testes financeiros/persistência e scripts; main/preload/shared, Vite e compilação Electron. A composição operacional é React → aplicação → contratos Promise → serviços web. Web Locks, reservas e recuperação permanecem nesse backend. Foi verificado o runtime real do Electron instalado, sem inferir a versão pelo Node do terminal.

## B. Biblioteca SQLite

Escolha: node:sqlite, com DatabaseSync e prepared statements, incorporado no Electron 44.7.0. A execução real informou Node 24.21.0 e SQLite 3.53.4. Nenhum pacote SQLite externo, ORM ou módulo nativo adicional foi instalado; não há rebuild ou DLL externa a empacotar. O binding usa o banco SQLite real, não JSON ou simulação.

better-sqlite3 foi considerado: tem API madura, statements e transações, mas adicionaria módulo nativo, dependência e etapa de rebuild/teste do ABI Electron no Windows. Para esta fundação, a implementação já incorporada oferece os recursos necessários e reduz a manutenção do empacotamento. A API node:sqlite no Node 24 está classificada como release candidate: atualizar Electron exige repetir a suíte com o runtime novo. DatabaseSync é síncrono; cargas futuras de migração/importação deverão ser medidas e, se necessário, executadas em worker controlado pelo main, preservando a fronteira de segurança.

Fontes: [node:sqlite Node 24.21](https://nodejs.org/download/release/v24.21.0/docs/api/sqlite.html), [better-sqlite3 e rebuild Electron](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md).

## C. Arquitetura

A pasta privada electron/main/sqlite contém schema, migrations, conexão, transações, idempotência, erros seguros, perfis e planejamento de instalação. O main abre a fundação antes de liberar o renderer e fecha a conexão no encerramento normal. Falha de inicialização abre a janela local de diagnóstico da Etapa 12B, sem preload.

Preload/shared e todos os contratos e consumidores React permaneceram intactos. getAppInfo continua o único IPC. Não há adaptador Electron fictício, IPC financeiro, API CRUD remota ou ativação de SQLite como backend operacional. A fundação só grava metadados técnicos iniciais; não semeia catálogo, credenciais, vendas ou dados fictícios no banco da aplicação.

## D. Localização do banco

A origem do caminho é app.getPath('userData'), definido pela configuração da Etapa 12B antes das sessões. Nenhum payload renderer escolhe caminho.

| Modo | Caminho relativo ao perfil |
|---|---|
| Build local/produção desktop | data/raiz-pdv.sqlite |
| Desenvolvimento com Vite | data/development/raiz-pdv.sqlite |
| Testes de fundação | data/test/raiz-pdv.sqlite em diretório temporário |

No Windows, o perfil padrão é %APPDATA%\Raiz PDV. Testes gráficos de ambos os modos também passam um perfil temporário isolado; não acessam o perfil padrão. O caminho não depende do cwd, dist ou dist-electron. Diretórios são criados com tratamento de erro. Arquivo existente vazio, diretório ou symlink no destino é rejeitado; banco existente não reconhecido/corrompido não é substituído.

requestSingleInstanceLock protege o userData efetivo. O mesmo perfil não abre duas vezes, inclusive entre desenvolvimento e build; perfis diferentes podem executar simultaneamente. A segunda tentativa não abre SQLite e foca a janela anterior. Dentro do processo, a conexão é única e os callbacks transacionais síncronos não intercalam. Outras conexões são controladas pelos locks SQLite e busy_timeout.

## E. Configuração e integridade

A abertura configura e verifica foreign_keys=ON, journal_mode=WAL, busy_timeout=1500 ms e synchronous=FULL. O timeout é configurável somente internamente, limitado a 0–10000 ms. Abertura/diagnóstico usam integrity_check e foreign_key_check; schema, digest, user_version e instalação são verificados antes de disponibilizar a conexão. Não há fallback silencioso de WAL para outra política. Extensões nativas e literais com aspas duplas são desabilitados.

raiz-pdv.sqlite contém as páginas principais; -wal pode conter transações já confirmadas ainda não transferidas; -shm mantém o índice compartilhado do WAL. O checkpoint padrão e o fechamento SQLite cuidam da incorporação, sem excluir manualmente esses arquivos. Não copiar somente o arquivo principal durante escritas como se fosse backup consistente. A 12C.3 deverá usar backup online SQLite/backup() com destino externo, verificar integridade e recuperação. FULL melhora durabilidade, mas não equivale a teste de queda de energia real ou garantia contra falha de hardware.

Erros nativos são convertidos em códigos fixos sem SQL, valores, stack, caminhos ou credenciais. Corrupção ou falha de rollback detectadas bloqueiam escritas posteriores da conexão; falha de abertura fecha a conexão. Dados nunca são corrigidos por adivinhação ou apagados automaticamente.

## F. Schema

A migration inicial contém 26 tabelas STRICT, PKs, FKs RESTRICT, UNIQUE, CHECK e índices de consulta. Grupos:

| Grupo | Tabelas |
|---|---|
| Catálogo/configuração | categories, product_images, products, store_settings |
| Operadores | operators, operator_credentials |
| Caixa | cash_sessions, cash_movements |
| Vendas | sale_sequence, sales, sale_items, sale_payments, sale_cancellations |
| Devoluções/resoluções | merchandise_returns, merchandise_return_items, financial_refunds |
| Créditos | customer_credits, customer_credit_movements, customer_credit_reservations |
| Integridade operacional | operation_requests, recovery_events |
| Fechamentos | cash_reconciliation_snapshots, cash_reconciliation_methods |
| Técnicas | backup_imports, schema_migrations, installation_state |

Centavos e quantidades são INTEGER, limitados a ±9007199254740991 ou intervalo não negativo/positivo aplicável. O binding também rejeita números fracionários/inseguros e bigint fora desse intervalo antes de preparar parâmetros. Subtotal exige produto unitário×quantidade sem overflow. Dinheiro físico e contagens são não negativos; net_received, esperado eletrônico e diferenças podem ser negativos. Pagamentos conferem troco/modalidade e vínculo de crédito. Crédito limita saldo ao original e guarda apenas verificador hexadecimal.

IDs e lineId são textuais, sem gerar associações retroativas. Vínculos de produto atual, operador, caixa e datas comerciais legadas previstos como opcionais ficam NULL. Devoluções usam FKs compostas para venda/linha e devolução/venda. Crédito associado à resolução permite FK diferida, mas precisa existir no commit. Reservas aceitam sale_id candidato anterior à venda e exigem operação/crédito existentes. Emissão e baixa/restauração agregadas têm unicidade. Snapshots e seus métodos têm triggers que bloqueiam UPDATE/DELETE comuns; não são recalculados.

Instantes usam UTC ISO com milissegundos; commercialDate usa America/Sao_Paulo explicitamente. Validações agregadas (quantidade devolvida acumulada, total de itens/pagamentos, elegibilidade e saldo com reservas) deverão ocorrer nos comandos futuros dentro da mesma transação. A suíte demonstra uma validação agregada interna de teste com rollback; não porta financial.recordReturn nesta etapa.

Divergências do planejamento registradas também no documento de preparação: imagens usam apenas BLOB de até 10 MiB; resultado idempotente usa result_json completo e referência opcional; estados de requests são pending/committed/interrupted; FKs compostas reforçam vínculos; snapshots ganham triggers; installation_state foi adicionado. Relações legadas não são preenchidas automaticamente. A futura migração deverá lidar com dados insuficientes por diagnóstico e snapshot legado, sem inventar financeiros.

## G. Migrations

MIGRATIONS contém versão 1; SQL efetivo é determinístico e recebe SHA-256. schema_migrations grava version, applied_at e migration_digest; PRAGMA user_version acompanha a versão. Versões precisam ser contíguas e ordenadas. Digests divergentes, versões futuras, lacunas ou versão de cabeçalho divergente são rejeitados.

As migrations pendentes e o registro técnico usam BEGIN IMMEDIATE/COMMIT, com rollback conjunto se uma instrução falhar. O estado é relido sob o writer lock antes de aplicar. A suíte cobre falha no banco novo e upgrade interrompido com dados existentes, seguido de inicialização/upgrade válido. Migrations publicadas não devem ser editadas: adicionar novas versões. Objetos de sqlite_schema são comparados ao schema esperado para detectar remoção/alteração externa de tabelas, índices ou triggers. Não há downgrade, reparo ou reset automático.

## H. Transações

SqliteFoundation.transaction fornece contexto privado de statements preparados: run/get/all. Abre BEGIN IMMEDIATE, executa leituras/validações/escritas síncronas e só confirma ao terminar. Falha intermediária ou FK diferida no commit faz rollback. Não existem chamadas financeiras CRUD independentes por IPC.

Aninhamento é rejeitado; Promise/thenable é rejeitada e contexto expirado não pode executar consultas tardias. O contexto também bloqueia controles manuais de transação/PRAGMA/ATTACH. SQLITE_BUSY/LOCKED retorna DATABASE_BUSY sem retry automático ou repetição do callback; após liberação, o chamador pode tentar explicitamente com o mesmo identificador e consultar o resultado. Falha de rollback bloqueia a conexão para diagnóstico. Os testes usam duas conexões reais, leituras WAL concorrentes e subprocessos encerrados antes/depois de commit.

## I. Idempotência durável

executeRequest recebe requestId, kind e payload JSON canônico sem segredos; digest SHA-256 não depende da ordem de propriedades. Mesmo ID/kind/hash confirmado devolve o resultado persistido sem executar callback. Conteúdo/kind diferente retorna REQUEST_CONFLICT. Registro pendente/interrompido existente retorna REQUEST_INTERRUPTED e aparece no diagnóstico, sem tentar adivinhar o efeito.

Request pending, efeito e result_json committed compartilham a mesma transação. Antes de commit, interrupção desfaz ambos; depois de commit, reinício conserva o resultado. JSON inválido/inseguro aborta. Não persistir senhas/códigos/tokens no payload ou resultado: a futura autenticação precederá o comando e produzirá referências autorizadas. A futura 12C.2 vinculará identidade também à instalação/geração/operador e distinguirá timeout de resultado desconhecido, mantendo o requestId. Esta infraestrutura não decide autorização nem cria vendas fictícias na aplicação.

## J. Preparação para uso oficial

installation_state tem uma única linha id=1, status testing/ready_for_setup/production, created_at UTC, activated_at obrigatório somente em production e generation inteira positiva segura. A migration inicial cria testing, geração 1, inclusive no build local; iniciar Electron não ativa uma instalação comercial. Reabrir preserva exatamente o estado. Estado ausente/inválido causa diagnóstico, sem recriar ou converter silenciosamente.

O módulo de instalação oferece leitura/validação e planejamento puro das transições futuras: testing → ready_for_setup incrementa geração; ready_for_setup → production exige setup completo. O planejador não escreve, autentica, limpa ou funciona como endpoint. Evidências de autorização serão obtidas pelo backend futuro e nunca aceitas como flags arbitrárias do renderer. Production rejeita o fluxo normal de preparação.

A 12C.3 deverá exigir administrador, reautenticação recente, dupla confirmação, frase ZERAR RAIZ PDV, exclusão concorrente e backup completo externo com recuperabilidade comprovada antes de limpar. A transação removerá os dados operacionais de teste de todos os grupos e requests/eventos/importações, preservará schema/migrations/metadados/backups externos, reiniciará next_number em 1 e incrementará generation. Triggers de histórico terão manutenção controlada e restauração na mesma transação. Qualquer falha provoca rollback.

Depois invalidar sessões, autorizações e rascunhos; voltar ao cadastro explícito do primeiro administrador e estabelecimento; bloquear vendas até ativação. Não criar Admin/123456 silenciosamente no SQLite. O Admin web atual permanece como antes. Após production, qualquer restauração de fábrica será procedimento extraordinário separado. Não há limpeza real, botão ou IPC de reinicialização nesta etapa.

## K. Segurança

As proteções 12B continuam: sandbox/contextIsolation/webSecurity true, nodeIntegration false; CSP, permissões negadas, protocolo/assets restritos, navegação/redirect/janelas controlados e validação de origem real/frame/WebContents. Renderer não importa Node/SQLite, não conhece o caminho ou a conexão, nem pode mudar installation por IPC. getAppInfo permanece sem dados privados. Tentativas de canais SQL/IPC arbitrários são rejeitadas e os testes comparam installation e requests para assegurar ausência de alteração.

A proteção não constitui criptografia ou defesa contra usuário com acesso de escrita ao perfil do Windows. Autorização de operador no backend financeiro será implementada na 12C.2, antes de expor os comandos.

## L. Testes

Resultados executados com sucesso:

- npm run typecheck: renderer e Electron aprovados.
- npm run test:all: 120 testes anteriores, 43 testes SQLite no runtime Electron, quatro roteiros UI anteriores e build web aprovados (163 testes automatizados somados).
- npm run test:sqlite: 43 testes aprovados, bancos reais em perfis temporários, sem skips.
- npm run build:desktop: renderer/main/preload aprovados.
- npm run test:desktop: Electron real em desenvolvimento/build local; venda/backup/reinício web; segurança/IPC; cinco falhas anteriores de startup; inicialização SQLite e estado preservado; instância única, perfis distintos simultâneos, isolamento dev/produção; corrupção/inacessibilidade com arquivos preservados.
- git diff --check: sem erros; somente avisos de conversão LF/CRLF do Git.

Cobertura SQLite: criação/reabertura, migrations/digest/futuro/rollback/recuperação, tabelas/índices/FKs, centavos/quantidades/legado, crédito/resolução/pagamentos, reservas, líquido eletrônico negativo, snapshots imutáveis, commit/rollback/aninhamento/async, bloqueios e concorrência, requests repetidos/conflitantes/interrompidos, persistência e interrupção abrupta antes/depois do commit, perfis/arquivos inválidos/corrupção, bloqueio de escrita após diagnóstico, installation singleton/geração/estado/planejamento, ausência de importação e manutenção do backend web.

Os testes não abrem o banco padrão de produção. Quando exercitam mode production, o userData é um diretório temporário isolado. Fixtures financeiras existem somente nos bancos temporários da suíte. Banco em memória é usado apenas para comparar estrutura e um teste do binding. Não há limpeza de armazenamento do usuário.

Limitações: inacessibilidade foi reproduzida com caminho/diretório bloqueado; não se testou toda a matriz ACL/UAC do Windows. Não houve corte físico de energia, corrupção de hardware, disco cheio real, instalador/assinatura ou backup SQLite operacional. Node 22 do terminal emite ExperimentalWarning nos testes gráficos ao consultar SQL; o teste da fundação roda no Node 24.21 do Electron e não oculta warnings.

## M. Arquivos

Criados:

- electron/main/sqlite/schema.cts
- electron/main/sqlite/migrations.cts
- electron/main/sqlite/database.cts
- electron/main/sqlite/errors.cts
- electron/main/sqlite/profile.cts
- electron/main/sqlite/installation.cts
- scripts/test-sqlite.mjs
- tests/sqlite-foundation.test.cjs
- tests/sqlite-desktop.cjs
- docs/etapa-12c-1-sqlite.md

Modificados: electron/main/index.cts, tests/electron-smoke.cjs, tests/electron-startup.cjs, package.json, .gitignore, README.md e docs/preparacao-electron-sqlite.md. package-lock.json e dependências permanecem intactos; node:sqlite é incorporado. Nenhum arquivo funcional foi removido. Os outputs não rastreados anteriores foram preservados; builds e bancos são ignorados pelo Git.

## N. Riscos conhecidos

node:sqlite ainda é release candidate no runtime escolhido. Atualizações do Electron deverão executar estes testes e validar o schema no SQLite embarcado novo. DatabaseSync pode bloquear o main durante trabalho longo; migrations/importações volumosas requerem avaliação de worker. WAL pressupõe armazenamento local compatível; a conexão rejeita configuração que não confirma WAL. A versão atual não oferece backup/importação SQL nem ferramentas de reparo automático.

As restrições SQL não substituem autorização, elegibilidade e validações agregadas dos comandos futuros. Idempotência atual protege somente callbacks internos já integrados ao mesmo SQLite, sem dual-write com localStorage. Não atribuir atomicidade SQLite às operações web atuais.

## O. Preparação para 12C.2 e 12C.3

12C.2: adaptador Electron real e IPC por comandos completos, validação/autorização/reautenticação no backend, identidade vinculada à geração, DTOs sem segredos, transações e conformidade com web para vendas/caixa/devoluções/reembolsos/créditos/recuperação. Sem ativar backend antes da validação.

12C.3: backup consistente e recuperável, importação v1/v2 e migração explícita com dados preservados, recuperação, seleção controlada do backend, cadastro inicial/ativação e Preparar para uso oficial com controles administrativos. Preservar históricos e diagnosticar legados incompatíveis sem invenções.

O backend operacional permanece createWebRepositories. Nenhum dado existente foi migrado ou excluído. Nenhuma limpeza real foi implementada. Não houve commit ou push; publicação e próximas etapas dependem de autorização.


### Git status ao encerrar

Branch codex/react-pos-base, HEAD 1a637da (Etapa 12B), sem novos commits.

```text
 M .gitignore
 M README.md
 M docs/preparacao-electron-sqlite.md
 M electron/main/index.cts
 M package.json
 M tests/electron-smoke.cjs
 M tests/electron-startup.cjs
?? docs/etapa-12c-1-sqlite.md
?? electron/main/sqlite/
?? outputs/credito-impressao.pdf
?? outputs/credito-impressao.png
?? outputs/dashboard-financeiro.png
?? outputs/devolucao-simplificada.png
?? outputs/etapa-11-2/
?? scripts/test-sqlite.mjs
?? tests/sqlite-desktop.cjs
?? tests/sqlite-foundation.test.cjs
```
