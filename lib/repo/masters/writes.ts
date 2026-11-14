/**
 * Stage D, unit U1 (docs/D1_MIGRATION_PLAN.md §6.6, §6.8a): the D1 write paths of the master-data routes.
 *
 * A route calls these only when `getWriteMode("masters")` is not 'mongo' (lib/d1/write-mode.ts); with the switch at
 * its default every route runs its MongoDB code exactly as before. Each function answers exactly what its route's
 * MongoDB code answers (same status codes, same messages, same JSON, the document in mongoose's JSON form), by
 * doing the same thing on D1:
 *   READ what the decision needs from D1 -> DECIDE with the same rules (the route's payload rules, copied as they
 *   are, and the mongoose model for casting, defaults and validation) -> ONE guarded D1 batch that writes the rows
 *   and their mirror_outbox rows (lib/d1/write-batch.ts). A guard that fails = someone changed the row between our
 *   read and our batch: 409, nothing written.
 * Unique indexes the models declare (brand / unit / variant names, unit short names, warehouse codes, product
 * reference VP codes) are checked on the D1 read and again by a guard inside the batch, and answer like MongoDB's
 * duplicate-key error (code 11000) does in each route.
 *
 * Not here on purpose (see lib/repo/WRITES_INVENTORY.md): items (stock quantities and purchasePrice are written by
 * U5 routes), customers / suppliers (balances, U5), billing companies (usageCount bumped by every bill, U5).
 * These master routes write no audit log, send no notification and publish nothing themselves; worker.ts announces
 * every successful write on the realtime hub by its path, in both modes alike.
 */
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Brand from "@/models/Brand";
import Category from "@/models/Category";
import Unit from "@/models/Unit";
import Variant from "@/models/Variant";
import Warehouse from "@/models/Warehouse";
import ProductCatalogReference from "@/models/ProductCatalogReference";
import Item from "@/models/Item";
import { getActor } from "@/lib/requirePermission";
import type { Model } from "mongoose";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { writeBusyResponse, type WriteDecision } from "@/lib/d1/write-mode";
import { loadStored, type StoredRow } from "@/lib/d1/stored-docs";
import {
  WriteConflictError,
  applyPlainUpdate,
  castIdError,
  commitWrite,
  conflictResponse,
  duplicateKeyError,
  guardAllUnchanged,
  guardNone,
  guardThat,
  guardUnchanged,
  idHex,
  newDocument,
  storedForm,
  writeDb,
} from "@/lib/d1/write-batch";
import { listWarehouses } from "./lists";
import { LEGACY_WAREHOUSE_NAMES } from "@/lib/legacy-rows";

type Mode = Exclude<WriteDecision, "mongo">;

/** The fence did not lift (503), or the op itself; a guard conflict anywhere answers 409. */
async function d1Op(mode: Mode, op: () => Promise<NextResponse>, onError: (e: any) => NextResponse): Promise<NextResponse> {
  if (mode === "busy") return writeBusyResponse();
  try {
    return await op();
  } catch (e: any) {
    if (e instanceof WriteConflictError) return conflictResponse(e);
    return onError(e);
  }
}

const fail = (status: number) => (e: any) => NextResponse.json({ success: false, error: e?.message }, { status });

/** The row with this id (as findById casts it); a non-ObjectId id throws the same CastError mongoose throws. */
async function storedById(db: D1DatabaseLike, collection: string, model: Model<any>, id: string): Promise<StoredRow | null> {
  const hex = idHex(id);
  if (!hex) throw castIdError(model, id);
  const [row] = await loadStored(db, collection, "id = ?", [hex]);
  return row || null;
}

/** Does another row already hold this value of a unique field? */
async function taken(db: D1DatabaseLike, table: string, where: string, params: unknown[]): Promise<boolean> {
  return !!(await db.prepare(`SELECT 1 AS x FROM ${table} WHERE ${where} LIMIT 1`).bind(...params).first());
}

/** A unique value is free now (read) and still free when the batch runs (guard): else the 11000 error. */
async function uniqueCheck(db: D1DatabaseLike, collection: string, table: string, fields: Record<string, unknown>, exceptId: string | null, guards: any[]) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const where = entries.map(([k]) => `${k} = ?`).join(" OR ");
  const full = exceptId ? `(${where}) AND id <> ?` : where;
  const params = [...entries.map(([, v]) => v), ...(exceptId ? [exceptId] : [])];
  if (await taken(db, table, full, params)) {
    // Name the field that is really taken, as MongoDB's error names its index.
    for (const [k, v] of entries) {
      if (await taken(db, table, exceptId ? `${k} = ? AND id <> ?` : `${k} = ?`, exceptId ? [v, exceptId] : [v])) {
        throw duplicateKeyError(collection, { [k]: v });
      }
    }
    throw duplicateKeyError(collection, Object.fromEntries(entries));
  }
  guards.push(guardNone(db, table, full, params));
}

const exists = (db: D1DatabaseLike, table: string, id: string) => guardThat(db, `EXISTS (SELECT 1 FROM ${table} WHERE id = ?)`, [id]);

// ---------------------------------------------------------------------------
// Generic create / update / delete, each mirroring one MongoDB call
// ---------------------------------------------------------------------------

/** `Model.create(payload)` on D1. Returns the mongoose document (what create returns). */
async function createOne(collection: string, model: Model<any>, table: string, payload: any, unique: string[] = []) {
  const db = writeDb();
  const now = new Date();
  const doc = newDocument(model, payload, now);
  await doc.validate();
  const guards: any[] = [];
  const stored = storedForm(doc);
  await uniqueCheck(db, collection, table, Object.fromEntries(unique.map((k) => [k, stored[k]])), null, guards);
  await commitWrite(db, { guards, upserts: [{ collection, doc: stored }] }, now);
  return doc;
}

/** `Model.findByIdAndUpdate(id, body, { new: true, runValidators })` on D1: the updated document, or null. */
async function updateById(collection: string, model: Model<any>, table: string, id: string, body: any, opts: { runValidators?: boolean; unique?: string[] } = {}) {
  const db = writeDb();
  const now = new Date();
  const current = await storedById(db, collection, model, id);
  if (!current) return null;
  const { stored, returned } = applyPlainUpdate(model, current.doc, body, { runValidators: opts.runValidators, now });
  const guards: any[] = [guardUnchanged(db, table, current.id, current.updatedAt, current.docHash)];
  // Only a unique field the update really sets can collide (as only that one touches MongoDB's index).
  const setUnique = (opts.unique || []).filter((k) => body && Object.prototype.hasOwnProperty.call(body, k));
  await uniqueCheck(db, collection, table, Object.fromEntries(setUnique.map((k) => [k, stored[k]])), current.id, guards);
  await commitWrite(db, { guards, upserts: [{ collection, doc: stored }] }, now);
  return returned;
}

/** `Model.findByIdAndDelete(id)` on D1: the deleted document's id, or null when there was none. */
async function deleteById(collection: string, model: Model<any>, table: string, id: string): Promise<string | null> {
  const db = writeDb();
  const current = await storedById(db, collection, model, id);
  if (!current) return null;
  await commitWrite(db, { guards: [exists(db, table, current.id)], deletes: [{ collection, id: current.id }] }, new Date());
  return current.id;
}

const idParam = (req: Request) => new URL(req.url).searchParams.get("id");

// ---------------------------------------------------------------------------
// Brands (app/api/brands/route.ts)
// ---------------------------------------------------------------------------

export async function createBrand(request: Request, mode: Mode) {
  return d1Op(
    mode,
    async () => {
      const body = await request.json();
      const newBrand = await createOne("brands", Brand, "brands", {
        name: body.name,
        description: body.description || "",
        status: body.status || "active",
      }, ["name"]);
      return NextResponse.json({ success: true, message: "Brand added successfully!", data: newBrand });
    },
    (error) => {
      if (error.code === 11000) return NextResponse.json({ success: false, error: "Brand name already exists" }, { status: 400 });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
  );
}

export async function updateBrand(req: Request, mode: Mode) {
  return d1Op(
    mode,
    async () => {
      const id = idParam(req);
      if (!id) return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
      const body = await req.json();
      const updatedBrand = await updateById("brands", Brand, "brands", id, body, { unique: ["name"] });
      if (!updatedBrand) return NextResponse.json({ success: false, error: "Brand not found" }, { status: 404 });
      return NextResponse.json({ success: true, data: updatedBrand });
    },
    (error) => {
      if (error.code === 11000) return NextResponse.json({ success: false, error: "Brand name already exists" }, { status: 400 });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
  );
}

export async function deleteBrand(req: Request, mode: Mode) {
  return d1Op(
    mode,
    async () => {
      const id = idParam(req);
      if (!id) return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
      const deleted = await deleteById("brands", Brand, "brands", id);
      if (!deleted) return NextResponse.json({ success: false, error: "Brand not found" }, { status: 404 });
      return NextResponse.json({ success: true, data: {} });
    },
    fail(500)
  );
}

// ---------------------------------------------------------------------------
// Categories (app/api/categories/route.ts)
// ---------------------------------------------------------------------------

export async function createCategory(request: Request, mode: Mode) {
  return d1Op(
    mode,
    async () => {
      const body = await request.json();
      const newCategory = await createOne("categories", Category, "categories", {
        name: body.name,
        description: body.description || "",
        parentId: body.parentId || null,
        status: body.status || "active",
      });
      return NextResponse.json({ success: true, message: "Category added successfully!", data: newCategory });
    },
    fail(500)
  );
}

export async function updateCategory(req: Request, mode: Mode) {
  return d1Op(
    mode,
    async () => {
      const id = idParam(req);
      if (!id) return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
      const body = await req.json();
      const updatedCategory = await updateById("categories", Category, "categories", id, body);
      if (!updatedCategory) return NextResponse.json({ success: false, error: "Category not found" }, { status: 404 });
      return NextResponse.json({ success: true, data: updatedCategory });
    },
    fail(500)
  );
}

export async function deleteCategory(req: Request, mode: Mode) {
  return d1Op(
    mode,
    async () => {
      const id = idParam(req);
      if (!id) return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
      const deleted = await deleteById("categories", Category, "categories", id);
      if (!deleted) return NextResponse.json({ success: false, error: "Category not found" }, { status: 404 });
      return NextResponse.json({ success: true, data: {} });
    },
    fail(500)
  );
}

// ---------------------------------------------------------------------------
// Units (app/api/units/route.ts)
// ---------------------------------------------------------------------------

export async function createUnit(request: Request, mode: Mode) {
  return d1Op(
    mode,
    async () => {
      const body = await request.json();
      const newUnit = await createOne("units", Unit, "units", {
        name: body.name,
        shortName: body.shortName,
        type: body.type || "count",
        status: body.status || "active",
      }, ["name", "shortName"]);
      return NextResponse.json({ success: true, message: "Unit added successfully!", data: newUnit });
    },
    (error) => {
      if (error.code === 11000) return NextResponse.json({ success: false, error: "Unit name or short name already exists" }, { status: 400 });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
  );
}

export async function deleteUnit(req: Request, mode: Mode) {
  return d1Op(
    mode,
    async () => {
      const id = idParam(req);
      if (!id) return NextResponse.json({ success: false, error: "ID is required" }, { status: 400 });
      const deleted = await deleteById("units", Unit, "units", id);
      if (!deleted) return NextResponse.json({ success: false, error: "Unit not found" }, { status: 404 });
      return NextResponse.json({ success: true, message: "Unit deleted successfully" });
    },
    fail(500)
  );
}

// ---------------------------------------------------------------------------
// Variants (app/api/variants/route.ts)
// ---------------------------------------------------------------------------

export async function createVariant(request: Request, mode: Mode) {
  return d1Op(
    mode,
    async () => {
      const body = await request.json();
      const newVariant = await createOne("variants", Variant, "variants", {
        name: body.name,
        values: body.values || [],
        status: body.status || "active",
      }, ["name"]);
      return NextResponse.json({ success: true, message: "Variant added successfully!", data: newVariant });
    },
    (error) => {
      if (error.code === 11000) return NextResponse.json({ success: false, error: "Variant name already exists" }, { status: 400 });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
  );
}

export async function deleteVariant(req: Request, mode: Mode) {
  return d1Op(
    mode,
    async () => {
      const id = idParam(req);
      if (!id) return NextResponse.json({ success: false, error: "ID is required" }, { status: 400 });
      const deleted = await deleteById("variants", Variant, "variants", id);
      if (!deleted) return NextResponse.json({ success: false, error: "Variant not found" }, { status: 404 });
      return NextResponse.json({ success: true, message: "Variant deleted successfully" });
    },
    fail(500)
  );
}

// ---------------------------------------------------------------------------
// Warehouses (app/api/warehouses/route.ts)
// ---------------------------------------------------------------------------

/**
 * GET's first-run seeding (`Warehouse.insertMany(defaults)` when there is no warehouse at all), then the list as the
 * GET returns it, read from D1 (which now holds them).
 */
export async function insertDefaultWarehouses(mode: Mode, defaults: any[]) {
  return d1Op(
    mode,
    async () => {
      const db = writeDb();
      const now = new Date();
      const docs = defaults.map((d) => newDocument(Warehouse, d, now));
      for (const d of docs) await d.validate();
      const stored = docs.map(storedForm);
      const codes = stored.map((d) => d.code);
      // insertMany stops at the first duplicate code: refuse the whole set instead (D1 writes all or nothing).
      if (await taken(db, "warehouses", "code IN (SELECT value FROM json_each(?))", [JSON.stringify(codes)])) {
        throw duplicateKeyError("warehouses", { code: codes[0] });
      }
      const guards = [guardNone(db, "warehouses", "code IN (SELECT value FROM json_each(?))", [JSON.stringify(codes)])];
      await commitWrite(db, { guards, upserts: stored.map((doc) => ({ collection: "warehouses", doc })) }, now);
      const warehouses = await listWarehouses(db, LEGACY_WAREHOUSE_NAMES);
      return NextResponse.json({ success: true, data: warehouses });
    },
    fail(500)
  );
}

export async function createWarehouse(req: Request, mode: Mode) {
  return d1Op(
    mode,
    async () => {
      const body = await req.json();
      const warehouse = await createOne("warehouses", Warehouse, "warehouses", body, ["code"]);
      return NextResponse.json({ success: true, data: warehouse });
    },
    fail(400)
  );
}

export async function updateWarehouse(req: Request, mode: Mode) {
  return d1Op(
    mode,
    async () => {
      const id = idParam(req);
      if (!id) return NextResponse.json({ success: false, error: "ID is required" }, { status: 400 });
      const body = await req.json();
      const updated = await updateById("warehouses", Warehouse, "warehouses", id, body, { runValidators: true, unique: ["code"] });
      if (!updated) return NextResponse.json({ success: false, error: "Warehouse not found" }, { status: 404 });
      return NextResponse.json({ success: true, data: updated });
    },
    fail(400)
  );
}

export async function deleteWarehouse(req: Request, mode: Mode) {
  return d1Op(
    mode,
    async () => {
      const id = idParam(req);
      if (!id) return NextResponse.json({ success: false, error: "ID is required" }, { status: 400 });

      // Item stock is still MongoDB's (items move with the money unit U5), so the "still holds stock" rule reads
      // MongoDB, exactly as the MongoDB path does.
      await connectToDatabase();
      const hasStock = await Item.exists({
        stockByWarehouse: { $elemMatch: { warehouseId: id, qty: { $gt: 0 } } },
      });
      if (hasStock) {
        return NextResponse.json(
          {
            success: false,
            error: "This warehouse still has stock recorded against it. Move or clear its stock first, or mark it inactive instead of deleting it.",
          },
          { status: 400 }
        );
      }

      const deleted = await deleteById("warehouses", Warehouse, "warehouses", id);
      if (!deleted) return NextResponse.json({ success: false, error: "Warehouse not found" }, { status: 404 });
      return NextResponse.json({ success: true, message: "Warehouse deleted successfully" });
    },
    fail(500)
  );
}

// ---------------------------------------------------------------------------
// Product catalog references (app/api/product-reference/route.ts POST)
// ---------------------------------------------------------------------------

/**
 * The stock reference sheet import: every row upserted by vpCode (`bulkWrite` of `updateOne { $set }, upsert`),
 * in sheet order, so a VP code listed twice is inserted once and then updated, as MongoDB does. All rows go in ONE
 * D1 batch (all or nothing, where MongoDB could stop half-way).
 */
export async function importProductReferences(req: Request, mode: Mode) {
  try {
    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    }
    if (!["admin", "superadmin", "manager"].includes(actor.role)) {
      return NextResponse.json(
        { success: false, error: "Only an admin or manager can import a stock reference sheet." },
        { status: 403 }
      );
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return d1Op(
    mode,
    async () => {
      const body = await req.json();
      const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
      const groupToCategory: Record<string, string> = body.groupToCategory || {};

      if (rows.length === 0) {
        return NextResponse.json({ success: false, error: "No rows to import." }, { status: 400 });
      }

      // The same operations the MongoDB path builds.
      const operations = rows
        .filter((r) => r.vpCode)
        .map((r) => ({
          vpCode: String(r.vpCode).trim().toUpperCase(),
          set: {
            description: r.description || "",
            brand: r.brand || "",
            groupName: r.groupName || "",
            category: (r.groupName && groupToCategory[r.groupName]) || "",
            productDesc: r.productDesc || "",
            charDesc: r.charDesc || "",
          },
        }));

      const db = writeDb();
      const now = new Date();
      const codes = Array.from(new Set(operations.map((o) => o.vpCode)));
      const existing = codes.length
        ? await loadStored(db, "product_catalog_references", "vpCode IN (SELECT value FROM json_each(?))", [JSON.stringify(codes)])
        : [];
      // updateOne updates the FIRST matching document (natural order ~ id order for these).
      const byCode = new Map<string, { doc: any; read: StoredRow | null }>();
      for (const row of existing) if (!byCode.has(row.doc.vpCode)) byCode.set(row.doc.vpCode, { doc: row.doc, read: row });

      let matched = 0;
      let upserted = 0;
      const inserted: string[] = [];
      for (const op of operations) {
        const hit = byCode.get(op.vpCode);
        if (hit) {
          matched++;
          hit.doc = applyPlainUpdate(ProductCatalogReference, hit.doc, op.set, { now }).stored;
        } else {
          upserted++;
          // An upsert inserts the filter's vpCode plus the $set fields; mongoose adds createdAt / updatedAt and
          // __v: 0 on insert ($setOnInsert), exactly what a new document gets.
          const doc = storedForm(newDocument(ProductCatalogReference, { vpCode: op.vpCode, ...op.set }, now));
          byCode.set(op.vpCode, { doc, read: null });
          inserted.push(op.vpCode);
        }
      }

      const read = Array.from(byCode.values()).filter((e) => e.read).map((e) => ({ id: e.read!.id, updatedAt: e.read!.updatedAt }));
      const guards = [];
      if (inserted.length) guards.push(guardNone(db, "productCatalogReferences", "vpCode IN (SELECT value FROM json_each(?))", [JSON.stringify(inserted)]));
      if (read.length) guards.push(guardAllUnchanged(db, "productCatalogReferences", read));
      await commitWrite(db, { guards, upserts: Array.from(byCode.values()).map((e) => ({ collection: "product_catalog_references", doc: e.doc })) }, now);

      return NextResponse.json({
        success: true,
        data: {
          matched,
          upserted,
          total: operations.length,
        },
      });
    },
    fail(500)
  );
}
