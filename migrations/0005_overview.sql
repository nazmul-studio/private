-- Real overview data: where each session signed in from (Cloudflare request.cf) and hourly traffic counters.
ALTER TABLE active_sessions ADD COLUMN country TEXT;
ALTER TABLE active_sessions ADD COLUMN city TEXT;
ALTER TABLE active_sessions ADD COLUMN lat REAL;
ALTER TABLE active_sessions ADD COLUMN lon REAL;
CREATE TABLE traffic_hourly (hour INTEGER PRIMARY KEY, req INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0);
