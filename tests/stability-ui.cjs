const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const context=await browser.newContext({timezoneId:'America/Sao_Paulo',viewport:{width:1280,height:950}});
  const page=await context.newPage();
  page.setDefaultTimeout(10000);
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   if(localStorage.getItem('stability-seeded'))return;
   const now=new Date().toISOString();
   localStorage.setItem('raiz-pdv:products',JSON.stringify([{id:'p1',name:'Produto inicial',category:'Bebidas',priceInCents:500,active:true,emoji:'X'}]));
   localStorage.setItem('raiz-pdv:cash',JSON.stringify({sessions:[{id:'today',operatorId:'raiz-admin',operatorName:'Administrador Mestre',openedAt:now,openingAmountInCents:10000,status:'open'}],movements:[]}));
   localStorage.setItem('raiz-pdv:completed-sales',JSON.stringify([{id:'repeated',number:1,date:now,status:'completed',cashSessionId:'today',items:[{productId:'p',productName:'Mesmo produto',quantity:2,unitPriceInCents:500,subtotalInCents:1000},{productId:'p',productName:'Mesmo produto',quantity:1,unitPriceInCents:700,subtotalInCents:700}],totalInCents:1700,payments:[{method:'pix',amountInCents:1700}]}]));
   localStorage.setItem('stability-seeded','yes');
  });
  const login=async tab=>{
   await tab.getByRole('textbox',{name:'Operador',exact:true}).fill('Admin');
   await tab.getByLabel('Senha',{exact:true}).fill('123456');
   await tab.getByRole('button',{name:'Entrar',exact:true}).click();
   await tab.getByRole('button',{name:'Sair / trocar operador',exact:true}).waitFor();
  };
  await page.goto('http://127.0.0.1:5173/'); await login(page);
  await page.getByRole('button',{name:'Nova venda',exact:true}).click();
  await page.getByTestId('product-p1').waitFor();
  const other=await context.newPage();await other.goto('http://127.0.0.1:5173/');await login(other);
  await other.evaluate(async()=>{
   const {saveProducts}=await import('/src/services/productStorage.ts');
   saveProducts([{id:'p1',name:'Produto renomeado',category:'Nova categoria',priceInCents:900,active:true,emoji:'X'},{id:'p2',name:'Novo produto',category:'Outra categoria',priceInCents:1200,active:true,emoji:'X'}]);
  });
  await page.getByRole('button',{name:'Adicionar Produto renomeado, R$ 9,00',exact:true}).waitFor();
  await page.getByRole('button',{name:'Nova categoria',exact:true}).click();
  assert.equal(await page.locator('.product').count(),1);
  await other.evaluate(async()=>{
   const {loadProducts,saveProducts}=await import('/src/services/productStorage.ts');
   saveProducts(loadProducts().map(item=>item.id==='p1'?{...item,active:false}:item));
  });
  await page.getByTestId('product-p1').waitFor({state:'detached'});
  await page.getByTestId('product-p2').waitFor();
  assert.equal(await page.getByRole('button',{name:'Nova categoria',exact:true}).count(),0);
  await page.getByRole('searchbox',{name:'Buscar produto pelo nome'}).fill('NOVO');
  assert.equal(await page.locator('.product').count(),1);
  await page.evaluate(async()=>{
   const {loadProducts,saveProducts}=await import('/src/services/productStorage.ts');
   saveProducts(loadProducts().map(item=>item.id==='p2'?{...item,name:'Atualizado na mesma aba',priceInCents:1400}:item));
  });
  await page.locator('.catalog-empty').waitFor();
  await page.getByRole('searchbox',{name:'Buscar produto pelo nome'}).fill('atualizado');
  await page.getByRole('button',{name:'Adicionar Atualizado na mesma aba, R$ 14,00',exact:true}).waitFor();
  await page.getByRole('button',{name:'Histórico',exact:true}).click();
  await page.getByRole('button',{name:'Ver detalhes',exact:true}).click();
  await page.getByRole('button',{name:'Devolver produtos',exact:true}).click();
  const inputs=page.getByRole('spinbutton',{name:'Quantidade devolvida de Mesmo produto',exact:true});
  assert.equal(await inputs.count(),2);
  await inputs.nth(1).fill('1');
  await page.getByRole('button',{name:'Confirmar itens e continuar'}).click();
  assert.equal(await page.locator('#settlement-customer_credit').inputValue(),'7,00');
  await page.getByRole('button',{name:'Gerar crédito do cliente',exact:true}).click();
  await page.getByRole('heading',{name:'Crédito emitido',exact:true}).waitFor();
  const returned=await page.evaluate(()=>JSON.parse(localStorage.getItem('raiz-pdv:sale-financial-data')).returns[0].items[0]);
  assert.equal(returned.lineId,'legacy-line-2');assert.equal(returned.amountInCents,700);
  await page.getByRole('button',{name:'Fechar comprovante de crédito',exact:true}).click();
  await page.evaluate(()=>{
   const sales=JSON.parse(localStorage.getItem('raiz-pdv:completed-sales'));
   sales.push({id:'concurrent',number:2,date:new Date().toISOString(),cashSessionId:'today',status:'cancelled',cancelledAt:new Date().toISOString(),cancellationReason:'customer_cancelled',items:[{productId:'p1',productName:'Concorrência',unitPriceInCents:500,quantity:1,subtotalInCents:500}],totalInCents:500,payments:[{method:'pix',amountInCents:500}]});
   localStorage.setItem('raiz-pdv:completed-sales',JSON.stringify(sales));
  });
  const emit=()=>import('/src/services/saleFinancialStorage.ts').then(async service=>{
   const sale=JSON.parse(localStorage.getItem('raiz-pdv:completed-sales')).find(item=>item.id==='concurrent');
   try{const result=await service.settleSaleBalance(sale,{amounts:{cash:0,pix:0,debit:0,credit:0,customer_credit:500},cashSessionId:'today'});window.__testCredit=result.issuedCredits[0];return 'ok';}catch{return 'blocked';}
  });
  const results=await Promise.all([page.evaluate(emit),other.evaluate(emit)]);
  const winner=results[0]==='ok'?page:other;
  assert.deepEqual([...results].sort(),['blocked','ok']);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('raiz-pdv:sale-financial-data')).credits.filter(item=>item.originalSaleId==='concurrent').length),1);
  const issued=await winner.evaluate(()=>window.__testCredit);
  await Promise.all([page,other].map(tab=>tab.evaluate(async issued=>{
   const service=await import('/src/services/saleStorage.ts');
   await service.lookupCustomerCredit(issued.credit.receiptNumber,issued.authCode);
  },issued)));
  const consume=issued=>import('/src/services/saleStorage.ts').then(async service=>{
   const item={product:{id:'p2',name:'Concorrência real',category:'Geral',priceInCents:400,active:true,emoji:'X'},quantity:1,unitPriceInCents:400,subtotalInCents:400};
   try {await service.saveCompletedSaleWithCustomerCredit([item],400,[{method:'customer_credit',customerCreditId:issued.credit.id,amountInCents:400}],'today');return 'ok';}catch(error){return error.message;}
  });
  const consumed=await Promise.all([page.evaluate(consume,issued),other.evaluate(consume,issued)]);
  assert.equal(consumed.filter(item=>item==='ok').length,1,consumed.join(' | '));
  const final=await page.evaluate(id=>{
   const data=JSON.parse(localStorage.getItem('raiz-pdv:sale-financial-data'));
   return {balance:data.credits.find(item=>item.id===id).balanceInCents,redemptions:data.creditMovements.filter(item=>item.creditId===id&&item.type==='redeemed').length};
  },issued.credit.id);
  assert.deepEqual(final,{balance:100,redemptions:1});
  await page.getByRole('button',{name:'Voltar ao histórico'}).click();
  await page.evaluate(async()=>{
   const {loadProducts,saveProducts}=await import('/src/services/productStorage.ts');
   saveProducts([...loadProducts(),{id:'p3',name:'Teste crédito',category:'Geral',priceInCents:50,active:true,emoji:'X'}]);
  });
  await page.getByRole('button',{name:'Nova venda',exact:true}).click();
  await page.getByTestId('product-p3').click();
  await page.getByRole('button',{name:'Finalizar venda'}).click();
  await page.getByRole('button',{name:'Crédito cliente'}).click();
  await page.getByLabel('Comprovante ou venda original',{exact:true}).fill(issued.credit.receiptNumber);
  await page.getByLabel('Código de autorização',{exact:true}).fill(issued.authCode);
  await page.getByRole('button',{name:'Adicionar pagamento',exact:true}).click();
  await page.getByRole('button',{name:'Finalizar venda',exact:true}).click();
  await page.getByRole('heading',{name:'Venda concluída!',exact:true}).waitFor();
  assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('raiz-pdv:sale-financial-data')).credits.find(item=>item.id===id).balanceInCents,issued.credit.id),50);
  assert.deepEqual(errors,[]);
  console.log('PASS: catálogo atualizado sem reload, nome/preço/categoria/situação, pesquisa, linhas repetidas emissão e baixa concorrentes reais entre abas e autorização no pagamento.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
