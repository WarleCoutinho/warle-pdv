import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../',import.meta.url));
// Exercise the exact SQLite/Node binary shipped with Electron, not the terminal Node.
const result = spawnSync(require('electron'),['--test','--test-concurrency=1','tests/sqlite-foundation.test.cjs','tests/sqlite-backend.test.cjs','tests/sqlite-security.test.cjs','tests/sqlite-credits.test.cjs','tests/sqlite-concurrency.test.cjs','tests/sqlite-conformance.test.cjs','tests/sqlite-recovery.test.cjs','tests/sqlite-ipc.test.cjs'],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit',windowsHide:true});
if (result.error) { console.error('SQLITE_TEST_RUNTIME_FAILED'); process.exitCode=1; } else process.exitCode=result.status ?? 1;
