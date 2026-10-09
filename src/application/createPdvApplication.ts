import type { PdvRepositories, CompleteSale, Settlement } from '../persistence/contracts';
import type { Sale } from '../types/sale';
import { getOpenCashSession } from '../domain/cashSessions';
/** Application coordination depends on ports only; adapters own compound write guarantees. */
export function createPdvApplication(repositories: PdvRepositories) {
  // A corrupt cash aggregate must not prevent an administrator reaching backup repair.
  const readCashContext = async () => {
    try { return { cash: await repositories.cash.read(), cashError: null as string | null }; }
    catch (failure) { return { cash: { sessions: [], movements: [] }, cashError: failure instanceof Error ? failure.message : 'Não foi possível carregar o caixa.' }; }
  };
  return {
    ...repositories,
    bootstrap: async () => {
      const [products, settings, cashContext, operator] = await Promise.all([repositories.products.list(), repositories.settings.load(), readCashContext(), repositories.operators.current()]);
      return { products, settings, ...cashContext, operator };
    },
    context: async () => {
      const [settings, cashContext, operator] = await Promise.all([repositories.settings.load(), readCashContext(), repositories.operators.current()]);
      return { settings, ...cashContext, operator };
    },
    completeSale: (input: CompleteSale) => repositories.sales.complete(structuredClone(input)),
    recordReturn: async (sale: Sale, quantities: Record<string, number>) => {
      const current = getOpenCashSession(await repositories.cash.read());
      return repositories.financial.recordReturn(sale, quantities, current?.id);
    },
    settle: async (sale: Sale, input: Settlement) => {
      const current = getOpenCashSession(await repositories.cash.read());
      return repositories.financial.settle(sale, { ...input, cashSessionId: current?.id });
    },
    updateRefund: async (id: string, status: 'completed' | 'failed') => {
      const current = status === 'completed' ? getOpenCashSession(await repositories.cash.read()) : undefined;
      return repositories.financial.updateRefund(id, status, current?.id);
    },
  };
}
export type PdvApplication = ReturnType<typeof createPdvApplication>;
