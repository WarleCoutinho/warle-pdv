import type { StoreSettings } from '../types/settings';

const SETTINGS_STORAGE_KEY = 'raiz-pdv:settings';
export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  storeName: 'Raiz',
  address: '',
  phone: '',
  receiptFooter: 'Obrigado pela preferência!',
};

export function loadSettings(): StoreSettings {
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (raw === null) {
    const defaults = { ...DEFAULT_STORE_SETTINGS };
    saveSettings(defaults);
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
  const normalized: StoreSettings = {
    storeName: settings.storeName.trim(),
    address: settings.address.trim(),
    phone: settings.phone.trim(),
    receiptFooter: settings.receiptFooter.trim(),
  };
  if (!isStoreSettings(normalized)) throw new Error('Informe um nome válido e um rodapé com até 200 caracteres.');
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    throw new Error('Não foi possível salvar as configurações no armazenamento local.');
  }
  return normalized;
}

export function clearStoredSettings(): void {
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
}

function isStoreSettings(value: unknown): value is StoreSettings {
  if (typeof value !== 'object' || value === null) return false;
  const settings = value as Record<string, unknown>;
  return typeof settings.storeName === 'string' && settings.storeName.trim().length > 0
    && typeof settings.address === 'string'
    && typeof settings.phone === 'string'
    && typeof settings.receiptFooter === 'string' && settings.receiptFooter.length <= 200;
}

