import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import PaymentTransaction from "@/models/PaymentTransaction";
import { purchasePaymentState, round2 } from "@/lib/purchase-payments";

import mongoose from "mongoose";
import { requirePermission } from "@/lib/requirePermission";
import { authoriseChange, auditChange, createChangeRequest, versionOf } from "@/lib/change-requests";
import { checkPaymentEdit, editPayment, removePayment, summarisePayment, purchaseBillFor } from "@/lib/payment-change";

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
  // Recording a payment moves money on a ledger: only roles allowed to record payments.
  const gate = await requirePermission("payment.record");
  if (!gate.ok) return gate.response;

  try {
    await connectToDatabase();
    const data = await request.json();
    
    // A payment to a supplier against one purchase bill. Checked before anything
    // is written: it may not be more than what is still due on that bill, and
    // the supplier is taken from the bill when the form did not pick one.
    const bill: any = data.partyType === "Supplier" && data.type === "paid" ? await purchaseBillFor(data.referenceId) : null;
    if (bill) {
      const due = purchasePaymentState(bill.total, bill.paid).balance;
      if (!(Number(data.amount) > 0)) {
        return NextResponse.json({ success: false, error: "Enter the amount paid." }, { status: 400 });
      }
      if (round2(data.amount) > due + 0.001) {
        return NextResponse.json(
          { success: false, error: `Only ₹${due.toFixed(2)} is due on bill ${bill.billNo}.` },
          { status: 400 }
        );
      }
      if (!data.partyId && bill.supplierId) data.partyId = String(bill.supplierId);
      if (!data.partyName) data.partyName = bill.supplierName;
      if (!data.transactionId) data.transactionId = `TXN-${Date.now()}`;
      data.referenceId = bill.billNo;
    }

    // Find the customer/supplier to update balance
    if (data.partyType === "Customer") {
      const Customer = (await import("@/models/Customer")).default;
      const customer = await Customer.findById(data.partyId);
      
      if (!customer) {
        return NextResponse.json({ success: false, error: "Customer not found" }, { status: 404 });
      }
      
      const multiplier = data.type === "paid" ? 1 : -1;
      // Decrease outstanding balance if received, increase if paid (refund)
      await Customer.findByIdAndUpdate(data.partyId, {
        $inc: { outstandingBalance: multiplier * Number(data.amount) }
      });
    } else if (data.partyType === "Supplier") {
      const Supplier = (await import("@/models/Supplier")).default;
      const supplier = await Supplier.findById(data.partyId);
      
      if (!supplier) {
        return NextResponse.json({ success: false, error: "Supplier not found" }, { status: 404 });
      }
      
      // If we pay supplier, our outstanding to them decreases (-1)
      // If we receive refund from supplier, our outstanding to them increases (1)
      const multiplier = data.type === "paid" ? -1 : 1;
      await Supplier.findByIdAndUpdate(data.partyId, {
        $inc: { outstandingBalance: multiplier * Number(data.amount) }
      });
    }
    
    // Update invoice if referenceId matches an invoiceNumber
    if (data.partyType === "Customer" && data.referenceId) {
      try {
        const Invoice = (await import("@/models/Invoice")).default;
        const inv = await Invoice.findOne({ invoiceNumber: data.referenceId });
        if (inv) {
          const newPaid = Math.min(Number(inv.total) || 0, (Number(inv.paidAmount) || 0) + Number(data.amount));
          const newBalance = Math.max(0, (Number(inv.total) || 0) - newPaid);
          const newStatus = newBalance <= 0 ? "paid" : "partial";
          await Invoice.findByIdAndUpdate(inv._id, {
            paidAmount: newPaid,
            balanceAmount: newBalance,
            status: newStatus,
          });
        }
      } catch (e) {
        console.warn("Notice updating invoice from payment:", e);
      }
    }
    
    if (bill) {
      // What was paid when the bill was entered never had a transaction of its
      // own; the supplier ledger reads it off the bill only while no transaction
      // names the bill. Before the first one does, it is recorded as one, so it
      // is not dropped from the ledger. (The supplier balance already excludes
      // it, so it is not counted against the balance again.)
      const alreadyLinked = await PaymentTransaction.exists({ partyType: "Supplier", referenceId: bill.billNo });
      if (!alreadyLinked && Number(bill.paid) > 0) {
        await PaymentTransaction.create({
          transactionId: `TXN-PE-${bill.billNo}`,
          partyId: data.partyId || String(bill.supplierId || ""),
          partyType: "Supplier",
          partyName: bill.supplierName,
          amount: round2(bill.paid),
          paymentMode: bill.paymentMode || "Cash",
          date: bill.billDate,
          referenceId: bill.billNo,
          notes: "Paid at purchase entry",
          type: "paid",
        });
      }
      const state = purchasePaymentState(bill.total, (Number(bill.paid) || 0) + Number(data.amount));
      bill.paid = state.paid;
      bill.balance = state.balance;
      bill.status = state.status;
      await bill.save();
    }

    const payment = await PaymentTransaction.create(data);
    return NextResponse.json({ success: true, data: payment, bill: bill ? { billNo: bill.billNo, paid: bill.paid, balance: bill.balance, status: bill.status } : undefined });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * Edit a payment (amount, mode, date, notes). Admin: done now. Store Manager: sent to
 * the Admin, and the payment stays exactly as it is until the Admin approves.
 * Needs the PIN and a reason either way.
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const gate = await authoriseChange(request, body.pin, body.reason);
    if (!gate.ok) return gate.response;

    await connectToDatabase();
    if (!mongoose.isValidObjectId(body.id)) {
      return NextResponse.json({ success: false, error: "Payment ID is required" }, { status: 400 });
    }
    const payment: any = await PaymentTransaction.findById(body.id);
    if (!payment) return NextResponse.json({ success: false, error: "Payment not found" }, { status: 404 });

    // Only these four fields can change; the party and the bill it is against stay.
    const c = body.changes || {};
    const changes: any = {};
    if (c.amount !== undefined) changes.amount = Number(c.amount);
    if (c.paymentMode !== undefined) changes.paymentMode = String(c.paymentMode);
    if (c.date !== undefined) changes.date = String(c.date);
    if (c.notes !== undefined) changes.notes = String(c.notes);

    const check = await checkPaymentEdit(payment, changes);
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: 400 });

    if (gate.mode === "direct") {
      const r = await editPayment(payment, changes, gate.actor);
      if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 400 });
      await auditChange({
        action: "payment.edit",
        entityType: "Payment",
        entityRef: payment.transactionId,
        entityId: String(payment._id),
        partyName: payment.partyName,
        amount: check.next.amount,
        reason: gate.reason,
        actor: gate.actor,
        ip: gate.ip,
        userAgent: gate.userAgent,
        usedLegacyPin: gate.usedLegacyPin,
        metadata: { before: r.before, after: r.after },
      });
      return NextResponse.json({ success: true, message: "Payment updated", data: await PaymentTransaction.findById(payment._id) });
    }

    const reqResult = await createChangeRequest({
      kind: "payment_edit",
      target: `payment:${payment._id}`,
      title: `Edit ${payment.partyType === "Supplier" ? "supplier payment" : "customer receipt"} — ${payment.partyName}`,
      description: `₹${Number(payment.amount).toLocaleString("en-IN")} → ₹${check.next.amount.toLocaleString("en-IN")} · ${payment.paymentMode} → ${check.next.paymentMode} · ${payment.date} → ${check.next.date}`,
      amount: check.next.amount,
      actor: gate.actor,
      reason: gate.reason,
      before: summarisePayment(payment),
      after: summarisePayment({ ...payment.toObject(), ...check.next }),
      data: { paymentId: String(payment._id), changes },
      baseVersion: versionOf(payment),
      meta: { ip: gate.ip, userAgent: gate.userAgent, usedLegacyPin: gate.usedLegacyPin },
    });
    if (!reqResult.ok) return NextResponse.json({ success: false, error: reqResult.error }, { status: 409 });
    return NextResponse.json({
      success: true,
      pending: true,
      message: "Sent to the Admin for approval. The payment stays as it is until it is approved.",
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** Delete a payment. Admin: done now. Store Manager: sent to the Admin. PIN and a reason either way. */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const body = await request.json().catch(() => ({}));

    const gate = await authoriseChange(request, body.pin ?? searchParams.get("pin") ?? "", body.reason ?? searchParams.get("reason") ?? "");
    if (!gate.ok) return gate.response;

    if (!id || !mongoose.isValidObjectId(id)) {
      return NextResponse.json({ success: false, error: "Payment ID is required" }, { status: 400 });
    }
    await connectToDatabase();

    const payment: any = await PaymentTransaction.findById(id);
    if (!payment) {
      return NextResponse.json({ success: false, error: "Payment not found" }, { status: 404 });
    }
    const before = summarisePayment(payment);

    if (gate.mode === "direct") {
      await removePayment(payment);
      await auditChange({
        action: "payment.delete",
        entityType: "Payment",
        entityRef: payment.transactionId,
        entityId: String(payment._id),
        partyName: payment.partyName,
        amount: Number(payment.amount) || 0,
        reason: gate.reason,
        actor: gate.actor,
        ip: gate.ip,
        userAgent: gate.userAgent,
        usedLegacyPin: gate.usedLegacyPin,
        metadata: { before },
      });
      return NextResponse.json({ success: true, message: "Payment deleted successfully" });
    }

    const reqResult = await createChangeRequest({
      kind: "payment_delete",
      target: `payment:${payment._id}`,
      title: `Delete ${payment.partyType === "Supplier" ? "supplier payment" : "customer receipt"} — ${payment.partyName}`,
      description: `₹${Number(payment.amount).toLocaleString("en-IN")} · ${payment.paymentMode} · ${payment.date}${payment.referenceId ? ` · against ${payment.referenceId}` : ""}`,
      amount: Number(payment.amount) || 0,
      actor: gate.actor,
      reason: gate.reason,
      before,
      after: { deleted: true },
      data: { paymentId: String(payment._id) },
      baseVersion: versionOf(payment),
      meta: { ip: gate.ip, userAgent: gate.userAgent, usedLegacyPin: gate.usedLegacyPin },
    });
    if (!reqResult.ok) return NextResponse.json({ success: false, error: reqResult.error }, { status: 409 });
    return NextResponse.json({
      success: true,
      pending: true,
      message: "Sent to the Admin for approval. The payment stays until it is approved.",
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
