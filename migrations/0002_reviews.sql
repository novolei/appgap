CREATE TABLE app_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  country TEXT NOT NULL,
  rating INTEGER,
  title TEXT,
  content TEXT,
  author TEXT,
  fetched_at TEXT NOT NULL
);

CREATE INDEX idx_reviews_app ON app_reviews (app_id, country);
