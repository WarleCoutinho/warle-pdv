# Preparação para Electron + SQLite

> Planejamento histórico da Etapa 11. O estado posterior, os créditos, operadores e linhas estáveis estão documentados no [relatório da Etapa 11.2](etapa-11-2-estabilizacao.md). O schema abaixo é preliminar e precisa incorporar essas entidades antes de uma migração.

**Etapa 11 — planejamento técnico, sem integração nesta etapa**
**Data da inspeção:** 08/10/2026
**Branch:** `codex/react-pos-base`
**HEAD local e remoto consultado:** `de74d0cfa16de894107cde76ca359a964a866027`

## 1. Diagnóstico

O projeto é uma aplicação React 19 + TypeScript compilada pelo Vite. O renderer atual é também a aplicação web: `src/main.tsx` monta `App`, que escolhe a página e chama serviços de armazenamento diretamente. Não existem dependências, configurações, processos ou diretórios de Electron/SQLite no projeto.

A persistência está distribuída em serviços síncronos que acessam `localStorage`. A interface lê esses dados durante a inicialização ou por hooks e atualiza estados React depois das gravações. O resultado é simples para o navegador, mas acopla domínio, serviços e telas a APIs síncronas do browser; SQLite no processo principal exigirá uma fronteira assíncrona e serializável.

A branch local e `origin/codex/react-pos-base` estão no mesmo commit, confirmado também pela referência consultada no GitHub. O working tree contém alterações existentes não commitadas, incluindo apuração financeira, backup/restauração, navegação por teclado, imagens de produtos e ajustes de interface. Essas alterações foram preservadas e não fazem parte desta documentação.

As funcionalidades verificadas no working tree incluem:

- Apuração de fechamento para dinheiro, Pix, débito e crédito, com diferenças e snapshot salvo na sessão.
- Exportação e validação de backup JSON, cópia de segurança pré-restauração, reversão compensatória e recarga da aplicação.
- Navegação por teclado no catálogo, carrinho, pagamentos e foco/tecla Esc em modais.
- Cancelamento de venda preservando os dados da venda no histórico.

**Limitação financeira existente:** o modelo não registra captura, estorno ou devolução efetivamente realizada. Cancelar uma venda não prova que houve devolução. A migração não deve inventar lançamentos de estorno para vendas canceladas.

## 2. Serviços e dados persistidos

| Serviço / chave atual | Conteúdo e responsabilidade | Relações importantes |
|---|---|---|
| `productStorage.ts` — `raiz-pdv:products` | Catálogo; sem chave salva, carrega e persiste os produtos demonstrativos. Produto contém id, nome, preço em centavos, categoria, ativo, emoji e, no working tree, imagem opcional em data URL. | Produtos ativos alimentam o catálogo. Uma venda salva nome, preço e quantidade em snapshot para preservar o histórico. |
| `settingsStorage.ts` — `raiz-pdv:settings` | Nome da loja, endereço, telefone e rodapé do comprovante; aplica padrões se ainda não houver chave. | Usado na configuração da loja e nos comprovantes. |
| `cartStorage.ts` — `raiz-pdv:draft-cart` | Rascunho temporário: id do produto, quantidade e preço unitário. Não faz parte do backup de negócio. | Ao carregar, resolve o produto pelo catálogo atual; item sem produto ativo é descartado. |
| `saleStorage.ts` — `raiz-pdv:completed-sales` | Array de vendas; cada venda possui id, número sequencial, data, sessão de caixa opcional, itens snapshot, total, pagamentos e status/metadados de cancelamento. | Venda pertence opcionalmente a uma sessão. Itens e pagamentos hoje estão embutidos no documento da venda. |
| `cashStorage.ts` — `raiz-pdv:cash` | Um objeto com sessões e movimentações. A sessão pode conter dados antigos de fechamento e, no working tree, um snapshot de apuração por modalidade. | Movimentação pertence a uma sessão. Sessão agrega vendas através de `cashSessionId`. |
| `backupStorage.ts` — `raiz-pdv:restore-safety-backup` | Cópia local de segurança ou snapshot de recuperação para restauração. Backup exportado inclui produtos, configurações, vendas e caixa, mas não carrinho. | Depende dos validadores dos quatro serviços de domínio. |

`localDataMaintenance.ts` remove somente as chaves pertencentes ao PDV. A soma de `cashStorage` com `saleStorage` é feita em memória; o encerramento lê novamente sessão, vendas e movimentos e persiste a apuração junto da sessão. Em SQLite, essas leituras, validação e gravação precisam ocorrer na mesma transação.

### Tipos e relacionamentos

- **Product:** `id`, `name`, `priceInCents`, `category`, `active`, `emoji`, `imageDataUrl?`.
- **Sale:** `id`, número, data, `cashSessionId?`, status opcional legado, campos de cancelamento, itens, total em centavos e pagamentos.
- **SaleItem:** `productId`, nome snapshot, preço unitário em centavos, quantidade e subtotal.
- **SalePayment:** modalidade (`cash | pix | debit | credit`), valor aplicado à venda; dinheiro também guarda valor recebido e troco. O valor aplicado, e não o recebido bruto em dinheiro, compõe a receita.
- **CashSession:** abertura, estado, fechamento/contagem/diferença e apuração persistida opcional para compatibilidade antiga.
- **CashMovement:** sessão, tipo suprimento/sangria, valor, descrição e data.
- **CashReconciliation:** totais e esperado/conferido/diferença por modalidade, total líquido de vendas e resumo físico snapshot.
- **StoreSettings:** campos simples da loja.

Cancelamento atualmente é uma mudança de status e metadados na própria venda. Não há entidade de captura/estorno. Sessões antigas podem não conter `reconciliation`; a tela deve continuar representando modalidade não apurada como ausente/desconhecida, nunca como zero conferido.

### Dependências entre telas e armazenamento

- `App.tsx` carrega produtos, configurações e caixa; entrega dados e callbacks às páginas.
- `PosPage` usa `cartStorage`, `saleStorage` e `cashStorage`; concluir venda requer uma sessão de caixa ainda aberta e salva uma venda com snapshot de itens/pagamentos.
- `CashPage` usa `usePersistedSales`, `cashStorage` e `utils/cash`; suprimentos/sangrias consultam o saldo calculado; fechamento refaz a leitura e compara a impressão digital dos dados revisados.
- `HistoryPage` lê vendas e chama o serviço de cancelamento; relatórios e dashboard filtram vendas concluídas por `salesAnalytics`.
- `ProductsPage` e `SettingsPage` chamam serviços síncronos e depois atualizam estado React no componente/App.
- Backup chama validadores e serviços diretamente. O formato atual é versão 1, até 10 MB, com checksum FNV-1a (detecção de corrupção acidental, não assinatura criptográfica).

Hoje os ouvintes de evento `storage` cobrem alterações feitas em outro contexto do navegador. Esse mecanismo não deve ser tratado como canal de atualização dentro de um único renderer Electron; as mutações IPC precisam atualizar o estado React explicitamente.

## 3. Proposta de contratos de acesso

Criar contratos TypeScript pequenos para operações de domínio, não uma interface genérica para qualquer chave, SQL ou objeto. Por exemplo:

```ts
interface ProductRepository {
  list(): Promise<Product[]>;
  saveAll(products: Product[]): Promise<Product[]>;
}
interface SalesRepository {
  list(): Promise<Sale[]>;
  complete(input: CompleteSaleInput): Promise<Sale>;
  cancel(input: CancelSaleInput): Promise<Sale>;
}
interface CashRepository {
  load(): Promise<CashData>;
  open(openingAmountInCents: number): Promise<CashData>;
  addMovement(input: CashMovementInput): Promise<CashData>;
  close(input: CloseCashInput): Promise<CashData>;
}
interface SettingsRepository {
  load(): Promise<StoreSettings>;
  save(settings: StoreSettings): Promise<StoreSettings>;
}
```

Agrupar esses contratos em um `PdvDataStore` ou `PdvRepositories`, mais uma interface de backup. Cada método resolve com os registros gravados ou rejeita com erro de domínio tipado; não retorna sucesso antes da confirmação do backend. Evitar `getItem(key)`, `setItem(key, value)`, `invoke(channel, payload)` ou consultas SQL arbitrárias expostas ao renderer.

Criar primeiro um adaptador web que encapsule os serviços atuais e cumpra a API Promise. Internamente, `localStorage` continuará síncrono; a Promise padroniza o contrato sem alterar o comportamento web. O adaptador Electron chamará métodos IPC. Na migração das telas, carregar dados em estado `loading/error/ready`, bloquear ações duplicadas enquanto uma escrita está pendente e atualizar o estado React com o resultado retornado pelo repositório. Não converter as regras financeiras em SQL nem replicá-las em dois lugares: manter validações de domínio compartilhadas e adicionar integridade transacional no repository SQLite.

Operações com mais de uma entidade devem ser expostas como operações de negócio: `completeSale`, `cancelSale`, `closeCashSession`, `importBackup`. O processo principal revalida os dados e executa toda a escrita relacionada em uma transação. O renderer não coordena uma sequência de gravações que possa ficar pela metade.

## 4. Estrutura de diretórios proposta

```text
electron/
  main/
    main.ts                  # ciclo de vida, janela e bootstrap
    database/
      connection.ts          # caminho, conexão e PRAGMAs
      migrations/
        001-initial-schema.sql
      repositories/          # implementação SQLite dos contratos
    ipc/
      registerHandlers.ts    # canais fechados e validação
  preload/
    index.ts                 # API mínima por contextBridge
src/
  services/
    dataContracts.ts         # contratos Promise compartilhados
    webDataStore.ts          # adaptador atual localStorage
    electronDataStore.ts     # adaptador que chama window.raizPdv
  types/
    electron.d.ts            # tipo global de window.raizPdv
  ...                        # telas e domínio React existentes
```

É uma proposta, não uma reorganização a executar nesta etapa. Manter `utils/` como lógica pura de dinheiro, pagamento, analytics e regra financeira. Vite deverá continuar servindo o modo web e ganhar uma configuração de build separada para main/preload/instalador apenas na etapa de integração.

## 5. Electron e segurança

- **Main process:** único dono da conexão SQLite, migrações, repositórios e operações nativas. Inicializa banco e registra handlers antes de abrir a janela; ao sair, aguarda/encerra gravações em curso e fecha a conexão.
- **Renderer:** React sem `nodeIntegration`, sem acesso a filesystem/SQLite e sem dados privilegiados. Deve carregar somente os assets empacotados pela aplicação.
- **Preload:** expõe uma API pequena e tipada usando `contextBridge`; cada método mapeia para um canal específico com `ipcRenderer.invoke`. Nunca expor `ipcRenderer`, `send`, `invoke`, canal arbitrário ou objetos nativos completos.
- **IPC:** validar origem/frame remetente, payloads e resultados no main; verificar estado e relações de domínio novamente no main. Limitar navegação, janelas auxiliares e permissões; aplicar CSP restritiva e manter Electron atualizado.
- **Janela:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`; protocolo local controlado para assets, em vez de habilitar acesso privilegiado ao renderer com `file://`.
- **Ciclo de vida:** inicializar após `app.whenReady()`, reabrir janela conforme plataforma, tratar `window-all-closed` e no Windows encerrar limpidamente. Não deixar o processo terminar no meio de uma transação.
- **Dados do usuário:** gravar em subdiretório próprio de `app.getPath('userData')`, por exemplo `<userData>/RaizPDV/raiz-pdv.sqlite`; nunca junto dos arquivos instalados, do executável ou em `src/`.

As recomendações sobre isolamento, sandbox, IPC, validação do sender e protocolo local seguem a documentação oficial do Electron. `userData` é o diretório convencional para dados da aplicação; o Electron recomenda uma subpasta própria para evitar colisões com dados internos do Chromium.

## 6. Esquema SQLite inicial proposto

Todos os valores monetários são `INTEGER` em centavos. Datas continuam ISO-8601 em UTC no banco; formatação local permanece no renderer. Habilitar `PRAGMA foreign_keys=ON` e verificar que está ativo em cada conexão. Toda migração deve estar versionada e transacional; registrar versão/data em `schema_migrations`.

### Tabelas

- `products(id TEXT PRIMARY KEY, name, price_cents INTEGER CHECK >= 0, category, active INTEGER CHECK IN (0,1), emoji, image_mime_type, image_data BLOB NULL)`. O `imageDataUrl` do JSON pode ser validado e convertido para bytes + MIME durante a importação; ao renderizar, o adapter reconstrói a data URL. Produtos do histórico continuam com snapshots próprios.
- `store_settings(id INTEGER PRIMARY KEY CHECK (id=1), store_name, address, phone, receipt_footer)`; uma linha singleton.
- `cash_sessions(id TEXT PRIMARY KEY, opened_at, opening_amount_cents INTEGER CHECK >= 0, status CHECK IN ('open','closed'), closed_at, counted_amount_cents, expected_amount_cents, difference_cents)`. Um índice único parcial com `WHERE status='open'` impede dois caixas abertos.
- `sales(id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, occurred_at, cash_session_id TEXT NULL REFERENCES cash_sessions(id) ON DELETE SET NULL, status CHECK IN ('completed','cancelled'), total_cents INTEGER CHECK >= 0, cancelled_at, cancellation_reason, cancellation_note)`. `cash_session_id` nulo preserva vendas legadas sem sessão.
- `sale_items(sale_id REFERENCES sales(id) ON DELETE CASCADE, line_number, product_id TEXT NULL REFERENCES products(id) ON DELETE SET NULL, product_name_snapshot, unit_price_cents INTEGER CHECK >= 0, quantity INTEGER CHECK > 0, subtotal_cents INTEGER CHECK >= 0, PRIMARY KEY(sale_id,line_number))`. Nome/preço snapshot não são substituídos por dados atuais do catálogo.
- `sale_payments(id TEXT PRIMARY KEY, sale_id REFERENCES sales(id) ON DELETE CASCADE, line_number, method CHECK IN ('cash','pix','debit','credit'), amount_cents INTEGER CHECK > 0, amount_received_cents NULL, change_cents NULL, UNIQUE(sale_id,line_number))`. `amount_cents` é o valor aplicado à venda; dinheiro pode ter valor recebido maior por causa do troco.
- `sale_cancellations(sale_id TEXT PRIMARY KEY REFERENCES sales(id), cancelled_at, reason, note)`. Mantém o evento e seus metadados separado do status derivado/exibido da venda.
- `payment_refunds(id TEXT PRIMARY KEY, payment_id REFERENCES sale_payments(id), amount_cents INTEGER CHECK > 0, status CHECK IN ('pending','completed','failed'), requested_at, completed_at, note)`. É extensão futura, não migrar nenhum reembolso para ela sem evento que o comprove. Validar dentro da transação que a soma de reembolsos concluídos não exceda o pagamento.
- `cash_movements(id TEXT PRIMARY KEY, cash_session_id REFERENCES cash_sessions(id), type CHECK IN ('supply','withdrawal'), amount_cents INTEGER CHECK > 0, description, occurred_at)`.
- `cash_reconciliation_snapshots(cash_session_id TEXT PRIMARY KEY REFERENCES cash_sessions(id), total_net_sales_cents, opening_cents, cash_sales_cents, supplies_cents, withdrawals_cents, expected_physical_cash_cents, closed_at)`. Guarda o snapshot físico e total líquido imutáveis.
- `cash_reconciliation_methods(cash_session_id REFERENCES cash_reconciliation_snapshots, method CHECK IN (...), expected_cents INTEGER CHECK >= 0, counted_cents INTEGER CHECK >= 0, difference_cents INTEGER, PRIMARY KEY(cash_session_id,method), CHECK(difference_cents=counted_cents-expected_cents))`. Quatro linhas por fechamento novo; fechamento antigo sem snapshot continua sem linhas e sem conferência eletrônica inventada.
- `schema_migrations(version INTEGER PRIMARY KEY, applied_at)` e `backup_imports(checksum TEXT PRIMARY KEY, imported_at, source_version)` para controlar migrações e tornar uma importação idempotente.

### Integridade, imutabilidade e índices

- Ativar `foreign_keys` na conexão. Impedir exclusão de caixa com registros; manter `sale_items`/pagamentos por exclusão em cascata somente se a política futura autorizar excluir a venda; para auditoria, preferir arquivar/desativar produto e nunca apagar vendas fechadas.
- Restrições `CHECK` cobrem domínio, valores positivos/não negativos, métodos, status e equação de diferença. Totais que dependem de várias linhas (soma dos itens/pagamentos, total de reembolsos, resumo do caixa) são validados pelo repository dentro da transação; `CHECK` não pode expressar sozinho agregações entre tabelas.
- Repositórios não oferecem atualização de apuração fechada. Snapshot de conferência é apenas insert no fechamento; histórico lê o snapshot salvo, sem recálculo. Fechamento legado ausente segue marcado como “não apurado”.
- Vendas concluídas devem inserir cabeçalho, itens e pagamentos em uma transação. Fechamento deve revalidar sessão aberta, origem dos valores e dados de vendas/movimentos e inserir sessão encerrada + snapshot + modalidades em uma transação. Cancelamento insere evento e muda status em transação. Cancelamento não cria reembolso.
- Índices iniciais: `sales(number UNIQUE)`, `sales(occurred_at)`, `sales(cash_session_id, occurred_at)`, `sales(status, occurred_at)`, `sale_items(sale_id, line_number)`, `sale_items(product_id)`, `sale_payments(sale_id, line_number)`, `sale_payments(method, sale_id)`, `cash_movements(cash_session_id, occurred_at)`, `cash_sessions(status, opened_at)`, `products(active, category, name)`.

SQLite oferece transações explícitas e constraints de chave estrangeira, mas a aplicação precisa ativar `foreign_keys` em cada conexão. Uma operação crítica deve começar, validar e gravar tudo antes de `COMMIT`; qualquer erro causa `ROLLBACK`.

## 7. Backup JSON e migração

O backup atual (formato `raiz-pdv-backup`, versão 1) já contém produtos, configurações, vendas e caixa, usa os validadores de domínio e checksum, e exclui o carrinho. Ele é um bom formato de intercâmbio inicial; manter o formato desacoplado do schema SQL.

Sequência proposta:

1. Criar o banco vazio, criar schema/migrações e tirar cópia de segurança verificada do JSON atual. Não remover nem sobrescrever chaves do `localStorage`.
2. Validar tamanho, formato/versão/checksum e todas as entidades JSON antes de abrir a transação. Exportar em arquivo a cópia do backup atual e registrar seu checksum.
3. Importar produtos e configuração; depois sessões, vendas, itens, pagamentos, cancelamentos, movimentos e snapshots de apuração, respeitando FKs. IDs são preservados.
4. Duplicidade: a mesma impressão digital já importada torna a operação idempotente/no-op. IDs ou número de venda que colidam com conteúdo diferente abortam a importação inteira; não mesclar nem substituir silenciosamente.
5. Em uma única transação SQLite, gravar todo o conteúdo e marcador de importação. Revalidar invariantes de cada serviço, unicidade, saldo/apuração salva, contagens e `PRAGMA foreign_key_check`; só então confirmar.
6. Em falha, `ROLLBACK` mantém a base anterior; o backup JSON externo e o `localStorage` original ficam intocados. Salvar diagnóstico sem dados sensíveis.
7. Após sucesso, reler do SQLite e comparar contagens, IDs, totais, pagamentos, status, movimentos e snapshots com o JSON. Repetir testes de caixa e vendas usando a cópia migrada.
8. Durante a transição, selecionar explicitamente um único backend por execução (web adapter ou Electron adapter). Evitar dual-write, que criaria duas fontes de verdade difíceis de reconciliar. Manter exportação JSON e uma cópia localizável até a migração ser verificada; não limpar `localStorage` automaticamente.

O backup atual guarda imagem de produto como string em JSON no working tree; a cópia SQLite proposta pode normalizar para BLOB + MIME. Essa conversão precisa ser validada com preview/export e limite de armazenamento. O checksum FNV atual não autentica arquivo nem substitui uma cópia de segurança independente.

## 8. Riscos e proteções

| Risco | Medida |
|---|---|
| Alteração local ainda não commitada confundida com release | Criar commit/snapshot antes de qualquer próxima implementação; este planejamento não altera os arquivos de aplicação. |
| Refatoração síncrona para assíncrona deixar estado React obsoleto | Migrar por adaptador, introduzir loading/error e atualizar contexto a partir da resposta confirmada. |
| Gravações relacionadas ficarem parciais | Operações de domínio no main e transação SQLite por venda, fechamento, cancelamento e importação. |
| Duas vendas simultâneas receberem mesmo número ou caixa fechar com origem antiga | Unicidade no banco, transação serializada, revalidar sessão/fingerprint dentro da transação. |
| Venda cancelada ser tratada como dinheiro devolvido | Não inferir estorno. Importar apenas cancelamento existente; estorno exige evento e status explícitos em uma etapa própria. |
| Apuração histórica mudar após mudança de vendas | Ler snapshot imutável salvo; nunca recalcular fechamento antigo na consulta. |
| XSS no renderer alcançar arquivos/banco | context isolation, sandbox, sem Node no renderer, API preload mínima, validação de sender/payload, CSP e navegação restrita. |
| Banco em pasta de instalação ou concorrência por arquivo | Diretório `userData` próprio e uma conexão controlada pelo processo principal. |
| Corrupção/falha durante importação ou atualização de schema | Migrar schema em transação, cópia independente antes da importação, idempotência e verificação pós-importação. |
| Backup JSON grande/ocupação por imagens | Limites explícitos, alerta de espaço, exportação independente e imagem em BLOB no SQLite. |
| Versões antigas sem reconciliação | Snapshot ausente permanece ausente; interface/histórico identificam a conferência como não disponível. |

## 9. Sequência recomendada para a próxima etapa

1. Revisar e commit/reter em snapshot o working tree atual antes de mudar a persistência; confirmar que contém as versões aprovadas de cada etapa.
2. Definir os contratos Promise e tipos de erro sem mudar regra de negócio.
3. Implementar e selecionar o adaptador web; migrar carregamento inicial do React para estado assíncrono e atualizar telas em pequenos lotes, mantendo todos os dados em `localStorage`.
4. Adicionar Electron/Vite main/preload e shell seguro sem SQLite; provar que o renderer não acessa APIs Node.
5. Adicionar conexão SQLite, PRAGMAs, migration `001` e testes de repository/constraint/rollback.
6. Implementar repositories de produtos/configurações, depois vendas/pagamentos/cancelamento, depois caixa/movimentações/fechamento.
7. Implementar importação inicial do backup JSON com cópia externa, transação, idempotência e conferência automatizada. Não remover `localStorage`.
8. Rodar fluxo web e desktop, testes de dinheiro/cancelamento/fechamento e restart; validar Windows instalado e caminho real dos dados.
9. Só em uma etapa aprovada separadamente, planejar eventuais novos eventos explícitos de captura/estorno e a política de retenção/backup automático.

## 10. Estado desta etapa

Esta etapa não implementou Electron, SQLite, repositórios, IPC nem migração. O único artefato produzido é este plano técnico. Não houve alteração de regra financeira, UI ou dados.

### Referências oficiais

- Electron — segurança: https://www.electronjs.org/docs/latest/tutorial/security/
- Electron — isolamento de contexto e `contextBridge`: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Electron — IPC: https://www.electronjs.org/docs/latest/tutorial/ipc
- Electron — diretórios de dados de aplicação: https://www.electronjs.org/docs/latest/api/app#appgetpathname
- SQLite — transações: https://www.sqlite.org/lang_transaction.html
- SQLite — suporte a foreign keys e ativação por conexão: https://www.sqlite.org/foreignkeys.html
