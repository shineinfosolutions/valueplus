import type { D1DatabaseLike } from "@/lib/d1/types";
import { getD1 } from "@/lib/d1/client";

let override: D1DatabaseLike | null = null;

/** Tests (and scripts) point the D1 reads at a local database; null goes back to the Worker binding. */
export function setSalesReadsDb(db: D1DatabaseLike | null) {
  override = db;
}

/** The D1 database the sales reads use. Throws when there is none (local `next dev`, no binding). */
export function salesDb(): D1DatabaseLike {
  const db = override || getD1();
  if (!db) throw new Error("D1 is not available (no DB binding)");
  return db;
}
