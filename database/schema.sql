-- Control Unit owns only these prefixed tables. Safe to apply repeatedly.
BEGIN;
SELECT pg_advisory_xact_lock(22453, 1);
CREATE TABLE IF NOT EXISTS cu_records (id TEXT PRIMARY KEY, origin TEXT NOT NULL, data JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS cu_records_origin_idx ON cu_records(origin);
CREATE TABLE IF NOT EXISTS cu_sources (origin TEXT NOT NULL, path TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY(origin,path));
CREATE TABLE IF NOT EXISTS cu_analysis_cache (key TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS cu_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL CHECK (calls >= 0));
COMMIT;
