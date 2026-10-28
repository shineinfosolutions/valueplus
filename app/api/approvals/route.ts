import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import StoreActivityApproval from "@/models/StoreActivityApproval";
import { notifyAdmins, notifyEmail } from "@/lib/notify";
import { getActor } from "@/lib/requirePermission";

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
      payload: body.payload || {},
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

    await connectToDatabase();

    const existing = await StoreActivityApproval.findOne({ activityId });
    if (!existing) {
      return NextResponse.json({ success: false, error: "Approval request not found" }, { status: 404 });
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
