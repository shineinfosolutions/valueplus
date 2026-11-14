-- Fixes after the live shadow comparisons of 14 Nov 2026 (docs/D1_MIGRATION_PLAN.md, Stage C).
--
-- 1. RACES in the shadow comparison (lib/d1/shadow.ts). The two answers of a comparison are read at different
--    moments: in shadow mode MongoDB answers the request and D1 is read after the response. When the request itself
--    (or another one) changes the document in between, D1 is read AFTER the change and MongoDB's answer is from
--    BEFORE it (push.subsForUsers: the push sets lastSuccessAt right after reading the devices). On a difference,
--    the answering side is now read once more: when that fresh answer equals the other side, the difference was
--    the change in between, not a D1 fault. Such a run counts as a match and is marked raced = 1.
ALTER TABLE shadow_results ADD COLUMN raced INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shadow_daily ADD COLUMN raced INTEGER NOT NULL DEFAULT 0;

-- 2. DEFERRED write-through copies (lib/d1/write-through.ts). When a document is still changing while its write is
--    copied (two quick updates of the same document), the verify rounds can end with D1 one change behind. That is
--    no failure: the next write of that document, or the copy job within 5 minutes (updatedAt watermark), copies
--    it. It is counted here, NOT in failures, so it no longer switches the write-through off (stage C guard).
ALTER TABLE write_through_state ADD COLUMN deferred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE write_through_state ADD COLUMN lastDeferredAt TEXT;
ALTER TABLE write_through_state ADD COLUMN lastDeferredError TEXT;

-- 3. HEARTBEAT of the stage C job (lib/d1/stage-c.ts): one row, written at the end of every run, so the Admin view
--    (/api/admin/d1-shadow-status) shows whether the job runs at all and how its last run ended.
CREATE TABLE stage_c_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lastRunAt TEXT,          -- ISO time of the last run (any outcome)
  lastResult TEXT,         -- 'ok' | 'error' | 'off' (the job's switch said off)
  lastOkAt TEXT,           -- last run that ended without an error
  lastError TEXT,
  lastSetting TEXT,        -- stageC as that run read it
  lastChanges TEXT,        -- JSON: the changes of the last run that made any, with its time
  runs INTEGER NOT NULL DEFAULT 0
);
