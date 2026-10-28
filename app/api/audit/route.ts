import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import AuditLog from "@/models/AuditLog";
import DeletedInvoice from "@/models/DeletedInvoice";
import DeletedPurchaseEntry from "@/models/DeletedPurchaseEntry";
import { requirePermission } from "@/lib/requirePermission";

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
    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const q = (searchParams.get("q") || "").trim();
    const view = searchParams.get("view");
    const limit = Math.min(Number(searchParams.get("limit")) || 200, 1000);

    const range: any = {};
    if (from) range.$gte = new Date(`${from}T00:00:00`);
    if (to) range.$lte = new Date(`${to}T23:59:59.999`);

    if (view === "deleted-invoices") {
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
      const filter: any = {};
      if (from || to) filter.deletedAt = range;
      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        filter.$or = [{ billNo: rx }, { supplierName: rx }, { deletedBy: rx }];
      }
      const rows = await DeletedPurchaseEntry.find(filter).sort({ deletedAt: -1 }).limit(limit).lean();
      const totalAmount = rows.reduce((sum, r: any) => sum + (Number(r.total) || 0), 0);
      return NextResponse.json({
        success: true,
        data: { rows, count: rows.length, totalAmount },
      });
    }

    const filter: any = {};
    if (action) filter.action = action;
    if (from || to) filter.createdAt = range;
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ entityRef: rx }, { partyName: rx }, { performedBy: rx }, { reason: rx }];
    }

    const rows = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    const totalAmount = rows.reduce((sum, r: any) => sum + (Number(r.amount) || 0), 0);

    return NextResponse.json({
      success: true,
      data: { rows, count: rows.length, totalAmount },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
