CREATE TABLE pools (
  app_id TEXT PRIMARY KEY,
  pool TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_pools_pool ON pools (pool, created_at);
