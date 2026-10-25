CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin')),
  password_hash TEXT,
  recovery_hash TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO users VALUES('owner','site-owner','站点管理员','admin',NULL,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX user_sessions_owner ON user_sessions(user_id);
CREATE TABLE account_attempts(bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE user_pools (
  user_id TEXT NOT NULL REFERENCES users(id),
  app_id TEXT NOT NULL,
  pool TEXT NOT NULL CHECK(pool IN ('watch','build')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id,app_id)
);
INSERT INTO user_pools SELECT 'owner',app_id,pool,created_at FROM pools;
CREATE TABLE research_history (
  user_id TEXT NOT NULL REFERENCES users(id),
  cache_key TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id,cache_key)
);
CREATE TABLE donations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 100 AND 10000000),
  currency TEXT NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected','refunded')),
  public INTEGER NOT NULL DEFAULT 0 CHECK(public IN (0,1)),
  public_name TEXT NOT NULL,
  message TEXT NOT NULL,
  payment_reference TEXT UNIQUE,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  reviewed_by TEXT
);
CREATE INDEX donations_owner ON donations(user_id,created_at DESC);
CREATE INDEX donations_feed ON donations(status,public,confirmed_at DESC);
