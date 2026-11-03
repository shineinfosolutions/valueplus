import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Estimate from "@/models/Estimate";
import Lead from "@/models/Lead";
import DeletedInvoice from "@/models/DeletedInvoice";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { requirePinAndPermission } from "@/lib/securityPin";
import { findBelowFloor, verifyUnlockPin } from "@/lib/priceLock";
import { missingApprovals } from "@/lib/discount-approval";
import { notifyRoles } from "@/lib/notify";

const SALES_ONLY_ROLES = ["salesman", "sales"];
const stripBrackets = (v?: string) => String(v || "").replace(/\(.*?\)/g, "").trim().toLowerCase();
const sameName = (a?: string, b?: string) => stripBrackets(a) === stripBrackets(b);

/** The fields a caller may set on an estimate. Approval, deal amount and unlock record are never taken from the request. */
const EDITABLE_FIELDS = [
  "customerName", "customerPhone", "customerAddress", "customerGST", "customerCompanyName",
  "date", "expiryDate", "items", "subTotal", "taxTotal", "total", "notes",
];

/** The form asks the Store Manager / Admin for these lines and then sends the estimate again. */
function discountApprovalResponse(lines: any[]) {
  return NextResponse.json(
    {
      success: false,
      discountApproval: true,
      lines,
      error: `Discount approval needed: ${lines.map((l) => `${l.itemName} (${l.percent}% off, ${l.tier === "admin" ? "Admin" : "Store Manager"})`).join(", ")}.`,
    },
    { status: 409 }
  );
}

function ipOf(req: Request) {
  return req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
}

/**
 * Locked-minimum-price check for the lines of an estimate.
 * A line below its product's locked minimum is only accepted with a valid price-unlock PIN.
 */
async function checkPriceLock(actor: any, items: any[], pin: string) {
  const below = await findBelowFloor(items);
  if (below.length === 0) return { ok: true as const, unlock: null as any, below };
  // A salesman cannot go below a locked price at all, PIN or not: only the cashier, manager or admin can.
  if (SALES_ONLY_ROLES.includes(actor.role)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          success: false,
          belowFloor: true,
          noUnlock: true,
          lines: below,
          error: `Price is locked: ${below.map((l) => `${l.itemName} cannot go below ₹${l.lockedMin}`).join(", ")}.`,
        },
        { status: 403 }
      ),
    };
  }
  if (!String(pin || "").trim()) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          success: false,
          belowFloor: true,
          lines: below,
          error: `Below the locked minimum price: ${below.map((l) => `${l.itemName} (min ₹${l.lockedMin})`).join(", ")}. The price unlock PIN is needed.`,
        },
        { status: 403 }
      ),
    };
  }
  const check = await verifyUnlockPin(actor, pin);
  if (!check.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, belowFloor: true, lines: below, pinFailed: true, error: check.error }, { status: 403 }),
    };
  }
  return { ok: true as const, unlock: { by: actor.name, byRole: actor.role, at: new Date(), lines: below }, below };
}

async function logPriceUnlock(req: Request, actor: any, estimate: any, below: any[], where: string) {
  try {
    await AuditLog.create({
      action: "estimate.price.unlock",
      entityType: "Estimate",
      entityRef: estimate.estimateNumber,
      entityId: String(estimate._id),
      partyName: estimate.customerName,
      amount: Number(estimate.total) || 0,
      reason: `Price unlocked below the locked minimum (${where})`,
      performedBy: actor.name,
      performedByUserId: actor.id,
      performedByRole: actor.role,
      pinVerified: true,
      ip: ipOf(req),
      userAgent: req.headers.get("user-agent") || "",
      metadata: { lines: below },
    });
  } catch (e) {
    console.warn("Notice: audit log for price unlock:", e);
  }
}

export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get("phone") || searchParams.get("customerPhone");
    const status = searchParams.get("status");
    const approval = searchParams.get("approval");

    const query: any = {};
    if (phone) {
      const clean = phone.replace(/\D/g, "");
      query.customerPhone = { $regex: clean, $options: "i" };
    }
    if (status) {
      query.status = status;
    }

    if (approval) query.approvalStatus = approval;
    let estimates: any[] = await Estimate.find(query).sort({ createdAt: -1 });
    // A salesman sees only the estimates made under their own name.
    if (SALES_ONLY_ROLES.includes(actor.role)) {
      estimates = estimates.filter((e) => sameName(e.salesperson, actor.name) || sameName(e.salesExecutive, actor.name));
    }
    return NextResponse.json({ success: true, data: estimates });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const body = await req.json();
    await connectToDatabase();

    const lock = await checkPriceLock(actor, body.items, body.priceUnlockPin);
    if (!lock.ok) return lock.response;
    const needDiscount = await missingApprovals(actor, body.customerName, body.items);
    if (needDiscount.length > 0) return discountApprovalResponse(needDiscount);

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

    const data: any = { estimateNumber: body.estimateNumber };
    for (const k of EDITABLE_FIELDS) if (body[k] !== undefined) data[k] = body[k];
    // Whose deal this is comes from the login for a salesman, never from the form.
    const owner = SALES_ONLY_ROLES.includes(actor.role) ? actor.name : body.salesperson || body.salesExecutive || actor.name;
    data.salesperson = owner;
    data.salesExecutive = owner;
    data.status = "Sent";
    if (lock.unlock) data.priceUnlock = lock.unlock;

    // An estimate is a quotation for the customer and needs no approval. A bill is a sale the
    // salesman sends to the cashier, who confirms payment and delivery and makes the invoice.
    data.kind = body.kind === "bill" ? "bill" : "estimate";
    data.approvalStatus = data.kind === "bill" ? "pending" : "approved";

    const estimate = await Estimate.create(data);
    if (lock.unlock) await logPriceUnlock(req, actor, estimate, lock.below, "estimate created");

    // A salesman's bill goes to the cashier: a bell and phone notification (it arrives with the app closed),
    // besides the pop-up the cashier sees while the app is open.
    if (data.kind === "bill") {
      await notifyRoles(
        ["cashier", "manager", "admin", "superadmin"],
        {
          type: "approval_request",
          title: "New bill from a salesman",
          message: `${owner} · ${estimate.customerName} · ₹${Number(estimate.total || 0).toLocaleString("en-IN")} (${estimate.estimateNumber}). Make the invoice.`,
          link: "/sales/estimates",
          createdBy: actor.name,
        },
        actor.id
      );
    }

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
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const body = await req.json();
    await connectToDatabase();

    if (!body.estimateNumber) {
      return NextResponse.json({ success: false, error: "Estimate number is required for update" }, { status: 400 });
    }

    const existing: any = await Estimate.findOne({ estimateNumber: body.estimateNumber });
    if (!existing) {
      return NextResponse.json({ success: false, error: "Estimate not found" }, { status: 404 });
    }
    if (existing.status === "Converted") {
      return NextResponse.json({ success: false, error: "This estimate is already billed and cannot be changed." }, { status: 400 });
    }
    if (SALES_ONLY_ROLES.includes(actor.role) && !sameName(existing.salesperson || existing.salesExecutive, actor.name)) {
      return NextResponse.json({ success: false, error: "You can only change your own estimates." }, { status: 403 });
    }

    const nextItems = body.items !== undefined ? body.items : existing.items;
    const lock = await checkPriceLock(actor, nextItems, body.priceUnlockPin);
    if (!lock.ok) return lock.response;
    const needDiscount = await missingApprovals(actor, body.customerName || existing.customerName, nextItems);
    if (needDiscount.length > 0) return discountApprovalResponse(needDiscount);

    const set: any = {};
    for (const k of EDITABLE_FIELDS) if (body[k] !== undefined) set[k] = body[k];
    const unset: any = {};
    if (lock.unlock) set.priceUnlock = lock.unlock;
    else unset.priceUnlock = 1;

    // A changed bill goes back to the cashier; an estimate (quotation) stays as it is.
    if (existing.kind === "bill") {
      set.approvalStatus = "pending";
      Object.assign(unset, { approvedBy: 1, approvedAt: 1, rejectedBy: 1, rejectedAt: 1, rejectReason: 1, dealAmount: 1, dealSalesperson: 1 });
    }

    const updatedEstimate = await Estimate.findOneAndUpdate(
      { estimateNumber: body.estimateNumber },
      { $set: set, $unset: unset },
      { new: true }
    );
    if (lock.unlock && updatedEstimate) await logPriceUnlock(req, actor, updatedEstimate, lock.below, "estimate edited");

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
