/** Migration 2: additive operational metadata; migration 1 remains immutable. */
export const OPERATIONAL_SCHEMA = `
ALTER TABLE customer_credits ADD COLUMN receipt_ciphertext BLOB CHECK(receipt_ciphertext IS NULL OR length(receipt_ciphertext) BETWEEN 1 AND 4096);
ALTER TABLE operation_requests ADD COLUMN operator_id TEXT REFERENCES operators(id) ON DELETE RESTRICT;
ALTER TABLE operation_requests ADD COLUMN generation INTEGER CHECK(generation IS NULL OR generation BETWEEN 1 AND 9007199254740991);
ALTER TABLE sales ADD COLUMN generation INTEGER NOT NULL DEFAULT 1 CHECK(generation BETWEEN 1 AND 9007199254740991);
ALTER TABLE sales ADD COLUMN operator_name_snapshot TEXT;
ALTER TABLE merchandise_returns ADD COLUMN reason TEXT NOT NULL DEFAULT 'returned_merchandise' CHECK(length(reason) BETWEEN 1 AND 300);
ALTER TABLE financial_refunds ADD COLUMN operator_id TEXT REFERENCES operators(id) ON DELETE RESTRICT;
ALTER TABLE financial_refunds ADD COLUMN completed_by_operator_id TEXT REFERENCES operators(id) ON DELETE RESTRICT;
ALTER TABLE customer_credit_movements ADD COLUMN operator_id TEXT REFERENCES operators(id) ON DELETE RESTRICT;
ALTER TABLE cash_reconciliation_snapshots ADD COLUMN closed_by_operator_id TEXT REFERENCES operators(id) ON DELETE RESTRICT;
CREATE INDEX requests_owner_generation ON operation_requests(operator_id,generation);
CREATE INDEX sales_generation_date ON sales(generation,occurred_at);
`;
