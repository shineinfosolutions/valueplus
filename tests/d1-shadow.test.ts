/**
 * Stage B2 of the D1 migration: the shadow-read framework (lib/d1/compare.ts, lib/d1/read-source.ts,
 * lib/d1/shadow.ts, lib/d1/shadow-status.ts, GET /api/admin/d1-shadow-status).
 *  - comparator: ObjectId / Date / number / null / key order / array order, unordered arrays, sort ties, ignored
 *    paths, defaults, sample size, and masking of secret fields;
 *  - read switch: default mongo, the 'read:<area>' row, unknown values, cache, env override, D1 missing / down;
 *  - readWithShadow: mongo / shadow / d1 modes, fallback on a D1 error, sampling, recording, and that shadow work
 *    never changes the answer nor its timing (measured with a slow and with a failing D1);
 *  - the daily totals, the report and the admin route.
 * Uses a local D1 (Miniflare via wrangler); MongoDB is not needed here (the "Mongo" side is a plain function).
 */
import mongoose from "mongoose";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import { faulty, brokenD1 } from "./helpers/d1-faults";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { compareResults, canonicalize } from "@/lib/d1/compare";
import { configureReadSource, getReadMode, resetReadModeCache, resetReadSourceConfig } from "@/lib/d1/read-source";
import { configureShadow, flushShadowWork, getLastShadowRun, readWithShadow, resetShadowConfig, resetShadowSampling, istDay } from "@/lib/d1/shadow";
import { getShadowStatus } from "@/lib/d1/shadow-status";
import { deferredContext } from "@/lib/deferred-context";
import { GET as shadowStatusGET } from "@/app/api/admin/d1-shadow-status/route";

const { ObjectId } = mongoose.Types;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function all(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any[]> {
  return ((await db.prepare(sql).bind(...args).all()).results || []) as any[];
}
async function one(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any> {
  return db.prepare(sql).bind(...args).first();
}
async function setFlag(db: D1DatabaseLike, area: string, value: string | null) {
  if (value === null) await db.prepare("DELETE FROM feature_flags WHERE key = ?").bind(`read:${area}`).run();
  else await db.prepare("INSERT INTO feature_flags (key, value, updatedAt) VALUES (?, ?, 'x') ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(`read:${area}`, value).run();
  resetReadModeCache();
}

function comparatorTests() {
  console.log("\ncomparator");
  const id = new ObjectId();
  const at = new Date("2026-11-14T05:06:07.089Z");
  check(compareResults({ _id: id, at }, { _id: id.toHexString(), at: "2026-11-14T05:06:07.089Z" }).equal, "ObjectId = its hex string, Date = its ISO text");
  check(compareResults({ a: 1, b: undefined }, { a: 1 }).equal, "undefined field = missing field");
  check(compareResults({ a: 1, b: null }, { a: 1 }).equal, "null field = missing field (D1 cannot tell them apart)");
  check(compareResults({ a: 1, b: 2 }, { b: 2, a: 1 }).equal, "key order is ignored");
  check(compareResults({ n: 0.1 + 0.2 }, { n: 0.3 }).equal, "0.1 + 0.2 = 0.3 within the 1e-9 tolerance");
  check(compareResults({ n: 1e12 + 0.0001 }, { n: 1e12 }).equal, "large numbers compare relatively");
  const nd = compareResults({ n: 1 }, { n: 1.0001 });
  check(!nd.equal && nd.diffs[0]?.path === "n", "1 vs 1.0001 is a difference at path n");
  check(!compareResults({ n: 1 }, { n: "1" }).equal, "number vs text is a difference");
  check(!compareResults([1, 2, 3], [3, 2, 1]).equal, "arrays are ordered by default");
  check(compareResults({ list: [{ x: 1 }, { x: 2 }] }, { list: [{ x: 2 }, { x: 1 }] }, { unorderedPaths: ["list"] }).equal, "unorderedPaths: any order accepted");
  check(!compareResults({ list: [{ x: 1 }, { x: 2 }] }, { list: [{ x: 2 }, { x: 3 }] }, { unorderedPaths: ["list"] }).equal, "unorderedPaths: different members still differ");
  const tie = { tieOrder: [{ path: "", key: (d: any) => d.k }] };
  const a = [{ _id: "1", k: 1 }, { _id: "2", k: 1 }, { _id: "3", k: 2 }];
  check(compareResults(a, [a[1], a[0], a[2]], tie).equal, "tieOrder: equal keys in any order");
  const wrongOrder = compareResults(a, [a[2], a[0], a[1]], tie);
  check(!wrongOrder.equal && wrongOrder.diffs.some((d) => d.path.includes("(sort key)")), "tieOrder: a wrong sort order is still caught");
  check(compareResults({ data: [{ s: [{ _id: "x", q: 1 }] }] }, { data: [{ s: [{ q: 1 }] }] }, { ignorePaths: ["data[].s[]._id"] }).equal, "ignorePaths with [] wildcards");
  check(!compareResults({ data: [{ s: [{ _id: "x", q: 1 }] }] }, { data: [{ s: [{ q: 2 }] }] }, { ignorePaths: ["data[].s[]._id"] }).equal, "ignorePaths leaves the rest compared");
  check(compareResults([{ f: undefined }], [{ f: false }], { defaultsWhenMissing: { "[].f": false } }).equal, "defaultsWhenMissing: absent = false where declared");
  check(!compareResults([{ f: undefined }], [{ f: true }], { defaultsWhenMissing: { "[].f": false } }).equal, "defaultsWhenMissing: absent != true");
  check(!compareResults([{ g: undefined }], [{ g: false }], { defaultsWhenMissing: { "[].f": false } }).equal, "defaultsWhenMissing only applies to its path");
  check(compareResults({ b: ["Samsung", "lg"] }, { b: ["LG", "Samsung"] }, { unorderedPaths: ["b"], foldCasePaths: ["b[]"] }).equal, "foldCasePaths: capitals ignored there (with unordered matching)");
  check(!compareResults({ b: ["lg"], c: "x" }, { b: ["LG"], c: "X" }, { foldCasePaths: ["b[]"] }).equal, "foldCasePaths: capitals still count elsewhere");
  const many = compareResults({ a: 1, b: 2, c: 3, d: 4, e: 5 }, { a: 9, b: 9, c: 9, d: 9, e: 9 });
  check(many.diffCount === 5 && many.diffs.length === 3, `5 differences counted, 3 kept as samples (${many.diffCount}/${many.diffs.length})`);
  check(compareResults([1, 2], [1, 2, 3]).diffs[0]?.path === "length", "length difference reported");

  // Masking: secret values never reach a sample; values are short.
  const secrets = compareResults(
    { password: "hash-AAA", pin: "1234", token: "tok-AAA", bankDetails: { accountNumber: "123456789012", ifscCode: "SBIN0000001" }, panNumber: "ABCDE1234F", cloudApi_accessToken: "EAAB", gstNumber: "09ABCDE1234F1Z5", aadhaar: "111122223333" },
    { password: "hash-BBB", pin: "9999", token: "tok-BBB", bankDetails: { accountNumber: "999999999999", ifscCode: "HDFC0000001" }, panNumber: "ZZZZZ9999Z", cloudApi_accessToken: "EAAC", gstNumber: "09ZZZZZ9999Z1Z5", aadhaar: "999988887777" },
    { maxSamples: 20 }
  );
  const text = JSON.stringify(secrets.diffs);
  const leaked = ["hash-AAA", "hash-BBB", "1234", "9999", "tok-", "123456789012", "999999999999", "SBIN", "HDFC", "ABCDE1234F", "ZZZZZ", "EAAB", "EAAC", "1111", "9999888"].filter((s) => text.includes(s));
  check(secrets.diffCount === 9 && leaked.length === 0, `9 secret differences found, none of their values stored (leaked: ${leaked.join(",") || "none"})`);
  check(secrets.diffs.every((d) => d.mongo === "***" && d.d1 === "***"), "secret values are shown as ***");
  const long = compareResults({ s: "x".repeat(500), o: { a: 1, b: 2 } }, { s: "y".repeat(500), o: [1] });
  check(long.diffs[0].mongo.length < 50 && long.diffs.some((d) => d.mongo === "{object with 2 keys}" && d.d1 === "[array of 1]"), "long strings cut, objects / arrays only summarised");
  check(JSON.stringify(canonicalize({ b: 1, a: [new ObjectId("0123456789abcdef01234567"), null] })) === '{"a":["0123456789abcdef01234567",null],"b":1}', "canonical form: sorted keys, hex ids, nulls kept inside arrays");
}

async function readSourceTests(db: D1DatabaseLike) {
  console.log("\nread switch");
  let envValue = "";
  configureReadSource({ resolveD1: () => db, envValue: () => envValue, flagTtlMs: 60_000 });
  const seeded = await one(db, "SELECT value FROM feature_flags WHERE key = 'read:masters'");
  check(seeded?.value === "shadow", "migration 0007 seeds read:masters = 'shadow'");
  check((await getReadMode("no-such-area")) === "mongo", "an area without a row reads MongoDB (sales, crm, stock, staff have rows since 0008)");
  check((await getReadMode("masters")) === "shadow", "read:masters row is honoured");
  await db.prepare("UPDATE feature_flags SET value = 'd1' WHERE key = 'read:masters'").run();
  check((await getReadMode("masters")) === "shadow", "the value is cached (no D1 read per request)");
  configureReadSource({ flagTtlMs: 0 });
  check((await getReadMode("masters")) === "d1", "after the cache time the new value is read");
  envValue = "mongo";
  check((await getReadMode("masters")) === "mongo", "D1_READS=mongo forces MongoDB");
  envValue = "";
  await setFlag(db, "masters", "D1 ");
  check((await getReadMode("masters")) === "d1", "value is trimmed and case-insensitive");
  await setFlag(db, "masters", "on");
  check((await getReadMode("masters")) === "mongo", "an unknown value reads MongoDB");
  configureReadSource({ resolveD1: () => null });
  check((await getReadMode("masters")) === "mongo", "no D1 binding: MongoDB");
  configureReadSource({ resolveD1: () => brokenD1 });
  check((await getReadMode("masters")) === "mongo", "D1 down: MongoDB (and no throw)");
  configureReadSource({ resolveD1: () => faulty(db, { slow: () => true, delayMs: 300 }), flagTimeoutMs: 50 });
  const t0 = Date.now();
  const slowMode = await getReadMode("masters");
  check(slowMode === "mongo" && Date.now() - t0 < 250, `slow flag read gives up after the timeout (${Date.now() - t0} ms)`);
  resetReadSourceConfig();
}

async function modeTests(db: D1DatabaseLike) {
  console.log("\nreadWithShadow modes");
  configureReadSource({ resolveD1: () => db, envValue: () => "", flagTtlMs: 0 });
  resetShadowConfig();
  const mongoValue: any = { rows: [{ _id: new ObjectId("0123456789abcdef01234567"), n: 1 }] };
  const d1Value: any = { rows: [{ _id: "0123456789abcdef01234567", n: 1 }] };
  let mongoCalls = 0;
  let d1Calls = 0;
  const mongoFn = async () => {
    mongoCalls++;
    return mongoValue;
  };
  const d1Fn = async () => {
    d1Calls++;
    return d1Value;
  };

  await setFlag(db, "test", "mongo");
  let r: any = await readWithShadow("test", "t.mongo", mongoFn, d1Fn);
  await flushShadowWork();
  check(r === mongoValue && mongoCalls === 1 && d1Calls === 0, "mongo: only MongoDB is read");

  await setFlag(db, "test", "d1");
  r = await readWithShadow("test", "t.d1", mongoFn, d1Fn);
  check(r === d1Value && mongoCalls === 1 && d1Calls === 1, "d1: only D1 is read before the answer, D1's answer is served");
  await flushShadowWork();
  const rev = await one(db, "SELECT * FROM shadow_results WHERE name = 't.d1'");
  check(mongoCalls === 2 && rev?.kind === "reverse" && rev.match === 1, "d1: MongoDB is read after the answer and compared (Stage C reverse shadow)");

  r = await readWithShadow("test", "t.fallback", mongoFn, async () => {
    throw new Error("D1_ERROR: no such table: items");
  });
  await flushShadowWork();
  check(r === mongoValue && mongoCalls === 3, "d1: a D1 error serves MongoDB's answer");
  const fb = await one(db, "SELECT * FROM shadow_results WHERE name = 't.fallback'");
  check(fb?.kind === "fallback" && fb.match === 0 && /no such table/.test(fb.error || ""), "the fallback is recorded with its error");
  const fbDay = await one(db, "SELECT * FROM shadow_daily WHERE name = 't.fallback'");
  check(fbDay?.fallbacks === 1 && fbDay.errors === 1 && fbDay.runs === 1, "and counted in the daily totals");

  await setFlag(db, "test", "shadow");
  r = await readWithShadow("test", "t.shadow", mongoFn, d1Fn);
  check(r === mongoValue, "shadow: MongoDB's answer is returned (the very same object)");
  check(d1Calls === 1, "shadow: D1 has not been read before the answer is returned");
  await flushShadowWork();
  check(d1Calls === 2, "shadow: D1 is read afterwards");
  const sh = await one(db, "SELECT * FROM shadow_results WHERE name = 't.shadow'");
  check(sh?.kind === "shadow" && sh.match === 1 && sh.diffCount === 0 && sh.mongoMs >= 0 && sh.d1Ms >= 0, "shadow: a match is recorded with both timings");
  check(getLastShadowRun()?.recorded === true, "getLastShadowRun reports it");

  // Sampling: at most one shadow run per path per 10 s per isolate.
  r = await readWithShadow("test", "t.shadow", mongoFn, d1Fn);
  await flushShadowWork();
  check(d1Calls === 2 && (await all(db, "SELECT id FROM shadow_results WHERE name = 't.shadow'")).length === 1, "a second call within 10 s is not shadowed");
  let clock = Date.now() + 11_000;
  configureShadow({ now: () => clock });
  r = await readWithShadow("test", "t.shadow", mongoFn, d1Fn);
  await flushShadowWork();
  check(d1Calls === 3, "after 10 s it is shadowed again");
  const day = await one(db, "SELECT * FROM shadow_daily WHERE name = 't.shadow' AND day = ?", istDay(clock));
  check(day?.runs >= 1 && day.matches >= 1 && day.mismatches === 0, "daily totals count runs and matches");

  // A mismatch: recorded with a masked sample, never the payload.
  resetShadowSampling();
  r = await readWithShadow(
    "test",
    "t.mismatch",
    async () => ({ rows: [{ name: "Ravi", phone: "9000000001", pin: "4321", bankDetails: { accountNumber: "111122223333" } }] }),
    async () => ({ rows: [{ name: "Ravi K", phone: "9000000001", pin: "8765", bankDetails: { accountNumber: "444455556666" } }] })
  );
  await flushShadowWork();
  const mm = await one(db, "SELECT * FROM shadow_results WHERE name = 't.mismatch'");
  const stored = JSON.stringify(mm);
  check(mm?.match === 0 && mm.diffCount === 3, `mismatch recorded with its count (${mm?.diffCount})`);
  check(mm && JSON.parse(mm.diffs).some((d: any) => d.path === "rows[0].name" && d.mongo === '"Ravi"' && d.d1 === '"Ravi K"'), "the sample shows the path and both short values");
  check(!/4321|8765|111122223333|444455556666|9000000001/.test(stored), "no PIN, account number or other payload stored");

  // A D1 error during shadow: recorded, the answer unaffected.
  resetShadowSampling();
  r = await readWithShadow("test", "t.shadowError", mongoFn, async () => {
    throw new Error("D1_ERROR: boom");
  });
  await flushShadowWork();
  const se = await one(db, "SELECT * FROM shadow_results WHERE name = 't.shadowError'");
  check(r === mongoValue && se?.match === 0 && /boom/.test(se.error), "shadow: a D1 error is recorded and the answer is MongoDB's");

  // Timing: shadow mode with a slow D1 answers as fast as mongo mode.
  resetShadowSampling();
  const slowD1 = async () => {
    await sleep(400);
    return d1Value;
  };
  const mongoSlow = async () => {
    await sleep(30);
    return mongoValue;
  };
  await setFlag(db, "test", "mongo");
  let t0 = performance.now();
  for (let i = 0; i < 5; i++) await readWithShadow("test", "t.timing", mongoSlow, slowD1);
  const mongoMs = (performance.now() - t0) / 5;
  await setFlag(db, "test", "shadow");
  t0 = performance.now();
  for (let i = 0; i < 5; i++) {
    resetShadowSampling();
    await readWithShadow("test", "t.timing", mongoSlow, slowD1);
  }
  const shadowMs = (performance.now() - t0) / 5;
  const t1 = performance.now();
  await flushShadowWork();
  const bgMs = performance.now() - t1;
  console.log(`  timing: mongo mode ${mongoMs.toFixed(1)} ms, shadow mode ${shadowMs.toFixed(1)} ms per call; D1 work finished ${bgMs.toFixed(0)} ms later in the background`);
  check(shadowMs - mongoMs < 20, `shadow adds < 20 ms to the answer with a 400 ms D1 (${(shadowMs - mongoMs).toFixed(1)} ms)`);
  check(bgMs >= 300, "the slow D1 work really ran after the answers");

  // Recording failing (shadow tables gone / D1 down for writes) never throws to the caller.
  resetShadowSampling();
  configureReadSource({ resolveD1: () => faulty(db, { fail: (sql) => /shadow_(results|daily)/.test(sql) }) });
  let threw = false;
  try {
    r = await readWithShadow("test", "t.recordFails", mongoFn, d1Fn);
    await flushShadowWork();
  } catch {
    threw = true;
  }
  check(!threw && r === mongoValue && getLastShadowRun()?.recorded === false, "a failed record is only logged");
  configureReadSource({ resolveD1: () => db });

  // No D1 at all: every mode reads MongoDB.
  configureReadSource({ resolveD1: () => null });
  const before = d1Calls;
  r = await readWithShadow("test", "t.noD1", mongoFn, d1Fn);
  await flushShadowWork();
  check(r === mongoValue && d1Calls === before, "no D1 binding: MongoDB only");
  configureReadSource({ resolveD1: () => db });

  // Custom defer hook (as on Workers, work is queued and run by the caller once the response is out).
  const queued: Array<() => Promise<void>> = [];
  configureShadow({ defer: (t) => queued.push(t), now: () => Date.now() });
  resetShadowSampling();
  const callsBefore = d1Calls;
  r = await readWithShadow("test", "t.queued", mongoFn, d1Fn);
  check(queued.length === 1 && d1Calls === callsBefore, "queued work does not run until the queue is drained");
  await Promise.all(queued.map((t) => t()));
  check(d1Calls === callsBefore + 1 && (await one(db, "SELECT match FROM shadow_results WHERE name = 't.queued'"))?.match === 1, "draining the queue runs and records it");
  resetShadowConfig();
}

async function reportTests(db: D1DatabaseLike) {
  console.log("\nreport");
  configureReadSource({ resolveD1: () => db, envValue: () => "", flagTtlMs: 0 });
  await setFlag(db, "test", "shadow");
  // Three clean days before today, one with a mismatch before that.
  const now = Date.now();
  for (let i = 1; i <= 4; i++) {
    const day = istDay(now - i * 86400_000);
    await db
      .prepare("INSERT INTO shadow_daily (area, name, day, runs, matches, mismatches, errors, fallbacks, mongoMsTotal, d1MsTotal, lastAt) VALUES ('test', 't.report', ?, 10, ?, ?, 0, 0, 200, 50, ?)")
      .bind(day, i === 4 ? 9 : 10, i === 4 ? 1 : 0, new Date(now - i * 86400_000).toISOString())
      .run();
  }
  const status = await getShadowStatus(db, { days: 7, now });
  const p = status.paths.find((x) => x.area === "test" && x.name === "t.report");
  check(!!p && p.runs === 40 && p.matches === 39 && p.mismatches === 1, "report totals runs / matches / mismatches over the window");
  check(p?.matchPct === 97.5 && p.avgMongoMs === 20 && p.avgD1Ms === 5, `match % and average timings (${p?.matchPct}%, ${p?.avgMongoMs} / ${p?.avgD1Ms} ms)`);
  check(p?.cleanDays === 3, `clean for 3 days in a row (${p?.cleanDays})`);
  check(p?.mode === "shadow" && status.modes.test?.mode === "shadow", "current mode shown");
  const mm = status.paths.find((x) => x.name === "t.mismatch");
  check(!!mm?.lastMismatch && Array.isArray(mm.lastMismatch.diffs) && mm.cleanDays === 0, "last mismatch sample shown; a mismatch today means 0 clean days");
  const old = await getShadowStatus(db, { days: 2, now });
  check(!old.paths.find((x) => x.name === "t.report")?.days.some((d) => d.mismatches), "the window limits the days");

  console.log("\nadmin route");
  const admin = { id: "a1", name: "Admin", email: "a@x", role: "admin", permissions: [] };
  const salesman = { ...admin, role: "salesman" };
  const call = (actor: any, url = "http://localhost/api/admin/d1-shadow-status") =>
    deferredContext.run({ approver: actor }, () => (shadowStatusGET as any)(new Request(url)) as Promise<Response>);
  const denied = await call(salesman);
  check(denied.status === 403, "salesman: 403");
  const ok = await call(admin, "http://localhost/api/admin/d1-shadow-status?days=7");
  const body: any = await ok.json();
  check(ok.status === 200 && body.success && body.paths.some((x: any) => x.name === "t.report") && body.windowDays === 7, "admin: 200 with the per-path report");
  check(!JSON.stringify(body).includes("4321") && !JSON.stringify(body).includes("111122223333"), "report carries no secret values");
  configureReadSource({ resolveD1: () => null });
  const noDb = await call(admin);
  check(noDb.status === 503, "no D1 binding: 503");
  resetReadSourceConfig();
}

/**
 * The push.subsForUsers finding of 14 Nov: "D1 newer than MongoDB". lib/push.ts reads the devices (MongoDB answers,
 * shadow mode), sends, then sets lastSuccessAt on them; the write-through copies that to D1 at once; only after the
 * response does the deferred D1 read run, so it sees the NEW lastSuccessAt and MongoDB's answer is the OLD one.
 * Mongo and D1 are plain in-memory stores here, changed exactly in that order.
 */
async function raceTests(db: D1DatabaseLike) {
  console.log("\nraces between the two reads of a comparison");
  configureReadSource({ resolveD1: () => db, envValue: () => "", flagTtlMs: 0 });
  resetShadowConfig();
  const old = "2026-11-13T06:30:25.689Z";
  const now = "2026-11-14T04:31:06.479Z";
  const device = (at: string) => ({ _id: "6a0000000000000000000001", endpoint: "https://push.example/1", lastSuccessAt: at, updatedAt: at });
  let mongo = [device(old)];
  let d1 = [device(old)];
  let mongoReads = 0;
  const mongoFn = async () => {
    mongoReads++;
    return JSON.parse(JSON.stringify(mongo));
  };
  const d1Fn = async () => JSON.parse(JSON.stringify(d1));
  const pushLike = async (name: string) => {
    const subs = await readWithShadow("staff", name, mongoFn, d1Fn); // the devices, as pushToUsers reads them
    // ... sent; then `PushSubscription.updateMany({ endpoint: { $in: ok } }, { $set: { lastSuccessAt: new Date() } })`,
    // copied into D1 in the same request by the write-through:
    mongo = [device(now)];
    d1 = [device(now)];
    return subs;
  };

  await setFlag(db, "staff", "shadow");
  const subs: any = await pushLike("push.race");
  await flushShadowWork();
  const row = await one(db, "SELECT * FROM shadow_results WHERE name = 'push.race'");
  const day = await one(db, "SELECT * FROM shadow_daily WHERE name = 'push.race'");
  check(subs[0].lastSuccessAt === old, "the request got MongoDB's answer from before its own update");
  check(row?.match === 1 && row.raced === 1 && row.diffCount === 2 && mongoReads === 2, `shadow: D1 'newer' than MongoDB was the update in between: a match, marked raced (match ${row?.match}, raced ${row?.raced}, MongoDB read ${mongoReads}x)`);
  check(day?.mismatches === 0 && day.matches === 1 && day.raced === 1, "  daily totals: no mismatch, one raced match (Stage C sees nothing wrong)");

  // D1 really behind (an earlier copy was missed), and another write lands in between whose copy is missed too: the
  // second MongoDB read differs from D1 as well -> a mismatch, as before.
  resetShadowSampling();
  mongo = [device(old)];
  d1 = [device("2026-11-12T10:00:00.000Z")];
  await readWithShadow("staff", "push.behind", mongoFn, d1Fn);
  mongo = [device(now)];
  await flushShadowWork();
  const behind = await one(db, "SELECT * FROM shadow_results WHERE name = 'push.behind'");
  check(behind?.match === 0 && behind.raced === 0, "shadow: D1 left behind by a write is still a mismatch (the fresh MongoDB read differs from D1 too)");

  // A plain wrong D1 answer, nothing changing: a mismatch.
  resetShadowSampling();
  mongo = [device(old)];
  d1 = [device("2020-01-01T00:00:00.000Z")];
  await readWithShadow("staff", "push.wrong", mongoFn, d1Fn);
  await flushShadowWork();
  const wrong = await one(db, "SELECT * FROM shadow_results WHERE name = 'push.wrong'");
  check(wrong?.match === 0 && wrong.raced === 0, "shadow: a wrong D1 answer stays a mismatch");

  // The second read fails: proves nothing, the mismatch stands.
  resetShadowSampling();
  let failSecond = false;
  const flakyMongo = async () => {
    if (failSecond) throw new Error("MongoDB went away");
    failSecond = true;
    return JSON.parse(JSON.stringify(mongo));
  };
  d1 = [device(now)];
  await readWithShadow("staff", "push.flaky", flakyMongo, d1Fn);
  await flushShadowWork();
  const flaky = await one(db, "SELECT * FROM shadow_results WHERE name = 'push.flaky'");
  check(flaky?.match === 0 && flaky.raced === 0, "shadow: when the second read fails, the mismatch stands");

  // A delivery reminder stamped on a bill while the comparison runs (14 Nov, orders.list): D1 already shows it, the
  // immediate second MongoDB read still does not, but a moment later both sides read the same -> a raced match.
  resetShadowSampling();
  configureShadow({ raceRecheckDelayMs: 5 });
  let lateReads = 0;
  const lateMongo = async () => {
    lateReads++;
    return JSON.parse(JSON.stringify(lateReads <= 2 ? [device(old)] : [device(now)]));
  };
  d1 = [device(now)];
  await readWithShadow("staff", "push.late", lateMongo, d1Fn);
  await flushShadowWork();
  const late = await one(db, "SELECT * FROM shadow_results WHERE name = 'push.late'");
  check(late?.match === 1 && late.raced === 1 && lateReads === 3, `shadow: a change still on its way is a raced match once both sides read the same (match ${late?.match}, raced ${late?.raced}, MongoDB read ${lateReads}x)`);
  resetShadowConfig();

  // d1 mode (reverse shadow): D1 answers first, the update lands, MongoDB is read after the response.
  resetShadowSampling();
  await setFlag(db, "staff", "d1");
  mongo = [device(old)];
  d1 = [device(old)];
  const served: any = await pushLike("push.reverse");
  await flushShadowWork();
  const rev = await one(db, "SELECT * FROM shadow_results WHERE name = 'push.reverse'");
  check(served[0].lastSuccessAt === old && rev?.kind === "reverse" && rev.match === 1 && rev.raced === 1, "reverse: MongoDB 'newer' than D1's answer was the update in between: raced match");
  await setFlag(db, "staff", "shadow");
  resetReadSourceConfig();
}

async function main() {
  const local = await startLocalD1();
  try {
    const files = await applyMigrations(local.db);
    check(files.includes("0007_shadow.sql"), `migrations applied (${files.join(", ")})`);
    comparatorTests();
    await readSourceTests(local.db);
    await setFlag(local.db, "masters", "shadow");
    await modeTests(local.db);
    await raceTests(local.db);
    await reportTests(local.db);
  } finally {
    await local.dispose();
  }
  process.exit(summary("d1-shadow") ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
