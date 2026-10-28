/**
 * Paid / balance / status of a purchase bill, worked out one way everywhere.
 *
 * Bill totals come from GST maths and carry stray fractions of a paisa
 * (318501.1514); paying the printed ₹3,18,501.15 then left a balance of
 * ₹0.0014 and the bill read "partial" forever. Amounts are rounded to paise and
 * a balance under one paisa counts as settled.
 */

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type PurchasePaymentStatus = "paid" | "partial" | "pending";

export function purchasePaymentState(total: number, paid: number): {
  total: number;
  paid: number;
  balance: number;
  status: PurchasePaymentStatus;
} {
  const t = round2(total);
  const p = Math.min(round2(paid), t);
  let balance = round2(t - p);
  if (balance < 0.01) balance = 0;
  const status: PurchasePaymentStatus = p <= 0 && t > 0 ? "pending" : balance === 0 ? "paid" : p > 0 ? "partial" : "pending";
  return { total: t, paid: balance === 0 ? t : p, balance, status };
}
