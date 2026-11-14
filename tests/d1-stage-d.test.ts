/**
 * Stage D of the D1 migration (docs/D1_MIGRATION_PLAN.md §6.8a): the write cutover machinery, shipped dormant.
 *  - default (no write:masters row): every masters write route answers exactly as with no D1 at all;
 *  - write:masters = 'd1': each masters write route answers the same JSON as the MongoDB path, D1 holds the row,
 *    the reverse mirror drains the outbox and MongoDB then holds the document the MongoDB path would have written;
 *  - _guard conflicts answer 409 and write nothing; the fence waits and proceeds, or answers 503;
 *  - 'd1' only honoured while the read areas answer from D1; the write-through skips D1-owned collections;
 *  - the reverse mirror retries and records failures, never writes an older copy over a newer one;
 *  - Stage D: 'off' does nothing; 'auto' promotes only in the night window with every precondition; rollback drains
 *    the outbox before flipping back; the cron skips D1-owned collections; the admin report shows Stage D.
 * Local D1 (Miniflare) and mongodb-memory-server; clocks are passed in where the job needs one.
 */
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { installWriteThrough, resetWriteThroughFlagCache } from "@/lib/d1/write-through";
import { configureReadSource, resetReadModeCache } from "@/lib/d1/read-source";
import { flushShadowWork } from "@/lib/d1/shadow";
import { configureWriteMode, getWriteMode, getWriteModeConfig, isD1OwnedCollection, resetWriteModeCache } from "@/lib/d1/write-mode";
import { mirrorWriteContext, WRITE_AREA_COLLECTIONS } from "@/lib/d1/write-areas";
import { drainOutbox, outboxPending } from "@/lib/d1/reverse-mirror";
import { storedDocFromRow } from "@/lib/d1/stored-docs";
import { canonicalJson } from "@/lib/d1/masters-map";
import { runStageD, evaluateStageD } from "@/lib/d1/stage-d";
import { deferredContext } from "@/lib/deferred-context";
import * as brands from "@/app/api/brands/route";
import * as categories from "@/app/api/categories/route";
import * as units from "@/app/api/units/route";
import * as variants from "@/app/api/variants/route";
import * as warehouses from "@/app/api/warehouses/route";
import * as productRef from "@/app/api/product-reference/route";
import { GET as d1SyncGET } from "@/app/api/cron/d1-sync/route";
import { GET as shadowStatusGET } from "@/app/api/admin/d1-shadow-status/route";
import Brand from "@/models/Brand";
import Item from "@/models/Item";

const at = (s: string) => Date.parse(`${s}:00+05:30`);
const iso = (ms: number) => new Date(ms).toISOString();
const SEED_TIME = new Date("2026-01-05T10:00:00.000Z");
const TEST_START = Date.now() - 60_000;
const ADMIN = { id: "u1", name: "Admin", email: "a@x", role: "admin", permissions: [] as any[] };

let realDb: D1DatabaseLike;
let activeDb: D1DatabaseLike;

async function all(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any[]> {
  return ((await db.prepare(sql).bind(...args).all()).results || []) as any[];
}
async function one(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any> {
  return db.prepare(sql).bind(...args).first();
}
async function run(db: D1DatabaseLike, sql: string, ...args: unknown[]) {
  await db.prepare(sql).bind(...args).run();
}
async function setFlag(key: string, value: string | null, updatedAt = iso(Date.now())) {
  if (value === null) await run(realDb, "DELETE FROM feature_flags WHERE key = ?", key);
  else {
    await run(
      realDb,
      "INSERT INTO feature_flags (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt",
      key, value, updatedAt
    );
  }
  resetReadModeCache();
  resetWriteModeCache();
  resetWriteThroughFlagCache();
}
const flag = async (key: string) => (await one(realDb, "SELECT value FROM feature_flags WHERE key = ?", key))?.value ?? null;

const TABLES = ["brands", "categories", "units", "warehouses", "variants", "productCatalogReferences", "items", "itemStock", "itemSupplierCodes"];

/** Empty MongoDB and D1 data, every switch back to its shipped default, write-through on. */
async function resetAll() {
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).syncIndexes().catch(() => null)));
  for (const t of [...TABLES, "mirror_outbox", "mirror_failures", "mirror_drain_state", "stage_d_log", "stage_c_log", "sync_errors", "write_through_state", "sync_state"]) {
    await run(realDb, `DELETE FROM ${t}`);
  }
  await run(realDb, "DELETE FROM feature_flags WHERE key LIKE 'write:%'");
  await setFlag("writeThrough", "on");
  await setFlag("stageD", "off");
  activeDb = realDb;
  configureWriteMode({ resolveD1: () => activeDb, readMode: async () => "d1", sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) });
}

// Seeds (fixed ids and times, so both runs of a comparison start from the same data). Written through mongoose
// while the write switch is 'mongo', so the write-through copies them into D1 as it does on live.
const IDS = {
  brand: "6a0000000000000000000001",
  brand2: "6a0000000000000000000002",
  category: "6a0000000000000000000011",
  unit: "6a0000000000000000000021",
  variant: "6a0000000000000000000031",
  warehouse: "6a0000000000000000000041",
  warehouseWithStock: "6a0000000000000000000042",
  ref: "6a0000000000000000000051",
};
const SEEDED = new Set(Object.values(IDS));

async function seed() {
  // Field order as mongoose stores a document it created: _id, the fields, createdAt, updatedAt, __v.
  const c = (name: string, doc: any) => mongoose.connection.collection(name).insertOne({ ...doc, createdAt: SEED_TIME, updatedAt: SEED_TIME, __v: 0 });
  const oid = (h: string) => new mongoose.Types.ObjectId(h);
  await c("brands", { _id: oid(IDS.brand), name: "LG", description: "", status: "active" });
  await c("brands", { _id: oid(IDS.brand2), name: "Sony", description: "tv", status: "active" });
  await c("categories", { _id: oid(IDS.category), name: "TV", description: "", parentId: null, status: "active" });
  await c("units", { _id: oid(IDS.unit), name: "Pieces", shortName: "pcs", type: "count", status: "active" });
  await c("variants", { _id: oid(IDS.variant), name: "Colour", values: ["Red"], status: "active" });
  const wh = (id: string, code: string) => ({
    _id: oid(id), name: `Store ${code}`, code, type: "showroom", address: "a", city: "c", state: "s", pincode: "1", contactPerson: "p", phone: "9", email: "e@x", status: "active", isDefault: false,
  });
  await c("warehouses", wh(IDS.warehouse, "W1"));
  await c("warehouses", wh(IDS.warehouseWithStock, "W2"));
  await c("product_catalog_references", { _id: oid(IDS.ref), vpCode: "VP001", description: "old", brand: "LG", groupName: "TV", category: "TV", productDesc: "", charDesc: "" });
  await Item.create({ code: "I1", name: "Item one", mrp: 10, sellingPrice: 9, purchasePrice: 8, stockByWarehouse: [{ warehouseId: IDS.warehouseWithStock, qty: 3 }], currentStock: 3 });
}

/** Canonical text of a value: new ids labelled in order of appearance, recent times as <now>, keys sorted. */
function canon(value: any, labels = new Map<string, string>(), keepKeyOrder = false): string {
  const walk = (v: any): any => {
    if (v === null || v === undefined) return v;
    if (v instanceof Date) return walk(v.toISOString());
    if (v && v._bsontype === "ObjectId") return walk(v.toHexString());
    if (typeof v === "string") {
      if (/^[0-9a-f]{24}$/i.test(v) && !SEEDED.has(v.toLowerCase())) {
        if (!labels.has(v)) labels.set(v, `<id#${labels.size + 1}>`);
        return labels.get(v);
      }
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Date.parse(v) >= TEST_START) return "<now>";
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === "object") {
      const o: any = {};
      const keys = Object.keys(v);
      for (const k of keepKeyOrder ? keys : keys.sort()) o[k] = walk(v[k]);
      return o;
    }
    return v;
  };
  return JSON.stringify(walk(JSON.parse(JSON.stringify(value, (_k, x) => x))));
}

/** The raw MongoDB documents of the master collections, canonical. */
async function mongoState(labels: Map<string, string>): Promise<string> {
  const out: any = {};
  for (const c of WRITE_AREA_COLLECTIONS.masters) {
    const docs = await mongoose.connection.collection(c).find({}).sort({ _id: 1 }).toArray();
    out[c] = docs.map((d) => JSON.parse(canon(d, labels)));
  }
  return JSON.stringify(out);
}

async function d1Ids(table: string): Promise<string[]> {
  return (await all(realDb, `SELECT id FROM ${table} ORDER BY id`)).map((r) => String(r.id));
}

const req = (path: string, method: string, body?: unknown) =>
  new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

interface Step {
  name: string;
  call: () => Promise<Response>;
}

const asAdmin = <T,>(fn: () => Promise<T>) => deferredContext.run({ approver: ADMIN as any }, fn);

/** Every masters write route, with valid and failing inputs. */
function steps(): Step[] {
  const whBody = { name: "New store", code: "W9", type: "godown", address: "a", city: "c", state: "s", pincode: "2", contactPerson: "p", phone: "9", email: "e@x" };
  return [
    { name: "brands POST", call: () => brands.POST(req("/api/brands", "POST", { name: "Samsung", description: "phones" })) },
    { name: "brands POST duplicate", call: () => brands.POST(req("/api/brands", "POST", { name: "LG" })) },
    { name: "brands POST invalid status", call: () => brands.POST(req("/api/brands", "POST", { name: "X", status: "bogus" })) },
    { name: "brands PUT", call: () => brands.PUT(req(`/api/brands?id=${IDS.brand}`, "PUT", { _id: IDS.brand, name: "LG India", items: 4, createdAt: "2020-01-01T00:00:00.000Z", status: "inactive" })) },
    { name: "brands PUT duplicate name", call: () => brands.PUT(req(`/api/brands?id=${IDS.brand}`, "PUT", { name: "Sony" })) },
    { name: "brands PUT missing", call: () => brands.PUT(req(`/api/brands?id=6a00000000000000000000ff`, "PUT", { name: "Q" })) },
    { name: "brands PUT bad id", call: () => brands.PUT(req(`/api/brands?id=nothex`, "PUT", { name: "Q" })) },
    { name: "brands PUT no id", call: () => brands.PUT(req(`/api/brands`, "PUT", { name: "Q" })) },
    { name: "brands DELETE", call: () => brands.DELETE(req(`/api/brands?id=${IDS.brand2}`, "DELETE")) },
    { name: "brands DELETE missing", call: () => brands.DELETE(req(`/api/brands?id=${IDS.brand2}`, "DELETE")) },
    { name: "categories POST", call: () => categories.POST(req("/api/categories", "POST", { name: "Audio" })) },
    { name: "categories POST child", call: () => categories.POST(req("/api/categories", "POST", { name: "Soundbar", parentId: IDS.category, description: "d" })) },
    { name: "categories PUT", call: () => categories.PUT(req(`/api/categories?id=${IDS.category}`, "PUT", { name: "Television", description: "big", parentId: "" })) },
    { name: "categories DELETE", call: () => categories.DELETE(req(`/api/categories?id=${IDS.category}`, "DELETE")) },
    { name: "units POST", call: () => units.POST(req("/api/units", "POST", { name: "Box", shortName: "box" })) },
    { name: "units POST duplicate short name", call: () => units.POST(req("/api/units", "POST", { name: "Pieces 2", shortName: "pcs" })) },
    { name: "units POST missing short name", call: () => units.POST(req("/api/units", "POST", { name: "Nope" })) },
    { name: "units DELETE", call: () => units.DELETE(req(`/api/units?id=${IDS.unit}`, "DELETE")) },
    { name: "units DELETE no id", call: () => units.DELETE(req(`/api/units`, "DELETE")) },
    { name: "variants POST", call: () => variants.POST(req("/api/variants", "POST", { name: "Size", values: ["S", "M"] })) },
    { name: "variants POST no values", call: () => variants.POST(req("/api/variants", "POST", { name: "Plain" })) },
    { name: "variants POST duplicate", call: () => variants.POST(req("/api/variants", "POST", { name: "Colour" })) },
    { name: "variants DELETE", call: () => variants.DELETE(req(`/api/variants?id=${IDS.variant}`, "DELETE")) },
    { name: "variants DELETE missing", call: () => variants.DELETE(req(`/api/variants?id=${IDS.variant}`, "DELETE")) },
    { name: "warehouses POST", call: () => warehouses.POST(req("/api/warehouses", "POST", whBody)) },
    { name: "warehouses POST invalid", call: () => warehouses.POST(req("/api/warehouses", "POST", { name: "Half" })) },
    { name: "warehouses PUT", call: () => warehouses.PUT(req(`/api/warehouses?id=${IDS.warehouse}`, "PUT", { city: "Gorakhpur", isDefault: true, extraField: 1 })) },
    { name: "warehouses PUT invalid type", call: () => warehouses.PUT(req(`/api/warehouses?id=${IDS.warehouse}`, "PUT", { type: "garage" })) },
    { name: "warehouses DELETE with stock", call: () => warehouses.DELETE(req(`/api/warehouses?id=${IDS.warehouseWithStock}`, "DELETE")) },
    { name: "warehouses DELETE", call: () => warehouses.DELETE(req(`/api/warehouses?id=${IDS.warehouse}`, "DELETE")) },
    {
      name: "product-reference POST",
      call: () =>
        asAdmin(() =>
          productRef.POST(
            req("/api/product-reference", "POST", {
              rows: [
                { vpCode: " vp001 ", description: "new", brand: "LG", groupName: "AUDIO" },
                { vpCode: "vp002", description: "fresh", groupName: "AUDIO", productDesc: "x" },
                { vpCode: "VP002", description: "again" },
                { description: "no code" },
              ],
              groupToCategory: { AUDIO: "Audio & Sound" },
            })
          )
        ),
    },
    { name: "product-reference POST empty", call: () => asAdmin(() => productRef.POST(req("/api/product-reference", "POST", { rows: [] }))) },
    { name: "product-reference POST signed out", call: () => productRef.POST(req("/api/product-reference", "POST", { rows: [{ vpCode: "A" }] })) },
  ];
}

interface RunResult {
  responses: { name: string; status: number; body: string; text: string }[];
  mongo: string;
  labels: Map<string, string>;
}

/** Runs every step in order in the given write mode and returns the answers and MongoDB's final state. */
async function runAll(mode: "none" | "default" | "mongo" | "d1"): Promise<RunResult> {
  await resetAll();
  await seed();
  if (mode === "none") configureWriteMode({ resolveD1: () => null });
  if (mode === "mongo") await setFlag("write:masters", "mongo");
  if (mode === "d1") await setFlag("write:masters", "d1");
  const labels = new Map<string, string>();
  const responses: RunResult["responses"] = [];
  for (const s of steps()) {
    const res = await s.call();
    const json = await res.json();
    // body: keys sorted; text: the JSON as sent (key order kept), with the same id / time labels.
    responses.push({ name: s.name, status: res.status, body: canon(json, labels), text: canon(json, new Map(labels), true) });
  }
  await flushShadowWork();
  return { responses, mongo: await mongoState(labels), labels };
}

// ---------------------------------------------------------------------------

async function defaultModeTests() {
  console.log("\ndefault: no write switch row = today's MongoDB behaviour");
  const none = await runAll("none");
  const dflt = await runAll("default");
  check((await getWriteMode("masters")) === "mongo", "getWriteMode('masters') is 'mongo' with no write:masters row");
  for (let i = 0; i < none.responses.length; i++) {
    const a = none.responses[i];
    const b = dflt.responses[i];
    check(a.status === b.status && a.body === b.body, `${a.name}: same answer with D1 bound and no switch as with no D1 at all (${a.status})`);
  }
  check(none.mongo === dflt.mongo, "MongoDB ends in the same state");
  check((await outboxPending(realDb)).pending === 0 && (await one(realDb, "SELECT COUNT(*) AS n FROM mirror_outbox")).n === 0, "nothing queued for the reverse mirror");
  check((await d1Ids("brands")).includes(IDS.brand) && !(await d1Ids("brands")).includes(IDS.brand2), "the write-through still copies the MongoDB writes into D1 (edit kept, delete gone)");
  const mongoRun = await runAll("mongo");
  check(mongoRun.responses.every((r, i) => r.status === dflt.responses[i].status && r.body === dflt.responses[i].body), "write:masters = 'mongo' set explicitly: identical too");
}

async function d1ParityTests() {
  console.log("\nwrite:masters = 'd1': same answers, D1 holds the rows, MongoDB caught up by the reverse mirror");
  const mongoRun = await runAll("mongo");
  const d1Run = await runAll("d1");
  for (let i = 0; i < mongoRun.responses.length; i++) {
    const a = mongoRun.responses[i];
    const b = d1Run.responses[i];
    const same = a.status === b.status && a.body === b.body;
    check(same, `${a.name}: same status and JSON in d1 mode (${a.status})`);
    if (!same) console.log(`      mongo ${a.status} ${a.body}\n      d1    ${b.status} ${b.body}`);
  }
  const sameText = mongoRun.responses.filter((a, i) => a.text === d1Run.responses[i].text).map((a) => a.name);
  const otherOrder = mongoRun.responses.filter((a, i) => a.text !== d1Run.responses[i].text).map((a) => a.name);
  check(otherOrder.length === 0, `byte-identical JSON text, key order included (ids and times labelled): ${sameText.length}/${mongoRun.responses.length}${otherOrder.length ? `; other order: ${otherOrder.join(", ")}` : ""}`);
  check((await outboxPending(realDb)).pending === 0, "the outbox is drained (after-response drain)");
  check((await one(realDb, "SELECT COUNT(*) AS n FROM mirror_outbox WHERE doneAt IS NOT NULL")).n > 0, "the D1 writes were queued and copied");
  const same = mongoRun.mongo === d1Run.mongo;
  check(same, "MongoDB holds exactly the documents the MongoDB path writes (canonical, times as <now>)");
  if (!same) console.log(`      mongo path: ${mongoRun.mongo}\n      d1 path:    ${d1Run.mongo}`);

  // D1 itself holds the documents (rebuilt rows equal MongoDB's documents).
  let rowsMatch = true;
  for (const c of WRITE_AREA_COLLECTIONS.masters) {
    const table = c === "product_catalog_references" ? "productCatalogReferences" : c;
    const rows = await all(realDb, `SELECT * FROM ${table} ORDER BY id`);
    const docs = await mongoose.connection.collection(c).find({}).sort({ _id: 1 }).toArray();
    const rebuilt = await Promise.all(rows.map((r) => storedDocFromRow(c, r)));
    if (canonicalJson(rebuilt) !== canonicalJson(docs)) {
      rowsMatch = false;
      console.log(`      ${c}: D1 ${canonicalJson(rebuilt)}\n      ${c}: Mongo ${canonicalJson(docs)}`);
    }
  }
  check(rowsMatch, "every D1 row rebuilds to exactly the MongoDB document (same _id, createdAt, updatedAt, fields)");
  const brandRow = await one(realDb, "SELECT name, status FROM brands WHERE id = ?", IDS.brand);
  check(brandRow?.name === "LG India" && brandRow?.status === "inactive", "the brand edit is in D1");
  check(!(await d1Ids("brands")).includes(IDS.brand2) && !(await d1Ids("warehouses")).includes(IDS.warehouse), "the deletes are in D1");
  check((await d1Ids("warehouses")).includes(IDS.warehouseWithStock), "a warehouse holding stock (MongoDB items) is still refused in d1 mode");
}

async function warehouseSeedTests() {
  console.log("\nwarehouses GET seeds the defaults on an empty database: on D1 in d1 mode");
  const go = async (mode: "mongo" | "d1") => {
    await resetAll();
    if (mode === "d1") await setFlag("write:masters", "d1");
    const labels = new Map<string, string>();
    const res = await warehouses.GET();
    const body = canon(await res.json(), labels);
    await flushShadowWork();
    return { status: res.status, body, mongo: await mongoState(labels) };
  };
  const m = await go("mongo");
  const d = await go("d1");
  check(m.status === 200 && m.status === d.status && m.body === d.body, "same list of 4 default warehouses");
  if (m.body !== d.body) console.log(`      mongo ${m.body}\n      d1    ${d.body}`);
  check(m.mongo === d.mongo, "MongoDB holds the same defaults after the reverse mirror");
  check((await d1Ids("warehouses")).length === 4, "D1 holds them");
}

/** A D1 whose batch first runs `before` (a concurrent change landing between our read and our batch). */
function racing(real: D1DatabaseLike, before: () => Promise<void>): D1DatabaseLike {
  let fired = false;
  return {
    prepare: (sql) => real.prepare(sql),
    batch: async (stmts) => {
      if (!fired && stmts.length > 1) {
        fired = true;
        await before();
      }
      return real.batch(stmts);
    },
  };
}

async function guardTests() {
  console.log("\n_guard: a change between the read and the batch answers 409 and writes nothing");
  await resetAll();
  await seed();
  await setFlag("write:masters", "d1");
  activeDb = racing(realDb, () => run(realDb, "UPDATE brands SET updatedAt = '2026-02-02T00:00:00.000Z', description = 'by someone else' WHERE id = ?", IDS.brand));
  let res = await brands.PUT(req(`/api/brands?id=${IDS.brand}`, "PUT", { name: "LG 2" }));
  let json: any = await res.json();
  check(res.status === 409 && json.success === false && /changed/i.test(json.error), `edit after a concurrent change: 409 (${res.status} ${json.error})`);
  const row = await one(realDb, "SELECT name, description FROM brands WHERE id = ?", IDS.brand);
  check(row.name === "LG" && row.description === "by someone else", "the brand keeps the other change, ours is not applied");
  check((await one(realDb, "SELECT COUNT(*) AS n FROM mirror_outbox")).n === 0, "the outbox rows of the batch were rolled back with it");

  activeDb = racing(realDb, () =>
    run(realDb, "INSERT INTO brands (id, name, description, status, createdAt, updatedAt, v, docHash, syncedAt) VALUES ('6a00000000000000000000aa', 'Bose', '', 'active', ?, ?, 0, 'x', ?)", iso(Date.now()), iso(Date.now()), iso(Date.now()))
  );
  res = await brands.POST(req("/api/brands", "POST", { name: "Bose" }));
  json = await res.json();
  check(res.status === 409, `create while another request takes the same unique name: 409 (${res.status})`);
  check((await all(realDb, "SELECT id FROM brands WHERE name = 'Bose'")).length === 1, "only the other brand exists");

  activeDb = racing(realDb, () => run(realDb, "DELETE FROM warehouses WHERE id = ?", IDS.warehouse));
  res = await warehouses.DELETE(req(`/api/warehouses?id=${IDS.warehouse}`, "DELETE"));
  check(res.status === 409, `delete of a row someone else deleted a moment before: 409 (${res.status})`);
  activeDb = realDb;
  await flushShadowWork();
  check((await one(realDb, "SELECT COUNT(*) AS n FROM _guard")).n === 0, "_guard stays empty");
}

async function fenceTests() {
  console.log("\nfence: writes wait, then go on; or answer 503 after 30 s");
  await resetAll();
  await seed();
  await setFlag("write:masters", "fence");
  let clock = 0;
  let sleeps = 0;
  configureWriteMode({
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      sleeps++;
      if (sleeps === 4) await run(realDb, "UPDATE feature_flags SET value = 'd1' WHERE key = 'write:masters'");
    },
  });
  let res = await brands.POST(req("/api/brands", "POST", { name: "Fenced" }));
  check(res.status === 200 && sleeps === 4 && clock === 1000, `waited 4 x 250 ms, then wrote (${res.status}, ${sleeps} polls)`);
  check((await all(realDb, "SELECT id FROM brands WHERE name = 'Fenced'")).length === 1, "on D1, because the switch moved to 'd1' meanwhile");
  await flushShadowWork();

  await setFlag("write:masters", "fence");
  clock = 0;
  sleeps = 0;
  configureWriteMode({ now: () => clock, sleep: async (ms) => { clock += ms; sleeps++; } });
  const before = (await all(realDb, "SELECT id FROM brands")).length;
  res = await brands.POST(req("/api/brands", "POST", { name: "Never" }));
  const json: any = await res.json();
  check(res.status === 503 && /try again/i.test(json.error) && res.headers.get("Retry-After") === "30", `still fenced after 30 s: 503 "${json.error}"`);
  check(sleeps === 120, `polled every 250 ms for 30 s (${sleeps} polls)`);
  check((await all(realDb, "SELECT id FROM brands")).length === before && !(await Brand.findOne({ name: "Never" })), "nothing written anywhere");
  for (const [name, fn] of [
    ["categories PUT", () => categories.PUT(req(`/api/categories?id=${IDS.category}`, "PUT", { name: "x" }))],
    ["warehouses DELETE", () => warehouses.DELETE(req(`/api/warehouses?id=${IDS.warehouse}`, "DELETE"))],
    ["product-reference POST", () => asAdmin(() => productRef.POST(req("/api/product-reference", "POST", { rows: [{ vpCode: "A" }] })))],
  ] as [string, () => Promise<Response>][]) {
    clock = 0;
    check((await fn()).status === 503, `${name}: 503 too`);
  }
  configureWriteMode({ now: () => Date.now() });
}

async function readGateTests() {
  console.log("\n'd1' is honoured only while every read area of the write area answers from D1");
  await resetAll();
  await seed();
  configureWriteMode({ readMode: (await import("@/lib/d1/read-source")).getReadMode });
  configureReadSource({ resolveD1: () => realDb, envValue: () => "", flagTtlMs: 0 });
  await setFlag("write:masters", "d1");
  await setFlag("read:masters", "shadow");
  await setFlag("read:stock", "d1");
  check((await getWriteMode("masters")) === "mongo", "read:masters 'shadow' -> writes MongoDB");
  let res = await brands.POST(req("/api/brands", "POST", { name: "Gate1" }));
  check(res.status === 200 && !!(await Brand.findOne({ name: "Gate1" })) && (await all(realDb, "SELECT id FROM brands WHERE name = 'Gate1'")).length === 1, "written to MongoDB, copied into D1 by the write-through");
  check((await one(realDb, "SELECT COUNT(*) AS n FROM mirror_outbox")).n === 0, "no outbox row");

  await setFlag("read:masters", "d1");
  await setFlag("read:stock", "shadow");
  check((await getWriteMode("masters")) === "mongo", "read:stock 'shadow' (variants, product references) -> still MongoDB");
  await setFlag("read:stock", "d1");
  check((await getWriteMode("masters")) === "d1", "both read areas 'd1' -> D1");
  await run(realDb, "INSERT INTO sync_errors (at, collection, docId, phase, message) VALUES (?, 'variants', NULL, 'incremental', 'x')", iso(Date.now()));
  resetReadModeCache();
  check((await getWriteMode("masters")) === "mongo", "a read area that is not fresh right now (copy error) -> MongoDB");
  await run(realDb, "DELETE FROM sync_errors");
  resetReadModeCache();

  // Leftover outbox rows are copied into MongoDB before a fallback to MongoDB writes.
  res = await brands.PUT(req(`/api/brands?id=${IDS.brand}`, "PUT", { description: "on d1" }));
  check(res.status === 200 && (await outboxPending(realDb)).pending === 1, "a D1 write queued (drain not run yet)");
  await setFlag("read:masters", "shadow");
  check((await getWriteMode("masters")) === "mongo", "read area demoted -> MongoDB");
  check((await outboxPending(realDb)).pending === 0 && (await Brand.findById(IDS.brand).lean())?.description === "on d1", "...after the outbox was copied into MongoDB first");
  await flushShadowWork();
  configureWriteMode({ readMode: async () => "d1" });
}

async function writeThroughSkipTests() {
  console.log("\nthe write-through skips collections D1 owns, and never copies the reverse mirror's writes");
  await resetAll();
  await seed();
  await setFlag("write:masters", "d1");
  check(await isD1OwnedCollection("brands"), "brands are D1-owned in d1 mode");
  check(!(await isD1OwnedCollection("items")), "items are not (their writes move with U5)");
  await Brand.create({ name: "Direct" });
  check((await all(realDb, "SELECT id FROM brands WHERE name = 'Direct'")).length === 0, "a direct MongoDB brand write is not copied into D1 (D1 is the source of truth)");
  await Item.create({ code: "I2", name: "Item two", mrp: 10, sellingPrice: 9, purchasePrice: 8 });
  check((await all(realDb, "SELECT id FROM items WHERE code = 'I2'")).length === 1, "an item write still is");
  await setFlag("write:masters", "fence");
  check(!(await isD1OwnedCollection("brands")), "in 'fence' the write-through runs (writes from before the fence must reach D1)");
  await setFlag("write:masters", null);
  await mirrorWriteContext.run(true, () => Brand.create({ name: "Mirrored" }));
  check((await all(realDb, "SELECT id FROM brands WHERE name = 'Mirrored'")).length === 0, "a reverse-mirror write is never copied back, whatever the switch");
  await Brand.create({ name: "Normal" });
  check((await all(realDb, "SELECT id FROM brands WHERE name = 'Normal'")).length === 1, "with the switch back at default, writes are copied as before");
}

async function reverseMirrorTests() {
  console.log("\nreverse mirror: retries, records failures, never goes backwards");
  await resetAll();
  await seed();
  await setFlag("write:masters", "d1");
  // Writes on D1 with the after-response drain failing.
  const realColl = (name: string) => mongoose.connection.db!.collection(name);
  let failNext = 2;
  const flaky = {
    collection: (name: string) => {
      const c = realColl(name);
      return {
        deleteOne: (...a: any[]) => (c.deleteOne as any)(...a),
        replaceOne: async (...a: any[]) => {
          if (failNext > 0) {
            failNext--;
            throw new Error("MongoNetworkError: connection reset");
          }
          return (c.replaceOne as any)(...a);
        },
      };
    },
  };
  await run(realDb, "UPDATE brands SET description = 'edited in d1', updatedAt = ?, docHash = '' WHERE id = ?", iso(Date.now()), IDS.brand);
  await run(realDb, "INSERT INTO mirror_outbox (collection, docId, op, at) VALUES ('brands', ?, 'upsert', ?)", IDS.brand, iso(Date.now()));
  let r = await drainOutbox(realDb, { mongo: flaky });
  let ob = await one(realDb, "SELECT * FROM mirror_outbox WHERE docId = ?", IDS.brand);
  check(!r.ok && r.failed === 1 && r.pending === 1 && ob.attempts === 1 && /connection reset/.test(ob.lastError) && ob.doneAt === null, "a failed copy stays pending with attempts 1 and its error");
  check((await one(realDb, "SELECT COUNT(*) AS n FROM mirror_failures")).n === 1, "logged in mirror_failures");
  check((await one(realDb, "SELECT lastResult FROM mirror_drain_state WHERE id = 1")).lastResult === "partial", "drain heartbeat says partial");
  r = await drainOutbox(realDb, { mongo: flaky });
  ob = await one(realDb, "SELECT * FROM mirror_outbox WHERE docId = ?", IDS.brand);
  check(ob.attempts === 2 && ob.doneAt === null, "retried on the next drain (attempts 2)");
  r = await drainOutbox(realDb, { mongo: flaky });
  ob = await one(realDb, "SELECT * FROM mirror_outbox WHERE docId = ?", IDS.brand);
  check(r.ok && r.drained === 1 && ob.doneAt !== null && (await Brand.findById(IDS.brand).lean())?.description === "edited in d1", "third time it lands: done, MongoDB has the D1 version");

  // Never backwards: MongoDB holds a NEWER copy (e.g. a slower drain racing a faster one).
  const future = new Date(Date.now() + 3600_000);
  await mirrorWriteContext.run(true, () => realColl("brands").updateOne({ _id: new mongoose.Types.ObjectId(IDS.brand) }, { $set: { description: "newer in mongo", updatedAt: future } }));
  await run(realDb, "INSERT INTO mirror_outbox (collection, docId, op, at) VALUES ('brands', ?, 'upsert', ?)", IDS.brand, iso(Date.now()));
  r = await drainOutbox(realDb);
  check(r.ok && r.pending === 0 && (await Brand.findById(IDS.brand).lean())?.description === "newer in mongo", "an older D1 copy is not written over a newer MongoDB document (row counted done)");

  // A row gone from D1 deletes the MongoDB document.
  await run(realDb, "DELETE FROM brands WHERE id = ?", IDS.brand2);
  await run(realDb, "INSERT INTO mirror_outbox (collection, docId, op, at) VALUES ('brands', ?, 'delete', ?)", IDS.brand2, iso(Date.now()));
  await drainOutbox(realDb);
  check(!(await Brand.findById(IDS.brand2).lean()), "a document deleted on D1 is deleted in MongoDB");
  check((await all(realDb, "SELECT id FROM brands WHERE id = ?", IDS.brand)).length === 1 && (await one(realDb, "SELECT description FROM brands WHERE id = ?", IDS.brand)).description === "edited in d1", "the drain never writes D1 (MongoDB's newer copy did not bounce back)");
}

// ---------------------------------------------------------------------------
// Stage D job
// ---------------------------------------------------------------------------

const NIGHT = at("2026-11-20T22:10");
const DAY_TIME = at("2026-11-20T15:00");

/** Everything a promotion of 'masters' needs, judged at NIGHT. */
async function readyForPromotion() {
  await resetAll();
  await seed();
  await setFlag("stageD", "auto");
  await setFlag("read:masters", "d1", iso(at("2026-11-10T22:05")));
  await setFlag("read:stock", "d1", iso(at("2026-11-12T22:05")));
  for (const c of WRITE_AREA_COLLECTIONS.masters) {
    await run(realDb, "INSERT INTO sync_state (collection, lastReconcileAt, lastReconcileRepaired, lastReconcileDeleted) VALUES (?, ?, 0, 0)", c, iso(at("2026-11-19T23:30")));
  }
  await run(realDb, "DELETE FROM write_through_state");
  await run(realDb, "DELETE FROM sync_errors");
}

const deps = (sleeps: number[]) => ({ sleep: async (ms: number) => void sleeps.push(ms), mongo: () => mongoose.connection.db, fenceSettleMs: 35_000 });

async function stageDTests() {
  console.log("\nStage D job");
  // off: nothing happens, even when a rollback reason is there.
  await resetAll();
  await seed();
  await setFlag("write:masters", "d1");
  await run(realDb, "INSERT INTO mirror_outbox (collection, docId, op, at) VALUES ('brands', ?, 'upsert', ?)", IDS.brand, iso(NIGHT - 3600_000));
  let r = await runStageD(realDb, NIGHT, deps([]));
  check(r.ok && r.setting === "off" && r.changes.length === 0 && (await flag("write:masters")) === "d1" && (await outboxPending(realDb)).pending === 1, "stageD 'off' (as seeded): nothing happens at all");
  check((await one(realDb, "SELECT value FROM feature_flags WHERE key = 'stageD'")).value === "off", "migration 0011 seeds stageD = 'off'");
  await setFlag("stageD", null);
  r = await runStageD(realDb, NIGHT, deps([]));
  check(r.setting === "off" && r.changes.length === 0, "a missing stageD row is 'off' too");

  // auto: promotion only in the window and only with every precondition.
  await readyForPromotion();
  let sleeps: number[] = [];
  r = await runStageD(realDb, DAY_TIME, deps(sleeps));
  check(r.ok && r.changes.length === 0 && (await flag("write:masters")) === null, "15:00 (shop open): no promotion although everything else holds");
  const ev = await evaluateStageD(realDb, DAY_TIME);
  check(ev.areas[0].blockers.length === 1 && /22:00-00:25/.test(ev.areas[0].blockers[0]), `the only blocker is the time (${ev.areas[0].blockers.join("; ")})`);

  for (const [what, prep] of [
    ["read:stock on D1 for only 3 shop days", () => setFlag("read:stock", "d1", iso(at("2026-11-17T22:05")))],
    ["read:masters still 'shadow'", () => setFlag("read:masters", "shadow", iso(at("2026-11-01T22:05")))],
    ["a write-through failure 3 days ago", () => run(realDb, "INSERT INTO write_through_state (collection, failures, lastFailureAt, lastError) VALUES ('items', 1, ?, 'x')", iso(at("2026-11-17T12:00")))],
    ["an outbox row pending", () => run(realDb, "INSERT INTO mirror_outbox (collection, docId, op, at) VALUES ('units', ?, 'upsert', ?)", IDS.unit, iso(NIGHT - 60_000))],
    ["a reconciliation that repaired a row", () => run(realDb, "UPDATE sync_state SET lastReconcileRepaired = 2 WHERE collection = 'brands'")],
    ["no reconciliation in 48 h", () => run(realDb, "UPDATE sync_state SET lastReconcileAt = ? WHERE collection = 'variants'", iso(at("2026-11-17T23:30")))],
    ["a rollback 2 days ago", () => run(realDb, "INSERT INTO stage_d_log (at, area, fromMode, toMode, kind, reason) VALUES (?, 'masters', 'fence', 'mongo', 'rollback', 'x')", iso(at("2026-11-18T22:30")))],
    ["stageD 'demote-only'", () => setFlag("stageD", "demote-only")],
  ] as [string, () => Promise<void>][]) {
    await readyForPromotion();
    await prep();
    r = await runStageD(realDb, NIGHT, deps([]));
    check(r.ok && r.changes.length === 0 && (await flag("write:masters")) === null, `22:10 but ${what}: no promotion`);
  }

  await readyForPromotion();
  sleeps = [];
  r = await runStageD(realDb, NIGHT, deps(sleeps));
  const log = await all(realDb, "SELECT * FROM stage_d_log ORDER BY id");
  check(r.ok && (await flag("write:masters")) === "d1", "22:10 with every precondition: masters writes go to D1");
  check(log.length === 2 && log[0].fromMode === "mongo" && log[0].toMode === "fence" && log[1].toMode === "d1" && log.every((l) => l.kind === "promote"), "mongo -> fence -> d1, both logged in stage_d_log");
  check(sleeps.length === 1 && sleeps[0] === 35_000, "the fence waited 35 s for writes already under way");
  r = await runStageD(realDb, NIGHT + 60_000, deps([]));
  check(r.changes.length === 0, "the next run changes nothing (idempotent)");

  // A promotion is aborted when the targeted reconciliation finds MongoDB and D1 apart.
  await readyForPromotion();
  await mirrorWriteContext.run(true, () => mongoose.connection.collection("units").updateOne({ _id: new mongoose.Types.ObjectId(IDS.unit) }, { $set: { name: "Changed only in Mongo", updatedAt: new Date(NIGHT) } }));
  r = await runStageD(realDb, NIGHT, deps([]));
  const last = await one(realDb, "SELECT * FROM stage_d_log ORDER BY id DESC LIMIT 1");
  check((await flag("write:masters")) === "mongo" && last.kind === "abort" && /differ between MongoDB and D1/.test(last.reason), "a document changed since the fence that differs in D1: promotion aborted back to 'mongo'");

  // A promotion's fence left by an interrupted run: finished by the next run (in the window), aborted outside it.
  await readyForPromotion();
  await setFlag("write:masters", "fence", iso(NIGHT));
  await run(realDb, "INSERT INTO stage_d_log (at, area, fromMode, toMode, kind, reason) VALUES (?, 'masters', 'mongo', 'fence', 'promote', 'x')", iso(NIGHT));
  r = await runStageD(realDb, NIGHT + 5 * 60_000, deps([]));
  check((await flag("write:masters")) === "d1", "an interrupted promotion's fence is finished by the next run");
  await readyForPromotion();
  await setFlag("write:masters", "fence", iso(NIGHT));
  await run(realDb, "INSERT INTO stage_d_log (at, area, fromMode, toMode, kind, reason) VALUES (?, 'masters', 'mongo', 'fence', 'promote', 'x')", iso(NIGHT));
  r = await runStageD(realDb, at("2026-11-21T08:30"), deps([]));
  check((await flag("write:masters")) === "mongo", "...and aborted when the next run is outside the window");
  await readyForPromotion();
  await setFlag("write:masters", "fence", iso(NIGHT));
  r = await runStageD(realDb, NIGHT, deps([]));
  check((await flag("write:masters")) === "fence" && r.changes.length === 0, "a fence set by hand is never touched");

  // Rollback: lag > 10 min -> fence, drain to zero, then mongo.
  await readyForPromotion();
  await setFlag("write:masters", "d1", iso(at("2026-11-19T22:10")));
  await run(realDb, "UPDATE brands SET description = 'only in d1', updatedAt = ? WHERE id = ?", iso(DAY_TIME), IDS.brand);
  await run(realDb, "INSERT INTO mirror_outbox (collection, docId, op, at) VALUES ('brands', ?, 'upsert', ?)", IDS.brand, iso(DAY_TIME - 11 * 60_000));
  r = await runStageD(realDb, DAY_TIME, deps([]));
  const rb = await all(realDb, "SELECT * FROM stage_d_log WHERE kind = 'rollback' ORDER BY id");
  check((await flag("write:masters")) === "mongo" && rb.length === 2 && rb[0].toMode === "fence" && rb[1].toMode === "mongo", "outbox lag 11 min (any time of day): d1 -> fence -> mongo");
  check(/waited 11 min/.test(rb[0].reason) && /drained to zero/.test(rb[1].reason), "with plain reasons");
  check((await outboxPending(realDb)).pending === 0 && (await Brand.findById(IDS.brand).lean())?.description === "only in d1", "the D1-only write reached MongoDB before the switch went back");

  // Rollback whose drain cannot finish: stays fenced, the next run finishes it.
  await readyForPromotion();
  await setFlag("write:masters", "d1", iso(at("2026-11-19T22:10")));
  for (let i = 0; i < 4; i++) await run(realDb, "INSERT INTO mirror_failures (at, collection, docId, error) VALUES (?, 'brands', ?, 'x')", iso(DAY_TIME - 10 * 60_000), IDS.brand);
  await run(realDb, "INSERT INTO mirror_outbox (collection, docId, op, at) VALUES ('brands', ?, 'upsert', ?)", IDS.brand, iso(DAY_TIME - 60_000));
  const failingDrain = async () => ({ ok: false, drained: 0, failed: 1, pending: 1, oldestPendingAt: null });
  r = await runStageD(realDb, DAY_TIME, { ...deps([]), drain: failingDrain });
  check((await flag("write:masters")) === "fence" && r.changes.length === 1 && /4 documents failed/.test(r.changes[0].reason), "4 drain failures in an hour: fenced, and it stays fenced while the outbox cannot be emptied");
  r = await runStageD(realDb, DAY_TIME + 5 * 60_000, deps([]));
  check((await flag("write:masters")) === "mongo" && (await outboxPending(realDb)).pending === 0, "the next run drains it and switches back to 'mongo'");

  // Rollback when Stage C demoted a read area.
  await readyForPromotion();
  await setFlag("write:masters", "d1", iso(at("2026-11-19T22:10")));
  await setFlag("read:stock", "shadow");
  r = await runStageD(realDb, DAY_TIME, deps([]));
  check((await flag("write:masters")) === "mongo" && /read:stock is 'shadow'/.test(r.changes[0]?.reason || ""), "a read area demoted by Stage C: writes rolled back to MongoDB");
}

async function cronAndAdminTests() {
  console.log("\ncron and admin report");
  await resetAll();
  await seed();
  process.env.NEXTAUTH_SECRET = "test-secret";
  // The cron uses getD1(): point the Cloudflare context at the local D1, as the Stage C test does.
  const cronCall = async () => (await d1SyncGET(new Request("http://localhost/api/cron/d1-sync", { headers: { "x-cron-key": "test-secret" } }))).json();
  const g = globalThis as any;
  const ctxSym = Symbol.for("__cloudflare-context__");
  const prevCtx = g[ctxSym];
  g[ctxSym] = { env: { DB: realDb }, ctx: undefined, cf: undefined };
  try {
    await setFlag("write:masters", "d1");
    let body: any = await cronCall();
    check(body.collections?.brands?.mode === "skipped" && body.collections?.variants?.mode === "skipped" && body.collections?.items?.mode !== "skipped", "write:masters 'd1': the copy job leaves the masters write collections alone (items still copied)");
    check(body.stageD?.setting === "off" && body.stageD?.changes?.length === 0, "the cron runs Stage D (off: nothing)");
    await run(realDb, "UPDATE brands SET description = 'cron drained' WHERE id = ?", IDS.brand);
    await run(realDb, "INSERT INTO mirror_outbox (collection, docId, op, at) VALUES ('brands', ?, 'upsert', ?)", IDS.brand, iso(Date.now()));
    body = await cronCall();
    check(body.reverseMirror?.drained === 1 && (await Brand.findById(IDS.brand).lean())?.description === "cron drained", "the cron drains what the outbox still holds");
    await setFlag("write:masters", null);
    body = await cronCall();
    check(body.collections?.brands?.mode !== "skipped", "with no write switch the copy job copies them as before");
  } finally {
    g[ctxSym] = prevCtx;
  }

  configureReadSource({ resolveD1: () => realDb });
  const res = await deferredContext.run({ approver: ADMIN as any }, () => (shadowStatusGET as any)(new Request("http://localhost/api/admin/d1-shadow-status")) as Promise<Response>);
  const status: any = await res.json();
  const m = status.stageD?.areas?.find((a: any) => a.area === "masters");
  check(res.status === 200 && status.stageD?.setting === "off" && !!m && m.mode === "mongo" && Array.isArray(m.blockers) && "outbox" in m && "lastDrain" in status.stageD && Array.isArray(status.stageD.log), "the admin report shows stageD: switch, write mode, outbox, blockers, last drain, log");
  check(m.collections.join(",") === WRITE_AREA_COLLECTIONS.masters.join(",") && m.readAreas.map((r: any) => r.area).sort().join(",") === "masters,stock", "with the area's collections and read areas");
}

async function main() {
  await startMemoryMongo("valueplus_stage_d");
  const d1 = await startLocalD1();
  realDb = d1.db;
  activeDb = realDb;
  let failed = 0;
  try {
    const files = await applyMigrations(realDb);
    check(files.includes("0011_stage_d.sql"), "migrations 0001-0011 apply on an empty D1");
    check((await one(realDb, "SELECT COUNT(*) AS n FROM _guard")).n === 0, "_guard exists and is empty");
    installWriteThrough({ resolveD1: () => realDb, flagTtlMs: 0 });
    configureReadSource({ resolveD1: () => realDb, envValue: () => "", flagTtlMs: 0 });
    configureWriteMode({ resolveD1: () => activeDb, envValue: () => "", flagTtlMs: 0 });
    check(getWriteModeConfig().fenceTimeoutMs === 30_000 && getWriteModeConfig().fencePollMs === 250, "fence: 250 ms polls, 30 s ceiling");

    await defaultModeTests();
    await d1ParityTests();
    await warehouseSeedTests();
    await guardTests();
    await fenceTests();
    await readGateTests();
    await writeThroughSkipTests();
    await reverseMirrorTests();
    await stageDTests();
    await cronAndAdminTests();

    // D1_WRITES=mongo forces MongoDB whatever the switch says.
    await setFlag("write:masters", "d1");
    configureWriteMode({ envValue: () => "mongo" });
    check((await getWriteMode("masters")) === "mongo" && !(await isD1OwnedCollection("brands")), "env D1_WRITES=mongo forces MongoDB everywhere");
  } catch (e) {
    console.error(e);
    failed++;
  } finally {
    await flushShadowWork().catch(() => {});
    await d1.dispose();
    await stopMemoryMongo();
  }
  failed += summary("d1-stage-d");
  process.exit(failed ? 1 : 0);
}

main();
