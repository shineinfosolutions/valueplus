import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";
import { getActor } from "@/lib/requirePermission";
import { checkSerialOnBill } from "@/lib/delivery-serial";

export const dynamic = "force-dynamic";

const ROLES = ["driver", "courier", "delivery", "warehouse", "admin", "superadmin", "manager", "cashier"];

/**
 * The first step of a delivery: the delivery boy scans the serial-number barcode and it is checked against the
 * bill at once, before any photo is taken. Nothing is saved here (the photos upload does that).
 * POST { invoiceNumber, serial } -> { matched, billHasSerials }, or an error when the serial is not on the bill.
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only delivery staff can check a delivery serial number." }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const invoiceNumber = String(body.invoiceNumber || "").trim();
    const serial = String(body.serial || "").trim();
    if (!invoiceNumber || !serial) {
      return NextResponse.json({ success: false, error: "The bill and the scanned serial number are needed." }, { status: 400 });
    }
    await connectToDatabase();
    const invoice: any = await Invoice.findOne({ invoiceNumber }).select("items.serialNumber items.itemName").lean();
    if (!invoice) return NextResponse.json({ success: false, error: "Bill not found." }, { status: 404 });

    const result = checkSerialOnBill(serial, invoice.items);
    if (result.billHasSerials && !result.matched) {
      return NextResponse.json(
        { success: false, error: `The scanned serial number (${serial}) is not on bill ${invoiceNumber}. Scan the product that was sold on this bill.` },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
