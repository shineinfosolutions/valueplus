/**
 * The SQL that makes D1 match Mongo documents: one upsert per parent row plus a replace of its child rows, or a
 * delete of the parent and its children. Shared by the copy job (lib/d1/sync.ts) and the write-through
 * (lib/d1/write-through.ts), so both write exactly the same rows.
 *
 * D1 limits respected: at most 100 bound parameters per statement (one parent row per statement; child rows and id
 * lists in chunks that stay under 100), Dates as ISO text, no undefined.
 */
import type { D1DatabaseLike, D1PreparedStatementLike } from "./types";
import { MasterSpec, MappedDoc, tableColumns } from "./masters-map";

/** D1 allows 100 bound parameters per statement. */
export const MAX_PARAMS = 100;

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export interface UpsertOptions {
  /**
   * Write-through only. Never replace a row with an OLDER snapshot: the parent row is only updated when the
   * snapshot's updatedAt is the same or newer than the one D1 already holds, and the child rows are only replaced
   * when the parent row now holds this snapshot (same docHash). So a write-through batch that lands late (two
   * requests finishing out of order, or a batch that was given up on by the timeout but still ran) cannot take a
   * row back in time. The copy job does not use this: it must be able to repair any row, whatever its updatedAt.
   */
  guarded?: boolean;
}

const upsertSqlCache = new Map<string, string>();

function upsertSql(spec: MasterSpec, guarded: boolean): string {
  const key = `${spec.table}:${guarded ? "g" : "u"}`;
  let sql = upsertSqlCache.get(key);
  if (!sql) {
    const cols = tableColumns(spec);
    const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    sql = `INSERT INTO ${spec.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ON CONFLICT(id) DO UPDATE SET ${updates.join(", ")}`;
    // updatedAt is ISO-8601 UTC text everywhere (mapDocWithoutHash makes sure), so text order is time order.
    if (guarded) sql += ` WHERE excluded.updatedAt >= ${spec.table}.updatedAt OR ${spec.table}.updatedAt IS NULL`;
    upsertSqlCache.set(key, sql);
  }
  return sql;
}

/** The statements that make D1 match one document: upsert the parent, then replace its child rows. */
export function statementsFor(db: D1DatabaseLike, spec: MasterSpec, m: MappedDoc, opts: UpsertOptions = {}): D1PreparedStatementLike[] {
  const guarded = !!opts.guarded;
  const cols = tableColumns(spec);
  const stmts = [db.prepare(upsertSql(spec, guarded)).bind(...cols.map((c) => (m.row[c] === undefined ? null : m.row[c])))];
  // Guarded: touch the children only if the parent row now holds this very snapshot.
  const holdsThis = `EXISTS (SELECT 1 FROM ${spec.table} WHERE id = ? AND docHash = ?)`;
  const guardArgs = guarded ? [m.id, m.row.docHash] : [];
  for (const child of m.children) {
    stmts.push(
      guarded
        ? db.prepare(`DELETE FROM ${child.table} WHERE ${child.parentCol} = ? AND ${holdsThis}`).bind(m.id, ...guardArgs)
        : db.prepare(`DELETE FROM ${child.table} WHERE ${child.parentCol} = ?`).bind(m.id)
    );
    const perStmt = Math.max(1, Math.floor((MAX_PARAMS - guardArgs.length) / child.columns.length));
    for (const rows of chunk(child.rows, perStmt)) {
      const values = rows.map(() => `(${child.columns.map(() => "?").join(", ")})`).join(", ");
      stmts.push(
        guarded
          ? db
              .prepare(`INSERT INTO ${child.table} (${child.columns.join(", ")}) SELECT * FROM (VALUES ${values}) WHERE ${holdsThis}`)
              .bind(...rows.flat(), ...guardArgs)
          : db.prepare(`INSERT INTO ${child.table} (${child.columns.join(", ")}) VALUES ${values}`).bind(...rows.flat())
      );
    }
  }
  return stmts;
}

/** Statements that delete rows (and their child rows) by id, ≤ 100 ids per statement. */
export function deleteStatements(db: D1DatabaseLike, spec: MasterSpec, ids: string[]): D1PreparedStatementLike[] {
  const stmts: D1PreparedStatementLike[] = [];
  for (const part of chunk(ids, MAX_PARAMS)) {
    const marks = part.map(() => "?").join(", ");
    // Children first and explicitly, so the delete does not depend on foreign-key enforcement being on.
    for (const child of spec.children || []) {
      stmts.push(db.prepare(`DELETE FROM ${child.table} WHERE ${child.parentCol} IN (${marks})`).bind(...part));
    }
    stmts.push(db.prepare(`DELETE FROM ${spec.table} WHERE id IN (${marks})`).bind(...part));
  }
  return stmts;
}

/** Statements reading id + docHash of the given rows (≤ 100 ids each); run them inside a batch to save a round trip. */
export function hashStatements(db: D1DatabaseLike, table: string, ids: string[]): D1PreparedStatementLike[] {
  return chunk(ids, MAX_PARAMS).map((part) => db.prepare(`SELECT id, docHash FROM ${table} WHERE id IN (${part.map(() => "?").join(", ")})`).bind(...part));
}

export async function existingHashes(db: D1DatabaseLike, table: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const stmt of hashStatements(db, table, ids)) {
    const res = await stmt.all<{ id: string; docHash: string }>();
    for (const r of res.results || []) out.set(String(r.id), String(r.docHash));
  }
  return out;
}
