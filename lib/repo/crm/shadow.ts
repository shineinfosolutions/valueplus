/**
 * The one way a route or helper runs a CRM / documents / accounting read: through the `crm` read switch (feature flag
 * `read:crm`, lib/d1/read-source.ts), i.e.
 *
 *   readWithShadow("crm", name, () => CRM_READS[name].mongo(args), (db) => CRM_READS[name].d1(args, db),
 *                  { compare: CRM_COMPARE[name] })
 *
 * Every CRM mongo function connects to MongoDB itself (lib/repo/crm/*.ts), so in `d1` mode this read needs no
 * MongoDB connection. Callers must not change the returned value in place: in shadow mode it is compared after the
 * response is sent.
 */
import { readWithShadow } from "@/lib/d1/shadow";
import { CRM_READS } from "./index";
import { CRM_COMPARE } from "./compare";

export function crmRead<T = any>(name: string, args: any = {}): Promise<T> {
  const entry = CRM_READS[name];
  if (!entry) throw new Error(`unknown crm read ${name}`);
  return readWithShadow<T>("crm", name, () => entry.mongo(args), (db) => entry.d1(args, db), { compare: CRM_COMPARE[name] });
}
