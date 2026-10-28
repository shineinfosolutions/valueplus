import PaymentTransaction from "@/models/PaymentTransaction";
import { purchasePaymentState, round2 } from "@/lib/purchase-payments";

/**
 * Recording and correcting a payment on the Receive Payment / Supplier Payment
 * screens, and what each one moves: the party's outstanding balance, the paid /
 * balance of the invoice or purchase bill it names.
 *
 * Shared by the payments route (Admin, or a same-day payment) and the approvals
 * route (a back-dated payment or a correction, once the Admin approves it).
 */

export type PaymentResult =
  | { ok: true; payment: any; bill?: { billNo: string; paid: number; balance: number; status: string } }
  | { ok: false; status: number; error: string };

/** The purchase bill a supplier payment is made against, if it names one. */
export async function purchaseBillFor(referenceId: any) {
  const ref = String(referenceId || "").trim();
  if (!ref) return null;
  const PurchaseEntry = (await import("@/models/PurchaseEntry")).default;
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return PurchaseEntry.findOne({
    billNo: { $regex: new RegExp(`^${escaped}$`, "i") },
    type: { $ne: "debit-note" },
    status: { $ne: "cancelled" },
  });
}

/** Checks a new payment before anything is written; fills in the supplier from its bill. */
export async function checkNewPayment(data: any): Promise<{ ok: true; bill: any } | { ok: false; status: number; error: string }> {
  // A payment to a supplier against one purchase bill. Checked before anything
  // is written: it may not be more than what is still due on that bill, and
  // the supplier is taken from the bill when the form did not pick one.
  const bill: any = data.partyType === "Supplier" && data.type === "paid" ? await purchaseBillFor(data.referenceId) : null;
  if (bill) {
    const due = purchasePaymentState(bill.total, bill.paid).balance;
    if (!(Number(data.amount) > 0)) {
      return { ok: false, status: 400, error: "Enter the amount paid." };
    }
    if (round2(data.amount) > due + 0.001) {
      return { ok: false, status: 400, error: `Only ₹${due.toFixed(2)} is due on bill ${bill.billNo}.` };
    }
    if (!data.partyId && bill.supplierId) data.partyId = String(bill.supplierId);
    if (!data.partyName) data.partyName = bill.supplierName;
    if (!data.transactionId) data.transactionId = `TXN-${Date.now()}`;
    data.referenceId = bill.billNo;
  }

  if (data.partyType === "Customer") {
    const Customer = (await import("@/models/Customer")).default;
    if (!(await Customer.exists({ _id: data.partyId }))) {
      return { ok: false, status: 404, error: "Customer not found" };
    }
  } else if (data.partyType === "Supplier") {
    const Supplier = (await import("@/models/Supplier")).default;
    if (!(await Supplier.exists({ _id: data.partyId }))) {
      return { ok: false, status: 404, error: "Supplier not found" };
    }
  }
  return { ok: true, bill };
}

export async function recordPayment(data: any): Promise<PaymentResult> {
  const check = await checkNewPayment(data);
  if (!check.ok) return check;
  const bill: any = check.bill;

  // Find the customer/supplier to update balance
  if (data.partyType === "Customer") {
    const Customer = (await import("@/models/Customer")).default;
    const multiplier = data.type === "paid" ? 1 : -1;
    // Decrease outstanding balance if received, increase if paid (refund)
    await Customer.findByIdAndUpdate(data.partyId, {
      $inc: { outstandingBalance: multiplier * Number(data.amount) }
    });
  } else if (data.partyType === "Supplier") {
    const Supplier = (await import("@/models/Supplier")).default;
    // If we pay supplier, our outstanding to them decreases (-1)
    // If we receive refund from supplier, our outstanding to them increases (1)
    const multiplier = data.type === "paid" ? -1 : 1;
    await Supplier.findByIdAndUpdate(data.partyId, {
      $inc: { outstandingBalance: multiplier * Number(data.amount) }
    });
  }

  // Update invoice if referenceId matches an invoiceNumber
  if (data.partyType === "Customer" && data.referenceId) {
    await moveInvoicePaid(data.referenceId, Number(data.amount));
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
  return {
    ok: true,
    payment,
    bill: bill ? { billNo: bill.billNo, paid: bill.paid, balance: bill.balance, status: bill.status } : undefined,
  };
}

/** Adds `delta` to what is paid on the invoice numbered `invoiceNumber`, if there is one. */
async function moveInvoicePaid(invoiceNumber: string, delta: number) {
  try {
    const Invoice = (await import("@/models/Invoice")).default;
    const inv = await Invoice.findOne({ invoiceNumber });
    if (inv) {
      const newPaid = Math.min(Number(inv.total) || 0, Math.max(0, (Number(inv.paidAmount) || 0) + delta));
      const newBalance = Math.max(0, (Number(inv.total) || 0) - newPaid);
      const newStatus = newPaid <= 0 ? "pending" : newBalance <= 0 ? "paid" : "partial";
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

/** What a payment correction may change. Party and the bill it is against stay. */
export const EDITABLE_PAYMENT_FIELDS = ["amount", "paymentMode", "date", "notes", "bankTxnRef"] as const;

export function cleanPaymentChanges(input: any): Record<string, any> {
  const changes: Record<string, any> = {};
  for (const f of EDITABLE_PAYMENT_FIELDS) {
    if (input?.[f] === undefined) continue;
    changes[f] = f === "amount" ? round2(input[f]) : String(input[f] ?? "").trim();
  }
  if (changes.date) changes.date = String(changes.date).slice(0, 10);
  return changes;
}

/** Checks a correction against the payment as it stands; nothing is written. */
export async function checkPaymentEdit(payment: any, changes: Record<string, any>): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if ("amount" in changes && !(Number(changes.amount) > 0)) {
    return { ok: false, status: 400, error: "Enter the amount." };
  }
  if ("paymentMode" in changes && !changes.paymentMode) {
    return { ok: false, status: 400, error: "Choose the payment mode." };
  }
  if ("date" in changes && !/^\d{4}-\d{2}-\d{2}$/.test(changes.date)) {
    return { ok: false, status: 400, error: "Enter a valid date." };
  }
  const delta = round2(("amount" in changes ? Number(changes.amount) : Number(payment.amount)) - Number(payment.amount));
  if (delta > 0 && payment.partyType === "Supplier" && payment.type === "paid") {
    const bill: any = await purchaseBillFor(payment.referenceId);
    if (bill) {
      const due = purchasePaymentState(bill.total, bill.paid).balance;
      if (delta > due + 0.001) {
        return { ok: false, status: 400, error: `Only ₹${due.toFixed(2)} more is due on bill ${bill.billNo}.` };
      }
    }
  }
  return { ok: true };
}

/** Applies a correction: the payment changes, and so does everything its amount moved. */
export async function applyPaymentEdit(paymentId: string, changes: Record<string, any>): Promise<PaymentResult> {
  const payment: any = await PaymentTransaction.findById(paymentId);
  if (!payment) return { ok: false, status: 404, error: "Payment not found" };
  const check = await checkPaymentEdit(payment, changes);
  if (!check.ok) return check;

  const delta = round2(("amount" in changes ? Number(changes.amount) : Number(payment.amount)) - Number(payment.amount));
  if (delta) {
    if (payment.partyType === "Customer") {
      const Customer = (await import("@/models/Customer")).default;
      const multiplier = payment.type === "paid" ? 1 : -1;
      await Customer.findByIdAndUpdate(payment.partyId, { $inc: { outstandingBalance: multiplier * delta } });
      if (payment.referenceId) await moveInvoicePaid(payment.referenceId, delta);
    } else if (payment.partyType === "Supplier") {
      const Supplier = (await import("@/models/Supplier")).default;
      const multiplier = payment.type === "paid" ? -1 : 1;
      await Supplier.findByIdAndUpdate(payment.partyId, { $inc: { outstandingBalance: multiplier * delta } });
      if (payment.type === "paid") {
        const bill: any = await purchaseBillFor(payment.referenceId);
        if (bill) {
          const state = purchasePaymentState(bill.total, (Number(bill.paid) || 0) + delta);
          bill.paid = Math.max(0, state.paid);
          bill.balance = state.balance;
          bill.status = state.status;
          await bill.save();
        }
      }
    }
  }

  Object.assign(payment, changes);
  await payment.save();
  return { ok: true, payment };
}

/** Audit row for a payment correction. Best-effort. */
export async function auditPaymentEdit(before: any, after: any, actor: { name: string; id?: string; role?: string }, reason: string, approvedBy: string) {
  try {
    const AuditLog = (await import("@/models/AuditLog")).default;
    await AuditLog.create({
      action: "payment.edit",
      entityType: "PaymentTransaction",
      entityRef: before.transactionId,
      entityId: String(before._id),
      partyName: before.partyName,
      amount: Number(after?.amount) || 0,
      reason: `${reason || "Payment corrected"}${approvedBy ? ` (approved by ${approvedBy})` : ""}`,
      performedBy: actor.name,
      performedByUserId: actor.id,
      performedByRole: actor.role,
      metadata: {
        before: { amount: before.amount, paymentMode: before.paymentMode, date: before.date, notes: before.notes, bankTxnRef: before.bankTxnRef },
        after: { amount: after?.amount, paymentMode: after?.paymentMode, date: after?.date, notes: after?.notes, bankTxnRef: after?.bankTxnRef },
      },
    });
  } catch (logErr) {
    console.warn("Notice: audit log for payment edit:", logErr);
  }
}
