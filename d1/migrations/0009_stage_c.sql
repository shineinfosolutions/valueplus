-- Stage C of docs/D1_MIGRATION_PLAN.md: the read switches move from 'shadow' to 'd1' BY THEMSELVES, one area per
-- night after shop close, once the area has been clean for long enough; and move back to 'shadow' at any time when
-- D1 and MongoDB disagree (lib/d1/stage-c.ts, run at the end of every /api/cron/d1-sync).
--
-- The job's own switch, one feature_flags row:
--   stageC = 'auto'        - promotions (at night) and safety demotions / write-through guard (any time);
--            'demote-only' - no promotions; demotions and the write-through guard still run (a safe pause);
--            'off'         - the job does nothing at all.
-- A missing row or any other value means 'off'.
-- INSERT OR IGNORE: a value already set by hand is never overwritten.
INSERT OR IGNORE INTO feature_flags (key, value, updatedAt) VALUES ('stageC', 'auto', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Every change the job makes, with a plain reason. area is masters / crm / staff / stock / sales, or 'writeThrough'
-- when the job switched the write-through off.
CREATE TABLE stage_c_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,                 -- ISO time of the change
  area TEXT NOT NULL,
  fromMode TEXT,
  toMode TEXT,
  reason TEXT NOT NULL
);
CREATE INDEX stage_c_log_area_at ON stage_c_log(area, at);
CREATE INDEX stage_c_log_at ON stage_c_log(at);

-- The demotion check reads the last hour of comparisons per area every 5 minutes.
CREATE INDEX shadow_results_area_at ON shadow_results(area, at);
