-- Discount approvals: the product's VSP and purchase price when the request was made (shown to the approver), and
-- the price first asked for when the approver approved a different price (memory.md §41).
ALTER TABLE discountApprovals ADD COLUMN vsp REAL;
ALTER TABLE discountApprovals ADD COLUMN purchasePrice REAL;
ALTER TABLE discountApprovals ADD COLUMN requestedPrice REAL;

-- Sales Target "Recount from date": the first bill date counted, and who recounted it when (memory.md §41).
ALTER TABLE staffTasks ADD COLUMN countFrom TEXT;
ALTER TABLE staffTasks ADD COLUMN recountedAt TEXT;
ALTER TABLE staffTasks ADD COLUMN recountedBy TEXT;
