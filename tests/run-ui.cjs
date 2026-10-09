const { spawnSync } = require('node:child_process');
try { require.resolve('playwright'); }
catch { console.error('Instale as dependências com npm install. Os testes de interface usam Playwright e Microsoft Edge instalado.'); process.exit(1); }
for (const file of ['tests/operators-ui.cjs', 'tests/devolution-ui.cjs', 'tests/stability-ui.cjs']) {
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit', env: process.env });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
