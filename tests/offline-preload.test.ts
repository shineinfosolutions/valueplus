// When the offline product/customer lists are downloaded (OfflineSyncProvider).
// Run: node_modules/.bin/esbuild tests/offline-preload.test.ts --bundle --platform=node --outfile=tests/.out/offline-preload.cjs --alias:@=. && node tests/.out/offline-preload.cjs
import assert from "node:assert/strict";
import {
  OFFLINE_CATALOG_MAX_AGE_MS,
  OFFLINE_CATALOG_ROLES,
  getOfflineCatalogFetchedAt,
  markOfflineCatalogFetched,
  shouldPreloadOfflineCatalog,
} from "@/lib/offline-storage";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const base = { signedIn: true, role: "cashier", online: true, lastFetchedAt: null as number | null, now: NOW };

test("billing roles download when never fetched", () => {
  assert.deepEqual(OFFLINE_CATALOG_ROLES, ["admin", "superadmin", "manager", "cashier"]);
  for (const role of ["admin", "superadmin", "manager", "cashier", "Cashier", "ADMIN"]) {
    assert.equal(shouldPreloadOfflineCatalog({ ...base, role }), true, role);
  }
});

test("other roles never download", () => {
  for (const role of ["salesman", "sales", "accounts", "hr", "driver", "godown", ""]) {
    assert.equal(shouldPreloadOfflineCatalog({ ...base, role }), false, role);
  }
});

test("never when signed out or offline", () => {
  assert.equal(shouldPreloadOfflineCatalog({ ...base, signedIn: false }), false);
  assert.equal(shouldPreloadOfflineCatalog({ ...base, online: false }), false);
});

test("at most once every 12 hours", () => {
  assert.equal(OFFLINE_CATALOG_MAX_AGE_MS, 12 * HOUR);
  assert.equal(shouldPreloadOfflineCatalog({ ...base, lastFetchedAt: NOW - 1 * HOUR }), false);
  assert.equal(shouldPreloadOfflineCatalog({ ...base, lastFetchedAt: NOW - 12 * HOUR + 1 }), false);
  assert.equal(shouldPreloadOfflineCatalog({ ...base, lastFetchedAt: NOW - 12 * HOUR }), true);
  assert.equal(shouldPreloadOfflineCatalog({ ...base, lastFetchedAt: NOW - 30 * HOUR }), true);
});

test("a time in the future (clock changed) or garbage is not trusted", () => {
  assert.equal(shouldPreloadOfflineCatalog({ ...base, lastFetchedAt: NOW + HOUR }), true);
  assert.equal(shouldPreloadOfflineCatalog({ ...base, lastFetchedAt: NaN }), true);
});

test("the last-fetched time is stored next to the cache and storage errors are swallowed", () => {
  const store = new Map<string, string>();
  (globalThis as any).window = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  assert.equal(getOfflineCatalogFetchedAt(), null);
  markOfflineCatalogFetched(NOW);
  assert.equal(getOfflineCatalogFetchedAt(), NOW);
  store.set("valueplus_cached_catalog_fetched_at_v1", "not a number");
  assert.equal(getOfflineCatalogFetchedAt(), null);
  // Blocked storage (private mode, quota): no throw.
  (globalThis as any).localStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("full");
    },
  };
  assert.equal(getOfflineCatalogFetchedAt(), null);
  assert.doesNotThrow(() => markOfflineCatalogFetched(NOW));
  delete (globalThis as any).window;
  delete (globalThis as any).localStorage;
});

console.log(`\n${passed} tests passed`);
