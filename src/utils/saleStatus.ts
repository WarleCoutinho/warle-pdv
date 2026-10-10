import type { Sale, SaleStatus } from '../types/sale';
export function getSaleStatus(sale: Sale): SaleStatus { return sale.status ?? 'completed'; }
export function isCompletedSale(sale: Sale): boolean { return getSaleStatus(sale) === 'completed'; }
