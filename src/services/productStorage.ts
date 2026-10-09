import { products as initialProducts } from '../data/products';
import type { Product } from '../types/product';

export const PRODUCTS_STORAGE_KEY = 'raiz-pdv:products';
const MAX_PRODUCT_IMAGE_DATA_URL_LENGTH = 700_000;

export function validateProductsBackup(value: unknown): Product[] {
  if (!Array.isArray(value) || !value.every(isProduct)) throw new Error('A lista de produtos do backup é inválida.');
  return value;
}

/** Loads the saved catalog, seeding and saving the demo catalog on first run. */
export function loadProducts(): Product[] {
  const raw = localStorage.getItem(PRODUCTS_STORAGE_KEY);
  if (raw === null) {
    const seeded = initialProducts.map((product) => ({ ...product }));
    saveProducts(seeded);
    return seeded;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Os produtos salvos estão inválidos.');
  }
  if (!Array.isArray(value) || !value.every(isProduct)) {
    throw new Error('Os produtos salvos estão inválidos.');
  }
  return value;
}

export function saveProducts(products: Product[]): void {
  if (!products.every(isProduct)) throw new Error('Os dados dos produtos são inválidos.');
  try {
    localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(products));
  } catch {
    throw new Error('Não foi possível salvar os produtos no armazenamento local.');
  }
}

export function clearStoredProducts(): void {
  localStorage.removeItem(PRODUCTS_STORAGE_KEY);
}

function isProduct(value: unknown): value is Product {
  if (typeof value !== 'object' || value === null) return false;
  const product = value as Record<string, unknown>;
  return typeof product.id === 'string' && product.id.length > 0
    && typeof product.name === 'string' && product.name.trim().length > 0
    && Number.isSafeInteger(product.priceInCents) && Number(product.priceInCents) > 0
    && typeof product.category === 'string' && product.category.trim().length > 0
    && typeof product.active === 'boolean'
    && typeof product.emoji === 'string'
    && (product.imageDataUrl === undefined || (typeof product.imageDataUrl === 'string'
      && /^data:image\/(?:png|webp|svg\+xml);base64,/i.test(product.imageDataUrl)
      && product.imageDataUrl.length <= MAX_PRODUCT_IMAGE_DATA_URL_LENGTH));
}

