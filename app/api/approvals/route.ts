import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import StoreActivityApproval from "@/models/StoreActivityApproval";
import { notifyEmail } from "@/lib/notify";
import { getActor } from "@/lib/requirePermission";
import { ADMIN_ROLES, auditChange, executeChangeRequest } from "@/lib/change-requests";

/**
 * Who can see what: the Admin sees every request; a Store Manager sees only the ones
 * they sent (so they can tell what is still waiting); everyone else sees none.
 */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    }
    const isAdmin = ADMIN_ROLES.includes(actor.role);
    if (!isAdmin && actor.role !== "manager") {
      return NextResponse.json({ success: true, data: [], pendingCount: 0 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const storeName = searchParams.get("storeName");

    await connectToDatabase();

    const query: any = {};
    if (status && status !== "all") query.status = status;
    if (storeName && storeName !== "all") query.storeName = storeName;
    if (!isAdmin) {
      query.$or = [{ "payload.requestedBy.id": actor.id }, { storeInchargeEmail: actor.email }];
    }

    const approvals = await StoreActivityApproval.find(query).sort({ createdAt: -1 }).lean();
    const pendingCount = await StoreActivityApproval.countDocuments({ ...query, status: "pending" });

    return NextResponse.json({
      success: true,
      data: approvals,
      pendingCount,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * Requests are no longer created here. They are created by the server, from the screen
 * that makes the change (a payment, a bill), so a request always carries a real,
 * checked change. Taking a free-form request from the caller would let anyone put a
 * made-up change in front of the Admin to approve.
 */
export async function POST() {
  return NextResponse.json(
    { success: false, error: "Requests are sent from the screen where the change is made (payment, bill)." },
    { status: 403 }
  );
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { activityId, action, notes } = body;

    // Only an Admin approves or rejects.
    const approver = await getActor();
    if (!approver || !ADMIN_ROLES.includes(approver.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin can approve or reject requests." }, { status: 403 });
    }

    if (!activityId || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ success: false, error: "activityId and action (approve/reject) are required" }, { status: 400 });
    }

    await connectToDatabase();

    const existing = await StoreActivityApproval.findOne({ activityId });
    if (!existing) {
      return NextResponse.json({ success: false, error: "Approval request not found" }, { status: 404 });
    }
    if (existing.status !== "pending") {
      return NextResponse.json(
        { success: false, error: `This request was already ${existing.status}.` },
        { status: 409 }
      );
    }

    // Approving applies the change. If it can no longer be applied (the record changed,
    // was cancelled or deleted since) the request stays waiting and the Admin is told why.
    if (action === "approve") {
      const result = await executeChangeRequest(existing, approver);
      if (!result.ok) {
        return NextResponse.json({ success: false, error: result.error }, { status: 409 });
      }
    }

    existing.status = action === "approve" ? "approved" : "rejected";
    existing.superAdminActionAt = new Date();
    existing.superAdminNotes = notes || (action === "approve" ? "Approved by Admin" : "Rejected by Admin");
    await existing.save();

    await auditChange({
      action: action === "approve" ? "change.approved" : "change.rejected",
      entityType: "ChangeRequest",
      entityRef: String(existing.payload?.target || existing.activityId),
      entityId: String(existing._id),
      partyName: existing.title,
      amount: existing.amount,
      reason: existing.superAdminNotes || "",
      actor: approver,
      metadata: { kind: existing.payload?.kind, requestedBy: existing.payload?.requestedBy, activityId: existing.activityId },
    });

    // A back-dated bill: approved, it keeps its date; rejected, it moves back to
    // the day it was actually made.
    if (existing.payload?.kind === "backdated_invoice" && existing.payload?.invoiceNumber) {
      try {
        const Invoice = (await import("@/models/Invoice")).default;
        await Invoice.updateOne(
          { invoiceNumber: existing.payload.invoiceNumber },
          action === "approve"
            ? { $set: { backdateStatus: "approved" } }
            : { $set: { backdateStatus: "rejected", date: existing.payload.madeOn || existing.payload.date } }
        );
      } catch (err) {
        console.error("Back-dated bill decision:", err);
      }
    }
    // Same for a back-dated purchase bill.
    if (existing.payload?.kind === "backdated_purchase" && existing.payload?.data?.billNo) {
      try {
        const PurchaseEntry = (await import("@/models/PurchaseEntry")).default;
        await PurchaseEntry.updateOne(
          { billNo: existing.payload.data.billNo },
          action === "approve"
            ? { $set: { backdateStatus: "approved" } }
            : { $set: { backdateStatus: "rejected", billDate: existing.payload.data.madeOn || existing.payload.data.date } }
        );
      } catch (err) {
        console.error("Back-dated purchase bill decision:", err);
      }
    }

    // If approved, execute relevant side-effects if needed
    if (action === "approve" && existing.activityType === "expense_approval" && existing.payload) {
      try {
        const Expense = (await import("@/models/Expense")).default;
        await Expense.create({
          title: existing.title,
          category: existing.payload.category || "Store Operations",
          amount: existing.amount || existing.payload.amount,
          date: new Date().toISOString().split("T")[0],
          paymentMode: existing.payload.paymentMode || "Cash",
          paidTo: existing.payload.paidTo || "Vendor",
          notes: `Super Admin Approved Activity #${existing.activityId}`,
          warehouse: existing.storeName,
          status: "approved",
        });
      } catch (err) {
        console.error("Auto expense error:", err);
      }
    }

    await notifyEmail(existing.storeInchargeEmail, {
      type: "approval_result",
      title: `${existing.status === "approved" ? "✅ Approved" : "❌ Rejected"}: ${existing.title}`,
      message: existing.superAdminNotes || "",
      link: "/admin/approvals",
      createdBy: "Admin",
    });

    return NextResponse.json({
      success: true,
      data: existing,
      message: `Request ${existing.activityId} has been ${existing.status.toUpperCase()}!`,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
