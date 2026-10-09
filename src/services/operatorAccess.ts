import type { CashOperator } from '../types/settings';
import { loadSettings } from './settingsStorage';
export const OPERATOR_SESSION_KEY = 'raiz-pdv:operator-session';
import { withDefaultAdmin } from './operatorDefaults';
export { DEFAULT_ADMIN, withDefaultAdmin } from './operatorDefaults';
export function getCurrentOperator(): CashOperator | null {
  try {
    const raw = sessionStorage.getItem(OPERATOR_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    const operator = withDefaultAdmin(loadSettings().operators).find((item) => item.id === session.id && item.active && item.passwordDigest && item.passwordDigest === session.credential);
    return operator ?? null;
  } catch { return null; }
}
export function requireOperator(): CashOperator {
  const operator = getCurrentOperator();
  if (!operator) throw new Error('Entre com operador e senha para continuar.');
  return operator;
}
export function requireAdministrator(): CashOperator {
  const operator = requireOperator();
  if (operator.role !== 'admin') throw new Error('Somente o administrador pode alterar configurações e cadastrar operadores.');
  return operator;
}
export function requireCashOwner(operatorId?: string, allowAdministrator = false): CashOperator {
  const operator = requireOperator();
  if (operator.id !== operatorId && !(allowAdministrator && operator.role === 'admin')) throw new Error('Este caixa pertence a outro operador. Entre com o operador responsável.');
  return operator;
}
export function logoutOperator(): void { sessionStorage.removeItem(OPERATOR_SESSION_KEY); }
export async function loginOperator(username: string, password: string): Promise<CashOperator> {
  const operator = withDefaultAdmin(loadSettings().operators).find((item) => (item.username ?? item.name).trim().toLocaleLowerCase('pt-BR') === username.trim().toLocaleLowerCase('pt-BR') && item.active);
  if (!operator?.passwordDigest || !(await verifyPassword(password, operator.passwordDigest))) throw new Error('Operador ou senha incorretos.');
  // Re-read after hashing: an account can be changed or disabled in another tab.
  const current = withDefaultAdmin(loadSettings().operators).find((item) => item.id === operator.id && item.active && item.passwordDigest === operator.passwordDigest);
  if (!current) throw new Error('O cadastro mudou. Entre novamente.');
  sessionStorage.setItem(OPERATOR_SESSION_KEY, JSON.stringify({ id: current.id, credential: current.passwordDigest }));
  return current;
}
export async function createPasswordDigest(password: string): Promise<string> {
  if (password.length < 6 || password.length > 128) throw new Error('A senha deve ter de 6 a 128 caracteres.');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2$210000$${salt}$${await derive(password, salt, 210000)}`;
}
export function isPasswordDigest(value: unknown): value is string { return typeof value === 'string' && /^pbkdf2\$210000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(value); }
async function verifyPassword(password: string, digest: string): Promise<boolean> {
  if (!isPasswordDigest(digest) || password.length > 128) return false;
  const [, iterations, salt, expected] = digest.split('$');
  const actual = await derive(password, salt, Number(iterations));
  let mismatch = 0; for (let index = 0; index < expected.length; index++) mismatch |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  return mismatch === 0;
}
async function derive(password: string, salt: string, iterations: number): Promise<string> {
  if (!crypto?.subtle) throw new Error('Este navegador não oferece proteção de senha. Use o PDV em localhost.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const saltBytes = Uint8Array.from(salt.match(/../g)!, (pair) => parseInt(pair, 16));
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, key, 256)));
}
function hex(bytes: Uint8Array): string { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''); }
