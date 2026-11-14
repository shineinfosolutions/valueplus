-- Stage D of docs/D1_MIGRATION_PLAN.md (§6.8, §6.8a): the WRITE cutover machinery. Ships DORMANT: nothing here
-- changes what the app does until someone sets a `write:<area>` switch or `stageD = 'auto'`.
--
-- Where an area WRITES to: one feature_flags row per write area, key 'write:<area>', value
--   'mongo' (default; a missing row means 'mongo') - writes go to MongoDB, copied into D1 by the write-through;
--   'fence'  - writes for the area wait (poll 250 ms, up to 30 s, then 503 "try again"), while the switch moves;
--   'd1'     - writes go to D1 in ONE guarded batch that also queues mirror_outbox rows; the reverse mirror copies
--              those documents into MongoDB, so MongoDB stays a current fallback.
-- 'd1' is only honoured while every read area holding the write area's collections answers from D1 (effective
-- read mode 'd1', lib/d1/read-source.ts); otherwise the area writes MongoDB as before. No row is seeded here on
-- purpose. The env var D1_WRITES=mongo forces 'mongo' everywhere.

-- Abort helper for guarded batches (§5.4). Always empty: a guard inserts 0 when its condition fails, the CHECK
-- fails, and D1 rolls the whole batch back (the repository answers 409 "changed meanwhile, try again").
CREATE TABLE IF NOT EXISTS _guard (ok INTEGER NOT NULL CHECK (ok = 1));

-- Reverse mirror queue: one row per document a D1-mode write touched, written in the SAME batch as the write.
-- The drainer (lib/d1/reverse-mirror.ts) copies the document's CURRENT D1 state into MongoDB by id and sets doneAt.
CREATE TABLE mirror_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection TEXT NOT NULL,      -- Mongo collection name (brands, categories, ...)
  docId TEXT NOT NULL,           -- the document's id (24-hex, same as Mongo _id)
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  at TEXT NOT NULL,              -- ISO time the D1 write committed
  attempts INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  lastAttemptAt TEXT,
  doneAt TEXT                    -- ISO time MongoDB was updated; NULL = still to copy
);
CREATE INDEX mirror_outbox_pending ON mirror_outbox(doneAt, id);
CREATE INDEX mirror_outbox_collection ON mirror_outbox(collection, doneAt);

-- Every failed attempt to copy one document into MongoDB (Stage D rolls an area back after more than 3 in an hour).
CREATE TABLE mirror_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  collection TEXT NOT NULL,
  docId TEXT,
  error TEXT
);
CREATE INDEX mirror_failures_at ON mirror_failures(at);

-- Heartbeat of the drainer: one row, written by every drain run that found work (or failed).
CREATE TABLE mirror_drain_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lastRunAt TEXT,
  lastResult TEXT,               -- 'ok' | 'partial' (some documents failed) | 'error'
  lastOkAt TEXT,
  lastDrained INTEGER NOT NULL DEFAULT 0,
  lastFailed INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  runs INTEGER NOT NULL DEFAULT 0
);

-- Every change the Stage D job (lib/d1/stage-d.ts) makes to a write switch, with a plain reason.
-- kind: 'promote' (mongo -> fence -> d1), 'rollback' (d1 -> fence -> mongo), 'abort' (a promotion given up).
CREATE TABLE stage_d_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  area TEXT NOT NULL,
  fromMode TEXT,
  toMode TEXT,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX stage_d_log_area_at ON stage_d_log(area, at);

-- The Stage D job's own switch: 'off' (seeded; the job does nothing), 'demote-only' (only the automatic rollbacks),
-- 'auto' (rollbacks any time, promotions 22:00-00:25 India time). Missing or unknown = 'off'.
-- INSERT OR IGNORE: a value already set by hand is never overwritten.
INSERT OR IGNORE INTO feature_flags (key, value, updatedAt) VALUES ('stageD', 'off', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
