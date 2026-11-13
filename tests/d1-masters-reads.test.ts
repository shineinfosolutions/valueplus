/**
 * Stage B2 wave 1: every master-data GET read path gives the same answer from D1 as from MongoDB.
 *
 * MongoDB (in memory) is seeded with realistic master data, including the awkward cases: legacy documents written
 * without mongoose (no booleans, extra fields, explicit nulls), several stock rows per item in a given order,
 * supplier codes, incentive rules and warranty plans, brands that differ only in case or punctuation, documents
 * created in the same millisecond, placeholder warehouses, shipping addresses, bank details. The existing copy job
 * (lib/d1/sync.ts) copies it into a local D1. Then each route is called in mongo mode and in d1 mode, with its
 * filter / sort parameters and roles, and the two JSON responses must be:
 *   - identical after the comparator's documented normalisation, with the SAME options the live shadow uses
 *     (lib/repo/masters/compare.ts); and
 *   - where a route has no such option, identical as canonical JSON (sorted keys) with nothing ignored.
 * Also: d1 mode really reads D1, a D1 error falls back to MongoDB, shadow mode records a match per read path, and a
 * D1 difference is recorded as a mismatch with masked samples.
 */
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import { faulty } from "./helpers/d1-faults";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { runD1Sync } from "@/lib/d1/sync";
import { MASTER_SPECS } from "@/lib/d1/masters-map";
import { compareResults, canonicalize } from "@/lib/d1/compare";
import { configureReadSource, resetReadModeCache, resetReadSourceConfig } from "@/lib/d1/read-source";
import { flushShadowWork, resetShadowConfig, resetShadowSampling } from "@/lib/d1/shadow";
import { MASTER_COMPARE } from "@/lib/repo/masters/compare";
import { compareBrandNames } from "@/lib/repo/masters/lists";
import { deferredContext } from "@/lib/deferred-context";
import Item from "@/models/Item";
import Category from "@/models/Category";
import Brand from "@/models/Brand";
import Unit from "@/models/Unit";
import Warehouse from "@/models/Warehouse";
import Customer from "@/models/Customer";
import Supplier from "@/models/Supplier";
import { GET as itemsGET } from "@/app/api/items/route";
import { GET as brandInfoGET } from "@/app/api/items/brand-info/route";
import { GET as incentivePlanGET } from "@/app/api/items/incentive-plan/route";
import { GET as assignBrandsGET } from "@/app/api/items/assign-brands/route";
import { GET as gstFixGET } from "@/app/api/items/gst-fix/route";
import { GET as purchaseGstGET } from "@/app/api/items/purchase-gst-flag/route";
import { GET as vpBackfillGET } from "@/app/api/items/vp-code-backfill/route";
import { GET as categoriesGET } from "@/app/api/categories/route";
import { GET as brandsGET } from "@/app/api/brands/route";
import { GET as unitsGET } from "@/app/api/units/route";
import { GET as warehousesGET } from "@/app/api/warehouses/route";
import { GET as customersGET } from "@/app/api/customers/route";
import { GET as suppliersGET } from "@/app/api/suppliers/route";

const { ObjectId } = mongoose.Types;
type Handler = (req: Request) => Promise<Response>;

async function one(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any> {
  return db.prepare(sql).bind(...args).first();
}
async function setMode(db: D1DatabaseLike, value: string) {
  await db.prepare("UPDATE feature_flags SET value = ? WHERE key = 'read:masters'").bind(value).run();
  resetReadModeCache();
}

const actors = {
  admin: { id: "u-admin", name: "Admin", email: "admin@x", role: "admin", permissions: [] as any[] },
  salesman: { id: "u-sales", name: "Amit", email: "amit@x", role: "salesman", permissions: [] as any[] },
  manager: { id: "u-mgr", name: "Manager", email: "m@x", role: "manager", permissions: [] as any[] },
};

async function call(handler: Handler, url: string, actor?: (typeof actors)[keyof typeof actors]) {
  const run = () => handler(new Request(url));
  const res = actor ? await deferredContext.run({ approver: actor }, run) : await run();
  return { status: res.status, text: await res.text() };
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const ids: Record<string, any> = {};

async function seed() {
  const raw = mongoose.connection.db!;
  // Warehouses: four created in one insertMany (same createdAt), plus an old placeholder the list leaves out.
  const whs = await Warehouse.insertMany([
    { name: "Ashoka Enterprises (Kunraghat Showroom)", code: "VP-KUN", type: "showroom", address: "H. No. 116", city: "Gorakhpur", state: "UP", pincode: "273008", contactPerson: "Shivam", phone: "+91 9140860604", email: "k@x", isDefault: true },
    { name: "Value Plus (Deoria Road Branch)", code: "VP-DEO", type: "showroom", address: "Deoria Bypass", city: "Gorakhpur", state: "UP", pincode: "273010", contactPerson: "BI", phone: "+91 98", email: "d@x" },
    { name: "Gorakhpur Central Godown", code: "GDN-MAIN", type: "godown", address: "Plot 42", city: "Gorakhpur", state: "UP", pincode: "273016", contactPerson: "Ram", phone: "+91 97", email: "g@x" },
    { name: "GIDA Industrial Area Godown", code: "GDN-GIDA", type: "godown", address: "Sector 13", city: "Gorakhpur", state: "UP", pincode: "273209", contactPerson: "Suresh", phone: "+91 96", email: "gi@x", status: "inactive" },
  ]);
  await Warehouse.create({ name: "Godown", code: "OLD-1", type: "godown", address: "-", city: "-", state: "-", pincode: "-", contactPerson: "-", phone: "-", email: "-" });
  const [kun, deo, gdn] = whs;
  ids.kun = kun._id;
  ids.gdn = gdn._id;

  await Unit.insertMany([
    { name: "Numbers", shortName: "NOS" },
    { name: "Pieces", shortName: "PCS" },
    { name: "Box", shortName: "BOX", type: "pack", status: "inactive" },
  ]);
  await Unit.create({ name: "Kilogram", shortName: "KG", type: "weight" });

  for (const c of ["Television", "Refrigerator", "Washing Machine", "Air Conditioner", "Mobile"]) await Category.create({ name: c, description: c === "Mobile" ? "Phones" : "" });
  await Category.create({ name: "Smart TV", parentId: "tv-parent", status: "inactive" });
  // Same createdAt for a batch of categories.
  await Category.insertMany([{ name: "Audio" }, { name: "Kitchen" }, { name: "Accessories" }]);

  // Brands: case variants, punctuation, digits, an accented name (ICU order vs byte order).
  for (const b of ["Sony", "sony", "Samsung", "LG", "L&T", "_Generic", "A-Plus", "A Plus", "a.o. smith", "3M", "Électrolux", "Zebronics", "Whirlpool", "lloyd"]) {
    await Brand.create({ name: b, description: b === "LG" ? "Life's Good" : "" });
  }

  const base = { hsnCode: "8528", gstRate: 18, unit: "NOS", mrp: 0 };
  const items: any[] = [
    { code: "IT-1", vpCode: "VP-JY7KJK8570", name: "LLOYD 55PS850G (QLED)", category: "Television", brand: "lloyd", purchasePrice: 30000, sellingPrice: 42000.5, mrp: 50000, currentStock: 5, stockByWarehouse: [{ warehouseId: gdn._id, qty: 3 }, { warehouseId: kun._id, qty: 2 }], supplierCodes: ["VP0012023", "LLY-55"], warrantyPlans: [{ planName: "2Y", durationMonths: 24, price: 1999 }], incentives: [{ type: "fixed", value: 500, minPrice: 40000, label: "TV push", startDate: "2026-01-01", endDate: "2099-12-31", active: true }], incentiveType: "fixed", incentiveValue: 500, purchaseIncludesGst: true, isSerialized: true, vspUpdatedAt: new Date("2026-11-01T10:00:00.123Z"), vsp: 41000 },
    { code: "IT-2", vpCode: "VP-Q5TWGA4431", name: "LG DFB532FP Dishwasher", category: "kitchen", brand: "LG", purchasePrice: 41000.1, sellingPrice: 52000, currentStock: 5, stockByWarehouse: [{ warehouseId: kun._id, qty: 5 }], warehouse: "Main Store" },
    { code: "IT-3", name: "LG 1.5T Split AC", category: "Air Conditioner", brand: "lg", purchasePrice: 30000, sellingPrice: 38000, currentStock: 5, stockByWarehouse: [{ warehouseId: kun._id, qty: 1 }, { warehouseId: deo._id, qty: 4 }], warehouse: "Gorakhpur Central Godown", incentiveType: "percentage", incentiveValue: 1 },
    { code: "IT-4", name: "Samsung 253L Fridge", category: "Refrigerator", brand: "Samsung", purchasePrice: 20000, sellingPrice: 26000, minSellingPrice: 24000, currentStock: 0, stockByWarehouse: [], warehouse: "godown-2", gstRate: 0 },
    { code: "IT-5", name: "Sony Bravia 43", category: "Television", brand: "Sony", purchasePrice: 35000, sellingPrice: 45000, currentStock: 12, stockByWarehouse: [{ warehouseId: deo._id, qty: 12 }], warehouse: "VP-KUN showroom" },
    { code: "IT-6", name: "AO Smith Geyser", category: "Kitchen", brand: "a.o. smith", purchasePrice: 8000, sellingPrice: 11000, currentStock: 2, stockByWarehouse: [{ warehouseId: gdn._id, qty: 2 }], warehouse: "main_store%", status: "inactive" },
    { code: "IT-7", name: "L&T Switch", category: "Accessories", brand: "L&T", purchasePrice: 100, sellingPrice: 150, currentStock: 40, stockByWarehouse: [{ warehouseId: kun._id, qty: 40 }], supplierCodes: ["VP-ICOUQ19698"] },
    { code: "IT-8", name: "Zebronics Speaker", category: "Audio", brand: "", purchasePrice: 900, sellingPrice: 1299, currentStock: 7, stockByWarehouse: [{ warehouseId: kun._id, qty: 7 }], billingEntity: "ashoka", incentives: [] },
    { code: "IT-9", name: "OPPO F33 PRO", category: "Mobile", brand: "", purchasePrice: 18000, sellingPrice: 21999, currentStock: 3, stockByWarehouse: [{ warehouseId: kun._id, qty: 3 }], supplierCodes: ["VP-UGNAPB6619"], vpCode: "" },
    { code: "IT-10", name: "Vivo Y20 - OPPO", category: "Mobile", brand: "unbranded", purchasePrice: 9000, sellingPrice: 11000, currentStock: 3, stockByWarehouse: [{ warehouseId: kun._id, qty: 3 }] },
  ];
  for (const it of items) {
    const d = await Item.create({ ...base, ...it });
    ids[it.code] = d._id;
  }
  // Legacy rows written straight into the collection: no booleans, no __v, explicit nulls, an unknown field,
  // a numeric-looking text, and an item without stockByWarehouse.
  const now = new Date("2026-10-01T08:00:00.000Z");
  const legacy1 = new ObjectId();
  const legacy2 = new ObjectId();
  ids.legacy1 = legacy1;
  await raw.collection("items").insertMany([
    { _id: legacy1, code: "OLD-1", name: "Old Haier TV", category: "Television", brand: "Haier", purchasePrice: 15000, sellingPrice: 18000, mrp: 20000, currentStock: 5, stockByWarehouse: [{ _id: new ObjectId(), warehouseId: gdn._id, qty: 5 }], vpCode: null, imageUrl: null, oldLocation: "rack 4", status: "active", createdAt: now, updatedAt: now },
    { _id: legacy2, code: "OLD-2", name: "Old Haier TV", category: "Television", brand: "HAIER", purchasePrice: 15000, sellingPrice: 18000, mrp: 20000, currentStock: 5, createdAt: now, updatedAt: now, __v: 3 },
  ]);

  await Customer.create({ code: "CUST-001", name: "Ravi Kumar", phone: "9000000001", email: "ravi@x", gstNumber: "09ABCDE1234F1Z5", billingAddress: { line1: "12 MG Rd", city: "Gorakhpur", state: "UP", pincode: "273001" }, outstandingBalance: 1500.75 });
  await Customer.create({ code: "CUST-002", name: "Walk-in", phone: "0000000000", billingAddress: {}, shippingAddress: { line1: "Site 2", city: "Deoria" }, customerGroup: "Wholesale", advanceBalance: 200 });
  await raw.collection("customers").insertOne({ code: "CUST-003", name: "Legacy Cust", phone: "9000000003", billingAddress: { line1: "Old Rd", city: "Gkp", state: "UP", pincode: "273002", country: "India", landmark: "Near temple" }, gstNumber: null, createdAt: now, updatedAt: now });

  await Supplier.create({ code: "SUPP-001", name: "Value Plus Retail", phone: "9111111111", gstNumber: "09AAACV1234A1Z1", panNumber: "AAACV1234A", address: { line1: "Hub", city: "Lucknow", state: "UP", pincode: "226001" }, bankDetails: { bankName: "SBI", accountNumber: "123456789012", ifscCode: "SBIN0000001", accountType: "current" }, outstandingBalance: 25000 });
  await Supplier.create({ code: "SUPP-002", name: "Haier India", phone: "9222222222", address: { line1: "Plot 1", city: "Noida", state: "UP", pincode: "201301" } });
}

// ---------------------------------------------------------------------------
// Parity
// ---------------------------------------------------------------------------

interface Case {
  label: string;
  name: string;
  handler: Handler;
  url: string;
  actor?: keyof typeof actors;
  /** Extract the read-path value from the JSON body, for the comparator (default: body.data). */
  pick?: (body: any) => any;
}

async function parity(db: D1DatabaseLike, c: Case) {
  await setMode(db, "mongo");
  const m = await call(c.handler, c.url, c.actor ? actors[c.actor] : undefined);
  await setMode(db, "d1");
  const d = await call(c.handler, c.url, c.actor ? actors[c.actor] : undefined);
  const mb = JSON.parse(m.text);
  const dbody = JSON.parse(d.text);
  if (m.status !== 200 || !mb.success) {
    check(false, `${c.label}: mongo mode answered ${m.status} ${m.text.slice(0, 200)}`);
    return;
  }
  const pick = c.pick || ((b: any) => b.data);
  const opts = MASTER_COMPARE[c.name];
  // The route's whole body is compared; the read-path options apply under `data` (where the route puts the rows).
  const res = compareResults(pick(mb), pick(dbody), opts);
  const rest = compareResults({ ...mb, data: undefined }, { ...dbody, data: undefined });
  const byteSame = m.text === d.text;
  const canonSame = JSON.stringify(canonicalize(mb)) === JSON.stringify(canonicalize(dbody));
  check(
    m.status === d.status && res.equal && rest.equal,
    `${c.label}: same answer from D1 (${byteSame ? "byte-identical" : canonSame ? "identical as canonical JSON" : `identical after normalisation; raw differs in ${compareResults(mb, dbody).diffCount} place(s)`})${res.equal ? "" : ` DIFFS ${JSON.stringify(res.diffs)}`}`
  );
  const strict = !opts || (!opts.ignorePaths && !opts.defaultsWhenMissing && !opts.unorderedPaths);
  if (strict && !opts?.tieOrder) check(canonSame, `${c.label}: canonical JSON identical with nothing ignored`);
  return { mongo: mb, d1: dbody };
}

async function main() {
  await startMemoryMongo();
  const local = await startLocalD1();
  const db = local.db;
  try {
    await applyMigrations(db);
    await seed();
    const copy = await runD1Sync(db, { reconcile: "skip", collections: MASTER_SPECS.map((s) => s.collection) });
    check(copy.ok && copy.errors === 0, `master data copied into D1 (${Object.entries(copy.collections).map(([k, v]) => `${k} ${v.copied}`).join(", ")})`);

    configureReadSource({ resolveD1: () => db, envValue: () => "", flagTtlMs: 0 });
    resetShadowConfig();

    const H = (h: unknown) => h as Handler;
    const kunHex = String(ids.kun);
    const cases: Case[] = [
      { label: "GET /api/items", name: "items.list", handler: H(itemsGET), url: "http://localhost/api/items" },
      { label: "GET /api/items as admin", name: "items.list", handler: H(itemsGET), url: "http://localhost/api/items", actor: "admin" },
      { label: "GET /api/items as salesman (purchase price hidden)", name: "items.list", handler: H(itemsGET), url: "http://localhost/api/items", actor: "salesman" },
      { label: "GET /api/items?brand=lg (case-insensitive)", name: "items.list", handler: H(itemsGET), url: "http://localhost/api/items?brand=lg" },
      { label: "GET /api/items?brand=%20L%26T%20 (special characters, trimmed)", name: "items.list", handler: H(itemsGET), url: "http://localhost/api/items?brand=%20L%26T%20" },
      { label: "GET /api/items?brand=all&category=KITCHEN", name: "items.list", handler: H(itemsGET), url: "http://localhost/api/items?brand=all&category=KITCHEN" },
      { label: "GET /api/items?category=Television&brand=haier", name: "items.list", handler: H(itemsGET), url: "http://localhost/api/items?category=Television&brand=haier" },
      { label: "GET /api/items?warehouse=<id> (stockAtWarehouse)", name: "items.list", handler: H(itemsGET), url: `http://localhost/api/items?warehouse=${kunHex}`, actor: "salesman" },
      { label: "GET /api/items?location=<ID IN CAPITALS>", name: "items.list", handler: H(itemsGET), url: `http://localhost/api/items?location=${kunHex.toUpperCase()}` },
      { label: "GET /api/items?warehouse=godown", name: "items.list", handler: H(itemsGET), url: "http://localhost/api/items?warehouse=godown" },
      { label: "GET /api/items?warehouse=showroom", name: "items.list", handler: H(itemsGET), url: "http://localhost/api/items?warehouse=showroom" },
      { label: "GET /api/items?warehouse=Kunraghat", name: "items.list", handler: H(itemsGET), url: "http://localhost/api/items?warehouse=Kunraghat" },
      { label: "GET /api/items?warehouse=main_store% (LIKE escaping)", name: "items.list", handler: H(itemsGET), url: "http://localhost/api/items?warehouse=main_store%25" },
      { label: "GET /api/items?warehouse=Main Store", name: "items.list", handler: H(itemsGET), url: "http://localhost/api/items?warehouse=Main%20Store" },
      { label: "GET /api/items?warehouse=nowhere", name: "items.list", handler: H(itemsGET), url: "http://localhost/api/items?warehouse=nowhere" },
      { label: "GET /api/items/brand-info?id=<item>", name: "items.byId", handler: H(brandInfoGET), url: `http://localhost/api/items/brand-info?id=${ids["IT-1"]}`, actor: "admin" },
      { label: "GET /api/items/brand-info?id=<legacy item>", name: "items.byId", handler: H(brandInfoGET), url: `http://localhost/api/items/brand-info?id=${ids.legacy1}`, actor: "salesman" },
      { label: "GET /api/items/incentive-plan", name: "items.incentivePlan", handler: H(incentivePlanGET), url: "http://localhost/api/items/incentive-plan", actor: "salesman" },
      { label: "GET /api/items/assign-brands", name: "items.assignBrands", handler: H(assignBrandsGET), url: "http://localhost/api/items/assign-brands", actor: "admin" },
      { label: "GET /api/items/gst-fix", name: "items.gstFix", handler: H(gstFixGET), url: "http://localhost/api/items/gst-fix", actor: "admin" },
      { label: "GET /api/items/purchase-gst-flag", name: "items.purchaseGstFlag", handler: H(purchaseGstGET), url: "http://localhost/api/items/purchase-gst-flag", actor: "admin" },
      { label: "GET /api/items/vp-code-backfill", name: "items.vpBackfill", handler: H(vpBackfillGET), url: "http://localhost/api/items/vp-code-backfill", actor: "manager" },
      { label: "GET /api/categories", name: "categories.list", handler: H(categoriesGET), url: "http://localhost/api/categories" },
      { label: "GET /api/brands", name: "brands.list", handler: H(brandsGET), url: "http://localhost/api/brands" },
      { label: "GET /api/units", name: "units.list", handler: H(unitsGET), url: "http://localhost/api/units" },
      { label: "GET /api/warehouses", name: "warehouses.list", handler: H(warehousesGET), url: "http://localhost/api/warehouses" },
      { label: "GET /api/customers", name: "customers.list", handler: H(customersGET), url: "http://localhost/api/customers" },
      { label: "GET /api/suppliers", name: "suppliers.list", handler: H(suppliersGET), url: "http://localhost/api/suppliers" },
    ];

    console.log("\nmongo mode vs d1 mode");
    const out: Record<string, any> = {};
    for (const c of cases) out[c.label] = await parity(db, c);

    // Spot checks that the cases really exercise what they claim.
    const all = out["GET /api/items"]?.d1?.data || [];
    check(all.length === 12, `items list has every item (${all.length})`);
    const it1 = all.find((x: any) => x.code === "IT-1");
    check(
      JSON.stringify(it1?.stockByWarehouse.map((s: any) => [s.warehouseId, s.qty])) === JSON.stringify([[String(ids.gdn), 3], [kunHex, 2]]),
      "D1 keeps the order of stockByWarehouse entries"
    );
    check(JSON.stringify(it1?.supplierCodes) === '["VP0012023","LLY-55"]' && it1?.warrantyPlans?.[0]?._id && it1?.incentives?.[0]?.label === "TV push", "supplier codes, warranty plans (with ids) and incentive rules come back");
    check(it1?.vspUpdatedAt === "2026-11-01T10:00:00.123Z" && it1?.sellingPrice === 42000.5 && typeof it1?._id === "string", "dates as ISO text, money as numbers, _id as a string");
    const old1 = all.find((x: any) => x.code === "OLD-1");
    check(old1?.oldLocation === "rack 4" && old1?.__v === 0, "a legacy item's unknown field comes back from `extra`");
    const sales = out["GET /api/items as salesman (purchase price hidden)"]?.d1?.data || [];
    check(sales.length === 12 && sales.every((x: any) => !("purchasePrice" in x)) && sales.find((x: any) => x.code === "IT-1")?.minSellingPrice === 30000, "salesman: no purchasePrice from D1 either, floor filled from it");
    const atKun = out["GET /api/items?warehouse=<id> (stockAtWarehouse)"]?.d1?.data || [];
    check(atKun.length === 7 && atKun.find((x: any) => x.code === "IT-3")?.stockAtWarehouse === 1, `warehouse filter + stockAtWarehouse (${atKun.length} items)`);
    const caps = out["GET /api/items?location=<ID IN CAPITALS>"]?.d1?.data || [];
    check(caps.length === 7 && caps.every((x: any) => x.stockAtWarehouse === 0), "an id in capitals matches (cast) but stockAtWarehouse stays 0, as on MongoDB");
    check((out["GET /api/items?brand=lg (case-insensitive)"]?.d1?.data || []).length === 2, "brand=lg finds LG and lg");
    check((out["GET /api/items?warehouse=main_store% (LIKE escaping)"]?.d1?.data || []).length === 1, "% and _ in the text filter are literal");
    check((out["GET /api/items?warehouse=godown"]?.d1?.data || []).length === 2, "warehouse=godown matches 'godown' anywhere, any case");
    check((out["GET /api/items?warehouse=showroom"]?.d1?.data || []).length === 10, "showroom filter leaves out only the two godown items");
    const brandNames = (out["GET /api/brands"]?.mongo?.data || []).map((b: any) => b.name);
    const d1BrandNames = (out["GET /api/brands"]?.d1?.data || []).map((b: any) => b.name);
    console.log(`  brands (MongoDB ICU order): ${brandNames.join(" | ")}`);
    console.log(`  brands (D1 order):          ${d1BrandNames.join(" | ")}`);
    check(
      brandNames.length === 14 && brandNames.every((n: string, i: number) => i === 0 || compareBrandNames(brandNames[i - 1], n) <= 0),
      "MongoDB's collation order agrees with Intl.Collator('en', accent)"
    );
    check((out["GET /api/brands"]?.d1?.data || []).find((b: any) => b.name === "LG")?.items === 1, "brand item counts are exact-case (LG: 1)");
    check((out["GET /api/warehouses"]?.d1?.data || []).every((w: any) => w.name !== "Godown"), "placeholder warehouse left out");
    const custs = out["GET /api/customers"]?.d1?.data || [];
    check(custs.find((c: any) => c.code === "CUST-003")?.billingAddress?.landmark === "Near temple", "unknown subdocument key comes back inside billingAddress");
    const sup = (out["GET /api/suppliers"]?.d1?.data || []).find((s: any) => s.code === "SUPP-001");
    check(sup?.bankDetails?.accountNumber === "123456789012", "suppliers: bank details returned exactly as the Mongo route does");

    // d1 mode really reads D1.
    console.log("\nd1 mode reads D1; errors fall back to MongoDB");
    await db.prepare("UPDATE units SET name = 'Numbers (from D1)' WHERE shortName = 'NOS'").run();
    await setMode(db, "d1");
    let body: any = JSON.parse((await call(H(unitsGET), "http://localhost/api/units")).text);
    check(body.data.some((u: any) => u.name === "Numbers (from D1)"), "d1 mode serves the D1 row");
    await setMode(db, "mongo");
    body = JSON.parse((await call(H(unitsGET), "http://localhost/api/units")).text);
    check(!body.data.some((u: any) => u.name === "Numbers (from D1)"), "mongo mode does not");

    await setMode(db, "d1");
    configureReadSource({ resolveD1: () => faulty(db, { fail: (sql) => /FROM (items|units)\b/.test(sql) }) });
    const fbItems = await call(H(itemsGET), "http://localhost/api/items", actors.salesman);
    const fbUnits = JSON.parse((await call(H(unitsGET), "http://localhost/api/units")).text);
    await flushShadowWork();
    const fbBody = JSON.parse(fbItems.text);
    check(fbItems.status === 200 && fbBody.data.length === 12 && !fbUnits.data.some((u: any) => u.name === "Numbers (from D1)"), "D1 failing: the routes answer from MongoDB");
    configureReadSource({ resolveD1: () => db });
    const fbRows = await one(db, "SELECT COUNT(*) AS n FROM shadow_results WHERE kind = 'fallback' AND name IN ('items.list', 'units.list')");
    check(Number(fbRows?.n) === 2, "both fallbacks recorded");
    await db.prepare("UPDATE units SET name = 'Numbers' WHERE shortName = 'NOS'").run();

    // Shadow mode: every read path records a match.
    console.log("\nshadow mode");
    await setMode(db, "shadow");
    await db.prepare("DELETE FROM shadow_results").run();
    const seen = new Set<string>();
    for (const c of cases) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      resetShadowSampling();
      const r = await call(c.handler, c.url, c.actor ? actors[c.actor] : undefined);
      check(r.status === 200, `${c.label}: answered in shadow mode`);
    }
    await flushShadowWork();
    const rows = ((await db.prepare("SELECT name, match, diffCount, diffs FROM shadow_results WHERE kind = 'shadow'").all()).results || []) as any[];
    for (const n of Array.from(seen)) {
      const r = rows.find((x) => x.name === n);
      check(r?.match === 1, `shadow ${n}: recorded as a match${r && r.match !== 1 ? ` (${r.diffs})` : r ? "" : " (no row)"}`);
    }

    // A real D1 difference is caught, with masked samples.
    await db.prepare("UPDATE suppliers SET bank_accountNumber = '999999999999', phone = '9111111199' WHERE code = 'SUPP-001'").run();
    resetShadowSampling();
    await call(H(suppliersGET), "http://localhost/api/suppliers");
    await flushShadowWork();
    const mm = await one(db, "SELECT * FROM shadow_results WHERE name = 'suppliers.list' AND match = 0 ORDER BY id DESC");
    check(mm?.diffCount === 2, `a changed D1 row is a mismatch (${mm?.diffCount} differences)`);
    check(!!mm && /bankDetails\.accountNumber/.test(mm.diffs) && /"\*\*\*"/.test(mm.diffs) && !/123456789012|999999999999/.test(JSON.stringify(mm)), "account number difference recorded with its path, value masked");
    check(!!mm && JSON.parse(mm.diffs).some((d: any) => /phone$/.test(d.path) && d.mongo === '"9111111111"' && d.d1 === '"9111111199"'), "a non-secret field shows its short value");

    // Shadow mode never changes the response nor its time, even with a slow D1 (300 ms per master query).
    console.log("\nresponse time with a slow D1");
    configureReadSource({ resolveD1: () => faulty(db, { slow: (sql) => /FROM (items|units|itemStock|itemSupplierCodes)\b/.test(sql), delayMs: 300 }) });
    for (const [label, handler, url] of [
      ["GET /api/items", H(itemsGET), "http://localhost/api/items"],
      ["GET /api/units", H(unitsGET), "http://localhost/api/units"],
    ] as Array<[string, Handler, string]>) {
      const time = async (mode: string) => {
        await setMode(db, mode);
        let text = "";
        const t0 = performance.now();
        for (let i = 0; i < 3; i++) {
          resetShadowSampling();
          text = (await call(handler, url, actors.salesman)).text;
        }
        return { ms: (performance.now() - t0) / 3, text };
      };
      const m = await time("mongo");
      const s = await time("shadow");
      const t1 = performance.now();
      await flushShadowWork();
      const bg = performance.now() - t1;
      console.log(`  ${label}: mongo mode ${m.ms.toFixed(1)} ms, shadow mode ${s.ms.toFixed(1)} ms; shadow D1 work finished ${bg.toFixed(0)} ms after the last response`);
      check(s.text === m.text, `${label}: shadow mode response byte-identical to mongo mode`);
      check(s.ms - m.ms < 60, `${label}: shadow mode adds < 60 ms with a 300 ms D1 (${(s.ms - m.ms).toFixed(1)} ms)`);
      check(bg >= 250, `${label}: the slow D1 work ran after the responses`);
    }
    configureReadSource({ resolveD1: () => db });
  } finally {
    resetReadSourceConfig();
    await local.dispose();
    await stopMemoryMongo();
  }
  process.exit(summary("d1-masters-reads") ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await stopMemoryMongo();
  } catch {}
  process.exit(1);
});
