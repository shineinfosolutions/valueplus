/**
 * Which cached screens a change touches — shared by the live-update socket (RealtimeProvider) and the
 * refresh after this tab's own save (QueryProvider), so both follow one rule.
 *
 * A screen lists the API paths its data comes from: `useQuery({ ..., meta: { live: ["/api/estimates"] } })`.
 * A changed path matches a watched path when it is that path or anything under it: a save to
 * "/api/staff/attendance/photo" refreshes a screen watching "/api/staff/attendance", but a save to
 * "/api/staff" does not refresh it. Plain functions, no React, so they can be tested on their own.
 */

/** Lower-case, no trailing slash: "/API/Invoices/" and "/api/invoices" are the same path. */
export const normPath = (p: string) => String(p || "").toLowerCase().replace(/\/+$/, "");

/** The path of a request URL, without origin or query string ("https://x/api/items?q=1" -> "/api/items"). */
export function pathOfUrl(url: string): string {
  try {
    return normPath(new URL(url, "http://local.invalid").pathname);
  } catch {
    return normPath(String(url || "").split(/[?#]/)[0]);
  }
}

/** `changed` is the watched path itself or lies under it. Both already normalised. */
export const pathMatches = (changed: string, watched: string) => changed === watched || changed.startsWith(`${watched}/`);

/** Any of the changed paths touches any of the watched ones. */
export const anyPathMatch = (changed: string[], watched: string[]) =>
  watched.some((w) => changed.some((c) => pathMatches(normPath(c), normPath(w))));

/** The `meta.live` paths of a query, or null when it has none (it is then not kept fresh by the socket). */
export function liveOf(q: { meta?: unknown } | null | undefined): string[] | null {
  const live = (q?.meta as any)?.live;
  return Array.isArray(live) && live.length ? live : null;
}

/**
 * Should this query be refreshed after a save in this tab?
 *  - `changed` is "all" when the save's paths are unknown: refresh everything, as before.
 *  - A query with `meta.live` refreshes only when the save touched one of its paths.
 *  - A query without `meta.live` always refreshes: nothing else tells it about changes, and refreshing it
 *    is what the app did before, so it never goes stale.
 */
export function shouldRefreshAfterWrite(q: { meta?: unknown }, changed: string[] | "all"): boolean {
  if (changed === "all") return true;
  const live = liveOf(q);
  if (!live) return true;
  return anyPathMatch(changed, live);
}

/**
 * Writes that change nothing any screen shows: NextAuth's own calls, the phone's geofence reports
 * (GeofenceWatcher) and push sign-up (sent on every app open once alerts are on). The Worker does not
 * announce these over the socket either (worker.ts changedPath).
 */
const IGNORED_WRITE_PATHS = ["/api/auth", "/api/staff/presence", "/api/push"];

/** The API path a finished request wrote to, when it should refresh screens; otherwise null. */
export function writtenApiPath(method: string, url: string, ok: boolean): string | null {
  const m = String(method || "GET").toUpperCase();
  if (!ok || m === "GET" || m === "HEAD") return null;
  const path = pathOfUrl(url);
  if (!path.startsWith("/api/")) return null;
  if (IGNORED_WRITE_PATHS.some((p) => pathMatches(path, p))) return null;
  return path;
}

const DEFAULT_STALE_TIME = 15 * 1000;
/** For master data that rarely changes (categories, brands, units, Onsitego plans, company profile). */
export const MASTER_DATA_STALE_TIME = 30 * 60 * 1000;

/** A query's staleTime: `meta.staleTime` ("master" or milliseconds) when given, else 15 s. */
export function staleTimeOf(meta: unknown): number {
  const s = (meta as any)?.staleTime;
  if (s === "master") return MASTER_DATA_STALE_TIME;
  if (typeof s === "number" && s >= 0) return s;
  return DEFAULT_STALE_TIME;
}
