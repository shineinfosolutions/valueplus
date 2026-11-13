-- Stage B2 of docs/D1_MIGRATION_PLAN.md: SHADOW READS. MongoDB stays the source of truth; a read path can be told
-- to also run its D1 version after the response and compare the two (lib/d1/shadow.ts), or to serve from D1.
--
-- Where each area reads from: one feature_flags row per area, key 'read:<area>', value
--   'mongo'  (default when the row is missing) - only MongoDB is read;
--   'shadow' - the user gets MongoDB's answer; after the response the D1 version runs and is compared;
--   'd1'     - the user gets D1's answer; if the D1 read throws, MongoDB's answer is served instead.
-- Read by the Worker at most once a minute. The env var D1_READS=mongo forces 'mongo' everywhere.
-- Later waves add their own 'read:<area>' rows.
INSERT OR IGNORE INTO feature_flags (key, value, updatedAt) VALUES ('read:masters', 'shadow', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- One row per shadow comparison (or per D1 read that failed and fell back to MongoDB). Never holds a payload:
-- only counts, timings and the first few differences, with secret fields masked. Rows older than 14 days are pruned.
CREATE TABLE shadow_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area TEXT NOT NULL,
  name TEXT NOT NULL,
  at TEXT NOT NULL,                 -- ISO time of the run
  kind TEXT NOT NULL,               -- 'shadow' (a comparison) or 'fallback' (d1 mode, the D1 read threw)
  match INTEGER NOT NULL,           -- 1 = same answer after normalisation, 0 = different / D1 failed
  mongoMs REAL,
  d1Ms REAL,
  diffCount INTEGER NOT NULL DEFAULT 0,
  diffs TEXT,                       -- JSON: first 3 differences [{path, mongo, d1}], secrets masked, values shortened
  error TEXT                        -- the D1 error, when the D1 read failed
);
CREATE INDEX shadow_results_name_at ON shadow_results(area, name, at);
CREATE INDEX shadow_results_at ON shadow_results(at);

-- Daily totals per read path, so "clean for N days" can be judged without keeping every row.
-- day is the India date (YYYY-MM-DD).
CREATE TABLE shadow_daily (
  area TEXT NOT NULL,
  name TEXT NOT NULL,
  day TEXT NOT NULL,
  runs INTEGER NOT NULL DEFAULT 0,
  matches INTEGER NOT NULL DEFAULT 0,
  mismatches INTEGER NOT NULL DEFAULT 0,  -- includes D1 errors during shadow runs
  errors INTEGER NOT NULL DEFAULT 0,      -- D1 read threw (shadow or d1 mode)
  fallbacks INTEGER NOT NULL DEFAULT 0,   -- d1 mode served MongoDB because the D1 read threw
  mongoMsTotal REAL NOT NULL DEFAULT 0,   -- average = total / runs
  d1MsTotal REAL NOT NULL DEFAULT 0,
  lastAt TEXT,
  PRIMARY KEY (area, name, day)
);
