import mongoose from "mongoose";
import Item from "@/models/Item";
import { lineIncentive, rulesOf, todayIST, type IncentiveRule } from "@/lib/incentive-rules";

/**
 * Work out the salesman's product incentive on a bill being saved, on the server (the form's figure is never
 * trusted). Each line gets the rules it was billed under copied onto it (`incentiveRules`) and its own
 * `incentiveEarned`; the bill's `salesExecutiveIncentive` is their sum.
 *
 * On an edit, a product that was already on the bill keeps the rules it was first billed under, so changing a
 * product's scheme later never changes what an old bill paid. A new product on the bill takes today's catalog rules.
 */
export async function stampLineIncentives(
  lines: any[],
  previousLines: any[] = [],
  billDate?: string | Date
): Promise<{ items: any[]; total: number }> {
  if (!Array.isArray(lines) || lines.length === 0) return { items: lines, total: 0 };
  const onDate = billDate ? String(billDate instanceof Date ? billDate.toISOString() : billDate).slice(0, 10) : todayIST();

  const earlier = new Map<string, IncentiveRule[]>();
  for (const prev of previousLines || []) {
    if (prev?.itemId && !earlier.has(String(prev.itemId))) earlier.set(String(prev.itemId), rulesOf(prev));
  }

  const ids = lines.map((l) => l?.itemId).filter((id) => mongoose.isValidObjectId(id));
  const products: any[] = ids.length
    ? await Item.find(
        { _id: { $in: ids } },
        { incentives: 1, incentiveType: 1, incentiveValue: 1, incentiveAmount: 1, incentiveTargetAmount: 1 }
      ).lean()
    : [];
  const byId = new Map(products.map((p) => [String(p._id), p]));

  let total = 0;
  const items = lines.map((line) => {
    if (!line || typeof line !== "object") return line;
    const id = line.itemId ? String(line.itemId) : "";
    const rules = earlier.has(id) ? earlier.get(id)! : rulesOf(byId.get(id));
    const earned = lineIncentive(
      rules,
      {
        rate: Number(line.rate) || 0,
        discount: Number(line.discount) || 0,
        qty: Number(line.quantity ?? line.qty) || 1,
        gstRate: Number(line.gstRate) || 0,
        taxable: Number.isFinite(Number(line.taxableAmount)) ? Number(line.taxableAmount) : undefined,
      },
      onDate
    );
    total += earned;
    return { ...line, incentiveRules: rules, incentiveEarned: earned };
  });
  return { items, total: Math.round(total * 100) / 100 };
}
