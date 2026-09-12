CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, threads_url TEXT NOT NULL,
  stage TEXT NOT NULL,               -- threads_running | shopee_running | done | failed
  threads_run_id TEXT, shopee_run_id TEXT,
  post_text TEXT, post_author TEXT, keyword TEXT, reasoning TEXT, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  item_key TEXT PRIMARY KEY,         -- "shopid.itemid"
  name TEXT NOT NULL, keyword TEXT NOT NULL, shopee_url TEXT NOT NULL,
  image_url TEXT, merchant_name TEXT,
  rating REAL NOT NULL DEFAULT 0, review_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_keyword ON products (keyword, last_seen_at);

CREATE TABLE IF NOT EXISTS price_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_key TEXT NOT NULL,
  price INTEGER NOT NULL, shipping_fee INTEGER NOT NULL DEFAULT 0,
  effective_price INTEGER NOT NULL, observed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_points_item ON price_points (item_key, observed_at);

CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, item_key TEXT NOT NULL, keyword TEXT NOT NULL,
  base_price INTEGER NOT NULL, target_price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',   -- active | triggered | cancelled
  created_at INTEGER NOT NULL, last_checked_at INTEGER, last_alert_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_watches_email ON watches (email, created_at);
CREATE INDEX IF NOT EXISTS idx_watches_status ON watches (status);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, watch_id TEXT NOT NULL, email TEXT NOT NULL,
  item_key TEXT NOT NULL, price INTEGER NOT NULL, target_price INTEGER NOT NULL,
  saved_ntd INTEGER NOT NULL,
  kind TEXT NOT NULL,               -- target_hit | new_low | watch_created
  sent_ok INTEGER NOT NULL, detail TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_email ON alerts (email, created_at);

CREATE TABLE IF NOT EXISTS sweeps (
  id TEXT PRIMARY KEY, keyword TEXT NOT NULL, run_id TEXT NOT NULL,
  status TEXT NOT NULL,             -- running | collected | failed
  created_at INTEGER NOT NULL, collected_at INTEGER, note TEXT
);
CREATE INDEX IF NOT EXISTS idx_sweeps_status ON sweeps (status, created_at);

CREATE TABLE IF NOT EXISTS price_assessments (
  item_key TEXT NOT NULL, observed_at INTEGER NOT NULL,
  assessed_price INTEGER NOT NULL, market_price INTEGER,
  reasoning TEXT NOT NULL, model TEXT NOT NULL, estimated_at INTEGER NOT NULL,
  PRIMARY KEY (item_key, observed_at)
);
