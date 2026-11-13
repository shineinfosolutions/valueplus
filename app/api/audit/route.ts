import { istDayStart, istDayEnd } from "@/lib/ist";
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import DeletedInvoice from "@/models/DeletedInvoice";
import { requirePermission } from "@/lib/requirePermission";
import { readStock } from "@/lib/repo/stock/shadow-read";
import { readStaff } from "@/lib/repo/staff/shadow-read";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The void & authorisation trail.
 *
 *   ?action=invoice.delete       filter to one action
 *   &from=&to=                   date range on when it happened
 *   &q=                          match an invoice number, party or person
 *   &view=deleted-invoices       read the invoice archive instead of the log
 *   &view=deleted-purchase-entries  read the purchase bill archive
 */
export async function GET(req: Request) {
  const gate = await requirePermission("audit.view");
  if (!gate.ok) return gate.response;

  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const q = (searchParams.get("q") || "").trim();
    const view = searchParams.get("view");
    const limit = Math.min(Number(searchParams.get("limit")) || 200, 1000);

    const range: any = {};
    // India days: with no zone these were read in the server's own zone (UTC) and missed 00:00–05:30 IST of the start day.
    if (from) range.$gte = istDayStart(from);
    if (to) range.$lte = istDayEnd(to);

    if (view === "deleted-invoices") {
      // The invoice archive is the sales area's: still MongoDB here.
      await connectToDatabase();
      const filter: any = {};
      if (from || to) filter.deletedAt = range;
      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        filter.$or = [{ invoiceNumber: rx }, { customerName: rx }, { deletedBy: rx }];
      }
      const rows = await DeletedInvoice.find(filter).sort({ deletedAt: -1 }).limit(limit).lean();
      const totalAmount = rows.reduce((sum, r: any) => sum + (Number(r.total) || 0), 0);
      return NextResponse.json({
        success: true,
        data: { rows, count: rows.length, totalAmount },
      });
    }

    if (view === "deleted-purchase-entries") {
      // Through the read:stock switch (lib/repo/stock/shadow-read.ts). Same filter as before: deletedAt within the
      // India days from..to, q matching the bill number, supplier or who deleted it; newest first, `limit` rows.
      const rows: any[] = await readStock("deletedPurchaseEntries.audit", { from, to, q, limit });
      const totalAmount = rows.reduce((sum, r: any) => sum + (Number(r.total) || 0), 0);
      return NextResponse.json({
        success: true,
        data: { rows, count: rows.length, totalAmount },
      });
    }

    // The log itself, through the read:staff switch (lib/repo/staff/shadow-read.ts). audit.list builds the same filter
    // as this route did: action, createdAt within the India days from..to, exact `refs` (a bill's own history: the
    // bill number and "invoice:<number>", comma separated, at most 10), q matching the reference, party, person or
    // reason; newest first, `limit` rows (default 200, at most 1000).
    const rows: any[] = await readStaff("audit.list", { action, from, to, refs: searchParams.get("refs"), q, limit: searchParams.get("limit") });
    const totalAmount = rows.reduce((sum, r: any) => sum + (Number(r.amount) || 0), 0);

    return NextResponse.json({
      success: true,
      data: { rows, count: rows.length, totalAmount },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
