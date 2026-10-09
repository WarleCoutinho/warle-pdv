import { DEFAULT_ADMIN, withDefaultAdmin } from './operatorDefaults';
import { requireAdministrator, isPasswordDigest } from './operatorAccess';
import type { StoreSettings } from '../types/settings';

export const SETTINGS_STORAGE_KEY = 'raiz-pdv:settings';

export function validateSettingsBackup(value: unknown): StoreSettings {
  if (!isStoreSettings(value)) throw new Error('As configurações do backup são inválidas.');
  return value;
}
export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  operators: [{ ...DEFAULT_ADMIN }],
  storeName: 'Raiz',
  address: '',
  phone: '',
  receiptFooter: 'Obrigado pela preferência!',
};

export function loadSettings(): StoreSettings {
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (raw === null) {
    const defaults = { ...DEFAULT_STORE_SETTINGS };
    writeSettings(defaults);
    return defaults;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('As configurações salvas estão inválidas.');
  }
  if (!isStoreSettings(value)) throw new Error('As configurações salvas estão inválidas.');
  return value;
}

export function saveSettings(settings: StoreSettings): StoreSettings {
  requireAdministrator();
  const normalized: StoreSettings = {
    ...(settings.operators ? { operators: withDefaultAdmin(settings.operators).map((operator) => ({ ...operator, name: operator.name.trim() })) } : {}),
    storeName: settings.storeName.trim(),
    address: settings.address.trim(),
    phone: settings.phone.trim(),
    receiptFooter: settings.receiptFooter.trim(),
  };
  if (!isStoreSettings(normalized)) throw new Error('Informe dados válidos da loja, rodapé de até 200 caracteres e operadores sem nomes duplicados.');
  if (!normalized.operators?.some((operator) => operator.role === 'admin' && operator.active && operator.passwordDigest)) throw new Error('Mantenha ao menos um administrador ativo com senha.');
  writeSettings(normalized);
  return normalized;
}

function writeSettings(normalized: StoreSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    throw new Error('Não foi possível salvar as configurações no armazenamento local.');
  }
}

export function initializeOperatorAccess(): StoreSettings {
  const settings = loadSettings();
  if (!settings.operators?.some((operator) => operator.role === 'admin')) { const next = { ...settings, operators: withDefaultAdmin(settings.operators) }; writeSettings(next); return next; }
  return settings;
}

export function clearStoredSettings(): void {
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
}

function isStoreSettings(value: unknown): value is StoreSettings {
  if (typeof value !== 'object' || value === null) return false;
  const settings = value as Record<string, unknown>;
  if (settings.operators !== undefined && (!Array.isArray(settings.operators) || !settings.operators.every((operator: any) => operator && typeof operator.id === 'string' && !!operator.id && typeof operator.name === 'string' && operator.name.trim().length > 0 && operator.name.length <= 80 && typeof operator.active === 'boolean') || new Set(settings.operators.map((operator: any) => operator.id)).size !== settings.operators.length || new Set(settings.operators.map((operator: any) => operator.name.trim().toLocaleLowerCase('pt-BR'))).size !== settings.operators.length)) return false;
  if (Array.isArray(settings.operators)) {
    const operators = settings.operators;
    if (operators.some((operator: any) => (operator.username !== undefined && (typeof operator.username !== 'string' || !operator.username.trim() || operator.username.length > 80)) || (operator.role !== undefined && !['admin', 'operator'].includes(operator.role)) || (operator.passwordDigest !== undefined && !isPasswordDigest(operator.passwordDigest)) || (operator.role === 'admin' && !operator.passwordDigest))) return false;
    const usernames = operators.map((operator: any) => (operator.username ?? operator.name).trim().toLocaleLowerCase('pt-BR'));
    if (new Set(usernames).size !== usernames.length || (operators.some((operator: any) => operator.role === 'admin') && !operators.some((operator: any) => operator.role === 'admin' && operator.active && operator.passwordDigest))) return false;
  }
  return typeof settings.storeName === 'string' && settings.storeName.trim().length > 0
    && typeof settings.address === 'string'
    && typeof settings.phone === 'string'
    && typeof settings.receiptFooter === 'string' && settings.receiptFooter.length <= 200;
}

