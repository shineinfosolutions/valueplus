import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Estimate from "@/models/Estimate";
import Lead from "@/models/Lead";
import DeletedInvoice from "@/models/DeletedInvoice";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { requirePinAndPermission } from "@/lib/securityPin";

export async function GET(req: Request) {
  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get("phone") || searchParams.get("customerPhone");
    const status = searchParams.get("status");

    const query: any = {};
    if (phone) {
      const clean = phone.replace(/\D/g, "");
      query.customerPhone = { $regex: clean, $options: "i" };
    }
    if (status) {
      query.status = status;
    }

    const estimates = await Estimate.find(query).sort({ createdAt: -1 });
    return NextResponse.json({ success: true, data: estimates });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();

    // Remembered here too so a company entered while quoting an estimate is
    // already in the dropdown by the time it's converted to an invoice.
    if (body.customerGST && body.customerCompanyName) {
      try {
        const BillingCompany = (await import("@/models/BillingCompany")).default;
        const { derivePanFromGstin } = await import("@/lib/gst");
        await BillingCompany.findOneAndUpdate(
          { gstin: String(body.customerGST).trim().toUpperCase() },
          {
            $set: { companyName: body.customerCompanyName, pan: derivePanFromGstin(body.customerGST) },
            $inc: { usageCount: 1 },
          },
          { upsert: true, setDefaultsOnInsert: true }
        );
      } catch (companyErr: any) {
        console.error("BillingCompany upsert failed, saving estimate anyway:", companyErr?.message);
      }
    }

    const estimate = await Estimate.create(body);

    // Auto-create / sync corresponding CRM Lead
    try {
      const cleanPhone = (estimate.customerPhone || "").replace(/\D/g, "");
      const itemsList = Array.isArray(estimate.items) ? estimate.items : [];
      const primaryProduct = itemsList.length > 0 
        ? itemsList.map((it: any) => it.name || it.itemName).join(", ") 
        : "Showroom Products";

      const leadCount = await Lead.countDocuments();
      const leadId = `LEAD-2026-${String(leadCount + 1).padStart(4, "0")}`;

      await Lead.create({
        leadId,
        customerName: estimate.customerName,
        mobile: cleanPhone || "9999999999",
        source: "Estimate Quotation",
        interestedProduct: primaryProduct,
        vpCode: itemsList[0]?.itemCode || "",
        assignedStaff: estimate.salesExecutive || estimate.salesperson || "Amit Singh",
        estimatedValue: Number(estimate.total) || 0,
        priority: "High",
        status: "Interested",
        estimateNumber: estimate.estimateNumber,
        estimateId: String(estimate._id),
        items: itemsList,
        notes: `Official Estimate generated: ${estimate.estimateNumber} for ₹${estimate.total}. Valid until ${estimate.expiryDate ? new Date(estimate.expiryDate).toLocaleDateString("en-IN") : "15 days"}.`,
        timeline: [
          {
            date: new Date(),
            action: `Estimate Created (${estimate.estimateNumber})`,
            notes: `Total quotation value: ₹${estimate.total}`,
            staff: estimate.salesExecutive || estimate.salesperson || "Sales Counter",
          },
        ],
      });
    } catch (leadErr) {
      console.error("Error auto-creating Lead from Estimate:", leadErr);
    }

    return NextResponse.json({ success: true, data: estimate });
  } catch (error: any) {
    if (error.code === 11000) {
       return NextResponse.json({ success: false, error: "Estimate number already exists" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    if (!body.estimateNumber) {
      return NextResponse.json({ success: false, error: "Estimate number is required for update" }, { status: 400 });
    }

    const updatedEstimate = await Estimate.findOneAndUpdate({ estimateNumber: body.estimateNumber }, body, { new: true });
    
    if (!updatedEstimate) {
      return NextResponse.json({ success: false, error: "Estimate not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Estimate updated successfully", data: updatedEstimate });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const estimateNumber = searchParams.get("estimateNumber");

    if (!estimateNumber) {
      return NextResponse.json({ success: false, error: "Estimate number is required" }, { status: 400 });
    }

    // An estimate is a quotation rather than a bill, but deleting one still makes
    // a document the customer may have been shown disappear without trace. It goes
    // through the same PIN, reason and archive as an invoice so the void audit
    // covers every sales document, not just the ones that were billed.
    let payload: any = {};
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }
    const pin = payload.pin ?? searchParams.get("pin") ?? "";
    const reason = String(payload.reason ?? searchParams.get("reason") ?? "").trim();

    const actor = await getActor();
    if (!actor) {
      return NextResponse.json(
        { success: false, error: "You must be signed in to do this." },
        { status: 401 }
      );
    }
    if (reason.length < 3) {
      return NextResponse.json(
        { success: false, error: "A reason is required and must say what happened." },
        { status: 400 }
      );
    }

    const check = await requirePinAndPermission(actor, "invoice.delete", pin);
    if (!check.ok) {
      return NextResponse.json(
        { success: false, error: check.error, pinFailed: true },
        { status: 403 }
      );
    }

    await connectToDatabase();

    const estimate = await Estimate.findOne({ estimateNumber });
    if (!estimate) {
      return NextResponse.json({ success: false, error: "Estimate not found" }, { status: 404 });
    }

    const snapshot = estimate.toObject();

    // Archived before the delete, so a failure here leaves the estimate intact
    // rather than removing it with no record.
    await DeletedInvoice.create({
      ...snapshot,
      _id: undefined,
      // Stored under the invoice-number field so the audit screens can list every
      // deleted document together; `docType` says which kind it was.
      invoiceNumber: estimate.estimateNumber,
      docType: "Estimate",
      customerName: estimate.customerName,
      total: Number(estimate.total) || 0,
      deletedAt: new Date(),
      deletedBy: actor.name,
      deletedByRole: actor.role,
      deletedByUserId: actor.id,
      deleteReason: reason,
      pinVerified: true,
      usedLegacyPin: Boolean(check.usedLegacyPin),
      snapshot,
    });

    await Estimate.findOneAndDelete({ estimateNumber });

    try {
      await AuditLog.create({
        action: "estimate.delete",
        entityType: "Estimate",
        entityRef: estimate.estimateNumber,
        entityId: String(estimate._id),
        partyName: estimate.customerName,
        amount: Number(estimate.total) || 0,
        reason,
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        pinVerified: true,
        usedLegacyPin: Boolean(check.usedLegacyPin),
        ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "",
        userAgent: req.headers.get("user-agent") || "",
        metadata: { status: estimate.status, date: (estimate as any).date },
      });
    } catch (logErr) {
      console.warn("Notice: audit log for estimate delete:", logErr);
    }

    return NextResponse.json({
      success: true,
      message: "Estimate deleted and archived to the audit trail",
      usedLegacyPin: Boolean(check.usedLegacyPin),
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
