CREATE TABLE opportunities_staging (
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
