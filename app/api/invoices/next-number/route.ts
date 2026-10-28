import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";
import Estimate from "@/models/Estimate";
import DeletedInvoice from "@/models/DeletedInvoice";
import { BILLING_ENTITIES, entityOf } from "@/lib/billing-entity";

/**
 * Allocates the next document number from what is actually stored.
 *
 * The billing modal used to build this client-side as
 *   `SVAK2026RI` + (cached invoice list length + 602)
 * which produced a number that already existed: the list endpoint hides
 * sales-orders, the offset was a magic constant, and any deleted or failed bill
 * shifted the count. The POST route then matched the existing invoice number and
 * returned that OLD invoice as a "success", so the counter printed a bill that
 * was never saved. Numbering therefore has to come from the database maximum.
 */

const PREFIXES = {
  "tax-invoice": { prefix: "SVAK2026RI", pad: 5 },
  "credit-note": { prefix: "CN-2026-", pad: 4 },
  "sales-order": { prefix: "SO-2026-", pad: 4 },
  estimate: { prefix: "EST-2026-", pad: 4 },
} as const;

/** Highest numeric suffix currently in use for a given prefix. */
function highestSuffix(numbers: string[], prefix: string): number {
  let max = 0;
  for (const raw of numbers) {
    if (!raw || !raw.startsWith(prefix)) continue;
    // Take the digits straight after the prefix, ignoring any -random suffix.
    const rest = raw.slice(prefix.length);
    const digits = (rest.match(/^\d+/) || [])[0];
    if (!digits) continue;
    const n = parseInt(digits, 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") || "tax-invoice") as keyof typeof PREFIXES;
    // Tax invoices are numbered separately for Value Plus and Ashoka Enterprises;
    // estimates, orders and credit notes share one series.
    const entity = BILLING_ENTITIES[entityOf(searchParams.get("entity"))];
    const cfg =
      type === "tax-invoice" || !PREFIXES[type]
        ? { prefix: entity.invoicePrefix, pad: entity.invoicePad }
        : PREFIXES[type];

    await connectToDatabase();

    let existing: string[] = [];
    if (type === "estimate") {
      const [ests, protos] = await Promise.all([
        Estimate.find({}, { estimateNumber: 1 }).lean(),
        Invoice.find({ type: "proforma" }, { invoiceNumber: 1 }).lean(),
      ]);
      existing = [
        ...ests.map((e: any) => e.estimateNumber || ""),
        ...protos.map((i: any) => i.invoiceNumber || ""),
      ];
    } else {
      // Scan every invoice, not just the visible list — a hidden sales-order or a
      // credit note still occupies its number. Deleted invoices count too: their
      // number was already issued and printed, and a GST audit that finds the same
      // number on two different bills is a far worse problem than a gap in the
      // sequence.
      const [all, deleted] = await Promise.all([
        Invoice.find({}, { invoiceNumber: 1 }).lean(),
        DeletedInvoice.find({}, { invoiceNumber: 1 }).lean(),
      ]);
      existing = [
        ...all.map((i: any) => i.invoiceNumber || ""),
        ...deleted.map((i: any) => i.invoiceNumber || ""),
      ];
    }

    const next = highestSuffix(existing, cfg.prefix) + 1;
    const padded = String(next).padStart(cfg.pad, "0");
    // Estimates/orders/credit notes keep their trailing random group for readability.
    const suffix = type === "tax-invoice" ? "" : `-${Math.floor(1000 + Math.random() * 9000)}`;
    const number = `${cfg.prefix}${padded}${suffix}`;

    return NextResponse.json({ success: true, number, next, type, entity: entity.key });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
