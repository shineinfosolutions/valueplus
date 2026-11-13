/**
 * Golden test for GET /api/dashboard/stats.
 *
 * The route's JSON for a fixed data set and a fixed "now" was recorded from the ORIGINAL handler (before the
 * projection / single-read optimisation) into tests/golden/dashboard-stats/. Every run compares the current handler's
 * output with those files byte for byte, so any change in a number, a list, or the order of anything fails here.
 *
 * Two data sets:
 *   - "small": hand-written edge cases (split / finance / due / cash bills, cancelled, credit notes, estimates,
 *     back-dated and edited bills, reprints, warehouse tags, supplier and vendor ledgers, deleted bills …);
 *     the full JSON is stored, so a failure shows a readable diff.
 *   - "big": ~4,000 generated bills for timings; only a SHA-256 of each response is stored.
 *
 * It also prints the time per call and how many documents / bytes MongoDB sent back.
 *
 *   node tests/run-tests.mjs dashboard-stats                   compare
 *   node tests/run-tests.mjs dashboard-stats --update-golden   re-record (only if the change is intended)
 */
import "./helpers/fixed-clock";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { startMemoryMongo, stopMemoryMongo, dropDatabase, resetReadStats, readStats } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { smallDataset, bigDataset, seed } from "./fixtures/dashboard-seed";
import { GET } from "@/app/api/dashboard/stats/route";

const UPDATE = process.argv.includes("--update-golden");
const GOLDEN_DIR = path.join(process.cwd(), "tests", "golden", "dashboard-stats");
const OUT_DIR = path.join(process.cwd(), "tests", ".out", "dashboard-stats");

const SCENARIOS: Record<string, string> = {
  "default-month": "",
  "today": "?startDate=2026-11-13&endDate=2026-11-13",
  "back-dated-day": "?startDate=2026-11-05&endDate=2026-11-05",
  "oct-to-nov": "?startDate=2026-10-25&endDate=2026-11-13",
  "ashoka": "?startDate=2026-10-25&endDate=2026-11-13&warehouse=Ashoka%20Enterprises%20(Kunraghat%20Showroom)",
  "main-branch": "?startDate=2026-10-01&endDate=2026-11-13&warehouse=Main%20Branch",
  "unmatched-location": "?startDate=2026-10-25&endDate=2026-11-13&location=Main%20Central%20Warehouse",
  "empty-past": "?startDate=2025-01-01&endDate=2025-01-31",
};
const BIG_SCENARIOS: Record<string, string> = {
  "big-default-month": "",
  "big-today": "?startDate=2026-11-13&endDate=2026-11-13",
  "big-quarter": "?startDate=2026-08-01&endDate=2026-10-31",
  "big-year": "?startDate=2026-01-01&endDate=2026-11-13",
};

async function call(query: string): Promise<{ status: number; text: string; ms: number }> {
  const t0 = performance.now();
  const res = await GET(new Request(`http://localhost/api/dashboard/stats${query}`));
  const body = await res.json();
  const ms = performance.now() - t0;
  return { status: res.status, text: JSON.stringify(body, null, 1) + "\n", ms };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function main() {
  mkdirSync(GOLDEN_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  await startMemoryMongo();

  // ── small data set: full JSON golden files ───────────────────────────────
  await seed(smallDataset());
  for (const [name, query] of Object.entries(SCENARIOS)) {
    const { status, text } = await call(query);
    writeFileSync(path.join(OUT_DIR, `${name}.json`), text);
    const goldenFile = path.join(GOLDEN_DIR, `${name}.json`);
    if (UPDATE) {
      writeFileSync(goldenFile, text);
      console.log(`  recorded ${name}`);
      continue;
    }
    check(status === 200, `${name}: status 200`);
    const golden = existsSync(goldenFile) ? readFileSync(goldenFile, "utf8") : null;
    check(golden !== null && golden === text, `${name}: identical to golden (tests/.out/dashboard-stats/${name}.json)`);
  }
  // Sanity: the golden data really exercises the paths it is meant to.
  const month = JSON.parse(readFileSync(path.join(OUT_DIR, "oct-to-nov.json"), "utf8"));
  if (!UPDATE) {
    check(month.success === true && month.metrics.totalRevenue > 0, "oct-to-nov has revenue");
    check(month.transactions.finance.length >= 2 && month.metrics.financePendingCount >= 1, "finance bills and a pending payout present");
    check(month.leakage.cancelled.count >= 1 && month.leakage.billsModified.backDatedCount >= 1 && month.leakage.billsModified.editedCount >= 1, "cancelled, back-dated and edited bills present");
    check(month.leakage.reprinted.count >= 2 && month.leakage.deleted.count >= 1, "reprints and deleted bills present");
    check(month.vendorSupplier.supplierOutstanding.count >= 2 && month.vendorSupplier.vendorDue.count >= 1, "supplier and vendor ledgers present");
  }

  // ── big data set: hashes + timings ───────────────────────────────────────
  await dropDatabase();
  await seed(bigDataset());
  const hashFile = path.join(GOLDEN_DIR, "big-hashes.json");
  const hashes: Record<string, string> = UPDATE || !existsSync(hashFile) ? {} : JSON.parse(readFileSync(hashFile, "utf8"));
  const timings: Record<string, any> = {};
  for (const [name, query] of Object.entries(BIG_SCENARIOS)) {
    await call(query); // warm-up (JIT, connection)
    const runs: number[] = [];
    let text = "";
    let stats = readStats();
    for (let i = 0; i < 5; i++) {
      resetReadStats();
      const r = await call(query);
      runs.push(r.ms);
      text = r.text;
      stats = readStats();
    }
    writeFileSync(path.join(OUT_DIR, `${name}.json`), text);
    runs.sort((a, b) => a - b);
    timings[name] = {
      medianMs: Math.round(runs[2]),
      docsRead: stats.docs,
      kbRead: Math.round(stats.bytes / 1024),
      commands: stats.commands,
      responseKb: Math.round(text.length / 1024),
      byCollection: Object.fromEntries(Object.entries(stats.byCollection).map(([c, v]) => [c, `${v.docs} docs / ${Math.round(v.bytes / 1024)} KB`])),
    };
    if (UPDATE) hashes[name] = sha(text);
    else check(hashes[name] === sha(text), `${name}: identical to recorded hash`);
  }
  if (UPDATE) writeFileSync(hashFile, JSON.stringify(hashes, null, 1) + "\n");
  writeFileSync(path.join(OUT_DIR, "timings.json"), JSON.stringify(timings, null, 1) + "\n");
  console.log("\nTimings on the big data set (median of 5, in-memory MongoDB on this machine):");
  for (const [name, t] of Object.entries(timings)) {
    console.log(`  ${name}: ${t.medianMs} ms, ${t.docsRead} docs / ${t.kbRead} KB read in ${t.commands} commands, response ${t.responseKb} KB`);
    console.log(`    ${JSON.stringify(t.byCollection)}`);
  }

  await stopMemoryMongo();
  return UPDATE ? 0 : summary("dashboard-stats");
}

main().then(
  (failures) => process.exit(failures ? 1 : 0),
  async (e) => {
    console.error(e);
    await stopMemoryMongo().catch(() => {});
    process.exit(1);
  }
);
