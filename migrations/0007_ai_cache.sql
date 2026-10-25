CREATE TABLE ai_result_cache (
  cache_key TEXT PRIMARY KEY,
  scope_hash TEXT NOT NULL,
  owner_hash TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('shared','session')),
  run_id INTEGER NOT NULL,
  data_captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  markdown TEXT NOT NULL
);
CREATE INDEX ai_result_cache_recent ON ai_result_cache(scope_hash, owner_hash, created_at DESC);
CREATE TABLE ai_call_ledger (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  owner_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','success','error')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ai_one_running ON ai_call_ledger(status) WHERE status='running';
CREATE INDEX ai_call_ledger_day ON ai_call_ledger(day, owner_hash);
