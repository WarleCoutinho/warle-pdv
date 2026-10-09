# Raiz PDV — Etapa 12C.3

Migração, backups e ativação operacional SQLite. Branch `codex/react-pos-base`; base inspecionada `bc88261cbfcb644f8ee796e50d0f96c0b2c34466` (12C.2). Data: 09/10/2026. Implementação local aguardando revisão; sem commit/push.

## 1. Diagnóstico inicial

A 12C.2 já oferecia backend transacional, autoria, verificadores, reservas, requests duráveis e impressão no main, mas o aplicativo normal usava web. SQLite operacional era exercitado por composição de teste. Faltavam importador, cópia nativa recuperável, assistente inicial, ativação e preparação oficial integrados.

Foram examinados os relatórios 11.2, 12A, 12B, 12C.1, 12C.2 e preparação Electron/SQLite, contratos, composição, serviços financeiros, validadores v1/v2, migrations, autenticação, impressão, instalação e suítes. Estado inicial rastreado limpo. Arquivos preexistentes em `outputs/` foram preservados.

## 2. Arquitetura final

React → aplicação/contratos → adaptador Electron → preload tipado → IPC validado → backend/coordenador de ciclo de instalação no main → SQLite. O coordenador compõe os algoritmos financeiros existentes; não os duplica. Importação reutiliza validação pura dos backups web.

`LifecycleCoordinator` coordena setup, importação, provas de backup, restauração, exclusão de teste e transições. `native-backup` executa cópia online, criptografia e recuperação isolada. `web-import` traduz registros validados dentro de uma transação e confere o resultado.

## 3. Seleção de backend

A composição escolhe Electron somente quando existe o preload confiável; navegador continua `createWebRepositories()`. O Electron normal publica o transporte SQLite sem flag de validação. Diagnóstico de inicialização não expõe preload operacional nem comandos financeiros. Não há fallback financeiro web no Electron, dual-write ou sincronização automática.

Há uma leitura explícita de chaves legadas do próprio perfil Electron, solicitada pelo administrador. Não há acesso a perfil externo de Chrome/Edge. Para navegador externo, exportar JSON e selecionar arquivo.

## 4. Banco operacional e migrations

Build local: `%APPDATA%\Raiz PDV\data\raiz-pdv.sqlite`. Desenvolvimento: `data\development\raiz-pdv.sqlite`. O modo de diretório é independente do estado comercial `testing/ready_for_setup/production`. Testes usam perfis temporários.

Migrations 1 e 2 permanecem intactas. Migration **3**, `lifecycle-schema.cts`, acrescenta identidade estável da instalação, auditoria técnica, rascunhos por operador/geração, JSON original legado e marcador de linha histórica sem ID. Não cria venda, credencial ou dados comerciais. Mantém chaves estrangeiras, STRICT, INTEGER em centavos e triggers históricos.

## 5. Backup nativo

`node:sqlite.backup()` usa a API online SQLite e inclui transações confirmadas no WAL. Não copia apenas o arquivo ativo. Uma cópia privada é aberta, validada e fechada antes da embalagem. O arquivo `.raizbackup` contém manifesto com identidade, geração, schema, SHA-256 do banco e fingerprint lógico, além de conteúdo cifrado autenticado.

O destino é escolhido em diálogo nativo, canônico e fora do perfil. Arquivo existente exige confirmação nativa própria e sua versão anterior é preservada. A escrita temporária usa criação exclusiva e fsync; publicação sem sobrescrita usa hard link. Falha de cópia ou publicação não informa sucesso.

Criado, verificado e recuperável são estados confirmados somente após abrir a cópia em perfil temporário real. A prova para operação destrutiva é privada ao main, vinculada à janela/geração/fingerprint; alterações posteriores tornam a prova obsoleta. Nesse caso, criar novo backup.

## 6. Restauração

Exige administrador, senha recente, seleção nativa, confirmação nativa e backup preventivo externo validado. O arquivo selecionado é decifrado e recuperado isoladamente; schema, identidade, geração, relações financeiras, saldos e integridade são conferidos. Arquivo futuro, adulterado ou sem segredo correto é rejeitado.

Instalações com dados comerciais não recebem arquivo de identidade estrangeira. Uma instalação nova pode receber backup de outra identidade, adotando-a. Produção não recebe backup de testes/preparação. A geração resultante é maior que a atual e a do backup; sessões, grants e rascunhos não são restaurados como autorizações válidas.

O banco atual é bloqueado, WAL consolidado e conexão fechada antes de substituição. Um journal durável registra nomes internos controlados de candidato/anterior. O anterior permanece preservado. No próximo início, uma troca interrompida recupera banco válido; candidato corrompido não confirmado permite retorno ao anterior validado, preservando o arquivo com falha. Falha sem anterior válido bloqueia, sem criar banco vazio.

## 7. Portabilidade de créditos

O arquivo inteiro, inclusive verificadores de operadores e códigos recuperáveis, é cifrado com AES-256-GCM. A chave é derivada por scrypt (N=32768, r=8, p=1, salt aleatório de 16 bytes); IV de 12 bytes e tag de 16 bytes. Manifesto é autenticado como AAD. Senha de recuperação explícita de 12 a 128 caracteres; não é gravada no arquivo ou perfil. Guarde-a separadamente. Perda da senha impede recuperação.

Códigos nativos são decifrados somente no main, conferidos com o verificador e incluídos no payload cifrado. No destino são novamente protegidos pelo vault atual (safeStorage/DPAPI no Windows). Não se presume que ciphertext DPAPI antigo seja portável. Código e verificadores não retornam ao renderer.

Crédito legado sem ciphertext mantém ID, saldo, verificador e movimentos. O cliente apresenta o código original; em Configurações, administrador informa referência/código, backend autentica, protege o mesmo código e imprime pelo main. Não há emissão de código novo nem mudança de saldo. Código perdido não pode ser reconstruído do hash.

## 8. Importação web v1/v2

Disponível no assistente de instalação vazia. Diálogo seleciona JSON; arquivo original permanece intocado. Valida formato/versão/checksum, centavos seguros, IDs, linhas, pagamentos, vínculos, caixa, crédito, movimentos, reservas e fechamento. Sem merge ou substituição por coincidência de ID.

Preview privado mantém conteúdo e digest no main. Após conferência e backup preventivo, todos os agregados são importados em uma transação. Erro desfaz catálogo, finanças e histórico juntos. Importação concluída deixa `ready_for_setup`; produção exige administrador e configuração válidos. Backup v1 não ganha ledger fictício.

## 9. Conferência financeira

Antes/depois são comparados produtos, categorias normalizadas, operadores, vendas/itens/pagamentos, sessões/movimentos, cancelamentos, devoluções/reembolsos, créditos/movimentos/reservas e fechamentos. Também receita, recebimentos por modalidade, reembolsos externos concluídos, créditos emitidos/consumidos/restaurados, saldo e próxima numeração.

Comparação exata em centavos; divergência aborta transação. Resumo aparece na interface e resultado técnico com digest/totais fica auditado. Cancelamento exclui receita sem presumir reembolso. Crédito emitido não diminui recebimento. Uso de crédito não duplica recebimento externo. Reembolso pendente não reduz caixa. Modalidade eletrônica negativa permanece permitida.

## 10. Dados legados

Sem operador/caixa/produto atual, vínculos nullable permanecem NULL; snapshots de nome/preço são preservados. Linhas sem `lineId` recebem ID interno determinístico para integridade SQL, mas a consulta pública preserva ausência original. O JSON original é guardado em `legacy_records`.

Devolução antiga só é vinculada quando existe uma única linha compatível com ID/snapshot/valor. Ambiguidade bloqueia importação; suporte deve esclarecer origem, sem atribuir arbitrariamente. Nomes de categorias são normalizados para unicidade (trim e caixa), conforme catálogo SQL; nomes históricos dos produtos/vendas e JSON original não são reescritos.

Fechamento antigo é lido do JSON original completo: conferência, valores, fingerprint e ausência de resumo v2 são preservados. Colunas escalares internas não são usadas para fabricar resumo moderno. Triggers continuam impedindo alteração/exclusão histórica fora da manutenção transacional.

## 11. Configuração inicial

Assistente solicita estabelecimento, endereço/telefone/rodapé, nome e usuário administrativo, senha/confirmar senha e finalidade. Não oferece usuário/senha padrão. Resumo e confirmação explícita precedem gravação.

Admin, verificador, estabelecimento, estado e auditoria são gravados juntos. Queda antes do commit deixa instalação não configurada; depois do commit reconhece configuração inteira. Após importação sem administrador, cadastro explícito do primeiro mestre também executa recuperação financeira no mesmo commit antes da ativação.

## 12. Ativação oficial

Instalação nova pode ser configurada explicitamente como testes ou produção. Importada/preparada exige produção. Importação com administrador existente pede login desse administrador e confirmação do relatório; recupera reservas e valida ledger antes da transição.

Não há transição comum de produção para testing/ready_for_setup. Produção inconsistente sem administrador ativo/estabelecimento bloqueia operação; não apresenta bootstrap que contorne a proteção.

## 13. Preparar para uso oficial

Somente testing, na área administrativa. Mostra impacto, quantidades de produtos/operadores/vendas/caixas/créditos, faturamento e saldo. Exige administrador ativo, reautenticação recente, checkbox explícito, frase exata `ZERAR RAIZ PDV`, segunda confirmação independente em diálogo nativo, backup externo recuperável e nenhuma intenção financeira pendente.

Exclusão abrange categorias, produtos/imagens, configuração, operadores/credenciais, caixa/movimentos, vendas/itens/pagamentos/cancelamentos, devoluções/itens/reembolsos, créditos/movimentos/reservas, requests/eventos/importações operacionais, fechamentos/métodos, rascunhos e JSON legado. Estrutura, migrations, identidade, backup externo e auditoria técnica permanecem.

O ciclo entre crédito/reembolso é desfeito somente dentro da transação de exclusão. Triggers históricos são removidos e recriados no mesmo commit; rollback restaura dados e proteções. Não há manutenção exposta como SQL no renderer.

## 14. Reset e geração

Mesmo commit limpa dados, incrementa geração, define ready_for_setup e próxima venda 1. Sessions/grants/provas/previews são invalidados. Após nova geração, comandos financeiros precisam de intenção preparada pelo backend atual; mensagens atrasadas com ID antigo não criam operações. Só após novo cadastro de estabelecimento/admin habilita comércio. Primeira venda nova é 1; produção não reinicia numeração.

## 15. Recuperação de operações

Request durável preparado antes do envio, vinculado a autor/payload/geração. Resposta perdida conserva o mesmo ID, inclusive após reinício da composição. A interface oferece conferência: consulta resultado confirmado, reconhecimento explícito, ou descarte somente de intenção preparada sem efeito. Registro interrompido não é repetido sob ID novo.

Reconhecimento de emissão reimprime crédito pelo main antes de finalizar. Venda reconhecida remove somente rascunho correspondente e anterior ao commit; carrinho diferente/mais novo é preservado. Recuperação de reservas mantém evidências, não inventa venda. Falha de impressão não reemite crédito.

## 16. Reautenticação

Ações sensíveis usam autorização e tempo no main. Ao expirar, diálogo solicita senha do operador conectado; cancelamento aborta. Adaptador repete a mesma ação/ID após confirmação, uma vez. Senha fica em memória transitória e é limpa; não vai para localStorage, journal, backup sem criptografia ou logs. Trocar operador não autoriza a intenção anterior.

## 17. Rascunhos

SQLite persiste apenas produto ID/quantidade por operador/geração. Reinício reconsulta catálogo e preços ativos, descarta itens indisponíveis e avisa que valores foram atualizados. Não salva autorização de crédito, pagamento ou reserva e não conclui venda sozinho. Esvaziar carrinho é ação explícita; preparação/restauração invalidam rascunhos antigos.

## 18. Segurança

Sandbox/contextIsolation/Node desabilitado, origem/frame/janela, CSP, navegação e instância única preservados. Nomes e payloads IPC fechados, tipados e validados. Renderer não escolhe caminhos internos, SQL, generation ou `isAdmin`. Diálogos de arquivo e segunda confirmação pertencem ao main. Manutenção exclui comandos concorrentes e bloqueia conexão com snapshot WAL ativo.

Limites: JSON web 10 MB, arquivo nativo 512 MB; segredo 12–128 caracteres. Erros expostos usam mensagens/códigos seguros, sem caminhos ou segredos. O vault precisa estar disponível para cópia portátil de códigos nativos.

## 19. Testes executados

Executados após a última alteração funcional, em 09/10/2026:

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | Aprovado (React e Electron) |
| `npm run test:all` | Aprovado: 120 testes Node/contratos, 124 SQLite, 4 campanhas UI e build web |
| `npm run test:sqlite` | Aprovado novamente: 124 testes; 0 falhas/skip |
| `npm run build:desktop` | Aprovado: renderer, main, preload e domínio compartilhado |
| `npm run test:desktop` | Aprovado: smoke web/dev/produção, launcher, falhas de startup, instância única/perfis/diagnóstico, financeiro/impressão DPAPI/PDF e lifecycle UI v1/v2 |
| `git diff --check` | Aprovado |

Os avisos de APIs experimentais SQLite/MockTimers do runtime não foram falhas. Durante a implementação, testes detectaram inserções com número de colunas antigo, ordem de exclusão com FK e necessidade de verificar existência real da cópia antes da publicação; foram corrigidos e as suítes completas repetidas. Uma espera de UI usava texto incompleto do feedback; o seletor foi corrigido sem alterar a cobertura. Não há comando obrigatório pendente.

Suítes antigas preservadas. Novos cenários exercitam main real/SQLite, backup WAL, segredo errado/adulteração, nova chave de custódia, v1/v2, devolução parcial/reembolso pendente e concluído, legados, setup, geração, concorrência, produção, rollback/triggers, falhas reais de processo e substituição corrompida. Electron Playwright usa app normal sem flag, interfaces reais e perfis descartáveis; cobre primeira venda 1 após preparação, conferência/descarte de intenção sem efeito, reconhecimento de resultado confirmado, retomada explícita de rascunho e migração de ambos os formatos v1/v2; diálogos de arquivos/respostas de confirmação são controlados somente no harness.

## 20. Limitações

Não foi feito teste com outro usuário Windows físico: portabilidade é testada entre chaves distintas e perfis novos; DPAPI real é exercitado no Electron atual. Impressão é conferida em janela isolada/PDF; nenhuma impressora física foi validada. Queda de processo foi testada, não corte físico de energia/falha de hardware. Não é instalador Windows distribuído; execução local compilada continua pelos scripts existentes.

Criptografia/validação de arquivos grandes ocorre no main e pode demorar; limites evitam arquivos ilimitados, mas não são benchmark de capacidade. Não há merge entre lojas. Senha de recuperação perdida e código legado perdido têm limitações explícitas.

## 21. Arquivos criados e modificados

Novos: `electron/main/lifecycle-ipc.cts`, `electron/main/sqlite/{lifecycle-schema,lifecycle,native-backup,web-import}.cts`, `electron/shared/lifecycle.ts`, `src/application/reauthentication.ts`, `src/components/DesktopManagement.tsx`, `tests/sqlite-lifecycle.test.cjs`, `tests/sqlite-lifecycle-desktop.cjs`, `tests/helpers/lifecycle-crash.cjs` e este documento.

Modificados: main/index/ipc/validation; sqlite/auth/backend/database/errors/installation/migrations/read-model; shared/operational; package.json/scripts/test-sqlite; App/application/context; PosPage/SettingsPage/styles; contracts e adaptador/errors Electron; export da validação pura backupStorage; desktop-launcher/electron-smoke/sqlite-desktop/sqlite-recovery; README, preparação e documentação dos contratos 12A. Nenhum arquivo removido, dependência acrescentada ou migration publicada reescrita. Artefatos de build/teste permanecem ignorados; outputs preexistentes não são parte da implementação.

## 22. Guia do administrador e suporte

1. **Primeira instalação:** compilar com `npm run build:desktop`, abrir `npm run start:desktop`. Escolher cadastro novo ou migração; informar estabelecimento e credencial própria. Para ensaios, escolher Testes; para começar oficialmente vazio, Operação oficial. Guardar credencial administrativa.
2. **Migrar navegador:** exportar backup JSON completo na instalação web; abrir aplicativo novo, selecionar v1/v2, conferir resumo/avisos, escolher senha de recuperação e criar backup externo da instalação vazia. Confirmar/importar; conferir resultado. Autenticar administrador importado ou cadastrar mestre explícito se o arquivo não contém um. Só então ativar produção. Manter JSON original.
3. **Backup periódico:** Configurações → senha de recuperação → Criar backup externo; guardar fora do perfil e copiar para mídia externa. Conferir os três estados e contagem de códigos legados. Verificar backup abre cópia isolada novamente. Guardar segredo separadamente; não enviar códigos/senhas em chamado de suporte.
4. **Restaurar:** interromper atendimento, entrar como administrador, usar a senha do arquivo selecionado e criar primeiro um backup preventivo com essa mesma senha (o formulário atual usa um segredo por fluxo). Selecionar Restaurar, escolher arquivo nativo e confirmar diálogo. Reiniciar/login com credencial da cópia. A geração é renovada, o anterior preservado. Uma instalação nova deve cadastrar admin para autorizar restauração de outra máquina; não cadastrar produtos/vendas antes.
5. **Preparação oficial após ensaios:** conferir/resolver operações pendentes, abrir Configurações como mestre, criar novo backup externo, conferir o resumo, marcar ciência, digitar frase e confirmar diálogo nativo. Assistente reaparece; cadastrar novo estabelecimento/admin. Primeira venda será 1. Produção não oferece essa limpeza.
6. **Produção:** operar com senha própria, caixa por operador/dia e rotinas usuais. Manter backups verificáveis e senha externa. Reautenticar quando solicitado. Em resultado incerto, conferir painel, sem criar venda substituta; conferir comprovantes e reconhecer.
7. **Crédito legado:** solicitar comprovante original do cliente; validar referência/código na ferramenta administrativa. Não tentar reconstruir código do verificador ou emitir outro para compensar saldo.
8. **Diagnóstico/falha:** fechar instâncias; preservar perfil inteiro, arquivos `.sqlite`, `-wal`, `-shm`, journal/anterior/candidato e backup externo. Não apagar/reinicializar arquivos para resolver mensagem. Suporte trabalha em cópia privada, verifica integridade/schema/generation e comparação financeira. Se novo arquivo interrompido falhar, inicialização usa anterior validado; falha sem anterior válido permanece bloqueada.

Referências técnicas primárias: [API SQLite online backup do Node](https://nodejs.org/api/sqlite.html), [criptografia do Node 24](https://nodejs.org/download/release/v24.21.0/docs/api/crypto.html), [diálogos nativos Electron](https://www.electronjs.org/docs/latest/api/dialog) e [safeStorage Electron](https://www.electronjs.org/docs/latest/api/safe-storage).

## 23. Riscos remanescentes e status da entrega

Backup não substitui guarda da senha nem proteção contra perda simultânea de disco/mídia. DPAPI no mesmo Windows e testes com vaults distintos fornecem evidência de mecanismo; ensaio em outra máquina/identidade e impressão física devem ser feitos antes de homologação do equipamento. Publicação de arquivo depende de filesystem local com hard links/rename; falhas são propagadas e cópias preservadas. Journals, candidatos e anteriores preservados exigem política futura de retenção após confirmação, sem limpeza automática nesta entrega.

Git final: arquivos rastreados modificados e novos arquivos da implementação/documentação/testes; outputs preexistentes preservados, nenhum arquivo staged. Branch e HEAD base mantidos. Não houve dual-write, mudança de backend web, limpeza/importação/migração de dados reais, commit ou push. Aguardando revisão e autorização de publicação.


### Git status final

```text
 M README.md
 M docs/etapa-12a-persistencia.md
 M docs/preparacao-electron-sqlite.md
 M electron/main/index.cts
 M electron/main/ipc.cts
 M electron/main/sqlite/auth.cts
 M electron/main/sqlite/backend.cts
 M electron/main/sqlite/database.cts
 M electron/main/sqlite/errors.cts
 M electron/main/sqlite/installation.cts
 M electron/main/sqlite/migrations.cts
 M electron/main/sqlite/read-model.cts
 M electron/main/validation.cts
 M electron/shared/operational.ts
 M package.json
 M scripts/test-sqlite.mjs
 M src/App.tsx
 M src/application/context.tsx
 M src/pages/PosPage.tsx
 M src/pages/SettingsPage.tsx
 M src/persistence/contracts/index.ts
 M src/persistence/electron/createElectronRepositories.ts
 M src/persistence/electron/errors.ts
 M src/services/backupStorage.ts
 M src/styles.css
 M tests/desktop-launcher.cjs
 M tests/electron-smoke.cjs
 M tests/sqlite-desktop.cjs
 M tests/sqlite-recovery.test.cjs
?? docs/etapa-12c-3-ativacao-sqlite.md
?? electron/main/lifecycle-ipc.cts
?? electron/main/sqlite/lifecycle-schema.cts
?? electron/main/sqlite/lifecycle.cts
?? electron/main/sqlite/native-backup.cts
?? electron/main/sqlite/web-import.cts
?? electron/shared/lifecycle.ts
?? outputs/credito-impressao.pdf
?? outputs/credito-impressao.png
?? outputs/dashboard-financeiro.png
?? outputs/devolucao-simplificada.png
?? outputs/etapa-11-2/
?? src/application/reauthentication.ts
?? src/components/DesktopManagement.tsx
?? tests/helpers/lifecycle-crash.cjs
?? tests/sqlite-lifecycle-desktop.cjs
?? tests/sqlite-lifecycle.test.cjs
```

Branch `codex/react-pos-base`; HEAD `bc88261cbfcb644f8ee796e50d0f96c0b2c34466`. Index vazio; sem commit/push. As duas migrations publicadas não possuem diff.
