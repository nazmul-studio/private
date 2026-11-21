CREATE TABLE owner_config (id INTEGER PRIMARY KEY CHECK (id = 1), password_hash TEXT NOT NULL, secret_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE active_sessions (id_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
CREATE TABLE media_metadata (id TEXT PRIMARY KEY, r2_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL CHECK (size > 0), created_at INTEGER NOT NULL);
CREATE INDEX idx_media_created ON media_metadata (created_at DESC);
CREATE TABLE security_audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, event TEXT NOT NULL, ip_hash TEXT);
CREATE INDEX idx_audit_at ON security_audit_logs (at DESC);
