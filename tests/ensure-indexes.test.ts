/**
 * lib/ensure-indexes.ts: creates the listed indexes (never unique), leaves equivalent existing ones alone (including a
 * unique one with the same keys and an index with a different name), skips collections that do not exist, does
 * nothing on a second run, and the cron wrapper runs only until it has succeeded once.
 */
import "./helpers/fixed-clock";
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { INDEXES, ensureIndexes, ensureIndexesOnce, ENSURE_INDEXES_JOB } from "@/lib/ensure-indexes";
import ScheduledRun from "@/models/ScheduledRun";

/** The same once-only helper the cron uses (lib/attendance-alerts.ts). */
async function claim(key: string): Promise<boolean> {
  const earlier = await ScheduledRun.findOneAndUpdate({ key }, { $setOnInsert: { ranAt: new Date() } }, { upsert: true, new: false });
  return !earlier;
}

async function main() {
  await startMemoryMongo("indexes_test");
  const db = mongoose.connection.db!;

  // Every listed collection exists except "push_subscriptions" (to check it is skipped, not created).
  const collections = Array.from(new Set(INDEXES.map((s) => s.collection))).filter((c) => c !== "push_subscriptions");
  for (const c of collections) await db.collection(c).insertOne({ seeded: true });
  // Already there, as the models would have built them on Node: a UNIQUE invoiceNumber index, and an attendance
  // index with the same keys under a custom name.
  await db.collection("invoices").createIndex({ invoiceNumber: 1 }, { unique: true });
  await db.collection("attendance").createIndex({ staffName: 1, date: 1 }, { name: "my_custom_name" });
  // An index whose NAME is what createIndex would pick for { customerPhone: 1 } but with other keys: a conflict.
  await db.collection("invoices").createIndex({ customerPhone: -1 }, { name: "customerPhone_1" });

  const first = await ensureIndexes();
  const expectedCreated = INDEXES.length - INDEXES.filter((i) => i.collection === "push_subscriptions").length /* missing collection */ - 2 /* already there */ - 1 /* conflict */;
  check(first.failed.length === 0, `first run: nothing failed ${first.failed.join("; ")}`);
  check(first.created.length === expectedCreated, `first run: ${first.created.length} created (expected ${expectedCreated})`);
  check(first.exists === 2, `first run: the 2 equivalent existing indexes are left alone (${first.exists})`);
  check(first.skipped.some((s) => s.startsWith("push_subscriptions") && s.includes("no such collection")), "missing collection skipped");
  check(first.skipped.some((s) => s.startsWith("invoices") && s.includes("customerPhone")), "name clash reported as skipped, not failed");
  check(!(await db.listCollections({ name: "push_subscriptions" }).toArray()).length, "missing collection was not created");

  let allPresent = true;
  let anyNewUnique = false;
  for (const spec of INDEXES) {
    if (spec.collection === "push_subscriptions") continue;
    if (spec.collection === "invoices" && "customerPhone" in spec.key) continue;
    const list = await db.collection(spec.collection).listIndexes().toArray();
    const found = list.find((ix: any) => JSON.stringify(ix.key) === JSON.stringify(spec.key));
    if (!found) allPresent = false;
    if (found?.unique && !(spec.collection === "invoices" && "invoiceNumber" in spec.key)) anyNewUnique = true;
  }
  check(allPresent, "every listed index now exists");
  check(!anyNewUnique, "no unique index was created");
  const invoiceIdx = await db.collection("invoices").listIndexes().toArray();
  check(invoiceIdx.filter((ix: any) => JSON.stringify(ix.key) === '{"invoiceNumber":1}').length === 1, "the existing unique invoiceNumber index was not duplicated or changed");

  const second = await ensureIndexes();
  check(second.created.length === 0 && second.failed.length === 0, "second run creates nothing (no-op)");

  // Cron wrapper: runs once, marks the job done, then stays quiet.
  await db.collection("scheduled_runs").deleteMany({});
  const runA = await ensureIndexesOnce(claim);
  check(runA !== null && runA.failed.length === 0, "cron wrapper ran the job");
  check(!!(await ScheduledRun.exists({ key: ENSURE_INDEXES_JOB })), `job marked done under "${ENSURE_INDEXES_JOB}"`);
  const runB = await ensureIndexesOnce(claim);
  check(runB === null, "cron wrapper does nothing once done");

  // A failing attempt is not marked done and is not retried within the same hour.
  await db.collection("scheduled_runs").deleteMany({});
  const realCollection = (mongoose.connection.db as any).collection.bind(mongoose.connection.db);
  (mongoose.connection.db as any).collection = (name: string) => {
    const c = realCollection(name);
    return new Proxy(c, { get: (t, p) => (p === "createIndex" ? async () => { throw new Error("simulated network error"); } : (t as any)[p]?.bind ? (t as any)[p].bind(t) : (t as any)[p]) });
  };
  await db.collection("items").dropIndexes();
  const failing = await ensureIndexesOnce(claim);
  check(failing !== null && failing.failed.length > 0, "a failing build is reported (and did not throw)");
  check(!(await ScheduledRun.exists({ key: ENSURE_INDEXES_JOB })), "a failing run is not marked done");
  check((await ensureIndexesOnce(claim)) === null, "no second attempt within the same hour");
  (mongoose.connection.db as any).collection = realCollection;

  // Never throws, even without a database.
  const savedDb = Object.getOwnPropertyDescriptor(mongoose.connection, "db");
  Object.defineProperty(mongoose.connection, "db", { configurable: true, get: () => null });
  let threw = false;
  try {
    await ensureIndexesOnce(async () => true);
  } catch {
    threw = true;
  }
  if (savedDb) Object.defineProperty(mongoose.connection, "db", savedDb);
  else delete (mongoose.connection as any).db;
  check(!threw, "ensureIndexesOnce never throws");

  await stopMemoryMongo();
  return summary("ensure-indexes");
}

main().then(
  (failures) => process.exit(failures ? 1 : 0),
  async (e) => {
    console.error(e);
    await stopMemoryMongo().catch(() => {});
    process.exit(1);
  }
);
