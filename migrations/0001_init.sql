CREATE TABLE apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist_id TEXT,
  artist_name TEXT,
  bundle_id TEXT,
  icon_url TEXT,
  genre_id TEXT,
  genre_name TEXT,
  description TEXT,
  one_liner TEXT,
  formatted_price TEXT,
  track_view_url TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE chart_ranks (
  snapshot_date TEXT NOT NULL,
  country TEXT NOT NULL,
  chart TEXT NOT NULL,
  genre_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  app_id TEXT NOT NULL,
  PRIMARY KEY (snapshot_date, country, chart, genre_id, rank)
);

CREATE INDEX idx_chart_app_date ON chart_ranks (app_id, snapshot_date);
CREATE INDEX idx_chart_date_chart ON chart_ranks (snapshot_date, chart, country);

CREATE TABLE app_metrics (
  snapshot_date TEXT NOT NULL,
  country TEXT NOT NULL,
  app_id TEXT NOT NULL,
  rating REAL,
  rating_count INTEGER,
  PRIMARY KEY (snapshot_date, country, app_id)
);

CREATE TABLE opportunities (
  lens TEXT NOT NULL,
  app_id TEXT NOT NULL,
  score REAL NOT NULL,
  country TEXT,
  chart TEXT,
  genre_id TEXT,
  rank INTEGER,
  rating REAL,
  rating_count INTEGER,
  rank_change INTEGER,
  consecutive_days INTEGER,
  one_liner TEXT,
  payload TEXT,
  PRIMARY KEY (lens, app_id)
);

CREATE INDEX idx_opp_lens_score ON opportunities (lens, score DESC);

CREATE TABLE ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  stats TEXT,
  error TEXT
);
