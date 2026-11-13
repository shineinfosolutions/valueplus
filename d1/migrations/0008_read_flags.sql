-- Stage B2 of docs/D1_MIGRATION_PLAN.md, wave 2: the read switches of the areas whose GET routes are now wired
-- through lib/d1/shadow.ts (sales & money, CRM / documents / accounting, stock / purchases / cash, staff & system).
-- They start in 'shadow': users keep getting MongoDB's answer, and the D1 answer is compared after the response.
-- INSERT OR IGNORE: a value already set by hand (e.g. 'mongo' to switch an area off) is never overwritten.
INSERT OR IGNORE INTO feature_flags (key, value, updatedAt) VALUES ('read:sales', 'shadow', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT OR IGNORE INTO feature_flags (key, value, updatedAt) VALUES ('read:crm', 'shadow', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT OR IGNORE INTO feature_flags (key, value, updatedAt) VALUES ('read:stock', 'shadow', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT OR IGNORE INTO feature_flags (key, value, updatedAt) VALUES ('read:staff', 'shadow', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
