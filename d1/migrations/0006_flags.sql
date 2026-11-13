-- Stage B1 of docs/D1_MIGRATION_PLAN.md: write-through (every MongoDB write is copied into D1 in the same request,
-- lib/d1/write-through.ts). MongoDB stays the source of truth.

-- Switches the Admin can flip with one SQL command, no deploy. Read by the Worker at most once a minute.
--   writeThrough: 'on' (default) or 'off'
CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  value TEXT,
  updatedAt TEXT
);
INSERT INTO feature_flags (key, value, updatedAt) VALUES ('writeThrough', 'on', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- How fresh D1 is, per collection: when the write-through last copied a write, and how often it failed.
CREATE TABLE write_through_state (
  collection TEXT PRIMARY KEY,
  lastWriteAt TEXT,               -- last write copied into D1 by the write-through
  writes INTEGER NOT NULL DEFAULT 0,
  docs INTEGER NOT NULL DEFAULT 0, -- documents copied (or deleted) by those writes
  failures INTEGER NOT NULL DEFAULT 0,
  lastFailureAt TEXT,
  lastError TEXT,
  fullRecopyMarks INTEGER NOT NULL DEFAULT 0, -- writes too big to copy inline: the copy job re-copies the collection
  lastFullRecopyMarkAt TEXT
);
