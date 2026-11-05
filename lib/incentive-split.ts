import { ONSITEGO_INCENTIVE_RATE, isOnsitego } from "@/lib/onsitego";
import { normPerson } from "@/lib/lead-share";

/**
 * Who earns what on one bill.
 *
 * Normally the bill's Sales Executive earns all of it: the product incentive (salesExecutiveIncentive) and 10% of the
 * Onsitego plans (onsitegoIncentive). When a product line carries its own salesman (a lead shared with another
 * brand's salesman), each line's incentive and its Onsitego share go to that line's salesman instead, and the rest
 * stays with the bill's Sales Executive. Used by the server's incentive book and by the incentive screens.
 */
export interface IncentiveShare {
  name: string;
  product: number;
  onsitego: number;
  total: number;
  /** The bill amount (incl. GST) and pieces of the lines that are his. */
  amount: number;
  units: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Does any line go to someone other than the bill's Sales Executive? */
export function isSplitBill(bill: any): boolean {
  const exec = normPerson(bill?.salesExecutive);
  return (bill?.items || []).some((l: any) => l?.salesExecutive && normPerson(l.salesExecutive) !== exec);
}

export function incentiveShares(bill: any): IncentiveShare[] {
  const exec = String(bill?.salesExecutive || "").trim();
  const lines: any[] = Array.isArray(bill?.items) ? bill.items : [];
  if (!isSplitBill(bill)) {
    const product = Number(bill?.salesExecutiveIncentive) || 0;
    const onsitego = Number(bill?.onsitegoIncentive) || 0;
    return [
      {
        name: exec,
        product: r2(product),
        onsitego: r2(onsitego),
        total: r2(product + onsitego),
        amount: Number(bill?.total) || 0,
        units: lines.reduce((t, l) => t + (Number(l?.quantity) || 1), 0),
      },
    ];
  }
  const map = new Map<string, IncentiveShare>();
  for (const l of lines) {
    const name = String(l?.salesExecutive || exec).trim();
    const key = normPerson(name);
    const row = map.get(key) || { name, product: 0, onsitego: 0, total: 0, amount: 0, units: 0 };
    row.product += Number(l?.incentiveEarned) || 0;
    if (isOnsitego(l?.extendedWarrantyProvider)) row.onsitego += (Number(l?.extendedWarrantyAmount) || 0) * ONSITEGO_INCENTIVE_RATE;
    row.amount += (Number(l?.amount) || 0) + (Number(l?.extendedWarrantyAmount) || 0);
    row.units += Number(l?.quantity) || 1;
    map.set(key, row);
  }
  return [...map.values()].map((r) => ({ ...r, product: r2(r.product), onsitego: r2(r.onsitego), total: r2(r.product + r.onsitego), amount: r2(r.amount) }));
}

/** This person's share of a bill, or null when he has no part in it. */
export function shareOf(bill: any, name: string): IncentiveShare | null {
  const key = normPerson(name);
  return incentiveShares(bill).find((s) => normPerson(s.name) === key) || null;
}
