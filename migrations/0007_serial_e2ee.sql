-- Serial numbers (#1, #2, ... never reused) and end-to-end encrypted files.
-- enc=1: the file, its thumbnail and its name were encrypted in the browser; enc_name holds the encrypted name, name is only a placeholder.
ALTER TABLE media_metadata ADD COLUMN serial INTEGER;
ALTER TABLE media_metadata ADD COLUMN enc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media_metadata ADD COLUMN enc_name TEXT;
ALTER TABLE upload_sessions ADD COLUMN enc INTEGER NOT NULL DEFAULT 0;
UPDATE media_metadata SET serial = (SELECT COUNT(*) FROM media_metadata m WHERE m.created_at < media_metadata.created_at OR (m.created_at = media_metadata.created_at AND m.id <= media_metadata.id));
CREATE UNIQUE INDEX idx_media_serial ON media_metadata (serial);
INSERT OR REPLACE INTO system_settings(key,value) VALUES ('serial_counter', CAST((SELECT COALESCE(MAX(serial),0) FROM media_metadata) AS TEXT));
