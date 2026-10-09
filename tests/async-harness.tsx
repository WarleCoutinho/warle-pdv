// Test-only entry point. Uses the real web adapter with controlled latency/failures.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/App';
import { createWebRepositories } from '../src/persistence';
import { createPdvApplication } from '../src/application/createPdvApplication';
const options = (window as any).harnessOptions ?? {};
const repositories = createWebRepositories();
const realSnapshot = repositories.financial.snapshot;
const realDraft = repositories.draft.load;
const realComplete = repositories.sales.complete;
const realProducts = repositories.products.list;
const harness = (window as any).harness = { pending: [], holdSnapshots: false, completeCalls: 0, failComplete: false, failProducts: options.failProducts ?? false, draftPending: null, savePending: null, holdComplete: false, repositories };
repositories.products.list = async () => { if (harness.failProducts) throw new Error('Falha de carregamento simulada'); return realProducts(); };
repositories.financial.snapshot = async () => {
  const value = await realSnapshot();
  if (!harness.holdSnapshots) return value;
  return new Promise((resolve, reject) => harness.pending.push({ value, resolve, reject }));
};
repositories.draft.load = async (products) => {
  const value = await realDraft(products);
  if (!options.holdDraft) return value;
  return new Promise((resolve) => { harness.draftPending = () => resolve(value); });
};
repositories.sales.complete = async (input) => {
  harness.completeCalls++;
  if (harness.holdComplete) await new Promise<void>((resolve) => { harness.savePending = resolve; });
  if (harness.failComplete) throw new Error('Falha de persistência simulada');
  return realComplete(input);
};
const root = createRoot(document.getElementById('root')!);
harness.unmount = () => root.unmount();
root.render(<App application={createPdvApplication(repositories)} />);
