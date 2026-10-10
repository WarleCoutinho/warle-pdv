import type { CashOperator } from '../types/settings';
export const DEFAULT_ADMIN: CashOperator = { id: 'raiz-admin', name: 'Administrador Mestre', username: 'Admin', role: 'admin', active: true, passwordDigest: 'pbkdf2$210000$f0b1c2d3e4a5968778695a4b3c2d1e0f$b84de8daef4e4446728eae9b4538c581263a0016be025069784688ab3df51d56' };
export function withDefaultAdmin(operators: CashOperator[] = []): CashOperator[] {
  if (operators.some((operator) => operator.role === 'admin')) return operators;
  return [...operators.map((operator) => ({ ...operator, username: (operator.username ?? operator.name).toLocaleLowerCase('pt-BR') === 'admin' ? `Admin-${operator.id}` : operator.username ?? operator.name })), { ...DEFAULT_ADMIN }];
}
