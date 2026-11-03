import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";
import Item from "@/models/Item";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";

export const dynamic = "force-dynamic";

/**
 * Bills used to be saved with 0% GST on some lines: a customer with a GSTIN (the bill form zeroed it), or a product whose
 * GST was 0 in the Item Master. The amount the customer paid was right, but the GST breakup was missing, so GSTR-1
 * and Profit & Loss (sales before GST) were off. This finds every such bill
 * and gives each line its product's own GST rate, splitting the same GST-inclusive amount into taxable value + tax.
 * The invoice total, balance and payments do not change.
 *
 * GET  -> the bills that would be fixed (nothing is changed).
 * POST { invoiceNumbers?: string[] } -> fixes them (all found bills when no list is sent). Admin only.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

async function plan(onlyNumbers?: string[]) {
  // Every customer bill (a GSTIN or not) saved with a 0% line; credit notes, estimates and sales orders are left alone.
  const query: any = { type: { $nin: ["proforma", "sales-order", "credit-note"] }, status: { $ne: "cancelled" } };
  if (onlyNumbers?.length) query.invoiceNumber = { $in: onlyNumbers };
  const invoices: any[] = await Invoice.find(query);
  const catalogCache = new Map<string, any>();
  const lookup = async (line: any) => {
    const keys: [string, any][] = [];
    if (line.itemId && mongoose.isValidObjectId(String(line.itemId))) keys.push(["id", String(line.itemId)]);
    if (line.vpCode) keys.push(["vp", String(line.vpCode)]);
    if (line.itemName) keys.push(["name", String(line.itemName)]);
    for (const [kind, value] of keys) {
      const ck = `${kind}:${value}`;
      if (!catalogCache.has(ck)) {
        const found: any =
          kind === "id" ? await Item.findById(value).select("gstRate").lean().catch(() => null)
          : kind === "vp" ? await Item.findOne({ vpCode: value }).select("gstRate").lean()
          : await Item.findOne({ name: value }).select("gstRate").lean();
        catalogCache.set(ck, found);
      }
      const hit = catalogCache.get(ck);
      if (hit && Number.isFinite(Number(hit.gstRate))) return Number(hit.gstRate);
    }
    return null;
  };

  const out: any[] = [];
  for (const inv of invoices) {
    const intra = String(inv.placeOfSupply || "").includes("09") || /uttar pradesh/i.test(String(inv.placeOfSupply || ""));
    const lines: any[] = [];
    let addGst = 0;
    let unresolved = 0;
    for (const line of inv.items || []) {
      if (Number(line.gstRate) > 0) continue;
      const rate = await lookup(line);
      if (rate === null) { unresolved++; continue; }
      if (rate <= 0) continue;
      const gross = Number(line.taxableAmount) || 0;
      const taxable = r2(gross / (1 + rate / 100));
      const gst = r2(gross - taxable);
      lines.push({ line, rate, taxable, gst });
      addGst += gst;
    }
    if (lines.length === 0) continue;
    out.push({ inv, lines, addGst: r2(addGst), intra, unresolved });
  }
  return out;
}

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!["admin", "superadmin"].includes(actor.role)) return NextResponse.json({ success: false, error: "Only the Admin can do this." }, { status: 403 });
    await connectToDatabase();
    const found = await plan();
    return NextResponse.json({
      success: true,
      data: {
        count: found.length,
        totalGstToAdd: r2(found.reduce((t, f) => t + f.addGst, 0)),
        invoices: found.map((f) => ({
          invoiceNumber: f.inv.invoiceNumber,
          date: f.inv.date,
          customer: f.inv.customerName,
          gstin: f.inv.customerGST || "",
          total: f.inv.total,
          gstToAdd: f.addGst,
          lines: f.lines.length,
          linesWithoutCatalogRate: f.unresolved,
        })),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!["admin", "superadmin"].includes(actor.role)) return NextResponse.json({ success: false, error: "Only the Admin can do this." }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const only: string[] | undefined = Array.isArray(body.invoiceNumbers) && body.invoiceNumbers.length > 0 ? body.invoiceNumbers.map(String) : undefined;
    await connectToDatabase();
    const found = await plan(only);
    const fixed: string[] = [];
    for (const f of found) {
      const inv = f.inv;
      const before = { taxableAmount: inv.taxableAmount, totalGST: inv.totalGST, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst, total: inv.total };
      let dTaxable = 0;
      for (const { line, rate, taxable, gst } of f.lines) {
        dTaxable += (Number(line.taxableAmount) || 0) - taxable;
        line.gstRate = rate;
        line.taxableAmount = taxable;
        line.cgst = f.intra ? r2(gst / 2) : 0;
        line.sgst = f.intra ? r2(gst / 2) : 0;
        line.igst = f.intra ? 0 : gst;
      }
      inv.taxableAmount = r2((Number(inv.taxableAmount) || 0) - dTaxable);
      inv.totalGST = r2((Number(inv.totalGST) || 0) + f.addGst);
      if (f.intra) {
        inv.cgst = r2((Number(inv.cgst) || 0) + f.addGst / 2);
        inv.sgst = r2((Number(inv.sgst) || 0) + f.addGst / 2);
      } else {
        inv.igst = r2((Number(inv.igst) || 0) + f.addGst);
      }
      inv.markModified("items");
      await inv.save();
      fixed.push(inv.invoiceNumber);
      try {
        await AuditLog.create({
          action: "invoice.gst-breakup-fix",
          entityType: "Invoice",
          entityRef: inv.invoiceNumber,
          entityId: String(inv._id),
          partyName: inv.customerName,
          amount: f.addGst,
          reason: "GSTIN bill saved at 0% GST: line GST rates restored from the product master (total unchanged)",
          performedBy: actor.name,
          performedByUserId: actor.id,
          performedByRole: actor.role,
          metadata: { before, after: { taxableAmount: inv.taxableAmount, totalGST: inv.totalGST, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst, total: inv.total } },
        });
      } catch (e) {
        console.warn("Notice: audit log for gst fix:", e);
      }
    }
    return NextResponse.json({ success: true, data: { fixed: fixed.length, invoiceNumbers: fixed }, message: `${fixed.length} bill(s) fixed.` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
