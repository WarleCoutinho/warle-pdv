# Raiz PDV — Etapa 12B: estrutura Electron

Data: 09/10/2026. Branch: codex/react-pos-base. Base: b617ae2 (Etapa 12A).

## A. Diagnóstico inicial

A branch foi confirmada e o trabalho existente preservado. Não havia código pendente; havia imagens/PDFs e outputs/etapa-11-2 não rastreados, mantidos intactos. Foram examinados os documentos das Etapas 11.2 e 12A, planejamento SQLite, composição da aplicação, contratos/adaptador web, scripts e testes. O renderer já usa serviços de aplicação e contratos Promise; os mecanismos financeiros continuam nos serviços web. O servidor Vite existente não foi encerrado.

## B. Arquitetura implementada

- electron/main/index.cts: ciclo de vida, janela, protocolo, sessão e IPC.
- electron/main/security.cts: políticas explícitas e testáveis de origem, caminhos, rede, downloads e payload.
- electron/preload/index.cts: ponte mínima sandboxed, sem imports locais em runtime.
- electron/shared/contracts.cts: tipos compartilhados, sem API financeira.
- src/types/desktop.d.ts: API opcional para o renderer; navegador continua independente dela.
- tsconfig.electron.json: compilação NodeNext/CommonJS separada em dist-electron.
- scripts/dev-desktop.mjs: compilação e coordenação Vite/Electron, preservando servidor já existente.

A janela tem título Raiz PDV, dimensão inicial 1280×900, mínimo 1024×720 e maximização normal. Fechar a última janela encerra o processo. Main/preload não usam hot reload: reiniciar o comando após alterações; React mantém HMR em desenvolvimento.

## C. Segurança

contextIsolation, sandbox e webSecurity permanecem habilitados; nodeIntegration, conteúdo inseguro e webview ficam desabilitados. Não há remote ou exposição de Node, arquivos, SQL, ipcRenderer ou invocação genérica. Não há DevTools aberto automaticamente.

Produção usa o protocolo raiz://app, registrado como padrão e seguro, sem bypass de CSP. Só index.html e assets com extensão/nome permitidos em dist são servidos; consultas, hosts alternativos, caminhos arbitrários e traversal são rejeitados. O desenvolvimento aceita exclusivamente http://127.0.0.1:5173/ e o WebSocket desse servidor. Configuração de desenvolvimento é rejeitada quando empacotado.

CSP limita scripts e conexões à origem autorizada; produção não permite script inline ou eval. Estilos inline permanecem permitidos por compatibilidade com a interface existente; apenas desenvolvimento permite os scripts inline exigidos pelo Vite. Frames, objetos e workers são bloqueados. Navegação, redirects, novas janelas, webviews e permissões são restritos. Não há abertura automática de links externos.

O único download permitido é backup JSON com nome esperado, MIME JSON, blob da origem confiável e gesto do usuário. O diálogo nativo permite escolher destino; o aplicativo não fornece escrita arbitrária de arquivos ao renderer.

## D. API e validação IPC

window.raizDesktop.getAppInfo() retorna somente { name: 'Raiz PDV', version, environment: 'desktop' }. A ponte valida/copía o DTO e propaga erro genérico. O main verifica WebContents proprietário, frame principal, origem real do frame, URL do frame/documento e ausência de argumentos. Emissor estrangeiro, payload indevido e canais não registrados são rejeitados. Não existem comandos financeiros por IPC nesta etapa.

## E. Persistência e compatibilidade

Navegador e Electron continuam usando createWebRepositories, sem alteração de contratos, chaves, centavos, vendas, créditos, reembolsos, reservas, Web Locks ou snapshots. Não há transferência automática de dados. Backups v1/v2 e recuperação permanecem nos serviços estabilizados, exercitados pela regressão anterior.

No Windows, userData e sessionData são definidos antes da criação da sessão em %APPDATA%\Raiz PDV. Partições persistentes raiz-development e raiz-desktop separam desenvolvimento do build local. O navegador mantém seu próprio perfil. Sessões de operadores continuam em sessionStorage e não sobrevivem ao reinício. A opção absoluta --raiz-profile serve à execução local/testes, é rejeitada quando empacotado e não é exposta ao renderer.

localStorage continua sem atomicidade real entre múltiplas chaves. Esta etapa não transforma a autenticação local em proteção contra alteração dos arquivos por um usuário com acesso ao computador.

## F. Scripts e execução

npm run dev mantém a versão web. npm run dev:desktop compila main/preload, reutiliza Vite válido na porta 5173 ou inicia seu próprio servidor, e abre Electron. npm run build:desktop compila renderer e Electron; npm run start:desktop carrega o build local sem Vite. npm run typecheck valida os dois projetos. npm run test:desktop:production permite testar apenas o build local, sem servidor web.

Electron 44.7.0 e @types/node 22.20.5 foram adicionados como dependências de desenvolvimento. Não foram instalados SQLite, builders de instaladores ou pacotes de IPC. O download inicial do binário Electron foi concluído antes dos testes gráficos. npm audit não apontou vulnerabilidades na instalação.

## G. Testes e diagnóstico

npm run test:all: aprovado, 120 testes Node (111 anteriores e 9 de segurança), quatro roteiros UI anteriores e build web. A suíte preserva testes financeiros, concorrência entre abas, backups, recuperação e estados assíncronos da Etapa 12A.

npm run test:desktop: aprovado, incluindo build:desktop e execução gráfica real com Playwright/Electron no Windows: navegador sem API desktop; modos desenvolvimento e build local; DTO e isolamento; opções da janela; bloqueio de rede, arquivos, script inline em produção, navegação e janelas; emissor/payload/canal indevidos; login, abertura de caixa, venda, exportação JSON; persistência e nova autenticação após reinício; diagnóstico após crash; execução do launcher real e encerramento da janela. Testes usam perfis temporários isolados, sem apagar dados do usuário. Capturas ficam em outputs/etapa-12b, ignorado pelo Git.

npm run build:desktop e npm run typecheck: aprovados. git diff --check: sem erros de whitespace (somente avisos de conversão LF/CRLF do Git).

A matriz de inicialização testa ausência do renderer/preload, preload quebrado, IPC falhando e renderer sem montar. Falhas usam códigos fixos e uma janela de diagnóstico local sem preload, mantendo sandbox. Dados não são apagados e não se exibe stack/caminho interno. Problemas encontrados durante a implementação (download inicial do binário, resolução do compilador TypeScript e corrida ao recarregar preload defeituoso) foram corrigidos e retestados.

Limitações: impressão física, instalador, assinatura, atualização automática, SQLite e aplicativo empacotado/distribuído não foram testados nem implementados. Os testes gráficos verificam o executável Electron com o build compilado local.

## H. Arquivos

Modificados: .gitignore, package.json, package-lock.json, vite.config.ts, README.md e docs/preparacao-electron-sqlite.md.

Criados: electron/main/index.cts, electron/main/security.cts, electron/preload/index.cts, electron/shared/contracts.cts, tsconfig.electron.json, scripts/dev-desktop.mjs, src/types/desktop.d.ts, tests/electron-security.test.mjs, tests/electron-smoke.cjs, tests/desktop-launcher.cjs, tests/electron-startup.cjs e este documento. Nenhum arquivo funcional anterior foi removido. dist e dist-electron permanecem gerados/ignorados; outputs anteriores foram preservados.

## I. Pendências e riscos

Persistência continua localStorage dentro do adaptador web; não houve extração ou duplicação de algoritmos financeiros. A separação dos perfis exige informar aos usuários que iniciar Electron não importa vendas do navegador. Futuras imagens externas, integrações ou novos comandos exigirão revisão explícita das políticas, sem relaxar globalmente a segurança. Instalação e distribuição Windows continuam pendentes.

## J. Preparação para a Etapa 12C

A estrutura desktop, build separado, origem estável, API mínima e fronteira validada estão disponíveis. A próxima etapa deverá adicionar o adaptador real e comandos completos tipados, com autorização no backend, autenticação de crédito, transações SQLite, idempotência durável e migração explícita versionada. O modelo relacional detalhado da Etapa 12A foi preservado e o planejamento recebeu a atualização 12B. Não há adaptador fictício nem banco simulado.

A etapa não foi commitada ou enviada ao GitHub. A Etapa 12C depende de autorização específica.
