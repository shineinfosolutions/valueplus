/**
 * The dashboard on a UTC server gives the same answer as in India.
 *
 * tests/run-tests.mjs runs every test with TZ=Asia/Kolkata, so the golden files of dashboard-stats.test.ts were
 * recorded with the machine's own zone = India. Cloudflare runs on UTC, where `setHours(0, 0, 0, 0)` and `getHours()`
 * used to give 05:30 IST day starts and 5:30-h-early hourly buckets. This test switches the process to UTC (Node
 * re-reads process.env.TZ when it is assigned) and checks the small data set against the SAME golden files: the day
 * ranges and the hourly chart are now India time whatever the machine's zone, so they must be identical.
 *
 *   node tests/run-tests.mjs dashboard-stats-utc
 */
process.env.TZ = "UTC";
import "./helpers/fixed-clock";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { smallDataset, seed } from "./fixtures/dashboard-seed";
import { GET } from "@/app/api/dashboard/stats/route";

const GOLDEN_DIR = path.join(process.cwd(), "tests", "golden", "dashboard-stats");
const OUT_DIR = path.join(process.cwd(), "tests", ".out", "dashboard-stats-utc");

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

async function main() {
  check(new Date(2026, 0, 1).getTimezoneOffset() === 0, "process really runs in UTC");
  mkdirSync(OUT_DIR, { recursive: true });
  await startMemoryMongo();
  await seed(smallDataset());
  for (const [name, query] of Object.entries(SCENARIOS)) {
    const res = await GET(new Request(`http://localhost/api/dashboard/stats${query}`));
    const text = JSON.stringify(await res.json(), null, 1) + "\n";
    writeFileSync(path.join(OUT_DIR, `${name}.json`), text);
    const goldenFile = path.join(GOLDEN_DIR, `${name}.json`);
    const golden = existsSync(goldenFile) ? readFileSync(goldenFile, "utf8") : null;
    check(res.status === 200 && golden === text, `${name} on a UTC clock: identical to golden (tests/.out/dashboard-stats-utc/${name}.json)`);
  }
  await stopMemoryMongo();
  return summary("dashboard-stats-utc");
}

main().then(
  (failures) => process.exit(failures ? 1 : 0),
  async (e) => {
    console.error(e);
    await stopMemoryMongo().catch(() => {});
    process.exit(1);
  }
);
