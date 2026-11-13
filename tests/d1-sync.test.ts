/**
 * Phase 1 of the D1 migration (docs/D1_MIGRATION_PLAN.md): the master-data copy from MongoDB into D1.
 *  - the migration applies cleanly and every table has exactly the columns the mapping writes;
 *  - mapping: realistic items / customers / suppliers, missing fields, unicode, large numbers, legacy shapes,
 *    a deterministic hash;
 *  - a full copy, then incremental copies that pick up changed documents ($inc through findByIdAndUpdate), with
 *    child rows replaced rather than duplicated;
 *  - the nightly reconciliation deletes rows whose document is gone and repairs rows changed behind updatedAt;
 *  - counts and hashes match afterwards (the status report);
 *  - a failing D1 write lands in sync_errors and does not throw, nor does a completely broken D1;
 *  - time-boxing stops a run and the next runs resume to the same end state.
 * Uses MongoDB in memory and a local D1 (Miniflare via wrangler); nothing external.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import type { D1DatabaseLike, D1PreparedStatementLike } from "@/lib/d1/types";
import { ALL_SPECS } from "@/lib/d1/registry";
import { MASTER_SPECS, SPEC_BY_COLLECTION, tableColumns, mapDoc, docHash, canonicalJson, toReal, toDate } from "@/lib/d1/masters-map";
import { runD1Sync, getD1SyncStatus } from "@/lib/d1/sync";
import Item from "@/models/Item";
import Customer from "@/models/Customer";
import Supplier from "@/models/Supplier";
import Brand from "@/models/Brand";
import Category from "@/models/Category";
import Unit from "@/models/Unit";
import Warehouse from "@/models/Warehouse";

const { ObjectId, Decimal128 } = mongoose.mongo as any;

async function all(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any[]> {
  const res = await db.prepare(sql).bind(...args).all();
  return (res.results || []) as any[];
}
async function one(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any> {
  return db.prepare(sql).bind(...args).first();
}
async function count(db: D1DatabaseLike, table: string): Promise<number> {
  return Number((await one(db, `SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0);
}
async function clearD1(db: D1DatabaseLike) {
  for (const t of ["itemStock", "itemSupplierCodes", ...MASTER_SPECS.map((s) => s.table), "sync_state", "sync_errors"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
}

/** A D1 whose batches fail whenever a statement is bound to `badId` (everything else passes through). */
function failingFor(real: D1DatabaseLike, badId: string): D1DatabaseLike {
  type W = D1PreparedStatementLike & { inner: D1PreparedStatementLike; args: unknown[] };
  const wrap = (inner: D1PreparedStatementLike, args: unknown[]): W => ({
    inner,
    args,
    bind: (...v: unknown[]) => wrap(inner.bind(...v), v),
    run: () => inner.run(),
    all: <T,>() => inner.all<T>(),
    first: <T,>() => inner.first<T>(),
  });
  return {
    prepare: (sql: string) => wrap(real.prepare(sql), []),
    batch: async (stmts: D1PreparedStatementLike[]) => {
      const ws = stmts as W[];
      if (ws.some((s) => s.args.includes(badId))) throw new Error("D1_ERROR: simulated write failure");
      return real.batch(ws.map((s) => s.inner));
    },
  };
}

const WH_A = new ObjectId();
const WH_B = new ObjectId();

async function seed() {
  await Warehouse.create([
    { _id: WH_A, name: "Showroom", code: "SR", type: "showroom", address: "MG Road", city: "Lucknow", state: "Uttar Pradesh", pincode: "226001", contactPerson: "Amit", phone: "9000000001", email: "sr@example.com", isDefault: true },
    { _id: WH_B, name: "GIDA Godown", code: "GD", type: "godown", address: "GIDA", city: "Gorakhpur", state: "Uttar Pradesh", pincode: "273209", contactPerson: "Ravi", phone: "9000000002", email: "gd@example.com" },
  ]);
  await Brand.create([{ name: "Samsung" }, { name: "LG" }, { name: "Godrej", status: "inactive" }]);
  await Category.create([{ name: "TV" }, { name: "LED TV", parentId: "tv" }]);
  await Unit.create([{ name: "Numbers", shortName: "NOS" }, { name: "Pieces", shortName: "PCS" }]);
  await Supplier.create({
    code: "SUP1", name: "Value Plus Retail", phone: "9000000010",
    address: { line1: "Hazratganj", city: "Lucknow", state: "Uttar Pradesh", pincode: "226001" },
    outstandingBalance: 125000.5, bankDetails: { bankName: "SBI", accountNumber: "000123", ifscCode: "SBIN0000001", accountType: "current" },
  });
  // Realistic items, including per-warehouse stock and supplier codes.
  for (let i = 0; i < 12; i++) {
    await Item.create({
      code: `IT${String(i).padStart(3, "0")}`, name: i === 0 ? "सैमसंग 55\" टीवी — Crystal 4K" : `LG Fridge ${i}`, category: "TV", brand: i % 2 ? "LG" : "Samsung",
      purchasePrice: 30000 + i, sellingPrice: 35000 + i, mrp: 40000 + i, gstRate: 18, currentStock: 3, showroomStock: 2, godownStock: 1,
      stockByWarehouse: [{ warehouseId: WH_A, qty: 2 }, { warehouseId: WH_B, qty: 1 }],
      supplierCodes: i === 1 ? ["VP0012023", "VP0012023", "VP-2"] : undefined,
      incentives: i === 2 ? [{ type: "fixed", value: 500 }, { type: "percentage", value: 1.5, minPrice: 30000 }] : undefined,
      warrantyPlans: i === 3 ? [{ planName: "2 yr", durationMonths: 24, price: 1999 }] : undefined,
      vspUpdatedAt: i === 4 ? new Date("2026-11-01T10:00:00Z") : undefined,
    });
  }
  // Customers with balances; one with a shipping address.
  for (let i = 0; i < 15; i++) {
    await Customer.create({
      code: `C${1000 + i}`, name: i === 0 ? "राम कुमार" : `Customer ${i}`, phone: `98${String(i).padStart(8, "0")}`,
      billingAddress: { line1: `House ${i}`, city: "Lucknow", state: "Uttar Pradesh", pincode: "226001" },
      shippingAddress: i === 1 ? { line1: "Shop 4", city: "Kanpur", state: "Uttar Pradesh", pincode: "208001" } : undefined,
      outstandingBalance: i * 1000.25, advanceBalance: i === 2 ? 5000 : 0,
    });
  }
  // Odd legacy documents written straight to the collection (no schema): missing fields, a plain-string address,
  // numbers as strings, a huge number, Decimal128, an unknown field, no timestamps.
  await mongoose.connection.db!.collection("items").insertOne({
    _id: new ObjectId(), code: "ODD1", name: "Legacy item", purchasePrice: "1,234.50", sellingPrice: 9007199254740991, mrp: Decimal128.fromString("123456789012.34"),
    stockByWarehouse: [{ warehouseId: WH_A, qty: 1 }, { warehouseId: WH_A, qty: 4 }, { qty: 2 }, null], isSerialized: "true", legacyModel: "UA55", __v: 3,
  });
  await mongoose.connection.db!.collection("customers").insertOne({
    _id: new ObjectId(), code: "C-LEG", name: "Walk-in", billingAddress: "12 Old Street, Lucknow", outstandingBalance: -250.75, createdAt: "2024-03-01", updatedAt: new Date(),
  });
}

async function main() {
  await startMemoryMongo("d1_sync_test");
  const local = await startLocalD1();
  const db = local.db;
  const mongo = mongoose.connection.db!;
  try {
    // ── 0. wiring: the binding and the cron call ──
    const wrangler = JSON.parse(readFileSync(path.join(process.cwd(), "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
    const d1 = (wrangler.d1_databases || [])[0] || {};
    check(d1.binding === "DB" && d1.database_name === "valueplus-db" && d1.database_id === "519a8be8-7520-4a8b-861a-11a28791648f" && d1.migrations_dir === "d1/migrations", "wrangler.jsonc binds valueplus-db as DB with d1/migrations");
    const worker = readFileSync(path.join(process.cwd(), "worker.ts"), "utf8");
    check(/ctx\.waitUntil\(hit\("\/api\/cron\/d1-sync"\)\)/.test(worker) && /ctx\.waitUntil\(hit\("\/api\/cron\/attendance"\)\)/.test(worker), "worker.ts cron calls d1-sync in its own waitUntil, attendance unchanged");

    // ── 1. migration ──
    const files = await applyMigrations(db);
    check(files.length >= 1 && files[0].startsWith("0001_"), `migrations applied: ${files.join(", ")}`);
    for (const spec of MASTER_SPECS) {
      const cols = (await all(db, `PRAGMA table_info(${spec.table})`)).map((c) => c.name);
      const want = tableColumns(spec);
      check(JSON.stringify(cols) === JSON.stringify(want), `${spec.table}: columns match the mapping (${cols.length})`);
      check(want.length <= 100, `${spec.table}: ${want.length} columns, under D1's 100 and so one row per statement fits 100 params`);
      for (const child of spec.children || []) {
        const ccols = (await all(db, `PRAGMA table_info(${child.table})`)).map((c) => c.name);
        check(JSON.stringify(ccols) === JSON.stringify(child.columns), `${child.table}: columns match`);
      }
    }
    check((await all(db, "PRAGMA table_info(sync_state)")).length > 5 && (await all(db, "PRAGMA table_info(sync_errors)")).length === 6, "sync_state and sync_errors exist");

    // ── 2. mapping, without a database ──
    const itemSpec = SPEC_BY_COLLECTION.items;
    const custSpec = SPEC_BY_COLLECTION.customers;
    const a = { _id: new ObjectId("650000000000000000000001"), name: "X", z: 1, a: { d: 2, c: [3, { y: 1, x: 2 }] } };
    const b = { a: { c: [3, { x: 2, y: 1 }], d: 2 }, z: 1, name: "X", _id: new ObjectId("650000000000000000000001") };
    check((await docHash(a)) === (await docHash(b)), "docHash ignores key order");
    check((await docHash(a)) !== (await docHash({ ...a, z: 2 })), "docHash changes when a value changes");
    check(canonicalJson({ d: new Date("2026-11-13T04:30:00Z"), u: undefined }) === '{"d":"2026-11-13T04:30:00.000Z"}', "canonical JSON: ISO dates, undefined dropped");
    check(toReal("1,234.50") === 1234.5 && toReal("abc") === null && toReal(NaN) === null && toReal(Decimal128.fromString("12.5")) === 12.5, "numbers: strings, NaN, Decimal128");
    check(toDate("2026-11-13") === "2026-11-13T00:00:00.000Z" && toDate("not a date") === "not a date" && toDate(undefined) === null, "dates: ISO, legacy text kept, missing -> NULL");

    const bare = await mapDoc(itemSpec, { _id: new ObjectId("650000000000000000000002") }, "2026-11-13T00:00:00.000Z");
    check(bare.row.name === null && bare.row.mrp === null && bare.row.isSerialized === 0 && bare.row.nameLower === "", "missing fields -> NULL / 0 / ''");
    check(bare.row.createdAt === new Date(0x65000000 * 1000).toISOString() && bare.row.updatedAt === bare.row.createdAt, "missing timestamps -> ObjectId time");
    check(bare.children.every((c) => c.rows.length === 0) && bare.row.extra === null, "no stock, no codes, no extra");
    const cust = await mapDoc(custSpec, { _id: new ObjectId(), name: "Ünïcødé", billingAddress: { line1: "A", landmark: "near temple", _id: new ObjectId() }, outstandingBalance: 1e15, foo: [1] });
    check(cust.row.billing_line1 === "A" && cust.row.shipping_line1 === null && cust.row.outstandingBalance === 1e15, "customer: flattened address, large balance");
    check(cust.row.extra === '{"billingAddress":{"landmark":"near temple"},"foo":[1]}', `unknown fields kept in extra: ${cust.row.extra}`);
    check(cust.row.nameLower === "ünïcødé", "nameLower lowercases unicode in JS");

    // ── 3. full copy ──
    await seed();
    const first = await runD1Sync(db, { reconcile: "skip" });
    check(first.ok && first.errors === 0 && !first.timedOut, `first run ok (${first.ms} ms, errors ${first.errors})`);
    check(Object.values(first.collections).every((c) => c.mode === "full" && c.fullCopyDone), "every collection did its full copy");
    for (const spec of MASTER_SPECS) {
      const m = await mongo.collection(spec.collection).countDocuments();
      const d = await count(db, spec.table);
      check(m === d && m > 0, `${spec.collection}: Mongo ${m} = D1 ${d}`);
    }
    check((await count(db, "itemStock")) === 12 * 2 + 2, `itemStock rows: ${await count(db, "itemStock")} (duplicates summed)`);
    const odd = await one(db, "SELECT * FROM items WHERE code = 'ODD1'");
    check(odd.purchasePrice === 1234.5 && odd.sellingPrice === 9007199254740991 && odd.mrp === 123456789012.34 && odd.isSerialized === 1 && odd.v === 3, "odd item: string / huge / Decimal128 numbers, 'true' boolean, __v");
    check(odd.extra === '{"legacyModel":"UA55"}' && odd.createdAt === odd.updatedAt, "odd item: unknown field in extra, timestamps from the ObjectId");
    const oddStock = await all(db, "SELECT warehouseId, qty FROM itemStock WHERE itemId = ? ORDER BY warehouseId", odd.id);
    check(JSON.stringify(oddStock) === JSON.stringify([{ warehouseId: "", qty: 2 }, { warehouseId: String(WH_A), qty: 5 }].sort((x, y) => (x.warehouseId < y.warehouseId ? -1 : 1))), `odd item stock: duplicate warehouse summed, missing warehouse kept as '' (${JSON.stringify(oddStock)})`);
    const hindi = await one(db, "SELECT * FROM items WHERE code = 'IT000'");
    check(hindi.name === "सैमसंग 55\" टीवी — Crystal 4K" && hindi.gstRate === 18 && hindi.purchaseIncludesGst === 0 && hindi.status === "active", "unicode item name round-trips");
    const codes = await all(db, "SELECT code FROM itemSupplierCodes WHERE itemId = (SELECT id FROM items WHERE code = 'IT001') ORDER BY code");
    check(JSON.stringify(codes.map((c) => c.code)) === '["VP-2","VP0012023"]', "supplier codes deduplicated");
    const inc = await one(db, "SELECT incentives FROM items WHERE code = 'IT002'");
    check(JSON.parse(inc.incentives).length === 2 && JSON.parse(inc.incentives)[1].minPrice === 30000, "incentives kept as JSON");
    check((await one(db, "SELECT vspUpdatedAt FROM items WHERE code = 'IT004'")).vspUpdatedAt === "2026-11-01T10:00:00.000Z", "Date -> ISO text");
    const leg = await one(db, "SELECT * FROM customers WHERE code = 'C-LEG'");
    check(leg.billing_line1 === "12 Old Street, Lucknow" && leg.outstandingBalance === -250.75 && leg.createdAt === "2024-03-01T00:00:00.000Z", "legacy customer: string address, negative balance, string createdAt");
    const sup = await one(db, "SELECT * FROM suppliers");
    check(sup.address_city === "Lucknow" && sup.bank_ifscCode === "SBIN0000001" && sup.outstandingBalance === 125000.5, "supplier flattened");
    const wh = await one(db, "SELECT * FROM warehouses WHERE code = 'SR'");
    check(wh.id === String(WH_A) && wh.isDefault === 1, "warehouse id is the 24-hex Mongo _id");

    // A second run straight after copies nothing (the 2-minute overlap re-reads, the hashes match).
    const idle = await runD1Sync(db, { reconcile: "skip" });
    check(idle.ok && Object.values(idle.collections).every((c) => c.mode === "incremental" && c.copied === 0), "second run: incremental, nothing rewritten");

    // ── 4. incremental ──
    const c3 = await Customer.findOne({ code: "C1003" });
    await Customer.findByIdAndUpdate(c3!._id, { $inc: { outstandingBalance: 499.5 } });
    const it5 = await Item.findOne({ code: "IT005" });
    await Item.findByIdAndUpdate(it5!._id, { $set: { stockByWarehouse: [{ warehouseId: WH_B, qty: 7 }], currentStock: 7 } });
    await Item.create({ code: "NEW1", name: "New arrival", purchasePrice: 1, sellingPrice: 2, mrp: 3, stockByWarehouse: [{ warehouseId: WH_A, qty: 1 }] });
    const incr = await runD1Sync(db, { reconcile: "skip" });
    check(incr.ok && incr.collections.customers.copied === 1 && incr.collections.items.copied === 2, `incremental copied customers ${incr.collections.customers.copied}, items ${incr.collections.items.copied}`);
    check((await one(db, "SELECT outstandingBalance FROM customers WHERE id = ?", String(c3!._id))).outstandingBalance === 3000.75 + 499.5, "$inc on a customer balance reached D1");
    const st5 = await all(db, "SELECT warehouseId, qty FROM itemStock WHERE itemId = ?", String(it5!._id));
    check(st5.length === 1 && st5[0].warehouseId === String(WH_B) && st5[0].qty === 7, "child rows replaced, not added to");
    check((await count(db, "itemStock")) === 12 * 2 + 2 - 1 + 1, "no duplicate child rows overall");
    check((await count(db, "items")) === (await mongo.collection("items").countDocuments()), "new item copied");
    const state = await one(db, "SELECT * FROM sync_state WHERE collection = 'customers'");
    check(!!state.watermark && !!state.fullCopyDoneAt && state.fullCopyLastId === null, "state: watermark set, full copy done");

    // ── 5. reconciliation: deletes and repairs ──
    const goneItem = await Item.findOne({ code: "IT006" });
    await Item.deleteOne({ _id: goneItem!._id });
    await Brand.deleteOne({ name: "Godrej" });
    // A raw-driver write that leaves updatedAt old (outside the incremental window): only the nightly repair sees it.
    const sneaky = await Customer.findOne({ code: "C1004" });
    await mongo.collection("customers").updateOne({ _id: sneaky!._id }, { $set: { loyaltyPoints: 77, updatedAt: new Date("2025-01-01T00:00:00Z") } });
    const nightHour = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
    if (nightHour < 23 && nightHour >= 1) {
      const auto = await runD1Sync(db); // "auto" outside 23:00-00:59 India time
      check(Object.values(auto.collections).every((c) => !c.reconcile), "auto mode: no reconciliation outside the night window");
    }
    const rec = await runD1Sync(db, { reconcile: "force" });
    check(rec.ok, `reconcile run ok (errors ${rec.errors})`);
    check(rec.collections.items.reconcile?.deleted === 1 && rec.collections.brands.reconcile?.deleted === 1, "deleted rows reported per collection");
    check(rec.collections.customers.reconcile?.repaired === 1, "repair re-copied the row changed behind updatedAt");
    check(!(await one(db, "SELECT id FROM items WHERE id = ?", String(goneItem!._id))), "deleted item gone from D1");
    check((await all(db, "SELECT * FROM itemStock WHERE itemId = ?", String(goneItem!._id))).length === 0, "its stock rows gone too");
    check((await one(db, "SELECT loyaltyPoints FROM customers WHERE id = ?", String(sneaky!._id))).loyaltyPoints === 77, "repaired value is in D1");
    const recState = await one(db, "SELECT * FROM sync_state WHERE collection = 'items'");
    check(recState.reconcileCursor === null && !!recState.lastReconcileAt && recState.lastReconcileDeleted === 1 && recState.mongoCount === recState.d1Count, "reconcile state recorded with counts");
    const again = await runD1Sync(db, { reconcile: "auto" });
    check(Object.values(again.collections).every((c) => !c.reconcile), "auto mode does not run it twice in one night");

    // ── 6. counts and hashes match ──
    const status = await getD1SyncStatus(db, { sampleSize: 200 });
    for (const cs of status.collections) {
      check(cs.mongoCount === cs.d1Count && !cs.error, `status ${cs.collection}: Mongo ${cs.mongoCount} = D1 ${cs.d1Count}`);
      check(!!cs.sample && cs.sample.size === cs.mongoCount && cs.sample.mismatched === 0 && cs.sample.missing === 0, `status ${cs.collection}: all ${cs.sample?.size} hashes match`);
    }
    // A corrupted D1 row is caught by the sample.
    await db.prepare("UPDATE customers SET docHash = 'x' WHERE code = 'C1001'").run();
    const bad = (await getD1SyncStatus(db, { sampleSize: 200 })).collections.find((c) => c.collection === "customers")!;
    check(bad.sample!.mismatched === 1, "status flags a corrupted row");
    await runD1Sync(db, { reconcile: "force" });
    check((await getD1SyncStatus(db, { sampleSize: 200 })).collections.find((c) => c.collection === "customers")!.sample!.mismatched === 0, "the next reconciliation repairs it");

    // ── 7. a failing D1 write is logged, never thrown ──
    const victim = await Customer.findOneAndUpdate({ code: "C1005" }, { $inc: { outstandingBalance: 1 } }, { new: true });
    await Customer.findOneAndUpdate({ code: "C1006" }, { $inc: { outstandingBalance: 1 } });
    let threw = false;
    let failed: any = null;
    try {
      failed = await runD1Sync(failingFor(db, String(victim!._id)), { reconcile: "skip", collections: ["customers"] });
    } catch {
      threw = true;
    }
    check(!threw && failed && !failed.ok && failed.errors === 1, "failing write: no throw, ok=false, one error");
    const errRow = await one(db, "SELECT * FROM sync_errors WHERE docId = ?", String(victim!._id));
    check(!!errRow && errRow.collection === "customers" && errRow.phase === "incremental" && errRow.message.includes("simulated"), "failure recorded in sync_errors");
    check((await one(db, "SELECT outstandingBalance FROM customers WHERE code = 'C1006'")).outstandingBalance === 6001.5 + 1, "the other document in the same batch still got through");
    const broken: D1DatabaseLike = {
      prepare: () => {
        throw new Error("D1 is down");
      },
      batch: async () => {
        throw new Error("D1 is down");
      },
    };
    let threw2 = false;
    let downRes: any = null;
    try {
      downRes = await runD1Sync(broken);
    } catch {
      threw2 = true;
    }
    check(!threw2 && downRes && !downRes.ok && downRes.errors >= 1, "D1 completely down: no throw, reported");
    const downStatus = await getD1SyncStatus(broken, { sampleSize: 5 });
    check(downStatus.collections.length === ALL_SPECS.length && downStatus.collections.every((c) => !!c.error), "status report survives D1 being down");
    // The failed document is caught up by the nightly repair.
    await runD1Sync(db, { reconcile: "force" });
    check((await one(db, "SELECT outstandingBalance FROM customers WHERE code = 'C1005'")).outstandingBalance === 5001.25 + 1, "failed document repaired later");

    // ── 8. time-boxing ──
    await clearD1(db);
    let fake = 0;
    const clock = () => (fake += 1000);
    let runs = 0;
    let timedOutRuns = 0;
    for (; runs < 100; runs++) {
      const r = await runD1Sync(db, { budgetMs: 4000, budgetClock: clock, pageSize: 3, batchDocs: 2, reconcile: "skip" });
      if (r.timedOut) timedOutRuns++;
      if (runs === 0) {
        const s = await one(db, "SELECT * FROM sync_state WHERE collection = 'items'");
        check(r.timedOut && !s.fullCopyDoneAt && !!s.fullCopyLastId, "first time-boxed run stopped mid-copy with a resume point");
        check((await count(db, "items")) > 0 && (await count(db, "items")) < (await mongo.collection("items").countDocuments()), "and copied only part of the items");
      }
      const done = await all(db, "SELECT fullCopyDoneAt FROM sync_state");
      if (done.length === ALL_SPECS.length && done.every((d) => d.fullCopyDoneAt)) break;
    }
    check(timedOutRuns > 1 && runs < 100, `full copy finished over ${runs + 1} short runs (${timedOutRuns} cut by the time box)`);
    const final = await getD1SyncStatus(db, { sampleSize: 200 });
    check(final.collections.every((c) => c.mongoCount === c.d1Count && c.sample?.mismatched === 0 && c.sample?.missing === 0), "after resuming: every count and hash matches");
    const expectStock = (await mongo.collection("items").find().toArray()).reduce((n: number, d: any) => n + new Set((d.stockByWarehouse || []).filter(Boolean).map((e: any) => String(e.warehouseId ?? ""))).size, 0);
    check((await count(db, "itemStock")) === expectStock, `itemStock rows = distinct (item, warehouse) pairs in Mongo (${expectStock}), none duplicated by resuming`);
    check((await count(db, "sync_errors")) === 0, "no errors in the time-boxed runs");
  } finally {
    await local.dispose();
    await stopMemoryMongo();
  }
  process.exit(summary("d1-sync") ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await stopMemoryMongo();
  } catch {}
  process.exit(1);
});
