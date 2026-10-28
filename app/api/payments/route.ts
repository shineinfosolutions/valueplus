import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import PaymentTransaction from "@/models/PaymentTransaction";
import { purchasePaymentState } from "@/lib/purchase-payments";
import { getActor } from "@/lib/requirePermission";
import { todayInIndia } from "@/lib/today";
import { isAdminRole, pendingApprovalFor, requestAdminApproval } from "@/lib/approval-requests";
import {
  applyPaymentEdit,
  auditPaymentEdit,
  checkNewPayment,
  checkPaymentEdit,
  cleanPaymentChanges,
  purchaseBillFor,
  recordPayment,
} from "@/lib/payments";

const PAYMENT_ROLES = ["admin", "superadmin", "manager", "accounts", "cashier"];
const inr = (n: any) => `₹${(Number(n) || 0).toLocaleString("en-IN")}`;

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    
    const { searchParams } = new URL(request.url);
    const partyId = searchParams.get("partyId");
    const partyType = searchParams.get("partyType"); // "Customer" | "Supplier"

    const filter: any = {};
    if (partyId) filter.partyId = partyId;
    if (partyType) filter.partyType = partyType;
    let payments: any[] = await PaymentTransaction.find(filter).sort({ date: -1 }).lean();

    // The legacy-invoice backfill below only ever represents a Customer's own
    // initial payment on their own bill — skip it entirely for a Supplier-only
    // listing, since there's no supplier-side equivalent to synthesize.
    if (partyType === "Supplier") {
      return NextResponse.json({ success: true, data: payments });
    }

    // Fetch old invoices that have paidAmount > 0 and include them as transactions if not already there
    const Invoice = (await import("@/models/Invoice")).default;
    const invoiceFilter = partyId ? { customerId: partyId, paidAmount: { $gt: 0 } } : { paidAmount: { $gt: 0 } };
    const paidInvoices = await Invoice.find(invoiceFilter).lean();

    const existingRefs = new Set(payments.map((p: any) => p.referenceId));

    const virtualPayments = paidInvoices
      .filter((inv: any) => !existingRefs.has(inv.invoiceNumber))
      .map((inv: any) => ({
        _id: inv._id,
        transactionId: `TXN-LEGACY-${inv.invoiceNumber}`,
        partyId: inv.customerId,
        partyType: "Customer",
        partyName: inv.customerName,
        amount: inv.paidAmount,
        paymentMode: inv.paymentMode || "Cash",
        date: inv.date,
        referenceId: inv.invoiceNumber,
        notes: `Legacy initial payment for ${inv.type === 'sales-order' ? 'order' : 'invoice'} ${inv.invoiceNumber}`,
        type: "received",
        createdAt: inv.createdAt,
      }));

    if (virtualPayments.length > 0) {
      payments = [...payments, ...virtualPayments].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    
    return NextResponse.json({ success: true, data: payments });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const data = await request.json();

    // A payment is dated today or earlier, never ahead. An earlier date from
    // anyone but the Admin waits for the Admin: nothing is recorded until then.
    const today = todayInIndia();
    const day = String(data.date || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day > today) {
      return NextResponse.json({ success: false, error: "A payment cannot be dated in the future." }, { status: 400 });
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < today) {
      const actor = await getActor();
      if (!actor) {
        return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
      }
      if (!isAdminRole(actor.role)) {
        const check = await checkNewPayment(data);
        if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });
        const approval = await requestAdminApproval({
          actor,
          title: `Approve back-dated payment ${data.partyName || ""} (${day})`.trim(),
          description: `${data.type === "paid" ? "Paid to" : "Received from"} ${data.partyName || data.partyType} · ${inr(data.amount)} ${data.paymentMode || ""} · dated ${day}, entered on ${today}${data.referenceId ? ` · against ${data.referenceId}` : ""}`,
          amount: Number(data.amount) || 0,
          payload: { kind: "payment_create", data, date: day, madeOn: today },
        });
        return NextResponse.json({
          success: true,
          pendingApproval: true,
          approvalId: approval.activityId,
          message: "Back-dated payment sent to the Admin for approval. It will be recorded once approved.",
        });
      }
    }

    const result = await recordPayment(data);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: result.payment, bill: result.bill });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * Correct a saved payment: amount, mode, date, notes, bank reference. The
 * Admin's correction is made at once; anyone else's goes to the Admin and is
 * made only when approved.
 */
export async function PUT(request: Request) {
  try {
    await connectToDatabase();
    const body = await request.json();
    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    }
    if (!PAYMENT_ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, error: "You are not allowed to correct payments." }, { status: 403 });
    }
    const id = String(body.id || "");
    const payment: any = /^[a-f0-9]{24}$/i.test(id) ? await PaymentTransaction.findById(id).lean() : null;
    if (!payment) {
      return NextResponse.json({ success: false, error: "Payment not found. A bill's legacy payment is corrected by editing the bill." }, { status: 404 });
    }

    const changes = cleanPaymentChanges(body);
    for (const k of Object.keys(changes)) {
      if (String(changes[k]) === String((payment as any)[k] ?? "")) delete changes[k];
    }
    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ success: false, error: "Nothing was changed." }, { status: 400 });
    }
    if (changes.date && changes.date > todayInIndia()) {
      return NextResponse.json({ success: false, error: "A payment cannot be dated in the future." }, { status: 400 });
    }
    const check = await checkPaymentEdit(payment, changes);
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    const reason = String(body.reason || "").trim();
    if (isAdminRole(actor.role)) {
      const result = await applyPaymentEdit(id, changes);
      if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
      await auditPaymentEdit(payment, result.payment, actor, reason, "");
      return NextResponse.json({ success: true, data: result.payment, message: "Payment updated" });
    }

    if (!reason) {
      return NextResponse.json({ success: false, error: "Give a reason for the correction — the Admin sees it." }, { status: 400 });
    }
    if (await pendingApprovalFor("payment_edit", { paymentId: id })) {
      return NextResponse.json(
        { success: false, error: "A correction to this payment is already waiting for the Admin." },
        { status: 409 }
      );
    }
    const before = Object.fromEntries(Object.keys(changes).map((k) => [k, (payment as any)[k] ?? ""]));
    const describe = (o: any) =>
      Object.entries(o)
        .map(([k, v]) => `${k} ${k === "amount" ? inr(v) : v || "—"}`)
        .join(", ");
    const approval = await requestAdminApproval({
      actor,
      title: `Approve payment correction ${payment.transactionId}`,
      description: `${payment.partyName} · ${describe(before)} → ${describe(changes)} · Reason: ${reason}`,
      amount: Number(changes.amount ?? payment.amount) || 0,
      payload: { kind: "payment_edit", paymentId: id, transactionId: payment.transactionId, before, changes, reason },
    });
    return NextResponse.json({
      success: true,
      pendingApproval: true,
      approvalId: approval.activityId,
      message: "Correction sent to the Admin for approval. The payment changes once approved.",
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    
    if (!id) {
      return NextResponse.json({ success: false, error: "Payment ID is required" }, { status: 400 });
    }

    await connectToDatabase();
    
    const payment = await PaymentTransaction.findById(id);
    if (!payment) {
      return NextResponse.json({ success: false, error: "Payment not found" }, { status: 404 });
    }

    // Reverse the balance update for Customer or Supplier
    if (payment.partyType === "Customer") {
      const Customer = (await import("@/models/Customer")).default;
      const multiplier = payment.type === "paid" ? -1 : 1;
      await Customer.findByIdAndUpdate(payment.partyId, {
        $inc: { outstandingBalance: multiplier * Number(payment.amount) } // add it back or subtract it
      });

      // Revert invoice paid amount if referenceId was linked
      if (payment.referenceId) {
        try {
          const Invoice = (await import("@/models/Invoice")).default;
          const inv = await Invoice.findOne({ invoiceNumber: payment.referenceId });
          if (inv) {
            const newPaid = Math.max(0, (Number(inv.paidAmount) || 0) - Number(payment.amount));
            const newBalance = Math.max(0, (Number(inv.total) || 0) - newPaid);
            const newStatus = newPaid <= 0 ? "pending" : newBalance <= 0 ? "paid" : "partial";
            await Invoice.findByIdAndUpdate(inv._id, {
              paidAmount: newPaid,
              balanceAmount: newBalance,
              status: newStatus,
            });
          }
        } catch (e) {
          console.warn("Notice reverting invoice from payment delete:", e);
        }
      }
    } else if (payment.partyType === "Supplier") {
      const Supplier = (await import("@/models/Supplier")).default;
      // Reverse of POST: if we paid supplier, removing payment INCREASES our outstanding (1)
      // if we received refund, removing payment DECREASES our outstanding (-1)
      const multiplier = payment.type === "paid" ? 1 : -1;
      await Supplier.findByIdAndUpdate(payment.partyId, {
        $inc: { outstandingBalance: multiplier * Number(payment.amount) }
      });

      // Removing a payment made against a purchase bill puts that amount back on it.
      if (payment.type === "paid") {
        const bill: any = await purchaseBillFor(payment.referenceId);
        if (bill) {
          const state = purchasePaymentState(bill.total, (Number(bill.paid) || 0) - Number(payment.amount));
          bill.paid = Math.max(0, state.paid);
          bill.balance = state.balance;
          bill.status = state.status;
          await bill.save();
        }
      }
    }

    await PaymentTransaction.findByIdAndDelete(id);

    return NextResponse.json({ success: true, message: "Payment deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
