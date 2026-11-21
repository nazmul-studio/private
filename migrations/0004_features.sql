CREATE TABLE auth_factors (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('passkey')), cred_id TEXT NOT NULL UNIQUE, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]', name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE webauthn_challenges (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, purpose TEXT NOT NULL CHECK (purpose IN ('reg','auth','proof')), expires_at INTEGER NOT NULL);
CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
ALTER TABLE media_metadata ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media_metadata ADD COLUMN deleted_at INTEGER;
ALTER TABLE media_metadata ADD COLUMN has_thumb INTEGER NOT NULL DEFAULT 0;
CREATE TABLE collections (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('album','folder')), name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE collection_items (collection_id TEXT NOT NULL, media_id TEXT NOT NULL, PRIMARY KEY (collection_id, media_id));
CREATE INDEX idx_items_media ON collection_items (media_id);
