import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Vendor from "@/models/Vendor";
import VendorBill from "@/models/VendorBill";
import VendorPayment from "@/models/VendorPayment";
import { requirePermission } from "@/lib/requirePermission";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Next free VEN-#### code, derived from the highest one in use. */
async function nextVendorCode(): Promise<string> {
  const vendors = await Vendor.find({}, { code: 1 }).lean();
  let max = 0;
  for (const v of vendors as any[]) {
    const digits = String(v.code || "").match(/(\d+)\s*$/);
    if (digits) {
      const n = parseInt(digits[1], 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return `VEN-${String(max + 1).padStart(4, "0")}`;
}

export async function GET(req: Request) {
  const gate = await requirePermission("ledger.vendor.view");
  if (!gate.ok) return gate.response;

  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const filter: any = {};
    if (status && status !== "all") filter.status = status;

    const vendors = await Vendor.find(filter).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: vendors });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requirePermission("vendor.manage");
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    await connectToDatabase();

    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();

    if (!name) {
      return NextResponse.json({ success: false, error: "Vendor name is required" }, { status: 400 });
    }
    if (phone.replace(/\D/g, "").length !== 10) {
      return NextResponse.json({ success: false, error: "A valid 10-digit phone number is required" }, { status: 400 });
    }

    const duplicate = await Vendor.findOne({
      $or: [{ phone }, { name: { $regex: new RegExp(`^${escapeRegex(name)}$`, "i") } }],
    });
    if (duplicate) {
      return NextResponse.json(
        { success: false, error: `Vendor "${duplicate.name}" (${duplicate.code}) already exists with these details.` },
        { status: 400 }
      );
    }

    const vendor = await Vendor.create({
      code: String(body.code || "").trim() || (await nextVendorCode()),
      name,
      contactPerson: body.contactPerson || "",
      email: body.email || "",
      phone,
      altPhone: body.altPhone || "",
      gstNumber: body.gstNumber || "",
      panNumber: body.panNumber || "",
      address: {
        line1: body.address?.line1 || "",
        line2: body.address?.line2 || "",
        city: body.address?.city || "",
        state: body.address?.state || "Uttar Pradesh",
        pincode: body.address?.pincode || "",
        country: body.address?.country || "India",
      },
      creditLimit: Number(body.creditLimit) || 100000,
      creditDays: Number(body.creditDays) || 30,
      openingBalance: Number(body.openingBalance) || 0,
      openingBalanceDate: body.openingBalanceDate || "",
      bankDetails: body.bankDetails || {},
      notes: body.notes || "",
      status: body.status || "active",
    });

    return NextResponse.json({ success: true, data: vendor });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: "A vendor with this code already exists" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  const gate = await requirePermission("vendor.manage");
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    await connectToDatabase();

    const id = body._id || body.id;
    if (!id && !body.code) {
      return NextResponse.json({ success: false, error: "Vendor id or code is required" }, { status: 400 });
    }

    // The code identifies the vendor across its bills and payments, so it is never
    // rewritten by an edit.
    const { _id, id: _ignored, code, createdAt, updatedAt, ...updatable } = body;

    const updated = id
      ? await Vendor.findByIdAndUpdate(id, updatable, { new: true })
      : await Vendor.findOneAndUpdate({ code: body.code }, updatable, { new: true });

    if (!updated) {
      return NextResponse.json({ success: false, error: "Vendor not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requirePermission("vendor.manage");
  if (!gate.ok) return gate.response;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, error: "Vendor id is required" }, { status: 400 });
    }

    await connectToDatabase();

    // A vendor with ledger history is deactivated rather than removed — deleting it
    // would orphan bills and payments that still have to reconcile.
    const [billCount, paymentCount] = await Promise.all([
      VendorBill.countDocuments({ vendorId: id }),
      VendorPayment.countDocuments({ vendorId: id }),
    ]);

    if (billCount > 0 || paymentCount > 0) {
      const deactivated = await Vendor.findByIdAndUpdate(id, { status: "inactive" }, { new: true });
      if (!deactivated) {
        return NextResponse.json({ success: false, error: "Vendor not found" }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        deactivated: true,
        message: `This vendor has ${billCount} bill(s) and ${paymentCount} payment(s) on record, so it was marked inactive instead of deleted. Its ledger stays intact.`,
        data: deactivated,
      });
    }

    const removed = await Vendor.findByIdAndDelete(id);
    if (!removed) {
      return NextResponse.json({ success: false, error: "Vendor not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Vendor deleted" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
