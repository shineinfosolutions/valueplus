/**
 * Notes counted at the daily cash audit. The audit total is always built from
 * these counts (plus loose coins) — it is never typed in directly — so the form,
 * the API and the audit history all read the same list.
 */
export const CASH_NOTE_VALUES = [500, 200, 100, 50, 20, 10] as const;

export interface CashDenomination {
  value: number;
  count: number;
}

/** Rupee total of a note breakup plus loose coins. */
export function denominationTotal(denominations: CashDenomination[] | undefined, coinsAmount = 0): number {
  const notes = (denominations || []).reduce(
    (sum, d) => sum + (Number(d.value) || 0) * (Number(d.count) || 0),
    0
  );
  return notes + (Number(coinsAmount) || 0);
}

/** "500 x 10, 200 x 3, coins ₹45" — skips notes that were not present. */
export function describeDenominations(denominations: CashDenomination[] | undefined, coinsAmount = 0): string {
  const parts = (denominations || [])
    .filter((d) => (Number(d.count) || 0) > 0)
    .sort((a, b) => b.value - a.value)
    .map((d) => `${d.value} x ${d.count}`);
  if ((Number(coinsAmount) || 0) > 0) parts.push(`coins ₹${Number(coinsAmount).toLocaleString("en-IN")}`);
  return parts.join(", ");
}
