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
- Consultar vendas salvas no Histórico, com busca por número, filtros de período, pagamento e status, detalhes históricos e reimpressão.
- Cancelar vendas concluídas pelo Histórico com motivo obrigatório, preservando os dados originais e identificando o cancelamento nos detalhes e no comprovante.
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

Os dados de Início e Relatórios consideram somente vendas concluídas; o Histórico preserva vendas canceladas com seus itens, pagamentos e valores originais. Vendas antigas sem status são tratadas como concluídas. Estoque, clientes e outras funções fora do escopo atual ainda não estão implementados.


## Apuração no fechamento de caixa

O fechamento confere separadamente dinheiro, Pix, débito e crédito em centavos. O dinheiro esperado inclui fundo inicial, pagamentos em dinheiro registrados, suprimentos e sangrias; meios eletrônicos não entram no saldo físico. O operador informa manualmente cada valor, revisa as diferenças e confirma o fechamento. A apuração é salva junto à sessão no armazenamento local e não é recalculada no histórico.

Sessões fechadas antes desta apuração continuam compatíveis e exibem somente o que foi gravado, com aviso de que Pix e cartões não foram conferidos. O cancelamento não cria automaticamente captura, estorno ou devolução. Os eventos financeiros são registrados separadamente; pagamentos registrados permanecem na apuração até existir um reembolso concluído explícito; uma venda cancelada não reduz automaticamente o saldo.

## Etapa 11.1 — devoluções e resolução financeira

Cancelamento integral, devolução física, reembolso e crédito possuem registros distintos. Devoluções parciais limitam a compensação ao valor dos itens devolvidos; devoluções totais e cancelamentos permitem o total da venda, descontando compensações anteriores e créditos restaurados. Pendências reservam esse limite, mas somente reembolsos concluídos alteram o caixa; falhas liberam a reserva. Dinheiro é devolvido no caixa atual aberto sem modificar fechamentos antigos.

Créditos têm código aleatório seguro, armazenado apenas como SHA-256, uso parcial e misto e proteção entre abas com Web Locks. O backup v2 inclui o ledger, valida relações financeiras e conserva rollback; backups v1 mantêm o ledger vazio. Dados antigos não recebem eventos financeiros reconstruídos.

## Dashboard e relatórios financeiros

Faturamento, ticket médio, maior venda e gráficos usam o valor original das vendas concluídas. Recebido líquido soma dinheiro, Pix e cartões e desconta somente reembolsos realizados; gerar crédito não reduz o faturamento nem o recebido. Cancelamentos ficam fora do faturamento. A contagem mantém as vendas concluídas, inclusive quando houve devolução total, para não confundir devolução com cancelamento.

A distribuição mostra os pagamentos originais das vendas concluídas, incluindo crédito do cliente, com percentuais sobre esses pagamentos. Crédito interno não é novo recebimento em dinheiro. Reembolsos realizados, pendências e créditos emitidos aparecem separadamente por data de registro (reembolsos realizados usam a data de conclusão), sem descontar duas vezes do faturamento. As telas acompanham mudanças de vendas e do ledger, inclusive entre abas, e renovam a referência de data ao retomar a janela e a cada minuto.


Histórico, Caixa, Início e Relatórios compartilham as regras de faturamento e recebimentos. A contagem separa concluídas de canceladas; devolução física ou emissão de crédito não cancela uma venda. Pagamentos de canceladas permanecem nos recebimentos até o reembolso real. Crédito usado numa compra compõe o valor da venda, mas não representa dinheiro novo.

Compare os mesmos filtros: Histórico considera as vendas filtradas e seus reembolsos; Início/Relatórios consideram a data das vendas e a data efetiva dos reembolsos; Caixa considera a sessão em que o recebimento ou reembolso ocorreu. Novos fechamentos salvam contagens e recebido líquido. Fechamentos antigos mantêm o valor originalmente gravado, identificado como histórico, sem recálculo.

## Operadores e separação diária de caixas

Cadastre operadores em Configurações e salve as alterações. A abertura exige um operador ativo e grava seu nome, identificador, data de operação e horário de entrada. O fechamento grava a data e hora reais em que foi realizado. A identidade histórica é preservada mesmo após editar ou inativar o cadastro.

A data do caixa usa America/Sao_Paulo. Na virada do dia, uma sessão ainda aberta aparece como pendente e deixa de aceitar vendas, suprimentos, sangrias e reembolsos em dinheiro. O mesmo operador deve fechar sua pendência antes de abrir o caixa do dia; outro operador pode abrir o de hoje. Existe apenas um caixa atual por dia e operador. Pendências podem ser conferidas e fechadas individualmente sem alterar o caixa atual. Caixas legados sem operador permanecem identificados como tal e precisam ser fechados antes de nova abertura.

Vendas antigas e seus vínculos não são movidos para novas sessões. A validação ocorre também ao gravar a venda, protegendo uma tela que ficou aberta durante a virada do dia. Operadores e dados das sessões entram no backup nas estruturas de configurações e caixa, preservando compatibilidade com backups antigos.


## Entrada de operador

Ao iniciar o sistema, entre com usuário e senha. O acesso inicial é Admin / 123456; altere a senha em Configurações. Apenas o administrador pode cadastrar, inativar operadores, alterar senhas, restaurar backup ou limpar dados. Cadastre nome, usuário e senha de pelo menos seis caracteres e salve as alterações. As senhas são armazenadas como verificadores PBKDF2 com salt, sem texto legível.

A abertura usa o operador conectado. Sair / trocar operador encerra o acesso, mas preserva o caixa aberto. Outro operador precisa entrar com sua própria senha e não pode vender nem movimentar o caixa alheio. O administrador pode fechar caixas pendentes. Trocar a senha invalida os acessos anteriores e exige entrar novamente. O acesso permanece durante a sessão da aba; não integra serviço externo de autenticação.


## Etapa 11.2 — estabilização financeira

O catálogo acompanha alterações de produtos na mesma aba e entre abas, sem reiniciar. Novas vendas gravam identificadores de linhas; devoluções distinguem linhas do mesmo produto, inclusive preços diferentes. Vendas antigas recebem identidades derivadas somente durante a leitura, sem regravação.

Vendas, cancelamentos, resoluções, movimentações/fechamento de caixa e restauração compartilham um Web Lock. A baixa exige autorização recente do código, saldo atual e reserva exatamente correspondente aos pagamentos. Falhas após gravar a venda conservam venda e reserva; falhas na restauração conservam o cancelamento e os movimentos. A recuperação ocorre após a entrada do operador, é repetível sem duplicar movimentos e mostra inconsistências em vez de ocultá-las.

`npm test` executa todos os arquivos `tests/*.test.mjs`. `npm run test:ui` executa os três testes de interface com Playwright e Microsoft Edge instalado; inicie o app em `http://127.0.0.1:5173/` antes. `npm run test:all` combina testes de domínio, interface e build. Os navegadores de teste usam contextos isolados; evidências novas ficam em `outputs/etapa-11-2/`.

Consulte [o relatório da Etapa 11.2](docs/etapa-11-2-estabilizacao.md) para diagnóstico, compatibilidade, testes e riscos remanescentes. O bloqueio entre abas e a recuperação compensatória não oferecem transações completas entre chaves do localStorage.


## Etapa 12A — contratos assíncronos de persistência

O Raiz PDV continua no navegador com as mesmas chaves e formatos locais. As telas usam a aplicação injetada via `ApplicationContext`, contratos Promise por agregado e `createWebRepositories()`. Venda, cancelamento, resolução, fechamento e restauração permanecem comandos completos, delegados aos serviços estabilizados. A apuração recebe snapshots explicitamente. Não há Electron, SQLite ou migração de dados nesta etapa.

`npm test` inclui os testes da nova camada; `npm run test:ui` inclui os três roteiros anteriores e o novo roteiro assíncrono, com Edge e servidor em `http://127.0.0.1:5173/`. Os testes usam armazenamento em memória ou contextos de navegador isolados, sem limpar os dados da operação real. `npm run test:all` executa testes, interface e build.

Consulte [o relatório 12A](docs/etapa-12a-persistencia.md) e [o modelo desktop atualizado](docs/preparacao-electron-sqlite.md), incluindo limites do localStorage, recuperação, idempotência futura e compatibilidade de backups v1/v2.


## Etapa 12B — execução desktop

Requer Node.js 22.12 ou superior. Electron 44.7.0 é uma dependência de desenvolvimento. A Etapa 12B adicionou a estrutura desktop; a fundação SQLite da Etapa 12C.1 está descrita abaixo. Instalador e migração de dados continuam pendentes.

```bash
npm install
npm run dev:desktop
npm run build:desktop
npm run start:desktop
npm run typecheck
npm run test:all
npm run test:desktop
```

`dev:desktop` compila main/preload e usa Vite em `http://127.0.0.1:5173/`, iniciando o servidor quando necessário. Alterações React usam HMR; alterações em main/preload exigem reiniciar o comando. `start:desktop` usa somente os arquivos compilados, pelo protocolo local `raiz://app`, sem servidor Vite. `test:desktop:production` verifica o build local sem depender do servidor web. `test:all` e a parte web de `test:desktop` exigem `npm run dev` disponível na porta 5173.

No Windows, o perfil Electron fica em `%APPDATA%\Raiz PDV`. Desenvolvimento e build local usam partições distintas. Os dados do navegador são independentes: esta etapa não copia nem sincroniza vendas entre os ambientes. Ambos usam os contratos e o adaptador web da Etapa 12A, com as mesmas chaves e formatos. Sessões de operadores continuam temporárias.

A janela mantém sandbox, isolamento de contexto e Node desabilitado no renderer. Na entrega da 12B, a API pública era `window.raizDesktop?.getAppInfo()`, com nome, versão e ambiente. A ampliação por comandos de domínio está descrita na 12C.2 abaixo; SQL e filesystem genéricos permanecem proibidos. Veja o diagnóstico, as garantias e os testes no [relatório da Etapa 12B](docs/etapa-12b-electron.md).


## Etapa 12C.1 — fundação SQLite

O main inicializa SQLite real usando `node:sqlite` do Electron 44.7.0 (Node 24.21.0, SQLite 3.53.4), sem dependência nativa externa ou recompilação. O banco contém schema, migrations e estado da instalação, mas **as operações do PDV continuam exclusivamente em `createWebRepositories()`**. A 12C.1 foi entregue sem migração, importação de backups para SQL, limpeza, botão de reinicialização ou IPC financeiro. A 12C.2 acrescenta comandos operacionais, mantendo a composição web.

No Windows, o build local usa `%APPDATA%\Raiz PDV\data\raiz-pdv.sqlite`; o desenvolvimento usa `data\development\raiz-pdv.sqlite` no mesmo perfil. Testes usam somente diretórios temporários isolados. Uma segunda instância com o mesmo `userData` é bloqueada, inclusive entre modos; perfis distintos podem rodar simultaneamente.

```bash
npm run test:sqlite
npm run typecheck
npm run test:all
npm run build:desktop
npm run test:desktop
```

`test:sqlite` executa SQLite real com o binário Electron; `test:all` também inclui essa suíte. `test:desktop` verifica a inicialização do banco, isolamento, IPC, instância única e diagnóstico seguro de corrupção/inacessibilidade. A regressão web continua exigindo Vite na porta 5173.

O estado SQLite começa em `testing`, geração 1. Ele não cria administrador automaticamente nem altera o login web atual. O fluxo futuro de cadastro/ativação e **Preparar para uso oficial** será implementado em etapas posteriores, com autorização e backup externo consistente obrigatório. Não apagar arquivos `.sqlite`, `-wal` ou `-shm` para reinicializar a instalação: o WAL pode conter transações confirmadas ainda não incorporadas ao arquivo principal. Veja o [relatório 12C.1](docs/etapa-12c-1-sqlite.md).


## Etapa 12C.2 — backend operacional SQLite, sem ativação automática

O backend agora implementa autenticação, catálogo/configuração, vendas, caixa, devoluções, reembolsos, créditos e recuperação por comandos transacionais, com autoria, geração e idempotência durável. A API `window.raizDesktop.pdv` contém somente operações explícitas e validadas; não oferece SQL ou filesystem genéricos. Verificadores e códigos não são devolvidos ao renderer operacional. Comprovantes de crédito usam impressão controlada no main e proteção DPAPI no Windows.

**O aplicativo normal continua usando o adaptador web.** O transporte SQLite exige validação manual não empacotada, perfil de teste explícito e `--raiz-sqlite-validation`; esse flag não seleciona o adaptador nem ativa a instalação. Não existe administrador nativo criado automaticamente. Cadastro inicial/ativação/importação oficial pertencem à 12C.3.

`npm run test:sqlite` inclui conformidade web/SQLite, concorrência com conexões reais, falhas/restart/timeout e autorização. `npm run test:desktop` também monta uma composição Electron explícita apenas numa cópia temporária, executa venda pela interface e verifica o comprovante isolado com DPAPI/PDF. Veja os comandos, contratos, limites e requisitos de migração no [relatório 12C.2](docs/etapa-12c-2-backend-sqlite.md).
