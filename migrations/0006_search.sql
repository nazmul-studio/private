-- AI photo search: a text description of each photo/video thumbnail and its embedding.
-- indexed_at: NULL = not analysed yet, -1 = analysis failed (retry from Settings), otherwise the time it was analysed.
ALTER TABLE media_metadata ADD COLUMN description TEXT;
ALTER TABLE media_metadata ADD COLUMN indexed_at INTEGER;
CREATE TABLE media_vectors (id TEXT PRIMARY KEY, vec TEXT NOT NULL);
