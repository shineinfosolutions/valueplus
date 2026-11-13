import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1DatabaseLike } from "./types";

/**
 * The D1 database (binding `DB` in wrangler.jsonc), or null where there is none: local `next dev` / `next start`
 * and the tests have no Cloudflare context. Callers treat null as "nothing to do", never as an error for the user.
 */
export function getD1(): D1DatabaseLike | null {
  try {
    const db = (getCloudflareContext().env as any)?.DB;
    return db && typeof db.prepare === "function" ? (db as D1DatabaseLike) : null;
  } catch {
    return null;
  }
}
