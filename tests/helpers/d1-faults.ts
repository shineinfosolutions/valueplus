/**
 * A real (local) D1 with faults added on purpose: statements whose SQL matches `fail` throw, statements whose SQL
 * matches `slow` wait `delayMs` first. Used to show that D1 trouble never reaches the user's response.
 */
import type { D1DatabaseLike, D1PreparedStatementLike } from "@/lib/d1/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type W = D1PreparedStatementLike & { inner: D1PreparedStatementLike; sql: string };

export interface Faults {
  fail?: (sql: string) => boolean;
  slow?: (sql: string) => boolean;
  delayMs?: number;
}

export function faulty(real: D1DatabaseLike, faults: Faults): D1DatabaseLike {
  const gate = async (sql: string) => {
    if (faults.slow?.(sql) && faults.delayMs) await sleep(faults.delayMs);
    if (faults.fail?.(sql)) throw new Error("D1_ERROR: simulated failure");
  };
  const wrap = (inner: D1PreparedStatementLike, sql: string): W => ({
    inner,
    sql,
    bind: (...v: unknown[]) => wrap(inner.bind(...v), sql),
    run: async () => {
      await gate(sql);
      return inner.run();
    },
    all: async <T,>() => {
      await gate(sql);
      return inner.all<T>();
    },
    first: async <T,>() => {
      await gate(sql);
      return inner.first<T>();
    },
  });
  return {
    prepare: (sql: string) => wrap(real.prepare(sql), sql),
    batch: async (stmts: D1PreparedStatementLike[]) => {
      const ws = stmts as W[];
      for (const s of ws) await gate(s.sql);
      return real.batch(ws.map((s) => s.inner));
    },
  };
}

export const brokenD1: D1DatabaseLike = {
  prepare: () => {
    throw new Error("D1 is down");
  },
  batch: async () => {
    throw new Error("D1 is down");
  },
};
