import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import PaymentTransaction from "@/models/PaymentTransaction";
import { purchasePaymentState, round2 } from "@/lib/purchase-payments";

/** The purchase bill a supplier payment is made against, if it names one. */
async function purchaseBillFor(referenceId: any) {
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
