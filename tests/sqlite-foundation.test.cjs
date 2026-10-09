const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { SqliteFoundation, canonicalJson } = require('../dist-electron/main/sqlite/database.cjs');
const { MIGRATIONS, digest } = require('../dist-electron/main/sqlite/migrations.cjs');
const { databasePath } = require('../dist-electron/main/sqlite/profile.cjs');
const { planInstallationTransition, commercialDate } = require('../dist-electron/main/sqlite/installation.cjs');
const now = '2026-10-09T12:00:00.000Z';
const hash = 'a'.repeat(64);
function profile() { return mkdtempSync(join(tmpdir(),'raiz sqlite 12c1 ')); }
function fixture(t,options={}) {
  const userData=profile(); const configuration={userData,mode:'test',...options};
  const db=SqliteFoundation.open(configuration); t.after(()=>db.close());
  return {db,userData,configuration,path:databasePath(userData,configuration.mode)};
}
function code(fn,expected) { assert.throws(fn,error=>error.code===expected); }
function value(db,sql) { return Object.values(db.read(sql)[0])[0]; }
function category(ctx,id='category') { ctx.run('INSERT INTO categories(id,name,normalized_name) VALUES(?,?,?)',id,id,id); }
function sale(ctx,id='historical-sale',number=1) { ctx.run("INSERT INTO sales(id,number,occurred_at,status,total_cents) VALUES(?,?,?,'completed',1000)",id,number,now); }
function line(ctx,id='line-preserved',saleId='historical-sale',quantity=2) { ctx.run('INSERT INTO sale_items(sale_id,line_id,position,product_id,product_name_snapshot,unit_price_cents,quantity,subtotal_cents) VALUES(?,?,0,?,?,500,?,?)',saleId,id,'old-product','Historical product',quantity,500*quantity); }
function credit(ctx,id='credit') { ctx.run("INSERT INTO customer_credits(id,receipt_number,original_sale_id,original_sale_number,issued_at,original_cents,balance_cents,status,authorization_verifier) VALUES(?,?,'historical-sale',1,?,1000,1000,'available',?)",id,id,now,hash); }
function reopen(configuration) { return SqliteFoundation.open(configuration); }
function native(path,work) { const db=new DatabaseSync(path); try{return work(db);}finally{db.close();} }

// These fixtures never address Electron's actual appData or any operational browser storage.
test('Runtime real do Electron contém SQLite e prepared statements',()=>{
 assert.equal(process.versions.electron,'44.7.0'); assert.equal(process.versions.node,'24.21.0');
 const db=new DatabaseSync(':memory:'); try{assert.equal(db.prepare('SELECT sqlite_version() AS version').get().version,'3.53.4');}finally{db.close();}
});
test('Banco novo configura e verifica WAL, FULL, FK, timeout, schema e estado inicial',t=>{
 const {db,path}=fixture(t); const info=db.diagnostics(); assert.ok(existsSync(path));
 assert.equal(info.schemaVersion,1); assert.equal(info.foreignKeys,1); assert.equal(info.journalMode,'wal'); assert.equal(info.synchronous,2); assert.equal(info.busyTimeoutMs,1500);
 assert.equal(info.installation.status,'testing'); assert.equal(info.installation.generation,1); assert.equal(value(db,'SELECT next_number FROM sale_sequence'),1);
 assert.deepEqual(info.interruptedRequests,[]);
});
test('Reabertura preserva dados, estado, timestamp e migration sem duplicar',t=>{
 const {db,configuration}=fixture(t); db.transaction(ctx=>category(ctx)); const state=db.installationState(); const migration=db.read('SELECT * FROM schema_migrations'); db.close();
 const next=reopen(configuration); try{assert.deepEqual(next.installationState(),state);assert.deepEqual(next.read('SELECT * FROM schema_migrations'),migration);assert.equal(value(next,'SELECT count(*) FROM categories'),1);}finally{next.close();}
});
test('Schema completo, índices parciais e FKs compostas estão presentes',t=>{
 const {db,path}=fixture(t);const tables=db.read("SELECT name FROM sqlite_schema WHERE type='table'").map(r=>r.name);
 const required=['categories','product_images','products','store_settings','operators','operator_credentials','cash_sessions','cash_movements','sale_sequence','sales','sale_items','sale_payments','sale_cancellations','merchandise_returns','merchandise_return_items','financial_refunds','customer_credits','customer_credit_movements','customer_credit_reservations','operation_requests','recovery_events','cash_reconciliation_snapshots','cash_reconciliation_methods','backup_imports','schema_migrations','installation_state'];
 assert.deepEqual(tables.sort(),required.sort());
 native(path,raw=>{assert.equal(raw.prepare("PRAGMA index_list('cash_sessions')").all().filter(r=>r.partial&&r.unique).length,2);assert.equal(raw.prepare("PRAGMA foreign_key_list('merchandise_return_items')").all().length,4);});
});
test('Digest da migration alterada é rejeitado preservando conteúdo',t=>{
 const {db,path,configuration}=fixture(t); db.transaction(ctx=>category(ctx));db.close();
 native(path,raw=>raw.prepare('UPDATE schema_migrations SET migration_digest=?').run('b'.repeat(64)));
 code(()=>reopen(configuration),'MIGRATION_DIGEST_MISMATCH');native(path,raw=>assert.equal(raw.prepare('SELECT count(*) AS n FROM categories').get().n,1));
});
test('Mudança retroativa no código da migration também é detectada',t=>{
 const {db,configuration}=fixture(t);db.close();code(()=>reopen({...configuration,migrations:[{version:1,sql:MIGRATIONS[0].sql+'\n-- changed'}]}),'MIGRATION_DIGEST_MISMATCH');
});
test('Versão futura desconhecida e divergência user_version são rejeitadas',t=>{
 const {db,path,configuration}=fixture(t);db.close();native(path,raw=>{raw.prepare('INSERT INTO schema_migrations VALUES(2,?,?)').run(now,hash);raw.exec('PRAGMA user_version=2');});
 code(()=>reopen(configuration),'DATABASE_VERSION_INCOMPATIBLE');
 native(path,raw=>{raw.exec('DELETE FROM schema_migrations WHERE version=2');raw.exec('PRAGMA user_version=7');});code(()=>reopen(configuration),'DATABASE_VERSION_INCOMPATIBLE');
});
test('Migration com falha faz rollback do schema, registros e versão; inicialização posterior recupera',()=>{
 const configuration={userData:profile(),mode:'test'};
 code(()=>reopen({...configuration,migrations:[...MIGRATIONS,{version:2,sql:'CREATE TABLE partial_test(id INTEGER); INSERT INTO missing_table VALUES(1);'}]}),'MIGRATION_FAILED');
 native(databasePath(configuration.userData,'test'),raw=>{assert.equal(raw.prepare('PRAGMA user_version').get().user_version,0);assert.equal(raw.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name IN ('partial_test','sales','schema_migrations')").get().n,0);});
 const db=reopen(configuration);try{assert.equal(db.diagnostics().schemaVersion,1);}finally{db.close();}
});
test('Falha de upgrade mantém dados existentes e permite reaplicar versão nova válida',t=>{
 const {db,configuration}=fixture(t);db.transaction(ctx=>category(ctx));db.close();
 code(()=>reopen({...configuration,migrations:[...MIGRATIONS,{version:2,sql:'CREATE TABLE upgrade_test(id INTEGER); SELECT * FROM absent;'}]}),'MIGRATION_FAILED');
 let next=reopen(configuration);assert.equal(value(next,'SELECT count(*) FROM categories'),1);next.close();
 const migrations=[...MIGRATIONS,{version:2,sql:'CREATE TABLE upgrade_test(id INTEGER PRIMARY KEY) STRICT;'}];next=reopen({...configuration,migrations});try{assert.equal(next.diagnostics().schemaVersion,2);assert.equal(next.read('SELECT * FROM schema_migrations').length,2);}finally{next.close();}
});
test('Schema alterado externamente e banco não reconhecido são diagnosticados sem recriação',t=>{
 const {db,path,configuration}=fixture(t);db.close();native(path,raw=>raw.exec('DROP INDEX products_catalog'));code(()=>reopen(configuration),'DATABASE_SCHEMA_MISMATCH');
 const other=profile();const otherPath=databasePath(other,'test');mkdirSync(join(other,'data','test'),{recursive:true});native(otherPath,raw=>raw.exec('CREATE TABLE private_data(value TEXT); INSERT INTO private_data VALUES(\'preserve\')'));
 code(()=>reopen({userData:other,mode:'test'}),'DATABASE_VERSION_INCOMPATIBLE');native(otherPath,raw=>assert.equal(raw.prepare('SELECT value FROM private_data').get().value,'preserve'));
});
test('Centavos rejeitam REAL, negativos, bigint e números além do inteiro seguro',t=>{
 const {db}=fixture(t);db.transaction(ctx=>category(ctx));
 const insert=(p)=>db.transaction(ctx=>ctx.run("INSERT INTO products(id,name,category_id,price_cents,active) VALUES('p','Product','category',?,1)",p));
 code(()=>insert(-1),'DATABASE_CONSTRAINT');code(()=>insert(0.5),'INVALID_DATABASE_INPUT');code(()=>insert(Number.MAX_SAFE_INTEGER+1),'INVALID_DATABASE_INPUT');code(()=>insert(9007199254740992n),'INVALID_DATABASE_INPUT');
 insert(Number.MAX_SAFE_INTEGER);assert.equal(value(db,'SELECT price_cents FROM products'),Number.MAX_SAFE_INTEGER);
});
test('Quantidades inteiras positivas e subtotal são validados no schema',t=>{
 const {db}=fixture(t);db.transaction(ctx=>sale(ctx));
 for(const q of [0,-1]) code(()=>db.transaction(ctx=>line(ctx,'line-preserved','historical-sale',q)),'DATABASE_CONSTRAINT');
 code(()=>db.transaction(ctx=>line(ctx,'line-preserved','historical-sale',1.5)),'INVALID_DATABASE_INPUT');
 code(()=>db.transaction(ctx=>ctx.run("INSERT INTO sale_items VALUES('historical-sale','invalid',0,'legacy',NULL,'Name',500,2,900)")),'DATABASE_CONSTRAINT');
 db.transaction(ctx=>line(ctx));assert.equal(value(db,'SELECT line_id FROM sale_items'),'line-preserved');
});
test('FK ativa rejeita órfãos e conserva IDs e vínculos legados opcionais',t=>{
 const {db}=fixture(t);code(()=>db.transaction(ctx=>ctx.run("INSERT INTO products(id,name,category_id,price_cents,active) VALUES('orphan','N','absent',1,1)")),'DATABASE_CONSTRAINT');
 db.transaction(ctx=>{sale(ctx);line(ctx);});const row=db.read('SELECT * FROM sale_items')[0];assert.equal(row.product_id,'old-product');assert.equal(row.catalog_product_id,null);assert.equal(row.line_id,'line-preserved');assert.equal(value(db,'SELECT operator_id FROM sales'),null);
});
test('Vínculo da devolução exige a mesma venda e linha estável',t=>{
 const {db}=fixture(t);db.transaction(ctx=>{sale(ctx);line(ctx);sale(ctx,'other-sale',2);line(ctx,'other-line','other-sale');ctx.run("INSERT INTO merchandise_returns(id,sale_id,sale_number_snapshot,occurred_at,amount_cents) VALUES('return','historical-sale',1,?,500)",now);});
 code(()=>db.transaction(ctx=>ctx.run("INSERT INTO merchandise_return_items VALUES('return',0,'other-sale','other-line','old-product','Historical product',500,1,500)")),'DATABASE_CONSTRAINT');
 db.transaction(ctx=>ctx.run("INSERT INTO merchandise_return_items VALUES('return',0,'historical-sale','line-preserved','old-product','Historical product',500,1,500)"));
});
test('Infraestrutura suporta validar quantidade acumulada dentro da transação e reverter excesso',t=>{
 const {db}=fixture(t);db.transaction(ctx=>{sale(ctx);line(ctx);});
 const record=(id,q)=>db.transaction(ctx=>{
  const sold=ctx.get("SELECT quantity FROM sale_items WHERE sale_id='historical-sale' AND line_id='line-preserved'").quantity;
  const returned=ctx.get("SELECT coalesce(sum(quantity),0) AS q FROM merchandise_return_items WHERE sale_id='historical-sale' AND line_id='line-preserved'").q;
  if(returned+q>sold)throw Error('TEST_QUANTITY_LIMIT');
  ctx.run("INSERT INTO merchandise_returns(id,sale_id,sale_number_snapshot,occurred_at,amount_cents) VALUES(?,'historical-sale',1,?,?)",id,now,q*500);
  ctx.run("INSERT INTO merchandise_return_items VALUES(?,0,'historical-sale','line-preserved','old-product','Historical product',500,?,?)",id,q,q*500);
 });record('r1',1);record('r2',1);assert.throws(()=>record('r3',1));assert.equal(value(db,'SELECT count(*) FROM merchandise_returns'),2);
});
test('Crédito tem saldo limitado, código só como verificador e emissão/baixa únicas',t=>{
 const {db}=fixture(t);db.transaction(ctx=>{sale(ctx);credit(ctx);});
 code(()=>db.transaction(ctx=>ctx.run("UPDATE customer_credits SET balance_cents=1001 WHERE id='credit'")),'DATABASE_CONSTRAINT');
 code(()=>db.transaction(ctx=>ctx.run("UPDATE customer_credits SET authorization_verifier='plaintext-code' WHERE id='credit'")),'DATABASE_CONSTRAINT');
 const movement=id=>db.transaction(ctx=>ctx.run("INSERT INTO customer_credit_movements(id,credit_id,type,amount_cents,occurred_at) VALUES(?,'credit','issued',1000,?)",id,now));movement('m1');code(()=>movement('m2'),'DATABASE_CONSTRAINT');
});
test('Ciclo crédito/resolução e pagamento combinado usam FKs e commit diferido',t=>{
 const {db}=fixture(t);db.transaction(ctx=>{sale(ctx);ctx.run("INSERT INTO financial_refunds(id,sale_id,sale_number_snapshot,method,amount_cents,status,requested_at,completed_at,credit_id) VALUES('resolution','historical-sale',1,'customer_credit',1000,'completed',?,?,'credit')",now,now);credit(ctx);ctx.run("INSERT INTO sale_payments(id,sale_id,position,method,amount_cents,received_cents,change_cents,credit_id) VALUES('p-credit','historical-sale',0,'customer_credit',500,500,0,'credit')");ctx.run("INSERT INTO sale_payments(id,sale_id,position,method,amount_cents,received_cents,change_cents) VALUES('p-cash','historical-sale',1,'cash',500,700,200)");});
 assert.equal(value(db,'SELECT sum(amount_cents) FROM sale_payments'),1000);
 code(()=>db.transaction(ctx=>ctx.run("INSERT INTO sale_payments(id,sale_id,position,method,amount_cents,received_cents,change_cents) VALUES('bad','historical-sale',2,'pix',1,1,1)")),'DATABASE_CONSTRAINT');
});
test('Reserva aceita venda candidata antes da venda; exige request e crédito reais',t=>{
 const {db}=fixture(t);db.transaction(ctx=>{sale(ctx);credit(ctx);});
 db.executeRequest({requestId:'reserve',kind:'test.reserve',payload:{}},ctx=>{ctx.run("INSERT INTO customer_credit_reservations(id,credit_id,operation_request_id,sale_id,amount_cents,created_at,state) VALUES('r','credit','reserve','future-sale',500,?,'reserved')",now);return {reserved:true};});
 assert.equal(value(db,"SELECT count(*) FROM sales WHERE id='future-sale'"),0);
 code(()=>db.transaction(ctx=>ctx.run("INSERT INTO customer_credit_reservations VALUES('r2','credit','missing-request','candidate',1,?,'reserved')",now)),'DATABASE_CONSTRAINT');
});
test('Snapshots admitem eletrônico líquido negativo, dinheiro não negativo e são imutáveis',t=>{
 const {db}=fixture(t);db.transaction(ctx=>{ctx.run("INSERT INTO cash_sessions(id,opened_at,closed_at,opening_cents,status) VALUES('cash',?,?,0,'closed')",now,now);ctx.run("INSERT INTO cash_reconciliation_snapshots VALUES('cash',2,0,-100,0,0,0,0,0,0,0,0,0,'fingerprint',?,NULL)",now);ctx.run("INSERT INTO cash_reconciliation_methods VALUES('cash','pix',0,100,-100,0,100)");});
 assert.equal(value(db,'SELECT net_received_cents FROM cash_reconciliation_snapshots'),-100);
 code(()=>db.transaction(ctx=>ctx.run("INSERT INTO cash_reconciliation_methods VALUES('cash','cash',0,100,-100,0,100)")),'DATABASE_CONSTRAINT');
 code(()=>db.transaction(ctx=>ctx.run("UPDATE cash_reconciliation_snapshots SET revenue_cents=1")),'DATABASE_CONSTRAINT');code(()=>db.transaction(ctx=>ctx.run('DELETE FROM cash_reconciliation_methods')),'DATABASE_CONSTRAINT');
});
test('Transação válida confirma e falha intermediária reverte todas as escritas',t=>{
 const {db}=fixture(t);db.transaction(ctx=>{category(ctx,'one');category(ctx,'two');});
 code(()=>db.transaction(ctx=>{category(ctx,'three');category(ctx,'one');}),'DATABASE_CONSTRAINT');assert.equal(value(db,'SELECT count(*) FROM categories'),2);
});
test('Transações aninhadas, callbacks async e contextos expirados são rejeitados',async t=>{
 const {db}=fixture(t);code(()=>db.transaction(ctx=>{category(ctx);db.transaction(()=>{});}),'TRANSACTION_NESTED');assert.equal(value(db,'SELECT count(*) FROM categories'),0);
 let late;code(()=>db.transaction(ctx=>{late=ctx;return Promise.resolve('bad');}),'TRANSACTION_ASYNC_FORBIDDEN');
 code(()=>late.run("INSERT INTO categories VALUES('late','Late','late')"),'TRANSACTION_INACTIVE');
 code(()=>db.transaction(ctx=>ctx.run('COMMIT')),'INVALID_DATABASE_INPUT');
 await new Promise(r=>setTimeout(r,0));assert.equal(value(db,'SELECT count(*) FROM categories'),0);
});
test('WAL permite leitura concorrente; SQLITE_BUSY não repete callback e permite tentativa explícita depois',t=>{
 const {db,configuration,path}=fixture(t,{busyTimeoutMs:30});const second=reopen(configuration);t.after(()=>second.close());
 const raw=new DatabaseSync(path);try{raw.exec('BEGIN IMMEDIATE');raw.prepare("INSERT INTO categories VALUES('uncommitted','N','uncommitted')").run();assert.equal(value(second,'SELECT count(*) FROM categories'),0);let attempts=0;
 code(()=>db.transaction(ctx=>{attempts++;category(ctx);}),'DATABASE_BUSY');assert.equal(attempts,0);raw.exec('ROLLBACK');db.transaction(ctx=>{attempts++;category(ctx);});assert.equal(attempts,1);
 }finally{raw.close();}
});
test('Idempotência repete resultado, rejeita payload/kind distintos e mantém um único efeito',t=>{
 const {db}=fixture(t);const request={requestId:'idempotent',kind:'test.category',payload:{b:2,a:1}};let count=0;
 const work=ctx=>{count++;category(ctx);return {categoryId:'category'};};const result=db.executeRequest(request,work);
 assert.deepEqual(db.executeRequest({...request,payload:{a:1,b:2}},work),result);assert.equal(count,1);assert.equal(value(db,'SELECT count(*) FROM operation_requests'),1);
 code(()=>db.executeRequest({...request,payload:{a:2,b:2}},work),'REQUEST_CONFLICT');code(()=>db.executeRequest({...request,kind:'other'},work),'REQUEST_CONFLICT');assert.equal(count,1);
});
test('Resultado confirmado é recuperável após fechar e reabrir',t=>{
 const {db,configuration}=fixture(t);const request={requestId:'durable',kind:'test.category',payload:{}};db.executeRequest(request,ctx=>{category(ctx);return {id:'category'};});db.close();
 const next=reopen(configuration);try{assert.deepEqual(next.executeRequest(request,()=>{throw Error('MUST_NOT_REPEAT');}),{id:'category'});assert.equal(value(next,'SELECT count(*) FROM categories'),1);}finally{next.close();}
});
test('Falha antes de commit reverte efeito e request; resultado inválido também reverte',t=>{
 const {db}=fixture(t);const request={requestId:'fail',kind:'test.category',payload:{}};assert.throws(()=>db.executeRequest(request,ctx=>{category(ctx);throw Error('TEST_FAILURE');}));assert.equal(value(db,'SELECT count(*) FROM categories'),0);assert.equal(value(db,'SELECT count(*) FROM operation_requests'),0);
 code(()=>db.executeRequest(request,ctx=>{category(ctx);return {invalid:Number.NaN};}),'INVALID_DATABASE_INPUT');assert.equal(value(db,'SELECT count(*) FROM categories'),0);
 db.executeRequest(request,ctx=>{category(ctx);return null;});assert.equal(value(db,'SELECT count(*) FROM categories'),1);
});
test('Request interrompido permanece diagnosticável e não é executado automaticamente',t=>{
 const {db}=fixture(t);db.transaction(ctx=>ctx.run("INSERT INTO operation_requests(request_id,kind,status,payload_hash,created_at) VALUES('pending','test.pending','interrupted',?,?)",digest('{}'),now));
 code(()=>db.executeRequest({requestId:'pending',kind:'test.pending',payload:{}},()=>{throw Error('MUST_NOT_RUN');}),'REQUEST_INTERRUPTED');assert.equal(db.diagnostics().interruptedRequests.length,1);
});
test('Interrupção abrupta antes/depois do commit mantém atomicidade e resultado durável',()=>{
 const userData=profile();const modulePath=resolve('dist-electron/main/sqlite/database.cjs');
 const run=committed=>spawnSync(process.execPath,['-e',`const {SqliteFoundation}=require(${JSON.stringify(modulePath)}); const db=SqliteFoundation.open({userData:${JSON.stringify(userData)},mode:'test'}); db.executeRequest({requestId:'crash',kind:'test.category',payload:{}},ctx=>{ctx.run("INSERT INTO categories VALUES('crash','Crash','crash')"); ${committed?'return {saved:true};':'process.exit(23);'} }); process.exit(24);`],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,encoding:'utf8'});
 assert.equal(run(false).status,23);let db=reopen({userData,mode:'test'});assert.equal(value(db,'SELECT count(*) FROM categories'),0);assert.equal(value(db,'SELECT count(*) FROM operation_requests'),0);db.close();
 assert.equal(run(true).status,24);db=reopen({userData,mode:'test'});try{assert.deepEqual(db.executeRequest({requestId:'crash',kind:'test.category',payload:{}},()=>{throw Error('REPEATED');}),{saved:true});assert.equal(value(db,'SELECT count(*) FROM categories'),1);}finally{db.close();}
});
test('Perfis development/test/production usam arquivos distintos e independem do cwd',()=>{
 const userData=profile();const modes=['development','test','production'];const paths=modes.map(mode=>databasePath(userData,mode));assert.equal(new Set(paths).size,3);
 for(const mode of modes){const db=reopen({userData,mode});db.transaction(ctx=>category(ctx,mode));db.close();}
 for(const mode of modes){const db=reopen({userData,mode});try{assert.equal(value(db,'SELECT id FROM categories'),mode);}finally{db.close();}}
 code(()=>databasePath('relative','test'),'INVALID_DATABASE_INPUT');
});
test('Banco ausente é criado; arquivo vazio, diretório ou caminho inacessível não são sobrescritos',()=>{
 const userData=profile();const file=databasePath(userData,'test');mkdirSync(join(userData,'data','test'),{recursive:true});writeFileSync(file,'');code(()=>reopen({userData,mode:'test'}),'DATABASE_OPEN_FAILED');assert.equal(readFileSync(file).length,0);
 const blocked=profile();writeFileSync(join(blocked,'data'),'KEEP');code(()=>reopen({userData:blocked,mode:'test'}),'DATABASE_OPEN_FAILED');assert.equal(readFileSync(join(blocked,'data'),'utf8'),'KEEP');
 const directory=profile();mkdirSync(databasePath(directory,'test'),{recursive:true});code(()=>reopen({userData:directory,mode:'test'}),'DATABASE_OPEN_FAILED');
});
test('Corrupção do arquivo é detectada sem apagar ou substituir',()=>{
 const userData=profile();const path=databasePath(userData,'test');mkdirSync(join(userData,'data','test'),{recursive:true});const bytes=Buffer.from('CORRUPTED_DATABASE_PRESERVE');writeFileSync(path,bytes);
 code(()=>reopen({userData,mode:'test'}),'DATABASE_CORRUPT');assert.deepEqual(readFileSync(path),bytes);
});
test('Violação referencial inserida externamente é detectada na inicialização',t=>{
 const {db,path,configuration}=fixture(t);db.close();native(path,raw=>{raw.exec('PRAGMA foreign_keys=OFF');raw.exec("INSERT INTO products(id,name,category_id,price_cents,active) VALUES('bad','N','missing',1,1)");});code(()=>reopen(configuration),'DATABASE_CORRUPT');
});
test('Installation singleton rejeita estado, geração e ativação inválidos',t=>{
 const {db}=fixture(t);
 for(const sql of ["UPDATE installation_state SET status='invalid'","UPDATE installation_state SET generation=0","UPDATE installation_state SET generation=9007199254740992","UPDATE installation_state SET status='production'","INSERT INTO installation_state VALUES(2,'testing','2026-10-09T12:00:00.000Z',NULL,1)"])code(()=>db.transaction(ctx=>ctx.run(sql)),'DATABASE_CONSTRAINT');
 assert.equal(db.installationState().generation,1);assert.equal(value(db,'SELECT count(*) FROM installation_state'),1);
});
test('Estado inválido ou ausente no banco não é recriado silenciosamente',t=>{
 const {db,path,configuration}=fixture(t);db.close();native(path,raw=>{raw.exec('DELETE FROM installation_state');});code(()=>reopen(configuration),'INSTALLATION_STATE_INVALID');native(path,raw=>assert.equal(raw.prepare('SELECT count(*) AS n FROM installation_state').get().n,0));
});
test('Planejamento interno de uso oficial exige evidências e não executa transição/limpeza',t=>{
 const {db}=fixture(t);db.transaction(ctx=>category(ctx));const state=db.installationState();const evidence={authorizedAdmin:true,recentReauthentication:true,verifiedExternalBackup:true,doubleConfirmation:true,phrase:'ZERAR RAIZ PDV'};
 const plan=planInstallationTransition(state,'prepare_for_setup',evidence);assert.deepEqual(plan,{status:'ready_for_setup',generation:2});assert.deepEqual(db.installationState(),state);assert.equal(value(db,'SELECT count(*) FROM categories'),1);
 code(()=>planInstallationTransition(state,'prepare_for_setup',{...evidence,verifiedExternalBackup:false}),'INSTALLATION_STATE_INVALID');code(()=>planInstallationTransition({...state,status:'production'},'prepare_for_setup',evidence),'INSTALLATION_STATE_INVALID');
 assert.deepEqual(planInstallationTransition({...state,status:'ready_for_setup'},'activate',{authorizedAdmin:true,recentReauthentication:true,setupComplete:true}),{status:'production',generation:1});
});
test('Primeiro administrador não é criado automaticamente no SQLite e nenhum dado operacional é importado',t=>{
 const {db}=fixture(t);for(const table of ['operators','operator_credentials','products','store_settings','sales','customer_credits','backup_imports'])assert.equal(value(db,`SELECT count(*) FROM ${table}`),0);
});
test('Data comercial usa America/Sao_Paulo explicitamente e instante UTC inválido é rejeitado',()=>{
 assert.equal(commercialDate('2026-10-09T01:00:00.000Z'),'2026-10-08');assert.equal(commercialDate('2026-10-09T04:00:00.000Z'),'2026-10-09');code(()=>commercialDate('2026-10-09'),'INVALID_DATABASE_INPUT');
});
test('DTO canônico rejeita valores não seguros, ciclos e objetos não JSON',()=>{
 assert.equal(canonicalJson({b:1,a:[null,true,'value']}),' {"a":[null,true,"value"],"b":1}'.trim());for(const v of [NaN,Infinity,1.5,undefined,new Date()])code(()=>canonicalJson(v),'INVALID_DATABASE_INPUT');const loop={};loop.self=loop;code(()=>canonicalJson(loop),'INVALID_DATABASE_INPUT');
});
test('SQLite e qualquer mudança de installation não são expostos pelo preload/renderer',()=>{
 const preload=readFileSync('electron/preload/index.cts','utf8');assert.doesNotMatch(preload,/sqlite|prepare_for_setup|installation_state|runSql|executeRequest/);assert.match(readFileSync('src/application/context.tsx','utf8'),/createWebRepositories/);
});

test('Commit com FK diferida ausente reverte efeito e request junto',t=>{
 const {db}=fixture(t);db.transaction(ctx=>sale(ctx));
 code(()=>db.executeRequest({requestId:'deferred',kind:'test.deferred',payload:{}},ctx=>{
 ctx.run("INSERT INTO financial_refunds(id,sale_id,sale_number_snapshot,method,amount_cents,status,requested_at,completed_at,credit_id) VALUES('orphan-refund','historical-sale',1,'customer_credit',1000,'completed',?,?,'missing-credit')",now,now);
 return {id:'orphan-refund'};
 }),'DATABASE_CONSTRAINT');assert.equal(value(db,'SELECT count(*) FROM financial_refunds'),0);assert.equal(value(db,'SELECT count(*) FROM operation_requests'),0);
});
test('Idempotência concorrente após liberação do writer lock retorna resultado confirmado sem repetir',t=>{
 const {db,configuration,path}=fixture(t,{busyTimeoutMs:30});const second=reopen(configuration);t.after(()=>second.close());
 const request={requestId:'concurrent',kind:'test.category',payload:{}};const raw=new DatabaseSync(path);
 try{raw.exec('BEGIN IMMEDIATE');raw.prepare("INSERT INTO operation_requests(request_id,kind,status,payload_hash,created_at,completed_at,result_json) VALUES('concurrent','test.category','committed',?,?,?,'{\"created\":true}')").run(digest('{}'),now,now);raw.exec("INSERT INTO categories VALUES('concurrent','Concurrent','concurrent')");code(()=>second.executeRequest(request,()=>{throw Error('MUST_NOT_REPEAT');}),'DATABASE_BUSY');raw.exec('COMMIT');assert.deepEqual(second.executeRequest(request,()=>{throw Error('MUST_NOT_REPEAT');}),{created:true});assert.equal(value(db,'SELECT count(*) FROM categories'),1);}finally{raw.close();}
});
test('Estado production e geração persistem; planejamento não autoriza retorno normal a testing',t=>{
 const {db,configuration}=fixture(t);db.transaction(ctx=>ctx.run("UPDATE installation_state SET status='production',activated_at=?,generation=3",now));db.close();
 const next=reopen(configuration);try{const state=next.installationState();assert.equal(state.status,'production');assert.equal(state.generation,3);code(()=>planInstallationTransition(state,'prepare_for_setup',{authorizedAdmin:true,recentReauthentication:true,verifiedExternalBackup:true,doubleConfirmation:true,phrase:'ZERAR RAIZ PDV'}),'INSTALLATION_STATE_INVALID');}finally{next.close();}
});
test('SQLite STRICT rejeita valores financeiros fracionários e fora do intervalo mesmo sem fachada',t=>{
 const {db,path}=fixture(t);db.transaction(ctx=>category(ctx));
 native(path,raw=>{const stmt=raw.prepare("INSERT INTO products(id,name,category_id,price_cents,active) VALUES('unsafe','Unsafe','category',?,1)");assert.throws(()=>stmt.run(1.5));assert.throws(()=>stmt.run(9007199254740992n));assert.equal(raw.prepare('SELECT count(*) AS n FROM products').get().n,0);});
});

test('Diagnóstico de inconsistência bloqueia escritas posteriores nesta conexão',t=>{
 const {db,path}=fixture(t);native(path,raw=>{raw.exec('PRAGMA foreign_keys=OFF');raw.exec("INSERT INTO products(id,name,category_id,price_cents,active) VALUES('bad-live','N','missing',1,1)");});code(()=>db.diagnostics(),'DATABASE_CORRUPT');code(()=>db.transaction(ctx=>category(ctx)),'DATABASE_CORRUPT');
});
