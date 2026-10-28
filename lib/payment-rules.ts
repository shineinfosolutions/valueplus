/**
 * Payment rules the screen also needs (no database code here, so it can be imported
 * in the browser). Kept apart from lib/payment-change.ts, which talks to the database.
 */

/** Payments made together with a bill (its own initial payment / refund) belong to that bill. */
export function isBillBoundPayment(p: any): boolean {
  const tid = String(p?.transactionId || "");
  const notes = String(p?.notes || "");
  return (
    tid.startsWith("TXN-PE-") ||
    /^Initial payment for/i.test(notes) ||
    /^Paid at purchase entry/i.test(notes) ||
    /^Refund for Credit Note/i.test(notes) ||
    /^Legacy initial payment/i.test(notes)
  );
}
