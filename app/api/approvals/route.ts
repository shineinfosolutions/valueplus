import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import StoreActivityApproval from "@/models/StoreActivityApproval";
import { notifyAdmins, notifyEmail } from "@/lib/notify";
import { getActor } from "@/lib/requirePermission";
import { todayInIndia } from "@/lib/today";
import { applyPaymentEdit, auditPaymentEdit, recordPayment } from "@/lib/payments";
import { POST as createInvoice } from "@/app/api/invoices/route";

/**
 * Carries out a held change (see lib/approval-requests.ts) once the Admin
 * approves it. Returns an error when it can no longer be made — the request
 * then stays pending, so the Admin can reject it instead.
 */
async function carryOut(req: Request, approval: any, approverName: string): Promise<{ ok: true; ref?: string } | { ok: false; error: string }> {
  const p = approval.payload || {};
  const by = p.requestedBy || { name: approval.storeInchargeName, email: approval.storeInchargeEmail };

  if (p.kind === "invoice_create") {
    if (String(p.body?.date || "").slice(0, 10) > todayInIndia()) return { ok: false, error: "The bill is dated in the future." };
    const res = await createInvoice(
      new Request(new URL("/api/invoices", req.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...p.body, approvedBackdate: { by: by.name, madeOn: p.madeOn } }),
      })
    );
    const json: any = await res.json().catch(() => ({}));
    if (!json.success) return { ok: false, error: json.error || "The bill could not be made." };
    return { ok: true, ref: json.data?.invoiceNumber };
  }

  if (p.kind === "invoice_edit") {
    const Invoice = (await import("@/models/Invoice")).default;
    const { fullEditInvoice } = await import("@/lib/invoice-full-edit");
    const invoice = await Invoice.findOne({ invoiceNumber: p.invoiceNumber });
    if (!invoice) return { ok: false, error: `Bill ${p.invoiceNumber} no longer exists.` };
    const result = await fullEditInvoice(invoice, p.invoice || {}, by, p.reason || "Correction", {
      ...(p.meta || {}),
      approvedBy: approverName,
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, ref: p.invoiceNumber };
  }

  if (p.kind === "payment_create") {
    const result = await recordPayment({ ...(p.data || {}) });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, ref: result.payment?.transactionId };
  }

  if (p.kind === "payment_edit") {
    const PaymentTransaction = (await import("@/models/PaymentTransaction")).default;
    const before: any = await PaymentTransaction.findById(p.paymentId).lean();
    if (!before) return { ok: false, error: "That payment no longer exists." };
    const result = await applyPaymentEdit(p.paymentId, p.changes || {});
    if (!result.ok) return { ok: false, error: result.error };
    await auditPaymentEdit(before, result.payment, by, p.reason || "", approverName);
    return { ok: true, ref: p.transactionId };
  }

  return { ok: true };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const storeName = searchParams.get("storeName");

    await connectToDatabase();

    const query: any = {};
    if (status && status !== "all") query.status = status;
    if (storeName && storeName !== "all") query.storeName = storeName;

    const approvals = await StoreActivityApproval.find(query).sort({ createdAt: -1 }).lean();
    const pendingCount = await StoreActivityApproval.countDocuments({ status: "pending" });

    return NextResponse.json({
      success: true,
      data: approvals,
      pendingCount,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();

    // Held bills, corrections and payments are filed by their own routes after
    // their own checks; one sent here would skip those checks.
    const heldKinds = ["invoice_create", "invoice_edit", "payment_create", "payment_edit"];
    const activityId = `ACT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}-${Math.floor(100 + Math.random() * 900)}`;

    const newApproval = await StoreActivityApproval.create({
      activityId,
      storeName: body.storeName || "Ashoka Enterprises (Kunraghat Showroom)",
      storeInchargeName: body.storeInchargeName || "Store Incharge",
      storeInchargeEmail: body.storeInchargeEmail || "storeincharge@valueplus.in",
      activityType: body.activityType || "general",
      title: body.title,
      description: body.description,
      amount: Number(body.amount) || 0,
      payload: heldKinds.includes(body.payload?.kind) ? { ...body.payload, kind: "" } : body.payload || {},
      status: "pending",
    });

    await notifyAdmins({
      type: "approval_request",
      title: `🔔 Approval needed: ${newApproval.title}`,
      message: `${newApproval.storeInchargeName} · ${newApproval.description}`,
      link: "/admin/approvals",
      createdBy: newApproval.storeInchargeName,
    });

    return NextResponse.json({
      success: true,
      data: newApproval,
      message: `Activity request ${newApproval.activityId} submitted to Super Admin for approval!`,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { activityId, action, notes } = body;

    // Only an Admin approves or rejects.
    const approver = await getActor();
    if (!approver || !["admin", "superadmin"].includes(approver.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin can approve or reject requests." }, { status: 403 });
    }

    if (!activityId || !action) {
      return NextResponse.json({ success: false, error: "activityId and action (approve/reject) are required" }, { status: 400 });
    }

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ success: false, error: "action must be approve or reject" }, { status: 400 });
    }

    await connectToDatabase();

    const existing = await StoreActivityApproval.findOne({ activityId });
    if (!existing) {
      return NextResponse.json({ success: false, error: "Approval request not found" }, { status: 404 });
    }

    if (existing.status !== "pending") {
      return NextResponse.json({ success: false, error: `This request was already ${existing.status}.` }, { status: 400 });
    }

    // A held bill, bill correction or payment is made only now, on approval.
    if (action === "approve") {
      const done = await carryOut(req, existing, approver.name);
      if (!done.ok) {
        return NextResponse.json(
          { success: false, error: `Could not carry this out: ${done.error} It is still pending — reject it if it should not go through.` },
          { status: 400 }
        );
      }
      if (done.ref) {
        existing.payload = { ...(existing.payload || {}), result: done.ref };
        existing.markModified("payload");
      }
    }

    existing.status = action === "approve" ? "approved" : "rejected";
    existing.superAdminActionAt = new Date();
    existing.superAdminNotes = notes || (action === "approve" ? "Approved by Super Admin" : "Rejected by Super Admin");
    await existing.save();

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
