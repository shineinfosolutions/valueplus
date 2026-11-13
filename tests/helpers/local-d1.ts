/**
 * A throw-away local D1 database for tests: wrangler's getPlatformProxy (Miniflare + workerd, both already in
 * node_modules with wrangler) started from a minimal config in a temp folder. No Cloudflare account, no network.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { D1DatabaseLike } from "@/lib/d1/types";

// Loaded with require so `tsc` does not need wrangler's types (it is a dev-only tool).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getPlatformProxy } = require("wrangler") as any;

export interface LocalD1 {
  db: D1DatabaseLike;
  dispose(): Promise<void>;
}

export async function startLocalD1(): Promise<LocalD1> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vp-d1-test-"));
  const configPath = path.join(dir, "wrangler.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "d1-test",
      compatibility_date: "2026-10-01",
      d1_databases: [{ binding: "DB", database_name: "test", database_id: "00000000-0000-0000-0000-000000000000" }],
    })
  );
  const proxy = await getPlatformProxy({ configPath, persist: { path: path.join(dir, "state") } });
  return {
    db: proxy.env.DB as D1DatabaseLike,
    async dispose() {
      await proxy.dispose();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // workerd may still hold the file on Windows for a moment; it is a temp folder anyway.
      }
    },
  };
}

/** The statements of a migration file: comments removed, split on ";" (the migrations hold no string with ";"). */
export function migrationStatements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Applies every d1/migrations/*.sql file in name order, as `wrangler d1 migrations apply` would. */
export async function applyMigrations(db: D1DatabaseLike): Promise<string[]> {
  const dir = path.join(process.cwd(), "d1", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    for (const stmt of migrationStatements(readFileSync(path.join(dir, f), "utf8"))) {
      await db.prepare(stmt).run();
    }
  }
  return files;
}
