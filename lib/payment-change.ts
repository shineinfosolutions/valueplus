import PaymentTransaction from "@/models/PaymentTransaction";
import { purchasePaymentState, round2 } from "@/lib/purchase-payments";

/**
 * Changing or removing a recorded payment, with everything it moved: the
 * customer's / supplier's balance, and the bill it was paid against.
 *
 * Used both by the Admin directly and by an approved Store Manager request, so
 * the two can never differ. `removePayment` is the delete logic the payments
 * route always had, moved here unchanged.
 */

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

export { isBillBoundPayment } from "@/lib/payment-rules";
import { isBillBoundPayment } from "@/lib/payment-rules";

export interface PaymentChanges {
  amount?: number;
  paymentMode?: string;
  date?: string;
  notes?: string;
}

export function summarisePayment(p: any) {
  return {
    party: `${p.partyName || ""} (${p.partyType})`,
    type: p.type,
    amount: round2(p.amount),
    paymentMode: p.paymentMode,
    date: p.date,
    reference: p.referenceId || "",
    notes: p.notes || "",
  };
}

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** Checks an edit without writing anything. */
export async function checkPaymentEdit(
  payment: any,
  changes: PaymentChanges
): Promise<{ ok: true; next: Required<PaymentChanges>; delta: number } | { ok: false; error: string }> {
  if (!payment) return { ok: false, error: "Payment not found." };
  if (isBillBoundPayment(payment)) {
    return {
      ok: false,
      error: "This payment was made together with its bill. Change it by editing the bill, not here.",
    };
  }

  const next = {
    amount: changes.amount === undefined ? round2(payment.amount) : round2(changes.amount),
    paymentMode: String(changes.paymentMode ?? payment.paymentMode ?? "").trim(),
    date: String(changes.date ?? payment.date ?? "").slice(0, 10),
    notes: String(changes.notes ?? payment.notes ?? "").trim(),
  };

  if (!(next.amount > 0) || !Number.isFinite(next.amount)) return { ok: false, error: "Enter a valid amount." };
  if (!next.paymentMode || next.paymentMode.length > 40) return { ok: false, error: "Choose the payment mode." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next.date)) return { ok: false, error: "Enter a valid date." };
  if (next.date > todayIst()) return { ok: false, error: "A payment cannot be dated in the future." };
  if (next.notes.length > 500) return { ok: false, error: "Notes are too long (500 characters at most)." };

  const same =
    next.amount === round2(payment.amount) &&
    next.paymentMode === String(payment.paymentMode || "") &&
    next.date === String(payment.date || "").slice(0, 10) &&
    next.notes === String(payment.notes || "").trim();
  if (same) return { ok: false, error: "Nothing was changed." };

  const delta = round2(next.amount - round2(payment.amount));

  if (delta !== 0 && payment.referenceId) {
    if (payment.partyType === "Customer" && payment.type === "received") {
      const Invoice = (await import("@/models/Invoice")).default;
      const inv: any = await Invoice.findOne({ invoiceNumber: payment.referenceId }).lean();
      if (inv && delta > 0) {
        const room = round2((Number(inv.total) || 0) - (Number(inv.advanceAdjusted) || 0) - (Number(inv.paidAmount) || 0));
        if (delta > room + 0.01) {
          return { ok: false, error: `Only ₹${Math.max(0, room).toFixed(2)} more can be taken against bill ${inv.invoiceNumber}.` };
        }
      }
    }
    if (payment.partyType === "Supplier" && payment.type === "paid") {
      const bill: any = await purchaseBillFor(payment.referenceId);
      if (bill && delta > 0) {
        const due = purchasePaymentState(bill.total, bill.paid).balance;
        if (delta > due + 0.001) return { ok: false, error: `Only ₹${due.toFixed(2)} more is due on bill ${bill.billNo}.` };
      }
    }
  }
  return { ok: true, next, delta };
}

/** Edit a payment: amount, mode, date and notes. Its party and bill stay the same. */
export async function editPayment(
  payment: any,
  changes: PaymentChanges,
  actor: { name: string }
): Promise<{ ok: true; before: any; after: any } | { ok: false; error: string }> {
  const check = await checkPaymentEdit(payment, changes);
  if (!check.ok) return check;
  const { next, delta } = check;
  const before = summarisePayment(payment);

  if (delta !== 0) {
    if (payment.partyType === "Customer") {
      const Customer = (await import("@/models/Customer")).default;
      // Same sign rule as recording: a receipt lowers what they owe, a refund raises it.
      const multiplier = payment.type === "paid" ? 1 : -1;
      await Customer.findByIdAndUpdate(payment.partyId, { $inc: { outstandingBalance: multiplier * delta } });

      if (payment.type === "received" && payment.referenceId) {
        const Invoice = (await import("@/models/Invoice")).default;
        const inv: any = await Invoice.findOne({ invoiceNumber: payment.referenceId });
        if (inv) {
          const cap = Math.max(0, (Number(inv.total) || 0) - (Number(inv.advanceAdjusted) || 0));
          const newPaid = round2(Math.min(cap, Math.max(0, (Number(inv.paidAmount) || 0) + delta)));
          const newBalance = round2(Math.max(0, cap - newPaid));
          await Invoice.findByIdAndUpdate(inv._id, {
            paidAmount: newPaid,
            balanceAmount: newBalance,
            status: newPaid <= 0 ? "pending" : newBalance <= 1 ? "paid" : "partial",
          });
        }
      }
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

  await PaymentTransaction.updateOne(
    { _id: payment._id },
    {
      $set: {
        amount: next.amount,
        paymentMode: next.paymentMode,
        date: next.date,
        notes: next.notes,
        lastEditedAt: new Date(),
        lastEditedBy: actor.name,
      },
      $inc: { editCount: 1 },
    }
  );
  const after = summarisePayment({ ...(payment.toObject ? payment.toObject() : payment), ...next });
  return { ok: true, before, after };
}

/** Delete a payment and undo what it did (the logic the payments route always had). */
export async function removePayment(payment: any): Promise<void> {
  if (payment.partyType === "Customer") {
    const Customer = (await import("@/models/Customer")).default;
    const multiplier = payment.type === "paid" ? -1 : 1;
    await Customer.findByIdAndUpdate(payment.partyId, {
      $inc: { outstandingBalance: multiplier * Number(payment.amount) },
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
    // Reverse of recording: if we paid supplier, removing the payment INCREASES our outstanding;
    // if we received a refund, removing it DECREASES our outstanding.
    const multiplier = payment.type === "paid" ? 1 : -1;
    await Supplier.findByIdAndUpdate(payment.partyId, {
      $inc: { outstandingBalance: multiplier * Number(payment.amount) },
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

  await PaymentTransaction.findByIdAndDelete(payment._id);
}
