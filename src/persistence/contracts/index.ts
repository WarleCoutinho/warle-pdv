import type { Product, CartItem } from '../../types/product';
import type { StoreSettings, CashOperator } from '../../types/settings';
import type { Sale, SaleCancellationReason } from '../../types/sale';
import type { SalePayment, PaymentMethod } from '../../types/payment';
import type { CashData, CashMovement } from '../../types/cash';
import type { CustomerCredit, SaleFinancialData } from '../../types/customerCredit';
import type { BackupDocument, BackupSummary } from '../../types/backup';
import type { CashPaymentTotals } from '../../domain/cash';
export type FinancialSnapshot = { sales: Sale[]; cash: CashData; financial: SaleFinancialData };
export type CompleteSale = { items: CartItem[]; totalInCents: number; payments: SalePayment[]; cashSessionId: string };
export type Settlement = { amounts: Record<PaymentMethod | 'customer_credit', number>; statuses?: Partial<Record<PaymentMethod, 'completed' | 'pending'>>; cashSessionId?: string };
export type PublicCredit = Omit<CustomerCredit, 'authCodeHash'>;
export interface ProductRepository { list(): Promise<Product[]>; replaceCatalog(products: Product[]): Promise<void>; }
export interface SettingsRepository { load(): Promise<StoreSettings>; save(settings: StoreSettings, passwords?: Record<string, string>): Promise<StoreSettings>; }
/** Credentials remain persistent; authentication state remains scoped to this window/tab. */
export interface OperatorRepository { list(): Promise<CashOperator[]>; current(): Promise<CashOperator | null>; login(username: string, password: string): Promise<CashOperator>; logout(): Promise<void>; hasDefaultPassword(): Promise<boolean>; }
/** Each command owns validation, concurrency and all related financial writes. Do not expose ledger CRUD. */
export interface SaleRepository { list(): Promise<Sale[]>; getById(id: string): Promise<Sale | null>; complete(input: CompleteSale): Promise<Sale>; cancel(id: string, reason: SaleCancellationReason, note?: string): Promise<Sale>; }
export interface CashRepository { read(): Promise<CashData>; open(amountInCents: number, operatorId: string): Promise<CashData>; move(sessionId: string, type: CashMovement['type'], amountInCents: number, description: string): Promise<CashData>; close(sessionId: string, counts: CashPaymentTotals, reviewedFingerprint: string): Promise<CashData>; }
export interface FinancialRepository { snapshot(): Promise<FinancialSnapshot>; recordReturn(sale: Sale, quantities: Record<string, number>, cashSessionId?: string): Promise<SaleFinancialData>; settle(sale: Sale, input: Settlement): Promise<{ data: SaleFinancialData; issuedCredits: Array<{ credit: CustomerCredit; authCode: string }> }>; updateRefund(id: string, status: 'completed' | 'failed', cashSessionId?: string): Promise<SaleFinancialData>; recover(): Promise<void>; }
/** authenticate must establish an adapter-side authorization checked again by SaleRepository.complete.
 * Reservation, consumption and restoration belong exclusively to complete/cancel/recover commands. */
export interface CustomerCreditRepository { search(query: string): Promise<PublicCredit[]>; authenticate(query: string, code: string): Promise<PublicCredit | undefined>; }
export interface DraftRepository { load(products: Product[]): Promise<CartItem[]>; save(items: CartItem[]): Promise<void>; }
export interface BackupRepository { exportJson(): Promise<string>; validateJson(contents: string): Promise<{ backup: BackupDocument; summary: BackupSummary }>; import(backup: BackupDocument): Promise<void>; safetyCopy(): Promise<string | null>; clearLocalData(): Promise<void>; }
export type ChangeTopic = 'products' | 'settings' | 'operator' | 'cash' | 'sales' | 'financial' | 'draft';
export interface ChangeSubscription { subscribe(topics: readonly ChangeTopic[], listener: () => void): () => void; }
export interface PdvRepositories { products: ProductRepository; settings: SettingsRepository; operators: OperatorRepository; sales: SaleRepository; cash: CashRepository; financial: FinancialRepository; credits: CustomerCreditRepository; draft: DraftRepository; backups: BackupRepository; changes: ChangeSubscription; }
