import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Vendor from "@/models/Vendor";
import VendorBill from "@/models/VendorBill";
import VendorPayment from "@/models/VendorPayment";
import Supplier from "@/models/Supplier";
import Customer from "@/models/Customer";
import Invoice from "@/models/Invoice";
import PurchaseEntry from "@/models/PurchaseEntry";
import PaymentTransaction from "@/models/PaymentTransaction";
import { requirePermission } from "@/lib/requirePermission";
import { classifyPaymentMode } from "@/lib/payment-modes";
import {
  LedgerEntryInput,
  buildLedger,
  carryForwardBefore,
  filterByRange,
} from "@/lib/ledger";

/**
 * One ledger endpoint for every party type.
 *
 *   ?party=vendor|supplier|customer   which book to read
 *   &id=<mongo id>                    a single party's full ledger
 *   (no id)                           a summary row per party
 *   &from=YYYY-MM-DD&to=YYYY-MM-DD    optional range, with carry-forward opening
 *
 * The supplier and customer sides read existing documents without writing
 * anything, and derive balances from those rows rather than from the stored
 * `paid` / `outstandingBalance` fields — those are only maintained on some
 * paths, so trusting them would report a party as owing money already paid.
 */

type PartyKind = "vendor" | "supplier" | "customer";

const PERMISSION_BY_PARTY = {
  vendor: "ledger.vendor.view",
  supplier: "ledger.supplier.view",
  customer: "ledger.customer.view",
} as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Ledger entries for one vendor, from its own bills and payments. */
function vendorEntries(bills: any[], payments: any[]): LedgerEntryInput[] {
  const entries: LedgerEntryInput[] = [];

  for (const bill of bills) {
    if (bill.status === "cancelled") continue;
    entries.push({
      kind: "bill",
      date: bill.date,
      ref: bill.billNo,
      label: `Bill #${bill.billNo}`,
      amount: Number(bill.total) || 0,
      dueDate: bill.dueDate,
      by: bill.createdBy,
      notes: bill.notes,
      raw: bill,
    });
  }

  for (const p of payments) {
    entries.push({
      kind: "payment",
      date: p.date,
      ref: p.paymentId,
      label: p.type === "paid" ? "Refund Issued" : "Payment Received",
      amount: Number(p.amount) || 0,
      mode: p.mode,
      refNo: p.refNo,
      by: p.receivedBy || p.createdBy,
      notes: p.notes,
      // A refund flows the other way: it puts the balance back up.
      reverse: p.type === "paid",
      raw: p,
    });
  }

  return entries;
}

/**
 * Ledger entries for one supplier, from purchase bills and payment transactions.
 *
 * Most purchase bills are settled as they are entered — the purchase form writes
 * the amount straight onto the bill's `paid` field and never creates a
 * PaymentTransaction. Counting only PaymentTransaction rows would therefore report
 * every one of those bills as still owing, which is exactly what a supplier who
 * has already been paid in full must NOT look like. So money recorded on the bill
 * counts as a payment, unless a transaction already references that bill — in
 * which case the transaction is the record and adding both would pay it twice.
 * This mirrors how a counter-collected invoice is handled on the customer side.
 */
function supplierEntries(bills: any[], payments: any[]): LedgerEntryInput[] {
  const rows: LedgerEntryInput[] = [];
  const referencedBills = new Set(
    payments.map((p: any) => p.referenceId).filter(Boolean)
  );

  for (const bill of bills) {
    // A cancelled purchase bill is no longer owed (its stock and the supplier's
    // balance were reversed when it was cancelled), so it leaves the ledger.
    if (bill.status === "cancelled") continue;
    rows.push({
      kind: "bill",
      date: bill.billDate || bill.date,
      ref: bill.billNo,
      label:
        bill.type === "debit-note"
          ? `Debit Note #${bill.billNo}`
          : `Purchase Bill #${bill.billNo}`,
      amount: Number(bill.total) || 0,
      dueDate: bill.dueDate,
      notes: bill.warehouse,
      // A debit note reduces what we owe the supplier.
      reverse: bill.type === "debit-note",
      raw: bill,
    });

    const paidOnBill = Number(bill.paid) || 0;
    if (paidOnBill > 0 && bill.type !== "debit-note" && !referencedBills.has(bill.billNo)) {
      rows.push({
        kind: "payment",
        date: bill.billDate || bill.date,
        ref: `${bill.billNo}-PAID`,
        label: "Paid at purchase entry",
        amount: paidOnBill,
        mode: bill.paymentMode || "Cash",
        refNo: bill.billNo,
        raw: bill,
      });
    }
  }

  for (const p of payments) {
    rows.push({
      kind: "payment",
      date: p.date,
      ref: p.transactionId,
      label: p.type === "paid" ? "Payment Made" : "Refund Received",
      amount: Number(p.amount) || 0,
      mode: p.paymentMode,
      refNo: p.referenceId,
      notes: p.notes,
      // We normally pay a supplier; a refund coming back raises the balance again.
      reverse: p.type === "received",
      raw: p,
    });
  }

  return rows;
}

/**
 * Ledger entries for one customer, from invoices and receipts.
 *
 * A bill collected at the counter usually has no PaymentTransaction of its own —
 * the money sits in the invoice's `paidAmount`. Those are folded in as receipts
 * here, but only where no PaymentTransaction already references that invoice
 * number, or the same rupees would be credited twice.
 */
function customerEntries(invoices: any[], payments: any[]): LedgerEntryInput[] {
  const rows: LedgerEntryInput[] = [];
  const referencedInvoices = new Set(
    payments.map((p: any) => p.referenceId).filter(Boolean)
  );

  // Documents that represent money owed BACK to the customer. A settlement against
  // one of these is a payout however it was tagged: the "Clear Due" flow does not
  // check the document type, so credit notes that were settled through it carry a
  // `type: "received"` transaction. Counting that as an inbound receipt would let
  // the credit note reduce the balance twice — once as a negative bill, once as a
  // receipt — which is what drove some customer ledgers deeply negative.
  const creditNoteRefs = new Set(
    invoices.filter((inv: any) => inv.type === "credit-note").map((inv: any) => inv.invoiceNumber)
  );

  for (const inv of invoices) {
    // A cancelled bill is no longer owed, so it leaves the balance entirely.
    if (inv.status === "cancelled") continue;
    // Proformas and estimates are not receivables.
    if (inv.type === "proforma") continue;

    rows.push({
      kind: "bill",
      date: inv.date,
      ref: inv.invoiceNumber,
      label:
        inv.type === "credit-note"
          ? `Credit Note #${inv.invoiceNumber}`
          : `Invoice #${inv.invoiceNumber}`,
      amount: Number(inv.total) || 0,
      dueDate: inv.dueDate,
      by: inv.salesExecutive,
      notes: inv.notes,
      reverse: inv.type === "credit-note",
      raw: inv,
    });

    const paidAtCounter = Number(inv.paidAmount) || 0;
    if (paidAtCounter > 0 && !referencedInvoices.has(inv.invoiceNumber)) {
      rows.push({
        kind: "payment",
        date: inv.date,
        ref: `${inv.invoiceNumber}-COLLECTED`,
        label: "Collected at billing",
        amount: paidAtCounter,
        mode: inv.paymentMode || "Cash",
        refNo: inv.invoiceNumber,
        by: inv.cashReceivedBy || inv.salesExecutive,
        raw: inv,
      });
    }
  }

  for (const p of payments) {
    const settlesCreditNote = p.referenceId && creditNoteRefs.has(p.referenceId);
    const isPayout = p.type === "paid" || settlesCreditNote;

    rows.push({
      kind: "payment",
      date: p.date,
      ref: p.transactionId,
      label: isPayout ? "Refund Issued" : "Payment Received",
      amount: Number(p.amount) || 0,
      mode: p.paymentMode,
      refNo: p.referenceId,
      notes: p.notes,
      // A refund to the customer puts the balance back up.
      reverse: isPayout,
      raw: p,
    });
  }

  return rows;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requested = (searchParams.get("party") || "vendor").toLowerCase();
  const party: PartyKind = (["vendor", "supplier", "customer"] as const).includes(
    requested as PartyKind
  )
    ? (requested as PartyKind)
    : "vendor";

  const gate = await requirePermission(PERMISSION_BY_PARTY[party]);
  if (!gate.ok) return gate.response;

  try {
    await connectToDatabase();

    const id = searchParams.get("id");
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
    const side: "payable" | "receivable" = party === "supplier" ? "payable" : "receivable";

    // ── Load every party plus the documents that make up their ledgers ──────────
    let parties: any[];
    const entriesByParty = new Map<string, LedgerEntryInput[]>();
    // Kept alongside entriesByParty so the single-party detail branch below can
    // build a bill-by-bill breakdown without re-querying or re-matching.
    const rawByParty = new Map<string, { bills: any[]; pays: any[] }>();

    if (party === "supplier") {
      const [suppliers, purchases, payments] = await Promise.all([
        id ? Supplier.find({ _id: id }).lean() : Supplier.find({}).lean(),
        PurchaseEntry.find({}).lean(),
        PaymentTransaction.find({ partyType: "Supplier" }).lean(),
      ]);

      parties = suppliers as any[];

      for (const s of parties) {
        const sid = String(s._id);
        const name = String(s.name || "").trim();
        const nameMatch = name ? new RegExp(`^${escapeRegex(name)}$`, "i") : null;

        // Purchase entries carry only `supplierName`, so matching falls back to the
        // name where no id was stored. Both are checked so old and new rows work.
        const bills = (purchases as any[]).filter((b) => {
          if (b.supplierId && String(b.supplierId) === sid) return true;
          return nameMatch ? nameMatch.test(String(b.supplierName || "").trim()) : false;
        });

        // The party type is already filtered in the query above: without it a
        // customer receipt whose partyId happened to match could land here.
        const pays = (payments as any[]).filter((p) => {
          const pid = String(p.partyId || "");
          return pid === sid || (s.code && pid === String(s.code));
        });

        entriesByParty.set(sid, supplierEntries(bills, pays));
        rawByParty.set(sid, { bills, pays });
      }
    } else if (party === "customer") {
      const [customers, invoices, payments] = await Promise.all([
        id ? Customer.find({ _id: id }).lean() : Customer.find({}).lean(),
        // A quotation is not a bill raised on the customer, so it stays out of their ledger.
        id
          ? Invoice.find({ customerId: id, type: { $ne: "proforma" } }).lean()
          : Invoice.find({ type: { $ne: "proforma" } }).lean(),
        PaymentTransaction.find({ partyType: "Customer" }).lean(),
      ]);

      parties = customers as any[];

      for (const c of parties) {
        const cid = String(c._id);
        const name = String(c.name || "").trim();
        const nameMatch = name ? new RegExp(`^${escapeRegex(name)}$`, "i") : null;

        const theirInvoices = (invoices as any[]).filter((inv) => {
          if (String(inv.customerId || "") === cid) return true;
          return nameMatch ? nameMatch.test(String(inv.customerName || "").trim()) : false;
        });
        const theirPayments = (payments as any[]).filter((p) => {
          const pid = String(p.partyId || "");
          return pid === cid || (c.code && pid === String(c.code));
        });

        entriesByParty.set(cid, customerEntries(theirInvoices, theirPayments));
      }
    } else {
      const [vendors, bills, payments] = await Promise.all([
        id ? Vendor.find({ _id: id }).lean() : Vendor.find({}).lean(),
        id ? VendorBill.find({ vendorId: id }).lean() : VendorBill.find({}).lean(),
        id ? VendorPayment.find({ vendorId: id }).lean() : VendorPayment.find({}).lean(),
      ]);

      parties = vendors as any[];

      for (const v of parties) {
        const vid = String(v._id);
        entriesByParty.set(
          vid,
          vendorEntries(
            (bills as any[]).filter((b) => String(b.vendorId) === vid),
            (payments as any[]).filter((p) => String(p.vendorId) === vid)
          )
        );
      }
    }

    if (id && parties.length === 0) {
      return NextResponse.json({ success: false, error: "Party not found" }, { status: 404 });
    }

    // ── Build each party's ledger ───────────────────────────────────────────────
    const asOf = new Date();
    const results = parties.map((p: any) => {
      const pid = String(p._id);
      const all = entriesByParty.get(pid) || [];

      // A stored opening balance seeds the book; a date filter adds whatever the
      // rows before `from` come to, so a filtered view still starts from the truth.
      const stored = Number(p.openingBalance) || 0;
      const opening = stored + carryForwardBefore(all, from);
      const scoped = filterByRange(all, from, to);

      const ledger = buildLedger(scoped, {
        side,
        openingBalance: opening,
        openingDate: from || p.openingBalanceDate || "",
        asOf,
      });

      // Payment modes are bucketed with the same classifier the sales dashboard
      // uses, so NEFT / IMPS / RTGS report as "online" here exactly as they do there.
      const byBucket: Record<string, number> = {
        cash: 0,
        upi: 0,
        online: 0,
        card: 0,
        finance: 0,
        due: 0,
      };
      for (const [mode, amount] of Object.entries(ledger.summary.byMode)) {
        const bucket = classifyPaymentMode(mode);
        byBucket[bucket] = (byBucket[bucket] || 0) + amount;
      }

      return {
        party: {
          _id: pid,
          code: p.code,
          name: p.name,
          phone: p.phone,
          email: p.email,
          gstNumber: p.gstNumber,
          // Customers keep their address under `billingAddress`; vendors and
          // suppliers use `address`.
          city: p.address?.city || p.billingAddress?.city || "",
          state: p.address?.state || p.billingAddress?.state || "",
          creditDays: p.creditDays,
          creditLimit: p.creditLimit,
          status: p.status,
        },
        summary: { ...ledger.summary, byBucket },
        rows: id ? ledger.rows : undefined,
      };
    });

    // ── Single party: full ledger, plus a bill-by-bill breakdown ───────────────
    if (id) {
      const detail: any = results[0];

      if (party === "vendor") {
        const [bills, payments] = await Promise.all([
          VendorBill.find({ vendorId: id }).sort({ date: 1 }).lean(),
          VendorPayment.find({ vendorId: id }).sort({ date: 1 }).lean(),
        ]);

        // How much of each bill is settled. A payment tagged with a bill number
        // pays that bill first; whatever is left over — plus every on-account
        // payment — is spread across the remaining bills oldest-first, which is
        // how a running account is normally squared off.
        const paidPerBill = new Map<string, number>();
        let onAccount = 0;

        for (const p of payments as any[]) {
          const amount = (p.type === "paid" ? -1 : 1) * (Number(p.amount) || 0);
          if (p.againstBillNo) {
            paidPerBill.set(p.againstBillNo, (paidPerBill.get(p.againstBillNo) || 0) + amount);
          } else {
            onAccount += amount;
          }
        }

        const openBills = (bills as any[]).filter((b) => b.status !== "cancelled");
        const billRows = openBills.map((b: any) => {
          const total = Number(b.total) || 0;
          let paid = Math.min(paidPerBill.get(b.billNo) || 0, total);
          if (paid < total && onAccount > 0) {
            const extra = Math.min(onAccount, total - paid);
            paid += extra;
            onAccount -= extra;
          }
          const balance = Math.max(0, total - paid);
          const overdue =
            balance > 0 && b.dueDate ? new Date(b.dueDate) < new Date() : false;

          return {
            billNo: b.billNo,
            date: b.date,
            dueDate: b.dueDate,
            items: b.items || [],
            itemCount: (b.items || []).length,
            subtotal: Number(b.subtotal) || 0,
            gstAmount: Number(b.gstAmount) || 0,
            total,
            paid,
            balance,
            reference: b.reference || "",
            notes: b.notes || "",
            createdBy: b.createdBy || "",
            status: balance <= 0 ? "paid" : paid > 0 ? "partial" : overdue ? "overdue" : "pending",
          };
        });

        detail.bills = billRows.reverse();
        detail.cancelledBills = (bills as any[])
          .filter((b) => b.status === "cancelled")
          .map((b: any) => ({
            billNo: b.billNo,
            date: b.date,
            total: Number(b.total) || 0,
            cancelReason: b.cancelReason || "",
            cancelledBy: b.cancelledBy || "",
            cancelledAt: b.cancelledAt || "",
          }));
        detail.payments = (payments as any[])
          .map((p: any) => ({
            paymentId: p.paymentId,
            date: p.date,
            amount: Number(p.amount) || 0,
            mode: p.mode,
            bucket: classifyPaymentMode(p.mode),
            refNo: p.refNo || "",
            againstBillNo: p.againstBillNo || "",
            receivedBy: p.receivedBy || p.createdBy || "",
            createdBy: p.createdBy || "",
            notes: p.notes || "",
            type: p.type,
          }))
          .reverse();
        detail.unallocated = Math.max(0, onAccount);
      } else if (party === "supplier") {
        const { bills, pays } = rawByParty.get(id) || { bills: [], pays: [] };

        // Same allocation rule as supplierEntries(): a payment tagged with a
        // bill number pays that bill first; a purchase entry's own `paid`
        // field only counts when no PaymentTransaction already references it
        // (otherwise the same rupees would show as paid twice).
        const referencedBillNos = new Set(
          (pays as any[]).map((p) => p.referenceId).filter(Boolean)
        );
        const paidPerBill = new Map<string, number>();
        let onAccount = 0;

        for (const p of pays as any[]) {
          const amount = (p.type === "received" ? -1 : 1) * (Number(p.amount) || 0);
          if (p.referenceId) {
            paidPerBill.set(p.referenceId, (paidPerBill.get(p.referenceId) || 0) + amount);
          } else {
            onAccount += amount;
          }
        }

        const openBills = (bills as any[]).filter((b) => b.status !== "cancelled");
        const billRows = openBills.map((b: any) => {
          const total = Number(b.total) || 0;
          const isDebitNote = b.type === "debit-note";
          let paid = referencedBillNos.has(b.billNo)
            ? Math.min(paidPerBill.get(b.billNo) || 0, total)
            : Math.min(Number(b.paid) || 0, total);
          if (!isDebitNote && paid < total && onAccount > 0) {
            const extra = Math.min(onAccount, total - paid);
            paid += extra;
            onAccount -= extra;
          }
          // Under one paisa left is settled (GST maths leaves fractions on old bills).
          const rawBalance = isDebitNote ? 0 : Math.max(0, total - paid);
          const balance = rawBalance < 0.01 ? 0 : Math.round(rawBalance * 100) / 100;
          const overdue = balance > 0 && b.dueDate ? new Date(b.dueDate) < new Date() : false;

          return {
            billNo: b.billNo,
            date: b.billDate,
            dueDate: b.dueDate,
            type: b.type,
            items: b.items || [],
            itemCount: (b.items || []).length,
            subtotal: Number(b.subtotal) || 0,
            gstAmount: Number(b.gst) || 0,
            total,
            paid,
            balance,
            warehouse: b.warehouse || "",
            status: isDebitNote
              ? "debit-note"
              : balance <= 0
              ? "paid"
              : paid > 0
              ? "partial"
              : overdue
              ? "overdue"
              : "pending",
          };
        });

        detail.bills = billRows.reverse();
        detail.cancelledBills = (bills as any[])
          .filter((b) => b.status === "cancelled")
          .map((b: any) => ({
            billNo: b.billNo,
            date: b.billDate,
            total: Number(b.total) || 0,
            cancelReason: b.cancelReason || "",
            cancelledBy: b.cancelledBy || "",
            cancelledAt: b.cancelledAt || "",
          }));
        detail.payments = (pays as any[])
          .map((p: any) => ({
            paymentId: p.transactionId,
            date: p.date,
            amount: Number(p.amount) || 0,
            mode: p.paymentMode,
            bucket: classifyPaymentMode(p.paymentMode),
            refNo: p.referenceId || "",
            againstBillNo: p.referenceId || "",
            receivedBy: "",
            createdBy: "",
            notes: p.notes || "",
            type: p.type,
          }))
          .reverse();
        detail.unallocated = Math.max(0, onAccount);
      }

      return NextResponse.json({ success: true, data: detail });
    }

    const totals = results.reduce(
      (acc, r) => {
        acc.totalBilled += r.summary.totalBilled;
        acc.totalPaid += r.summary.totalPaid;
        acc.outstanding += r.summary.closingBalance;
        acc.overdue += r.summary.overdueAmount;
        acc.ageing.current += r.summary.ageing.current;
        acc.ageing.d31to60 += r.summary.ageing.d31to60;
        acc.ageing.d61to90 += r.summary.ageing.d61to90;
        acc.ageing.d90plus += r.summary.ageing.d90plus;
        for (const [bucket, amount] of Object.entries(r.summary.byBucket)) {
          acc.byBucket[bucket] = (acc.byBucket[bucket] || 0) + (amount as number);
        }
        return acc;
      },
      {
        parties: results.length,
        totalBilled: 0,
        totalPaid: 0,
        outstanding: 0,
        overdue: 0,
        ageing: { current: 0, d31to60: 0, d61to90: 0, d90plus: 0 },
        byBucket: {} as Record<string, number>,
      }
    );

    return NextResponse.json({
      success: true,
      data: {
        side,
        party,
        totals,
        parties: results
          .map((r) => ({ ...r.party, summary: r.summary }))
          .sort((a, b) => b.summary.closingBalance - a.summary.closingBalance),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
