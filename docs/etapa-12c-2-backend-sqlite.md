# Etapa 12C.2 — backend operacional Electron/SQLite

Data: 09/10/2026. Repositório `WarleCoutinho/warle-pdv`, branch `codex/react-pos-base`.
Base publicada inspecionada: `0021d26028c1eb2eef4a83ddf188671297e602c1` (12C.1).

## 1. Diagnóstico inicial

A branch estava correta; não havia alteração rastreada pendente. Os PDFs, imagens e `outputs/etapa-11-2/` preexistentes foram preservados. Foram lidos os relatórios 11.2, 12A, 12B, 12C.1 e o planejamento Electron/SQLite. Foram examinados contratos, composição, React, serviços financeiros, credenciais, backups, foundation SQLite, migrations, main, preload e testes.

React já depende de `createPdvApplication`/portas Promise. O adaptador web delega aos serviços estabilizados; localStorage mantém catálogo, configurações, vendas, caixa, ledger, rascunho e cópia de restauração. sessionStorage mantém a sessão web e grants ficam em memória; Web Locks serializa comandos financeiros. O SQLite 12C.1 já tinha 26 tabelas contando migrations, WAL/FULL/FK, transações síncronas, recuperação e requests duráveis, mas nenhum comando operacional.

## 2. Arquitetura implementada

```text
React → ApplicationContext → createPdvApplication
     → createElectronRepositories (seleção explícita)
     → preload.pdv [comandos permitidos]
     → IPC: origem + frame + WebContents + payload
     → OperationalBackend: autenticação + instalação + domínio
     → BEGIN IMMEDIATE → efeitos + resultado → COMMIT
```

`src/application/context.tsx` e `src/main.tsx` continuam compondo exclusivamente o web. O shell normal expõe a API tipada, mas rejeita operações SQLite com `UNSUPPORTED_OPERATION`. A validação exige simultaneamente aplicativo não empacotado, perfil absoluto explícito e `--raiz-sqlite-validation`. Essa chave habilita transporte de teste; não muda a composição React nem o estado da instalação. O teste desktop cria uma cópia temporária com composição Electron explícita, sem editar os arquivos operacionais.

O main importa os cálculos puros já aprovados de caixa, recebimentos, elegibilidade e centavos. O SQL coordena agregados; não existem métodos IPC para escrever linhas/tabelas isoladamente. O build usa o Vite já instalado para incluir domínio TypeScript em CommonJS; não foi instalada dependência adicional. Typechecking continua obrigatório antes de gerar main/preload.

## 3. Contratos alterados

- `CommandOptions.requestId` e identificador opcional em conclusão/resolução permitem repetição explícita.
- Reautenticação é capacidade opcional da porta de operadores.
- `OperationRecoveryRepository` expõe lista, consulta, reconhecimento e descarte de **intenção preparada sem efeitos**; não limpa dados comerciais.
- `requiresAuthenticatedReads` permite bootstrap com tela de login sem consultar dados privados antes da sessão.
- Operadores públicos têm `hasPassword`, sem verifier/salt/digest. Settings preserva a indicação visual de senha configurada no web e no Electron.
- Créditos públicos omitem `authCodeHash`; o tipo compartilhado permite essa ausência, mas o validador de armazenamento/backup web continua exigindo o hash existente.
- Emissão pode entregar código apenas no web ou marcar `printedByBackend` após impressão controlada no Electron. A tela de resolução abre o comprovante web somente quando recebe código. Nenhum dado financeiro fica salvo em duas fontes.

A API operacional possui DTO próprio para concluir venda: IDs de produtos, quantidades, expectativa de preço/total, pagamentos e caixa. O adaptador converte CartItem; não envia imagem, nome ou snapshot de catálogo como autoridade. Preço/total/troco efetivos vêm do main.

## 4. Adaptador Electron

`src/persistence/electron/createElectronRepositories.ts` implementa as portas existentes e publica notificações locais somente após respostas confirmadas. Login também atualiza o catálogo privado. Rascunho fica em memória no main, por janela; não grava ledger no navegador. Falhas propagam mensagens adequadas ao vendedor; erros incertos carregam `requestId` para conferência.

Backups nativos/importação/limpeza não foram simulados com localStorage. Essas portas retornam indisponibilidade explícita até o coordenador seguro da 12C.3. O adaptador web e backups v1/v2 permanecem integralmente funcionais. Esta diferença de capacidade não reduz os comandos financeiros implementados.

## 5. IPC e validações

Canais fixos `raiz:pdv:<comando>`:

| Grupo | Comandos |
|---|---|
| Operadores | authenticate, reauthenticate, current, logout, list |
| Catálogo/configuração | catalog.list/save, settings.read/update |
| Vendas | sales.complete/list/get/cancel |
| Caixa | cash.open/read/recordMovement/close |
| Financeiro | financial.snapshot/recordReturn/settle/updateRefund/recover |
| Créditos | credits.list/authorize/readMovements/printReceipt |
| Instalação | installation.read |
| Recuperação | operations.prepare/read/list/acknowledge/discardPrepared |
| Temporário | draft.read/save |

Não existem execute/query SQL, filesystem genérico, alteração de instalação, reset ou exclusão administrativa de operadores. Cada handler verifica janela proprietária, frame principal, origem e documento real. Inputs fechados rejeitam campos desconhecidos; números precisam ser inteiros seguros; strings/listas/imagens têm limites. Imagens aceitam PNG/JPEG/WebP/GIF base64 canônico, até 10 MiB, com limite agregado de transporte de 16 MB. Payload canônico de request financeiro permanece limitado pela foundation a 1 MiB.

Retornos contêm DTOs públicos da operação ou snapshot de consulta necessário, ou código de erro controlado, sem SQL, stack, caminhos, hashes, ciphertext ou código secreto. O preload oferece funções fixas; não expõe ipcRenderer ou invoke arbitrário.

## 6. Autenticação e autorização

PBKDF2-SHA256, salt aleatório de 16 bytes, 210.000 iterações e verifier de 32 bytes, equivalentes ao esquema web. Comparação via timingSafeEqual. Senhas não ficam em texto claro, request ou log. Cinco falhas por identidade normalizada em 15 minutos bloqueiam novas tentativas; a política também cobre reautenticação e códigos de crédito. Verificação de usuário inexistente executa derivação equivalente e produz erro sensível genérico.

Sessões ficam somente no main, associadas à conexão/janela, operador, banco/perfil e geração. Expiram após 30 minutos sem atividade ou 8 horas absolutas. Credencial, papel e atividade são reavaliados dentro da transação. Logout/navegação/destruição revogam sessão; alteração de credencial, desativação ou papel invalida o contexto. Grants de crédito duram no máximo cinco minutos e são removidos no logout, troca de contexto/caixa e consumo.

Reautenticação de até cinco minutos é exigida para administração, cancelamento, resolução, conclusão/falha de reembolso, fechamento e recuperação. É uma política mais restritiva que a web, justificada pela autoridade do main. A API de reautenticação está pronta; a interface atual também pode renovar essa evidência saindo e entrando com o mesmo operador. Não foi redesenhada a tela para o futuro assistente desktop.

Nenhum Admin/default password é criado no banco. `configureInitialAdministrator` é extensão **interna do main**, com credencial explícita, permitida apenas sem operadores e fora de production; não é IPC e não altera estado/geração. Testes usam somente perfis descartáveis.

## 7. Operações financeiras

- Venda: valida caixa de hoje e proprietário, consulta catálogo ativo, calcula linhas e total, verifica parcelas/troco, grants e disponibilidade descontadas reservas, gera numeração, grava venda/itens/pagamentos, reserva/consome créditos e registra autoria.
- Cancelamento: preserva itens/pagamentos, registra motivo/nota/autoria/data e restaura créditos uma vez. Motivo “outro” exige descrição. Não inventa saída financeira. Resoluções anteriores limitam a restauração elegível.
- Devolução: usa saleId/lineId, valida quantidades acumuladas, guarda snapshots, motivo e autor. Linhas repetidas do mesmo produto continuam separadas. Não devolve dinheiro automaticamente.
- Resolução: usa saldo elegível compartilhado; pending reserva elegibilidade, failed libera, completed externo altera fluxo. Crédito emitido mantém recebimento e cria passivo rastreável.
- Reembolso: só transita de pending para completed/failed. Espécie exige caixa atual e saldo físico. Modalidades eletrônicas podem ter líquido negativo. Histórico fechado permanece intacto.
- Crédito: origem, saldo e histórico; autenticação de código no main; reserva e consumo na mesma venda; restauração no cancelamento; constraints e validação de ledger impedem saldo negativo/duplicidade.
- Caixa: impede caixa de ontem do mesmo operador e caixa aberto na mesma data; outro operador pode abrir hoje quando a pendência é de outro. A venda não pode cair no caixa de ontem. Suprimentos/sangrias verificam dono, data e saldo. Fechamento calcula fingerprint, confere modalidades e grava snapshot/métodos imutáveis.

Preços editados não alteram vendas históricas. Produtos omitidos do catálogo são inativados; operadores existentes não podem ser removidos por atualização. Último administrador ativo com credencial é preservado.

## 8. Transações e schema

A migration 1 publicada não foi modificada. Migration 2 adiciona autoria/geração a requests e vendas, autoria de movimentos/refundos/fechamento, motivo de devolução, ciphertext de comprovante e índices. PK/FK/STRICT/constraints de centavos/quantidades e triggers de imutabilidade anteriores continuam ativos. Nenhum dado do navegador é importado pelo upgrade de schema.

Todos os efeitos de cada comando financeiro e seu resultado mínimo ficam na mesma transação síncrona BEGIN IMMEDIATE. O journal guarda a venda, evento, movimento ou sessão afetada, sem copiar todo o ledger/histórico a cada comando. Após o commit, o adaptador consulta o agregado atualizado para cumprir as portas 12A; são consultas, não uma sequência de escritas CRUD. Erro nessa leitura conserva o ID e permite recuperação. Um teste usa ledger maior que 1 MiB e confirma que o resultado durável permanece pequeno. Erro ou FK diferida inválida reverte ambos e não avança definitivamente a sequência. Não há Web Locks no backend SQL. Consultas autorizadas usam transação coerente com a validação da sessão.

## 9. Idempotência durável

Preparação registra somente intenção não secreta: requestId, tipo, hash canônico, operador, geração e estado `pending`/referência `prepared`. Não reserva saldo nem cria venda. O comando executa essa intenção e confirma efeitos + resultado juntos.

Uma resposta perdida deixa request não reconhecido. Ao reconstruir o adaptador/reiniciar, prepare com os mesmos dados recupera o identificador existente. Mesmo request/tipo/conteúdo retorna o resultado confirmado sem repetir efeito. Reuso com outros dados dá conflito. Outro operador ou geração é recusado **antes** da consulta/retorno idempotente.

Depois da resposta (e da impressão quando há emissão), o adaptador reconhece o resultado. Nova operação intencional pode então obter novo ID. Dados diferentes enquanto há intenção incerta são bloqueados; não é criado ID novo para contornar timeout. Falha de domínio só libera intenção após consultar o main e comprovar estado preparado sem efeitos. Descarte explícito conserva a linha como interrompida/reconhecida e é proibido para operação confirmada ou com reserva.

Credenciais/códigos/grants não entram no hash ou resultado durável. Parâmetro requestId fornecido explicitamente é preservado. Chamadores diretos da API devem reconhecer resultados consultados; a porta Electron faz essa coordenação automaticamente.

## 10. Concorrência

Testes executam writers reais em worker threads, cada um com sua própria conexão SQLite ao mesmo arquivo e sessão autenticada. Cobrem mesma venda, disputa do mesmo crédito, cancelamento, reembolso e fechamento simultâneos. WAL permite leitores; writer lock serializa validação e efeitos. SQLITE_BUSY retorna erro sem repetir callback/efeito; reenvio explícito usa o mesmo ID. Índices únicos protegem número e movimentos/snapshots.

## 11. Recuperação

Queda antes do commit não deixa venda, itens, pagamentos, reserva, baixa, request confirmado ou avanço de número. Queda depois do commit conserva resultado recuperável. Tests encerram processo real do Electron/Node nos dois pontos.

Reservas órfãs de requests não confirmados são liberadas de modo auditado. Reserva ligada a venda confirmada precisa coincidir com pagamentos; consumo já existente é reconhecido uma vez, consumo ausente pode ser conciliado com saldo e autoria, e venda cancelada exige restauração compatível. Divergência ambígua/ledger inválido bloqueia recuperação e comandos financeiros. Não se conclui request interrompido por adivinhação. Intenções preparadas sem efeito permanecem separadas dessa recuperação.

## 12. Estado da instalação

- testing: operações autorizadas, com administrador/configuração explícitos e mesmas invariantes.
- ready_for_setup: configuração autorizada; comandos financeiros e replay ficam bloqueados.
- production: operações autorizadas e configuração válida; nenhuma API de retorno, reset ou mudança arbitrária.

Sessão e request de geração antiga são recusados. Não foi feita ativação automática, troca de estado, reinicialização de sequência ou limpeza real.

## 13. Conformidade web/SQLite

Suíte atravessa `createWebRepositories` e `createElectronRepositories`, usando SQLite real do Electron. Compara vendas/parcelas, receita, recebimentos, totais esperados, devoluções, reembolsos, saldos/movimentos e snapshots; ignora IDs/datas internos/fingerprint de transporte.

Cobertura: dinheiro/troco, PIX, débito/crédito, divisão, suprimento/sangria, cancelamento sem/pending/completed, devolução parcial/integral, reembolso eletrônico negativo, emissão, uso parcial/integral, parcela de crédito + recebimento externo, restauração, failed e nova resolução, fechamento e tentativas duplicadas. Recuperação/restart e imutabilidade têm provas específicas para o SQL e regressões anteriores para o web.

Diferenças deliberadas: SQL tem idempotência durável, credenciais privadas e reautenticação mais restritiva; web conserva a política publicada de locks/recuperação. Repetição explícita do mesmo ID SQL devolve resultado; uma segunda intenção independente de cancelamento é recusada em ambos. Campos de autoria e caixa da emissão são mais completos no SQL, sem mudar cálculos.

## 14. Segurança e comprovantes

Sandbox/contextIsolation/webSecurity continuam ativos; Node permanece desabilitado no renderer. CSP, navegação, permissões, single-instance/perfil e diagnóstico 12B/12C.1 permanecem.

Para atender “não devolver códigos secretos”, o código não é retornado nem na emissão. O main mantém verifier SHA256 e ciphertext do comprovante usando safeStorage. No Windows a proteção usa DPAPI, vinculada ao usuário do sistema; não protege contra outro programa comprometido executado pelo mesmo usuário. Provedor indisponível/inseguro bloqueia emissão, sem fallback em texto claro.

`credits.printReceipt` verifica sessão recente e autoria/admin, decripta somente no main e prepara documento em janela isolada, invisível, sem preload, Node, permissões ou acesso de rede. Protocolo privado da sessão recebe URL aleatória **sem código na URL**. O renderer operacional recebe apenas sucesso/erro de impressão. Cancelar/falhar impressão não repete emissão; o mesmo request recupera o crédito e permite reimpressão autorizada. O marcador `printedByBackend` só aparece após callback de impressão bem-sucedido.

Referências: [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [webContents.print](https://www.electronjs.org/docs/latest/api/web-contents#contentsprintoptions-callback).

## 15. Testes executados

Validação final em 09/10/2026, depois do ajuste de resultados compactos no journal: todos os comandos abaixo terminaram com código 0.

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | TypeScript da aplicação e do Electron aprovado. |
| `npm run test:all` | 120 testes Node, 97 testes SQLite, quatro suítes UI e build web aprovados. |
| `npm run test:sqlite` | 97/97 aprovados, sem falhas, skips ou cancelamentos. |
| `npm run build:desktop` | Build web e main/preload aprovados; executado também como pré-requisito de test:desktop. |
| `npm run test:desktop` | Web sem API, Electron development/production, launcher, cinco diagnósticos de startup, isolamento de perfis, corrupção/inacessibilidade e composição operacional SQLite aprovados. |

O teste operacional desktop executou login, abertura de caixa, venda pela interface com dupla submissão, persistência após restart, IPC rigoroso, emissão de crédito com safeStorage/DPAPI e PDF em renderer isolado. A regressão UI verificou atualização entre abas, cálculos financeiros, créditos, impressão/Esc e estados assíncronos. A prova de journal acima de 1 MiB confirmou resultado mínimo e replay sem duplicação.

Falhas encontradas nas rodadas incrementais foram investigadas e corrigidas: parâmetros SQL, fixtures da migration 1, compatibilidade do motivo de cancelamento, encerramento de workers no Windows, atualização do catálogo após login e consulta de crédito esgotado. Nenhum teste foi removido para aprovar a suíte. O aviso experimental de node:sqlite vem do runtime Electron utilizado e não causou falhas. Impressora física não foi exercitada.

Comandos requeridos: `npm run typecheck`, `npm run test:all`, `npm run test:sqlite`, `npm run build:desktop`, `npm run test:desktop`. Não se considera uma rodada anterior evidência do código modificado posteriormente.

## 16. Limitações conhecidas

- SQLite permanece desligado na composição operacional. O flag de validação não é ativação comercial.
- Sessões/grants e limites de tentativas ficam no main em memória; reinício encerra sessões e reinicia a janela de tentativas. Não são tokens persistidos no renderer.
- Rascunho nativo é temporário por janela; reinício do main não fornece carrinho persistente. Requests financeiros são duráveis e recuperáveis independentemente disso.
- Catálogo/configuração são atualizações administrativas de agregado; não foi criado editor multioperador com controle otimista de versão.
- Backup/restauração nativos e assistente de reautenticação/ativação não foram simulados. Há API de recuperação/reautenticação para a composição futura.
- Impressão física depende da impressora e do diálogo Windows. Automatização verifica o mesmo documento com printToPDF e isolamento real; não afirma envio a uma impressora física.
- Autoridade backend e constraints não impedem adulteração por usuário com acesso direto ao arquivo/banco. Integridade/schema são verificados, divergências detectadas bloqueiam efeitos; proteção do equipamento/perfil continua necessária.

## 17. Arquivos modificados

Criados: `electron/shared/operational.ts`; `electron/main/validation.cts`, `ipc.cts`, `credit-printing.cts`; `electron/main/sqlite/auth.cts`, `backend.cts`, `read-model.cts`, `operational-schema.cts`; `src/persistence/electron/createElectronRepositories.ts`, `errors.ts`; `scripts/build-electron.mjs`; suítes `tests/sqlite-backend`, `sqlite-security`, `sqlite-credits`, `sqlite-concurrency`, `sqlite-conformance`, `sqlite-recovery`, `sqlite-ipc` e teste `sqlite-operational-desktop`, além dos helpers de perfil/vault/worker; este relatório.

Modificados: main/preload/contratos Electron; foundation/errors/migrations; portas/tipos/coordenação/bootstrap; SettingsPage e SaleFinancialPanel; scripts/package/tsconfig; smoke desktop e testes foundation (rodando explicitamente a versão 1 para conservar suas provas); README e planejamento/relatório de contratos. Nenhum arquivo operacional removido. Arquivos gerados não fazem parte da entrega e evidências preexistentes foram preservadas.

## 18. Pendências da 12C.3

1. Assistente explícito para administrador/estabelecimento, configuração inicial e ativação autorizada; sem senha padrão.
2. Definir seleção de um único backend depois de validar/importar, sem dual-write ou alteração automática do browser.
3. Importador v1/v2 no main: validar checksum/versão/IDs/centavos/relações/lineId opcional e reservas; guardar cópia externa consistente e journal; aplicar conjunto completo numa transação, preservando histórico e falhas recuperáveis.
4. Mapear campos antigos opcionais sem inventar recebimentos, autoria, pagamentos ou reembolsos. Fechamentos antigos precisam conservar JSON e semântica original, inclusive ausência de resumo v2; não devem ser reinterpretados pelo mapper moderno.
5. Copiar verificadores PBKDF2/crédito com normalização explícita e sem devolvê-los à UI. Crédito legado tem só verifier; não inventar/alterar código ou ciphertext. Planejar impressão após apresentação/autorização válida do código original e política administrativa de autoria legada.
6. Backup nativo seguro pelo main e escolha explícita de arquivo; ciphertext DPAPI não é portabilidade automática para outro Windows/usuário.
7. Completar UI de reautenticação/conferência de requests incertos e política de rascunho durável, utilizando as portas prontas.
8. Implementar “Preparar para uso oficial” somente com autorização, backup externo consistente, dupla confirmação/frase, geração nova e exclusão transacional planejada dos dados fictícios. Sequência volta a 1 somente nessa nova geração. Testar proteção de production e falha antes/depois do commit.

A 12C.3 não foi iniciada. Não houve migração/importação real, limpeza, ativação automática, commit ou push nesta etapa.
