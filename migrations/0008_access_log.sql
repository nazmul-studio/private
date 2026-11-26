-- Append-only access log: who signed in (or tried to), from where, on which device.
-- The triggers make UPDATE and DELETE fail, so nothing in the app (or a hacked session) can edit or remove a record.
CREATE TABLE IF NOT EXISTS access_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, event TEXT NOT NULL, severity TEXT NOT NULL, ip TEXT, country TEXT, region TEXT, city TEXT, postal TEXT, lat REAL, lon REAL, tz TEXT, asn INTEGER, org TEXT, colo TEXT, ua TEXT, device TEXT, client TEXT, geo_status TEXT, gps_lat REAL, gps_lon REAL, gps_acc REAL, method TEXT, path TEXT, status INTEGER);
CREATE INDEX IF NOT EXISTS idx_access_at ON access_logs (at DESC);
CREATE INDEX IF NOT EXISTS idx_access_ip ON access_logs (ip, event, at DESC);
CREATE TRIGGER IF NOT EXISTS access_logs_no_update BEFORE UPDATE ON access_logs BEGIN SELECT RAISE(ABORT, 'access_logs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS access_logs_no_delete BEFORE DELETE ON access_logs BEGIN SELECT RAISE(ABORT, 'access_logs is append-only'); END;
-- the older audit table gets the same protection
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON security_audit_logs BEGIN SELECT RAISE(ABORT, 'security_audit_logs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON security_audit_logs BEGIN SELECT RAISE(ABORT, 'security_audit_logs is append-only'); END;
