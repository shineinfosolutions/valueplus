import type { D1DatabaseLike } from "@/lib/d1/types";

/**
 * One read of the area: `mongo` runs the query exactly as the route / helper runs it today, `d1` returns the same
 * documents from D1. Both take the same `args`; `d1` also takes the database (default: the Worker's DB binding).
 */
export interface StockRead<A = any> {
  mongo: (args: A) => Promise<any>;
  d1: (args: A, db?: D1DatabaseLike | null) => Promise<any>;
  /**
   * Stage C: even with `read:stock` = 'd1' this read answers from MongoDB (D1 is still compared after the response),
   * because its answer decides a write and a few seconds of D1 lag could make that write wrong. A function decides
   * per call from the read's arguments (e.g. only the "AVAILABLE serials" list offered for a sale).
   */
  mongoOnlyInD1?: boolean | ((args: A) => boolean);
}

/** Whether this call of a stock read must answer from MongoDB even in d1 mode. */
export function isMongoOnlyInD1<A>(r: { mongoOnlyInD1?: boolean | ((args: A) => boolean) }, args: A): boolean {
  const m = r.mongoOnlyInD1;
  if (typeof m === "function") {
    try {
      return !!m(args);
    } catch {
      return true; // cannot tell: the safe answer is MongoDB
    }
  }
  return !!m;
}

export const read = <A>(r: StockRead<A>): StockRead<A> => r;
