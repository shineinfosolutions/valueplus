// Which cached queries a save refreshes (QueryProvider) — and the shared path rule (RealtimeProvider).
// Run: node_modules/.bin/esbuild tests/live-paths.test.ts --bundle --platform=node --outfile=tests/.out/live-paths.cjs --alias:@=. && node tests/.out/live-paths.cjs
import assert from "node:assert/strict";
import {
  anyPathMatch,
  liveOf,
  MASTER_DATA_STALE_TIME,
  normPath,
  pathMatches,
  pathOfUrl,
  shouldRefreshAfterWrite,
  staleTimeOf,
  writtenApiPath,
} from "@/lib/live-paths";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

test("normPath lower-cases and drops trailing slashes", () => {
  assert.equal(normPath("/API/Invoices/"), "/api/invoices");
  assert.equal(normPath("/api/items"), "/api/items");
});

test("pathOfUrl strips origin, query and hash", () => {
  assert.equal(pathOfUrl("/api/items?q=1"), "/api/items");
  assert.equal(pathOfUrl("https://erp.example/api/Invoices/123/?x=1#y"), "/api/invoices/123");
  assert.equal(pathOfUrl("api/items"), "/api/items");
});

test("a path matches itself and what lies under it, not its parent or a sibling", () => {
  assert.equal(pathMatches("/api/staff/attendance", "/api/staff/attendance"), true);
  assert.equal(pathMatches("/api/staff/attendance/photo", "/api/staff/attendance"), true);
  assert.equal(pathMatches("/api/staff", "/api/staff/attendance"), false);
  assert.equal(pathMatches("/api/invoices-archive", "/api/invoices"), false);
  assert.equal(anyPathMatch(["/api/invoices/abc"], ["/api/items", "/API/Invoices/"]), true);
  assert.equal(anyPathMatch(["/api/expenses"], ["/api/items", "/api/invoices"]), false);
});

test("liveOf reads meta.live only when it is a non-empty list", () => {
  assert.deepEqual(liveOf({ meta: { live: ["/api/x"] } }), ["/api/x"]);
  assert.equal(liveOf({ meta: { live: [] } }), null);
  assert.equal(liveOf({ meta: {} }), null);
  assert.equal(liveOf({}), null);
});

test("after a save: live queries refresh only when their paths match; queries without meta.live always", () => {
  const estimates = { meta: { live: ["/api/estimates"] } };
  const stock = { meta: { live: ["/api/items", "/api/invoices", "/api/purchase-entries"] } };
  const summary = { meta: { live: ["/api/notifications", "/api/estimates", "/api/day-close"] } };
  const plain = { meta: undefined };
  const written = ["/api/invoices/66a1/payment"];
  assert.equal(shouldRefreshAfterWrite(estimates, written), false);
  assert.equal(shouldRefreshAfterWrite(stock, written), true);
  assert.equal(shouldRefreshAfterWrite(summary, written), false);
  assert.equal(shouldRefreshAfterWrite(plain, written), true);
  // Several saves in one burst: union of their paths.
  assert.equal(shouldRefreshAfterWrite(summary, ["/api/invoices", "/api/day-close"]), true);
  // Unknown paths (an older tab's message): everything, as before.
  assert.equal(shouldRefreshAfterWrite(estimates, "all"), true);
  // A mutation with no paths: only queries without meta.live.
  assert.equal(shouldRefreshAfterWrite(estimates, []), false);
  assert.equal(shouldRefreshAfterWrite(plain, []), true);
});

test("writtenApiPath: only successful non-GET calls to our API, minus auth, presence and push", () => {
  assert.equal(writtenApiPath("POST", "/api/invoices", true), "/api/invoices");
  assert.equal(writtenApiPath("patch", "https://h/api/Notifications?x=1", true), "/api/notifications");
  assert.equal(writtenApiPath("GET", "/api/invoices", true), null);
  assert.equal(writtenApiPath("HEAD", "/api/invoices", true), null);
  assert.equal(writtenApiPath("POST", "/api/invoices", false), null);
  assert.equal(writtenApiPath("POST", "/other/api", true), null);
  assert.equal(writtenApiPath("POST", "/api/auth/signout", true), null);
  assert.equal(writtenApiPath("POST", "/api/staff/presence", true), null);
  assert.equal(writtenApiPath("POST", "/api/push/subscribe", true), null);
  assert.equal(writtenApiPath("POST", "/api/pushes", true), "/api/pushes");
  assert.equal(writtenApiPath("DELETE", "/api/staff/attendance/1", true), "/api/staff/attendance/1");
});

test("staleTimeOf: 15 s by default, 30 min for master data, or the given milliseconds", () => {
  assert.equal(staleTimeOf(undefined), 15_000);
  assert.equal(staleTimeOf({ live: ["/api/x"] }), 15_000);
  assert.equal(staleTimeOf({ staleTime: "master" }), MASTER_DATA_STALE_TIME);
  assert.equal(MASTER_DATA_STALE_TIME, 30 * 60 * 1000);
  assert.equal(staleTimeOf({ staleTime: 60_000 }), 60_000);
  assert.equal(staleTimeOf({ staleTime: -5 }), 15_000);
});

console.log(`\n${passed} tests passed`);
