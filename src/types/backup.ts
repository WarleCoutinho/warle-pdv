import type { Product } from './product';
import type { StoreSettings } from './settings';
import type { Sale } from './sale';
import type { CashData } from './cash';
import type { SaleFinancialData } from './customerCredit';
export type BackupData = { products: Product[]; settings: StoreSettings; sales: Sale[]; cash: CashData; financial: SaleFinancialData };
export type BackupDocument = { format: 'raiz-pdv-backup'; version: 2; exportedAt: string; data: BackupData; integrity: { algorithm: 'fnv1a-32'; checksum: string } };
export type BackupSummary = { exportedAt: string; products: number; activeProducts: number; sales: number; cancelledSales: number; cashSessions: number; closedSessions: number; cashMovements: number; returns: number; refunds: number; customerCredits: number };
