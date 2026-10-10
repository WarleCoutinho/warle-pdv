/** Additive migration 3. Published migrations 1/2 remain unchanged. */
export const LIFECYCLE_SCHEMA = `
ALTER TABLE installation_state ADD COLUMN installation_id TEXT CHECK(installation_id IS NULL OR (length(installation_id)=32 AND installation_id NOT GLOB '*[^0-9a-f]*'));
UPDATE installation_state SET installation_id=lower(hex(randomblob(16)));
CREATE TABLE installation_audit(id TEXT PRIMARY KEY NOT NULL,kind TEXT NOT NULL,generation INTEGER NOT NULL,occurred_at TEXT NOT NULL,details_json TEXT NOT NULL CHECK(json_valid(details_json))) STRICT;
CREATE TABLE native_drafts(operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,generation INTEGER NOT NULL,items_json TEXT NOT NULL CHECK(json_valid(items_json)),updated_at TEXT NOT NULL,PRIMARY KEY(operator_id,generation)) STRICT;
CREATE TABLE legacy_records(kind TEXT NOT NULL,id TEXT NOT NULL,original_json TEXT NOT NULL CHECK(json_valid(original_json)),PRIMARY KEY(kind,id)) STRICT;
ALTER TABLE sale_items ADD COLUMN legacy_line INTEGER NOT NULL DEFAULT 0 CHECK(legacy_line IN (0,1));
`;
