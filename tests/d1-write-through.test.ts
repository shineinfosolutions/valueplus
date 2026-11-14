/**
 * Stage B1 of the D1 migration: write-through (lib/d1/write-through.ts). Every MongoDB write on a copied collection
 * lands in D1 in the same request.
 *  - every write kind (model create / save / updateOne / findByIdAndUpdate with $inc / insertMany / updateMany /
 *    replaceOne / findOneAndReplace / findOneAndDelete / deleteOne / deleteMany / bulkWrite / upserts, and raw
 *    collection writes) leaves the D1 row and its child rows equal to a fresh mapping of the Mongo document;
 *  - deletes remove the row and its child rows; insertMany is handled once (not again for its inner bulkWrite);
 *  - more than `cap` documents -> the collection is marked for a full re-copy, and the copy job then catches up;
 *  - ordering: two requests finishing out of order keep the newer state (older updatedAt is refused; same
 *    updatedAt is fixed by the verify round); an older snapshot landing late cannot replace a row or its children;
 *  - D1 failing / slow / down: the Mongo write succeeds with the same result, the error is logged, the added time
 *    is bounded by the timeout;
 *  - kill switch (feature_flags row, cached) and env switch: no D1 writes; collections not copied are not touched;
 *  - a bill save (invoice + item stock $inc + customer balance $inc + payment + serial), twice at once on the same
 *    item, leaves D1 equal to Mongo;
 *  - the added latency is measured.
 * Uses MongoDB in memory and a local D1 (Miniflare via wrangler); nothing external.
 */
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import type { D1DatabaseLike, D1PreparedStatementLike } from "@/lib/d1/types";
import { ALL_SPEC_BY_COLLECTION } from "@/lib/d1/registry";
import { tableColumns, mapDoc, idText, type MasterSpec } from "@/lib/d1/masters-map";
import { statementsFor } from "@/lib/d1/upsert";
import { runD1Sync } from "@/lib/d1/sync";
import {
  installWriteThrough,
  resetWriteThroughFlagCache,
  getLastWriteThrough,
  idsFromFilter,
  WRITE_METHODS,
} from "@/lib/d1/write-through";
import Item from "@/models/Item";
import Customer from "@/models/Customer";
import Invoice from "@/models/Invoice";
import PaymentTransaction from "@/models/PaymentTransaction";
import SerialNumber from "@/models/SerialNumber";
import Notification from "@/models/Notification";

const { ObjectId } = mongoose.mongo as any;

async function all(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any[]> {
  return ((await db.prepare(sql).bind(...args).all()).results || []) as any[];
}
async function one(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any> {
  return db.prepare(sql).bind(...args).first();
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Does D1 hold exactly a fresh mapping of the Mongo document (or nothing, when it is gone)? "" when equal. */
async function diffDoc(db: D1DatabaseLike, spec: MasterSpec, id: unknown): Promise<string> {
  const mongo = mongoose.connection.db!;
  const text = idText(id);
  const doc = await mongo.collection(spec.collection).findOne({ _id: id as any });
  const row = await one(db, `SELECT * FROM ${spec.table} WHERE id = ?`, text);
  if (!doc) {
    if (row) return `${text}: row still in D1`;
    for (const c of spec.children || []) {
      const n = (await one(db, `SELECT COUNT(*) AS n FROM ${c.table} WHERE ${c.parentCol} = ?`, text))?.n;
      if (Number(n)) return `${text}: ${n} ${c.table} rows still in D1`;
    }
    return "";
  }
  if (!row) return `${text}: no row in D1`;
  const m = await mapDoc(spec, doc);
  for (const col of tableColumns(spec)) {
    if (col === "syncedAt") continue;
    const want = m.row[col] ?? null;
    const got = row[col] ?? null;
    if (want !== got && !(typeof want === "number" && typeof got === "number" && Math.abs(want - got) < 1e-9)) {
      return `${text}: ${col} D1=${JSON.stringify(got)} Mongo=${JSON.stringify(want)}`;
    }
  }
  for (const c of m.children) {
    const got = (await all(db, `SELECT ${c.columns.join(", ")} FROM ${c.table} WHERE ${c.parentCol} = ?`, text)).map((r) => JSON.stringify(c.columns.map((k) => r[k] ?? null)));
    const want = c.rows.map((r) => JSON.stringify(r.map((v) => v ?? null)));
    if (JSON.stringify([...got].sort()) !== JSON.stringify([...want].sort())) return `${text}: ${c.table} differ (${got.length} in D1, ${want.length} in Mongo)`;
  }
  return "";
}

async function mirrored(db: D1DatabaseLike, collection: string, ids: unknown[]): Promise<string> {
  const spec = ALL_SPEC_BY_COLLECTION[collection];
  for (const id of ids) {
    const d = await diffDoc(db, spec, id);
    if (d) return d;
  }
  return "";
}

/** Every Mongo document of the collection is in D1 as mapped, and D1 has no row Mongo lacks. */
async function wholeCollectionEqual(db: D1DatabaseLike, collection: string): Promise<string> {
  const spec = ALL_SPEC_BY_COLLECTION[collection];
  const docs = await mongoose.connection.db!.collection(collection).find({}).toArray();
  for (const d of docs) {
    const diff = await diffDoc(db, spec, d._id);
    if (diff) return diff;
  }
  const n = Number((await one(db, `SELECT COUNT(*) AS n FROM ${spec.table}`))?.n ?? 0);
  return n === docs.length ? "" : `${spec.table}: ${n} rows in D1, ${docs.length} documents in Mongo`;
}

// ---------------------------------------------------------------------------
// D1 stand-ins
// ---------------------------------------------------------------------------

type W = D1PreparedStatementLike & { inner: D1PreparedStatementLike; sql: string };
function wrapStmt(inner: D1PreparedStatementLike, sql: string): W {
  return {
    inner,
    sql,
    bind: (...v: unknown[]) => wrapStmt(inner.bind(...v), sql),
    run: () => inner.run(),
    all: <T,>() => inner.all<T>(),
    first: <T,>() => inner.first<T>(),
  };
}
/** Real D1, but batches containing a statement whose SQL matches `fail` throw, and every batch waits `delayMs`. */
function tampered(real: D1DatabaseLike, opts: { fail?: (sql: string) => boolean; delayMs?: number }): D1DatabaseLike {
  return {
    prepare: (sql: string) => wrapStmt(real.prepare(sql), sql),
    batch: async (stmts: D1PreparedStatementLike[]) => {
      const ws = stmts as W[];
      if (opts.delayMs) await sleep(opts.delayMs);
      if (opts.fail && ws.some((s) => opts.fail!(s.sql))) throw new Error("D1_ERROR: simulated write failure");
      return real.batch(ws.map((s) => s.inner));
    },
  };
}
/** Counts every call that reaches D1. */
function counting(real: D1DatabaseLike) {
  const n = { prepare: 0, batch: 0 };
  const db: D1DatabaseLike = {
    prepare: (sql: string) => {
      n.prepare++;
      return real.prepare(sql);
    },
    batch: (s: D1PreparedStatementLike[]) => {
      n.batch++;
      return real.batch(s);
    },
  };
  return { db, n };
}
const brokenD1: D1DatabaseLike = {
  prepare: () => {
    throw new Error("D1 is down");
  },
  batch: async () => {
    throw new Error("D1 is down");
  },
};

// ---------------------------------------------------------------------------

const WH_A = new ObjectId();
const WH_B = new ObjectId();
let itemSeq = 0;
function itemData(over: Record<string, unknown> = {}) {
  itemSeq++;
  return {
    code: `WT${String(itemSeq).padStart(3, "0")}`, name: `LG Fridge ${itemSeq}`, category: "Fridge", brand: "LG",
    purchasePrice: 30000, sellingPrice: 35000, mrp: 40000, gstRate: 18, currentStock: 5, showroomStock: 3, godownStock: 2,
    stockByWarehouse: [{ warehouseId: WH_A, qty: 3 }, { warehouseId: WH_B, qty: 2 }], supplierCodes: [`SC-${itemSeq}`],
    ...over,
  };
}
function customerData(i: number, over: Record<string, unknown> = {}) {
  return {
    code: `WC${1000 + i}`, name: i === 0 ? "राम कुमार" : `Customer ${i}`, phone: `97${String(i).padStart(8, "0")}`,
    billingAddress: { line1: `House ${i}`, city: "Lucknow", state: "Uttar Pradesh", pincode: "226001" }, outstandingBalance: 0,
    ...over,
  };
}
let billSeq = 0;
function billData(itemId: string, customerId: string, serial: string) {
  billSeq++;
  const rate = 35000;
  const taxable = rate / 1.18;
  return {
    invoiceNumber: `VP/26-27/W${String(billSeq).padStart(3, "0")}`, customerId, customerName: "राम कुमार", customerPhone: "9700000000",
    warehouseId: WH_A, date: "2026-11-13", dueDate: "2026-12-13",
    items: [{ itemId, itemName: "LG Fridge", itemCode: "WT", quantity: 1, unit: "Pcs", rate, taxableAmount: taxable, gstRate: 18, cgst: taxable * 0.09, sgst: taxable * 0.09, igst: 0, amount: rate, serialNumber: serial }],
    payments: [{ mode: "Cash", amount: 15000 }, { mode: "UPI", amount: 20000, txnId: `UTR${billSeq}` }],
    subtotal: rate, taxableAmount: taxable, cgst: taxable * 0.09, sgst: taxable * 0.09, totalGST: taxable * 0.18,
    total: rate, paidAmount: rate, balanceAmount: 0, paymentMode: "Multiple", salesExecutive: "AMIT SINGH",
  };
}

/** One bill save, as app/api/invoices does it: invoice, stock, customer balance, payment, serial. */
async function saveBill(itemId: any, customerId: any, serial: string) {
  const inv = await Invoice.create(billData(String(itemId), String(customerId), serial));
  await Item.findOneAndUpdate(
    { _id: itemId, "stockByWarehouse.warehouseId": WH_A },
    { $inc: { currentStock: -1, showroomStock: -1, "stockByWarehouse.$.qty": -1 } },
    { new: true }
  );
  await Customer.updateOne({ _id: customerId }, { $inc: { outstandingBalance: 0, totalPurchases: 35000 } as any });
  const pay = await PaymentTransaction.create({
    transactionId: `PT-${inv.invoiceNumber}`, partyId: String(customerId), partyType: "Customer", partyName: "राम कुमार", amount: 35000,
    paymentMode: "Multiple", date: "2026-11-13", referenceId: inv.invoiceNumber, type: "received",
  });
  const sn = await SerialNumber.findOneAndUpdate(
    { serialNumber: serial },
    { $set: { status: "SOLD", invoiceId: String(inv._id), invoiceNumber: inv.invoiceNumber, soldDate: "2026-11-13" }, $push: { history: { action: "SOLD", details: inv.invoiceNumber } } },
    { new: true }
  );
  return { inv, pay, sn };
}

async function main() {
  await startMemoryMongo("d1_write_through_test");
  const local = await startLocalD1();
  const realDb = local.db;
  const mongo = mongoose.connection.db!;
  let currentD1: D1DatabaseLike | null = realDb;
  let envOff = false;
  installWriteThrough({ resolveD1: () => currentD1, envOff: () => envOff, timeoutMs: 3000 });
  const report = () => getLastWriteThrough();
  const wtState = (c: string) => one(realDb, "SELECT * FROM write_through_state WHERE collection = ?", c);

  try {
    // Models build their indexes before the timed / counted parts.
    await Promise.allSettled([Item, Customer, Invoice, PaymentTransaction, SerialNumber, Notification].map((m: any) => m.init()));

    // ── 1. migration ──
    const files = await applyMigrations(realDb);
    // Later stages add migrations after 0006 (0007_shadow.sql ...): only its place after the copy tables matters.
    check(files.includes("0006_flags.sql") && files.indexOf("0006_flags.sql") > files.indexOf("0005_crm_docs.sql"), `migrations applied in order: ${files.join(", ")}`);
    const flagRow = await one(realDb, "SELECT value FROM feature_flags WHERE key = 'writeThrough'");
    check(flagRow?.value === "on", "feature_flags.writeThrough is 'on' after the migration");
    check(!!(await one(realDb, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'write_through_state'")), "write_through_state table exists");

    // ── 2. the hook ──
    const proto = (mongoose as any).mongo.Collection.prototype;
    check(WRITE_METHODS.every((m) => proto[m].name === "d1WriteThrough"), "all 11 driver write methods are hooked");
    check(JSON.stringify(idsFromFilter({ _id: "a" })) === '["a"]' && idsFromFilter({ _id: { $in: ["a", "b"] } })!.length === 2 && idsFromFilter({ _id: { $gt: "a" } }) === null && idsFromFilter({ code: "x" }) === null && idsFromFilter({ _id: /x/ }) === null, "ids are taken from an _id filter only when it names them");

    // ── 3. every write kind ──
    // Model.create -> insertOne (with child rows)
    const it1 = await Item.create(itemData({ name: "सैमसंग 55\" टीवी — Crystal 4K" }));
    check((await mirrored(realDb, "items", [it1._id])) === "" && report()?.method === "insertOne", `Model.create -> insertOne mirrored with children ${await mirrored(realDb, "items", [it1._id])}`);
    check(Number((await one(realDb, "SELECT COUNT(*) AS n FROM itemStock WHERE itemId = ?", String(it1._id)))?.n) === 2, "  itemStock child rows written (2)");

    // doc.save() of an existing document -> updateOne by _id (children replaced, not duplicated)
    it1.stockByWarehouse = [{ warehouseId: WH_A, qty: 7 }] as any;
    it1.sellingPrice = 36000;
    await it1.save();
    check((await mirrored(realDb, "items", [it1._id])) === "" && report()?.method === "updateOne", "doc.save() -> updateOne mirrored");
    check(Number((await one(realDb, "SELECT COUNT(*) AS n FROM itemStock WHERE itemId = ?", String(it1._id)))?.n) === 1, "  child rows replaced (now 1)");

    // Model.updateOne with a non-_id filter (ids read first)
    const r1 = await Item.updateOne({ code: it1.code }, { $set: { mrp: 41000 } });
    check(r1.matchedCount === 1 && r1.modifiedCount === 1 && r1.acknowledged === true, "Model.updateOne result unchanged");
    check((await mirrored(realDb, "items", [it1._id])) === "", "Model.updateOne (filter by code) mirrored");

    // findByIdAndUpdate with $inc -> findOneAndUpdate
    const after = await Item.findByIdAndUpdate(it1._id, { $inc: { currentStock: -2, "stockByWarehouse.0.qty": -2 } }, { new: true });
    check(after?.currentStock === 3, "findByIdAndUpdate returns the updated doc as before");
    check((await mirrored(realDb, "items", [it1._id])) === "" && report()?.method === "findOneAndUpdate", "findByIdAndUpdate $inc mirrored");

    // insertMany (60 customers) -> handled once, not again for the driver's inner bulkWrite
    const writesBefore = Number((await wtState("customers"))?.writes ?? 0);
    const custs = await Customer.insertMany(Array.from({ length: 60 }, (_, i) => customerData(i)));
    check(custs.length === 60, "insertMany returns its 60 docs");
    check((await mirrored(realDb, "customers", custs.map((c) => c._id))) === "", "insertMany: 60 customers mirrored");
    check(Number((await wtState("customers"))?.writes) === writesBefore + 1 && report()?.method === "insertMany", "insertMany handled once (inner bulkWrite not handled again)");

    // updateMany over many docs
    const um = await Customer.updateMany({ "billingAddress.city": "Lucknow" }, { $inc: { outstandingBalance: 100.25 } });
    check(um.matchedCount === 60 && um.modifiedCount === 60, "updateMany result unchanged (60)");
    check((await mirrored(realDb, "customers", custs.map((c) => c._id))) === "" && report()?.ids === 60, "updateMany: all 60 mirrored");

    // replaceOne / findOneAndReplace
    await Customer.replaceOne({ _id: custs[1]._id }, customerData(1, { name: "Replaced 1", outstandingBalance: 5 }));
    check((await mirrored(realDb, "customers", [custs[1]._id])) === "" && report()?.method === "replaceOne", "replaceOne mirrored");
    await Customer.findOneAndReplace({ code: custs[2].code }, customerData(2, { name: "Replaced 2" }));
    check((await mirrored(realDb, "customers", [custs[2]._id])) === "" && report()?.method === "findOneAndReplace", "findOneAndReplace mirrored");

    // findOneAndDelete / deleteOne / deleteMany: row + child rows gone
    const it2 = await Item.create(itemData());
    const it3 = await Item.create(itemData());
    const it4 = await Item.create(itemData({ category: "ToDelete" }));
    const it5 = await Item.create(itemData({ category: "ToDelete" }));
    await Item.findOneAndDelete({ code: it2.code });
    check((await mirrored(realDb, "items", [it2._id])) === "" && !(await one(realDb, "SELECT id FROM items WHERE id = ?", String(it2._id))), "findOneAndDelete: row gone");
    check(Number((await one(realDb, "SELECT COUNT(*) AS n FROM itemStock WHERE itemId = ?", String(it2._id)))?.n) === 0 && Number((await one(realDb, "SELECT COUNT(*) AS n FROM itemSupplierCodes WHERE itemId = ?", String(it2._id)))?.n) === 0, "  and its child rows");
    const d1r = await Item.deleteOne({ code: it3.code });
    check(d1r.deletedCount === 1 && (await mirrored(realDb, "items", [it3._id])) === "", "deleteOne: row + children gone, result unchanged");
    const dmr = await Item.deleteMany({ category: "ToDelete" });
    check(dmr.deletedCount === 2 && (await mirrored(realDb, "items", [it4._id, it5._id])) === "", "deleteMany: rows + children gone");

    // bulkWrite with every op kind, including an upsert
    const it6 = await Item.create(itemData());
    const it7 = await Item.create(itemData());
    const newId = new ObjectId();
    const upId = new ObjectId();
    const bw = await Item.bulkWrite([
      { insertOne: { document: { _id: newId, ...itemData() } as any } },
      { updateOne: { filter: { _id: it6._id }, update: { $inc: { currentStock: 1 } } } },
      { updateMany: { filter: { code: { $in: [it6.code, it7.code] } }, update: { $set: { brand: "Samsung" } } } },
      { replaceOne: { filter: { _id: it1._id }, replacement: { ...itemData({ code: it1.code, name: "Replaced by bulk" }) } as any } },
      { deleteOne: { filter: { code: it7.code } } },
      { updateOne: { filter: { _id: upId }, update: { $set: { code: "UPSERT1", name: "Upserted", sellingPrice: 1 } }, upsert: true } },
    ] as any);
    check(bw.insertedCount === 1 && bw.deletedCount === 1 && bw.upsertedCount === 1, "bulkWrite result unchanged");
    check((await mirrored(realDb, "items", [newId, it6._id, it7._id, it1._id, upId])) === "" && report()?.method === "bulkWrite", `bulkWrite (insert/update/updateMany/replace/delete/upsert) mirrored ${await mirrored(realDb, "items", [newId, it6._id, it7._id, it1._id, upId])}`);

    // upserts outside bulkWrite
    const up = await Customer.updateOne({ code: "UP-1" }, { $set: { name: "Upsert One", phone: "9111111111" } }, { upsert: true });
    check(!!up.upsertedId && (await mirrored(realDb, "customers", [up.upsertedId])) === "", "updateOne upsert: new doc mirrored");
    const beforeUp = await Customer.findOneAndUpdate({ code: "UP-2" }, { $set: { name: "Upsert Two" } }, { upsert: true, new: false });
    const up2 = await mongo.collection("customers").findOne({ code: "UP-2" });
    check(beforeUp === null && !!up2 && (await mirrored(realDb, "customers", [up2._id])) === "", "findOneAndUpdate upsert returning the old (null) doc: new doc still found and mirrored");
    const meta: any = await Customer.findOneAndUpdate({ code: "UP-3" }, { $set: { name: "Upsert Three" } }, { upsert: true, includeResultMetadata: true });
    check(!!meta?.lastErrorObject?.upserted && (await mirrored(realDb, "customers", [meta.lastErrorObject.upserted])) === "", "findOneAndUpdate upsert with includeResultMetadata mirrored");

    // raw collection writes: mongoose.connection.collection(x) and mongoose.connection.db.collection(x)
    const rawId = new ObjectId();
    await mongoose.connection.collection("items").insertOne({ _id: rawId, code: "RAW1", name: "Raw item", stockByWarehouse: [{ warehouseId: WH_B, qty: 9 }] });
    check((await mirrored(realDb, "items", [rawId])) === "", "raw mongoose.connection.collection().insertOne mirrored");
    await mongo.collection("items").updateOne({ code: "RAW1" }, { $set: { sellingPrice: 999 }, $push: { stockByWarehouse: { warehouseId: WH_A, qty: 1 } } } as any);
    check((await mirrored(realDb, "items", [rawId])) === "" && Number((await one(realDb, "SELECT COUNT(*) AS n FROM itemStock WHERE itemId = ?", String(rawId)))?.n) === 2, "raw db.collection().updateOne mirrored (children 2)");
    // a raw write naming a 24-hex STRING id that matches nothing must not delete the ObjectId document's row
    await mongo.collection("items").updateOne({ _id: String(rawId) as any }, { $set: { sellingPrice: 1 } });
    check(!!(await one(realDb, "SELECT id FROM items WHERE id = ?", String(rawId))) && (await mirrored(realDb, "items", [rawId])) === "", "a string-id write that matched nothing leaves the ObjectId row in place");
    await mongo.collection("items").deleteMany({ code: "RAW1" });
    check((await mirrored(realDb, "items", [rawId])) === "", "raw deleteMany mirrored");

    // a failing write: the caller gets the same error, and nothing breaks
    let dupErr: any = null;
    try {
      await Customer.create(customerData(0, { _id: custs[0]._id }));
    } catch (e) {
      dupErr = e;
    }
    check(dupErr?.code === 11000 && (await mirrored(realDb, "customers", [custs[0]._id])) === "", "a write that fails (duplicate key) throws the same error; D1 still equal");

    // ── 4. more than the cap -> full re-copy marked, copy job catches up ──
    await Notification.insertMany(Array.from({ length: 30 }, (_, i) => ({ recipientId: "u1", title: `Note ${i}` })));
    check((await wholeCollectionEqual(realDb, "notifications")) === "", "30 notifications mirrored");
    await realDb.prepare("INSERT OR REPLACE INTO sync_state (collection, fullCopyStartedAt, fullCopyDoneAt, watermark) VALUES ('notifications', ?, ?, ?)").bind("2026-11-01T00:00:00.000Z", "2026-11-01T00:01:00.000Z", new Date().toISOString()).run();
    installWriteThrough({ cap: 20 });
    const nm = await Notification.updateMany({ recipientId: "u1" }, { $set: { readAt: new Date() } });
    installWriteThrough({ cap: 500 });
    check(nm.modifiedCount === 30, "updateMany over the cap still updates Mongo (30)");
    const st = await one(realDb, "SELECT * FROM sync_state WHERE collection = 'notifications'");
    check(report()?.outcome === "full-recopy" && st?.fullCopyDoneAt === null && st?.fullCopyStartedAt === null, "more than the cap: collection marked for a full re-copy");
    check(Number((await wtState("notifications"))?.fullRecopyMarks) === 1, "  counted in write_through_state.fullRecopyMarks");
    check((await wholeCollectionEqual(realDb, "notifications")) !== "", "  (D1 is behind until the copy job runs)");
    envOff = true; // the copy job's own D1 writes must not depend on the hook
    const run = await runD1Sync(realDb, { collections: ["notifications"], reconcile: "skip" });
    envOff = false;
    check(run.ok && run.collections.notifications.fullCopyDone && (await wholeCollectionEqual(realDb, "notifications")) === "", "the copy job's full re-copy brings notifications back equal");

    // ── 5. ordering ──
    // 5a. older updatedAt lands last: refused by the guard.
    const ri = await Item.create(itemData());
    let gate: { hit: boolean; reached: () => void; release: Promise<void> } | null = null;
    installWriteThrough({
      beforeD1Write: async (info) => {
        if (gate && !gate.hit && info.collection === "items" && info.round === 1) {
          gate.hit = true;
          gate.reached();
          await gate.release;
        }
      },
    });
    {
      const reached = deferred();
      const release = deferred();
      gate = { hit: false, reached: reached.resolve, release: release.promise };
      const pA = Item.findByIdAndUpdate(ri._id, { $set: { sellingPrice: 111 } }, { new: true }).exec();
      await reached.promise; // A has written Mongo and read its snapshot; its D1 write waits
      await sleep(5);
      await Item.findByIdAndUpdate(ri._id, { $set: { sellingPrice: 222 } }); // B: newer, mirrored first
      check(Number((await one(realDb, "SELECT sellingPrice FROM items WHERE id = ?", String(ri._id)))?.sellingPrice) === 222, "race (newer updatedAt): B's state in D1");
      release.resolve();
      await pA;
      check(Number((await one(realDb, "SELECT sellingPrice FROM items WHERE id = ?", String(ri._id)))?.sellingPrice) === 222 && (await mirrored(realDb, "items", [ri._id])) === "", "  A's older snapshot, landing last, did not overwrite it (D1 = Mongo = 222)");
    }
    // 5b. same updatedAt (raw writes without timestamps): the verify round repairs it.
    {
      const reached = deferred();
      const release = deferred();
      gate = { hit: false, reached: reached.resolve, release: release.promise };
      const pA = mongo.collection("items").updateOne({ _id: ri._id }, { $set: { sellingPrice: 333 } });
      await reached.promise;
      await mongo.collection("items").updateOne({ _id: ri._id }, { $set: { sellingPrice: 444 } });
      release.resolve();
      await pA;
      const rep = report();
      check(Number((await one(realDb, "SELECT sellingPrice FROM items WHERE id = ?", String(ri._id)))?.sellingPrice) === 444 && (await mirrored(realDb, "items", [ri._id])) === "", "race (same updatedAt): D1 ends at the newer state (444)");
      check(rep?.rounds === 2 && rep?.outcome === "mirrored", `  repaired by the verify round (rounds: ${rep?.rounds})`);
    }
    // 5c. a late, older snapshot cannot replace the row or its child rows (the guard itself).
    {
      const spec = ALL_SPEC_BY_COLLECTION.items;
      const docNow = await mongo.collection("items").findOne({ _id: ri._id });
      const older = { ...docNow, sellingPrice: 1, updatedAt: new Date(docNow!.updatedAt.getTime() - 60_000), stockByWarehouse: [{ warehouseId: WH_A, qty: 99 }, { warehouseId: WH_B, qty: 98 }, { warehouseId: new ObjectId(), qty: 97 }] };
      await realDb.batch(statementsFor(realDb, spec, await mapDoc(spec, older), { guarded: true }));
      check((await mirrored(realDb, "items", [ri._id])) === "", "guard: an older snapshot written late changes neither the row nor its child rows");
      const newer = { ...docNow, sellingPrice: 555, updatedAt: new Date(docNow!.updatedAt.getTime() + 1) };
      await realDb.batch(statementsFor(realDb, spec, await mapDoc(spec, newer), { guarded: true }));
      check(Number((await one(realDb, "SELECT sellingPrice FROM items WHERE id = ?", String(ri._id)))?.sellingPrice) === 555, "guard: a newer snapshot is written");
      await realDb.batch(statementsFor(realDb, spec, await mapDoc(spec, docNow)));
      check((await mirrored(realDb, "items", [ri._id])) === "", "the copy job's unguarded upsert can always repair a row");
    }
    // 5d. a request that gives up (timeout) while its D1 write is held: the later write wins, the late batch is harmless.
    {
      installWriteThrough({ timeoutMs: 300 });
      const reached = deferred();
      const release = deferred();
      gate = { hit: false, reached: reached.resolve, release: release.promise };
      const t0 = Date.now();
      const pA = Item.findByIdAndUpdate(ri._id, { $set: { sellingPrice: 666 } }, { new: true }).exec();
      await reached.promise;
      await sleep(5);
      await Item.findByIdAndUpdate(ri._id, { $set: { sellingPrice: 777 } });
      const resA = await pA;
      const msA = Date.now() - t0;
      check(resA?.sellingPrice === 666 && msA < 300 + 500 + 400, `timed-out request still returns its result, after ${msA} ms (timeout 300 ms)`);
      const errs = await all(realDb, "SELECT * FROM sync_errors WHERE phase = 'write-through' AND message LIKE '%did not answer%'");
      check(errs.length >= 1, "  the timeout is logged in sync_errors");
      release.resolve();
      await sleep(300);
      check(Number((await one(realDb, "SELECT sellingPrice FROM items WHERE id = ?", String(ri._id)))?.sellingPrice) === 777 && (await mirrored(realDb, "items", [ri._id])) === "", "  the abandoned older batch landed later without undoing the newer state (777)");
      installWriteThrough({ timeoutMs: 3000, beforeD1Write: undefined });
      gate = null;
    }
    // 5e. a document that keeps changing during every verify round (many phones claiming today's scheduled_runs row
    //     at once, 14 Nov 05:10): DEFERRED to the copy job, counted apart, NOT a failure; the copy job repairs it.
    {
      const ci = await Item.create(itemData());
      let churn = true;
      installWriteThrough({
        beforeD1Write: async (info) => {
          if (!churn || info.collection !== "items" || !info.ids.includes(String(ci._id))) return;
          envOff = true; // the change in between is a plain write (its own copy is not what is tested here)
          try {
            await Item.updateOne({ _id: ci._id }, { $inc: { mrp: 1 } });
          } finally {
            envOff = false;
          }
        },
      });
      const before = await wtState("items");
      await Item.updateOne({ _id: ci._id }, { $set: { sellingPrice: 901 } });
      churn = false;
      const rep = report();
      const after = await wtState("items");
      check(rep?.outcome === "deferred" && rep?.rounds === 3, `a document still changing after 3 rounds: outcome deferred (${rep?.outcome}, rounds ${rep?.rounds})`);
      check(Number(after?.failures) === Number(before?.failures ?? 0) && Number(after?.deferred) === Number(before?.deferred ?? 0) + 1, `  counted in write_through_state.deferred, not in failures (failures ${before?.failures}->${after?.failures}, deferred ${before?.deferred ?? 0}->${after?.deferred})`);
      const defErr = await one(realDb, "SELECT * FROM sync_errors WHERE phase = 'write-through-deferred' ORDER BY id DESC LIMIT 1");
      check(defErr?.collection === "items" && String(defErr?.docId).includes(String(ci._id)), "  logged as phase 'write-through-deferred' (the freshness guard still sees it)");
      check((await mirrored(realDb, "items", [ci._id])) !== "", "  D1 is one change behind for now");
      // The copy job's incremental pass (updatedAt after watermark - 2 min) picks it up.
      await realDb.prepare("INSERT OR REPLACE INTO sync_state (collection, fullCopyStartedAt, fullCopyDoneAt, watermark) VALUES ('items', ?, ?, ?)").bind("2026-11-01T00:00:00.000Z", "2026-11-01T00:01:00.000Z", new Date(Date.now() - 60_000).toISOString()).run();
      envOff = true;
      const run = await runD1Sync(realDb, { collections: ["items"], reconcile: "skip" });
      envOff = false;
      check(run.ok && run.collections.items.mode === "incremental" && (await mirrored(realDb, "items", [ci._id])) === "", "  the copy job's incremental pass repairs it (D1 = Mongo)");

      // 5f. the same, but Mongo's updatedAt is OLD (a raw write that set it back): the incremental pass would not
      //     pick it up, so that stays a real failure (left for the nightly repair).
      const old = new Date(Date.now() - 3600_000);
      churn = true;
      installWriteThrough({
        beforeD1Write: async (info) => {
          if (!churn || info.collection !== "items" || !info.ids.includes(String(ci._id))) return;
          envOff = true;
          try {
            await mongo.collection("items").updateOne({ _id: ci._id }, { $inc: { mrp: 1 }, $set: { updatedAt: old } });
          } finally {
            envOff = false;
          }
        },
      });
      const before2 = await wtState("items");
      await mongo.collection("items").updateOne({ _id: ci._id }, { $set: { sellingPrice: 902, updatedAt: old } });
      churn = false;
      const after2 = await wtState("items");
      check(report()?.outcome === "error" && Number(after2?.failures) === Number(before2?.failures ?? 0) + 1 && Number(after2?.deferred) === Number(before2?.deferred), "  ... with an old updatedAt the copy job would not see it: a real failure");
      installWriteThrough({ beforeD1Write: undefined });
      envOff = true;
      await realDb.batch(statementsFor(realDb, ALL_SPEC_BY_COLLECTION.items, await mapDoc(ALL_SPEC_BY_COLLECTION.items, await mongo.collection("items").findOne({ _id: ci._id }))));
      envOff = false;
    }

    // ── 6. D1 failing / slow / down ──
    const fi = await Item.create(itemData());
    const failsBefore = Number((await wtState("items"))?.failures ?? 0);
    currentD1 = tampered(realDb, { fail: (sql) => sql.startsWith("INSERT INTO items ") });
    const fr = await Item.updateOne({ _id: fi._id }, { $set: { sellingPrice: 1234 } });
    currentD1 = realDb;
    check(JSON.stringify(fr) === JSON.stringify({ acknowledged: true, modifiedCount: 1, upsertedId: null, upsertedCount: 0, matchedCount: 1 }), `D1 failing: Mongo result unchanged ${JSON.stringify(fr)}`);
    check((await mongo.collection("items").findOne({ _id: fi._id }))?.sellingPrice === 1234, "  Mongo has the write");
    check(report()?.outcome === "error" && Number((await wtState("items"))?.failures) === failsBefore + 1, "  failure counted in write_through_state");
    const lastErr = await one(realDb, "SELECT * FROM sync_errors WHERE phase = 'write-through' ORDER BY id DESC LIMIT 1");
    check(lastErr?.collection === "items" && String(lastErr?.message).includes("simulated") && String(lastErr?.docId).includes(String(fi._id)), "  logged in sync_errors with the document id");
    check((await mirrored(realDb, "items", [fi._id])) !== "", "  D1 left behind (for the copy job)");
    await Item.updateOne({ _id: fi._id }, { $set: { mrp: 50000 } });
    check((await mirrored(realDb, "items", [fi._id])) === "", "  the next write of that document catches it up");

    // slow D1: the request waits at most the timeout (+ the capped error logging)
    installWriteThrough({ timeoutMs: 400, logTimeoutMs: 200 });
    currentD1 = tampered(realDb, { delayMs: 1500 });
    let t0 = Date.now();
    const sr = await Item.updateOne({ _id: fi._id }, { $set: { sellingPrice: 4321 } });
    const slowMs = Date.now() - t0;
    currentD1 = realDb;
    check(sr.modifiedCount === 1 && (await mongo.collection("items").findOne({ _id: fi._id }))?.sellingPrice === 4321, "D1 slow: the Mongo write succeeds with the same result");
    check(slowMs < 400 + 200 + 300 && report()?.outcome === "timeout", `  bounded by the timeout: ${slowMs} ms (timeout 400 ms + log cap 200 ms; D1 took 1500 ms)`);
    installWriteThrough({ timeoutMs: 3000, logTimeoutMs: 500 });
    await sleep(1700); // the abandoned batch lands
    check((await mirrored(realDb, "items", [fi._id])) === "", "  the slow batch, landing later, wrote the current state");

    // D1 completely down (even logging fails): no throw, write done
    currentD1 = brokenD1;
    const warn = console.warn;
    let warned = 0;
    console.warn = () => {
      warned++;
    };
    const br = await Item.updateOne({ _id: fi._id }, { $set: { sellingPrice: 1111 } });
    console.warn = warn;
    currentD1 = realDb;
    check(br.modifiedCount === 1 && (await mongo.collection("items").findOne({ _id: fi._id }))?.sellingPrice === 1111 && warned >= 1, "D1 down: write done, failure goes to the console");
    // flag unreadable (D1 down when the cache expires): off for the minute, writes untouched
    resetWriteThroughFlagCache();
    currentD1 = brokenD1;
    console.warn = () => {};
    const br2 = await Item.updateOne({ _id: fi._id }, { $set: { sellingPrice: 2222 } });
    console.warn = warn;
    currentD1 = realDb;
    check(br2.modifiedCount === 1 && report()?.ms !== undefined, "flag unreadable: write done");
    resetWriteThroughFlagCache();
    await Item.updateOne({ _id: fi._id }, { $set: { sellingPrice: 2223 } });
    check((await mirrored(realDb, "items", [fi._id])) === "", "  and once D1 is back, the next write catches up");

    // ── 7. kill switch / env switch / collections not copied ──
    const ki = await Item.create(itemData());
    await realDb.prepare("UPDATE feature_flags SET value = 'off', updatedAt = ? WHERE key = 'writeThrough'").bind(new Date().toISOString()).run();
    await Item.updateOne({ _id: ki._id }, { $set: { sellingPrice: 1 } });
    check((await mirrored(realDb, "items", [ki._id])) === "", "flag set 'off': still on until the cached value expires (≤ 60 s)");
    resetWriteThroughFlagCache(); // = the minute has passed
    const c1 = counting(realDb);
    currentD1 = c1.db;
    await Item.updateOne({ _id: ki._id }, { $set: { sellingPrice: 2 } });
    await Item.updateOne({ _id: ki._id }, { $set: { sellingPrice: 3 } });
    currentD1 = realDb;
    check(c1.n.batch === 0 && c1.n.prepare === 1, `flag 'off': no D1 writes (one flag read for both writes; batches ${c1.n.batch}, prepares ${c1.n.prepare})`);
    check(Number((await one(realDb, "SELECT sellingPrice FROM items WHERE id = ?", String(ki._id)))?.sellingPrice) === 1, "  D1 row untouched");
    await realDb.prepare("UPDATE feature_flags SET value = 'on' WHERE key = 'writeThrough'").run();
    resetWriteThroughFlagCache();
    envOff = true;
    const c2 = counting(realDb);
    currentD1 = c2.db;
    await Item.updateOne({ _id: ki._id }, { $set: { sellingPrice: 4 } });
    currentD1 = realDb;
    envOff = false;
    check(c2.n.batch === 0 && c2.n.prepare === 0, "D1_WRITE_THROUGH=off: no D1 call at all");
    await Item.updateOne({ _id: ki._id }, { $set: { sellingPrice: 5 } });
    check((await mirrored(realDb, "items", [ki._id])) === "", "switched back on: the next write catches the row up");

    const c3 = counting(realDb);
    currentD1 = c3.db;
    const lastBefore = report();
    await mongo.collection("not_copied_scratch").insertOne({ a: 1 });
    await mongo.collection("not_copied_scratch").updateMany({}, { $set: { a: 2 } });
    await mongoose.connection.collection("not_copied_scratch").deleteMany({});
    currentD1 = realDb;
    check(!ALL_SPEC_BY_COLLECTION.not_copied_scratch && c3.n.batch === 0 && c3.n.prepare === 0 && report() === lastBefore, "collections not in ALL_SPECS: ignored (no D1 call)");
    currentD1 = null;
    const noD1 = await Item.updateOne({ _id: ki._id }, { $set: { sellingPrice: 6 } });
    currentD1 = realDb;
    check(noD1.modifiedCount === 1, "no D1 binding (local dev / scripts): writes untouched");
    await Item.updateOne({ _id: ki._id }, { $set: { sellingPrice: 7 } });

    // ── 8. bill save: invoice + stock $inc + balance $inc + payment + serial, two bills at once on one item ──
    const bi = await Item.create(itemData({ isSerialized: true }));
    const bc = await Customer.create(customerData(500));
    await SerialNumber.create([
      { serialNumber: "SN-WT-1", itemId: String(bi._id), vpCode: "VP1", itemName: "LG Fridge" },
      { serialNumber: "SN-WT-2", itemId: String(bi._id), vpCode: "VP1", itemName: "LG Fridge" },
    ]);
    const [b1, b2] = await Promise.all([saveBill(bi._id, bc._id, "SN-WT-1"), saveBill(bi._id, bc._id, "SN-WT-2")]);
    check((await mongo.collection("items").findOne({ _id: bi._id }))?.currentStock === 3, "bill save: Mongo stock 5 -> 3");
    const billDiff =
      (await mirrored(realDb, "invoices", [b1.inv._id, b2.inv._id])) ||
      (await mirrored(realDb, "items", [bi._id])) ||
      (await mirrored(realDb, "customers", [bc._id])) ||
      (await mirrored(realDb, "payment_transactions", [b1.pay._id, b2.pay._id])) ||
      (await mirrored(realDb, "serial_numbers", [b1.sn!._id, b2.sn!._id]));
    check(billDiff === "", `bill save x2 at once: every touched doc equal in D1 ${billDiff}`);
    check(Number((await one(realDb, "SELECT currentStock FROM items WHERE id = ?", String(bi._id)))?.currentStock) === 3 && Number((await one(realDb, "SELECT COUNT(*) AS n FROM invoiceItems WHERE invoiceId IN (?, ?)", String(b1.inv._id), String(b2.inv._id)))?.n) === 2 && Number((await one(realDb, "SELECT COUNT(*) AS n FROM invoicePayments WHERE invoiceId = ?", String(b1.inv._id)))?.n) === 2, "  D1 stock 3, invoice lines and payments as child rows");

    // ── 9. whole collections equal ──
    for (const c of ["items", "customers", "invoices", "payment_transactions", "serial_numbers", "notifications"]) {
      const d = await wholeCollectionEqual(realDb, c);
      check(d === "", `${c}: D1 equals Mongo ${d}`);
    }

    // ── 10. latency ──
    const li = await Item.create(itemData());
    const N = 30;
    const time = async () => {
      const s = Date.now();
      for (let i = 0; i < N; i++) await Item.findByIdAndUpdate(li._id, { $inc: { currentStock: 1 } });
      return (Date.now() - s) / N;
    };
    await time(); // warm up
    envOff = true;
    const offMs = await time();
    envOff = false;
    const onMs = await time();
    const s1 = Date.now();
    for (let i = 0; i < N; i++) await Customer.create(customerData(1000 + i));
    const createMs = (Date.now() - s1) / N;
    const s2 = Date.now();
    for (let i = 0; i < N; i++) await realDb.batch([realDb.prepare("SELECT 1")]);
    const d1RoundTrip = (Date.now() - s2) / N;
    const s3 = Date.now();
    for (let i = 0; i < N; i++) await mongo.collection("items").find({ _id: { $in: [li._id] } }).toArray();
    const mongoRead = (Date.now() - s3) / N;
    console.log(`  one local D1 batch round trip: ${d1RoundTrip.toFixed(1)} ms; one Mongo read by _id: ${mongoRead.toFixed(1)} ms; write-through = 1 Mongo read + 1 D1 batch + 1 verify read`);
    console.log(`  latency per findByIdAndUpdate: ${offMs.toFixed(1)} ms without, ${onMs.toFixed(1)} ms with write-through (+${(onMs - offMs).toFixed(1)} ms; local Mongo + local D1); Model.create with it: ${createMs.toFixed(1)} ms`);
    check(onMs - offMs < 200 && (await mirrored(realDb, "items", [li._id])) === "", "latency measured; D1 current after the timed writes");
  } finally {
    await local.dispose();
    await stopMemoryMongo();
  }
  process.exit(summary("d1-write-through") ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
