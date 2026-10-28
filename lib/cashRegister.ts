import CashTransaction from "@/models/CashTransaction";
import Invoice from "@/models/Invoice";
import Expense from "@/models/Expense";
import FinanceTransaction from "@/models/FinanceTransaction";
import PaymentTransaction from "@/models/PaymentTransaction";

/**
 * Builds the same consolidated cash ledger + running balance the Cash Register
 * page shows. Pulled out of app/api/cash-register/route.ts so Day-Close can
 * snapshot "what the system expects the drawer to hold" without re-deriving
 * this logic a second time and risking the two drifting apart.
 */
/** "YYYY-MM-DD" in India time — the server runs in UTC. */
const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

/** When a cash movement happened. A register entry's typed date + "HH:MM" (India
 *  time) wins, since a handover can be recorded later than it happened. */
function momentOf(date?: string, time?: string, createdAt?: any): number {
  const hm = String(time || "").match(/^(\d{1,2}):(\d{2})/);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && hm && !/[ap]m/i.test(String(time))) {
    return new Date(`${date}T${hm[1].padStart(2, "0")}:${hm[2]}:00+05:30`).getTime();
  }
  const c = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!isNaN(c)) return c;
  return date ? new Date(`${date}T12:00:00+05:30`).getTime() : 0;
}

export async function getCashRegisterSummary() {
  const todayStr = istDay(new Date());

  const recordedTxns = await CashTransaction.find({}).sort({ createdAt: -1 });

  // Only real completed sales count as cash in hand — see the matching note in
  // the cash-register route for why `type: "tax-invoice"` is required here.
  const cashInvoices = await Invoice.find({
    type: "tax-invoice",
    $or: [
      { paymentMode: "Cash" },
      { paymentMode: "cash" },
      { "payments.mode": { $regex: /cash/i } },
    ],
    status: { $ne: "cancelled" },
  }).sort({ createdAt: -1 });

  const cashExpenses = await Expense.find({
    $or: [{ paymentMode: "Cash" }, { paymentMode: "cash" }],
  }).sort({ createdAt: -1 });

  const financeRecords = await FinanceTransaction.find({}).sort({ createdAt: -1 });

  // FinanceTransaction itself never recorded how the down payment was actually
  // collected — only the Invoice it came from does (financeDownPaymentMode).
  // Without this join, every finance down payment got labelled "Cash" here
  // regardless of whether it was really UPI/card/online.
  const financeInvoiceNumbers = financeRecords.map((f: any) => f.invoiceNumber).filter(Boolean);
  const linkedInvoices = financeInvoiceNumbers.length
    ? await Invoice.find(
        { invoiceNumber: { $in: financeInvoiceNumbers } },
        { invoiceNumber: 1, financeDownPaymentMode: 1 }
      ).lean()
    : [];
  const downPaymentModeByInvoice = new Map(
    linkedInvoices.map((i: any) => [i.invoiceNumber, i.financeDownPaymentMode])
  );

  const consolidatedLedger: any[] = [];
  const seenRefs = new Set<string>();

  recordedTxns.forEach((tx) => {
    seenRefs.add(tx.referenceNo);
    consolidatedLedger.push({
      _id: tx._id.toString(),
      type: tx.type,
      category: tx.category,
      amount: Number(tx.amount || 0),
      date: tx.date || todayStr,
      time: tx.time || "12:00 PM",
      referenceNo: tx.referenceNo,
      description: tx.description || "",
      partyName: tx.partyName || "",
      targetBankAccount: tx.targetBankAccount || "",
      handedTo: tx.handedTo || "",
      recordedBy: tx.recordedBy || "Cashier / Admin",
      source: "CASH_TRANSACTION",
      at: momentOf(tx.date, tx.time, (tx as any).createdAt),
    });
  });

  cashInvoices.forEach((inv: any) => {
    if (!seenRefs.has(inv.invoiceNumber)) {
      seenRefs.add(inv.invoiceNumber);
      // The bill's own date. Bills keep it in `date`; reading `invoiceDate` (which no
      // bill has) put every cash bill ever on "today", so today's cash showed the
      // all-time total — ₹1,67,500 handed over on a day with no cash sale.
      const invDate = String(inv.date || inv.invoiceDate || "").slice(0, 10) || (inv.createdAt ? istDay(new Date(inv.createdAt)) : todayStr);

      const cashRows = Array.isArray(inv.payments)
        ? inv.payments.filter((p: any) => /cash/i.test(p?.mode || ""))
        : [];
      const isSplit = Array.isArray(inv.payments) && inv.payments.length > 1;
      // A plain cash bill: what was actually paid on it (normally the whole bill).
      const cashAmount = isSplit
        ? cashRows.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0)
        : Number(inv.paidAmount) > 0
        ? Number(inv.paidAmount)
        : Number(inv.grandTotal || inv.totalAmount || inv.total || 0);

      if (cashAmount <= 0) return;

      consolidatedLedger.push({
        _id: `INV-${inv._id}`,
        type: "INFLOW",
        category: "CASH_SALE",
        amount: cashAmount,
        date: invDate,
        time: inv.createdAt ? new Date(inv.createdAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }) : "10:00 AM",
        referenceNo: inv.invoiceNumber,
        description: isSplit
          ? `Cash portion of Split Bill · ${inv.customerName || "Customer"}`
          : `Cash Sale Bill · ${inv.customerName || "Customer"}`,
        partyName: inv.customerName || "Walk-in Customer",
        recordedBy: "Sales Cashier",
        source: "INVOICE",
        at: momentOf(undefined, undefined, inv.createdAt) || momentOf(invDate),
      });
    }
  });

  // A Due / Credit bill where part of the amount was taken in cash at the counter.
  const dueCashBills = await Invoice.find(
    {
      type: "tax-invoice",
      status: { $ne: "cancelled" },
      paymentMode: { $regex: /due|credit/i },
      dueAdvanceMode: { $regex: /cash/i },
      paidAmount: { $gt: 0 },
    },
    { invoiceNumber: 1, customerName: 1, paidAmount: 1, dueAdvanceAmount: 1, date: 1, createdAt: 1 }
  ).lean();
  (dueCashBills as any[]).forEach((inv) => {
    const ref = `DUEADV-${inv.invoiceNumber}`;
    if (seenRefs.has(ref) || seenRefs.has(inv.invoiceNumber)) return;
    seenRefs.add(ref);
    const amount = Number(inv.dueAdvanceAmount) || Number(inv.paidAmount) || 0;
    if (amount <= 0) return;
    consolidatedLedger.push({
      _id: `DUEADV-${inv._id}`,
      type: "INFLOW",
      category: "CASH_SALE",
      amount,
      date: String(inv.date || "").slice(0, 10) || (inv.createdAt ? istDay(new Date(inv.createdAt)) : todayStr),
      time: inv.createdAt ? new Date(inv.createdAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }) : "",
      referenceNo: inv.invoiceNumber,
      description: `Cash received on Due / Credit bill · ${inv.customerName || "Customer"}`,
      partyName: inv.customerName || "Customer",
      recordedBy: "Sales Cashier",
      source: "INVOICE",
      at: momentOf(undefined, undefined, inv.createdAt),
    });
  });

  // Cash collected later against a bill — a due cleared, a payment received at
  // the counter. A bill's own first payment is already counted with the bill.
  const cashReceipts = await PaymentTransaction.find(
    { partyType: "Customer", type: "received", paymentMode: { $regex: /^cash/i } },
    { transactionId: 1, amount: 1, date: 1, referenceId: 1, partyName: 1, notes: 1, createdAt: 1 }
  ).lean();
  (cashReceipts as any[]).forEach((p) => {
    if (/^initial payment/i.test(String(p.notes || "")) || String(p.transactionId || "").startsWith("TXN-LEGACY")) return;
    const ref = String(p.transactionId);
    if (seenRefs.has(ref)) return;
    seenRefs.add(ref);
    const amount = Number(p.amount) || 0;
    if (amount <= 0) return;
    consolidatedLedger.push({
      _id: `RCPT-${p._id}`,
      type: "INFLOW",
      category: "CASH_RECEIPT",
      amount,
      date: String(p.date || "").slice(0, 10) || (p.createdAt ? istDay(new Date(p.createdAt)) : todayStr),
      time: p.createdAt ? new Date(p.createdAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }) : "",
      referenceNo: p.referenceId || ref,
      description: `Cash received${p.referenceId ? " against " + p.referenceId : ""}${p.notes ? " · " + p.notes : ""}`,
      partyName: p.partyName || "Customer",
      recordedBy: "Counter",
      source: "PAYMENT",
      at: momentOf(undefined, undefined, p.createdAt) || momentOf(p.date),
    });
  });

  financeRecords.forEach((f) => {
    const downPaymentMode = downPaymentModeByInvoice.get(f.invoiceNumber) || "";
    const isDownPaymentCash = /cash/i.test(downPaymentMode);
    if (Number(f.customerDownPayment) > 0 && isDownPaymentCash) {
      const dpRef = `DP-${f.doId}`;
      if (!seenRefs.has(dpRef)) {
        seenRefs.add(dpRef);
        consolidatedLedger.push({
          _id: `FIN-DP-${f._id}`,
          type: "INFLOW",
          category: "DOWN_PAYMENT",
          amount: Number(f.customerDownPayment),
          date: f.date ? f.date.split(" ")[0] : todayStr,
          time: "11:30 AM",
          referenceNo: dpRef,
          description: `Cash Down Payment for ${f.financeProvider} DO: ${f.doId}`,
          partyName: f.customerName,
          recordedBy: "Finance Desk",
          source: "FINANCE_DP",
          at: momentOf(undefined, undefined, (f as any).createdAt) || momentOf(f.date ? f.date.split(" ")[0] : todayStr),
        });
      }
    }

    if (Array.isArray(f.emiSchedule)) {
      f.emiSchedule.forEach((inst: any) => {
        if (inst.status === "Paid" && inst.paymentChannel === "Shop Counter" && inst.paymentMode === "Cash") {
          const emiRef = inst.receiptNumber || `EMI-${f.doId}-${inst.installmentNumber}`;
          if (!seenRefs.has(emiRef)) {
            seenRefs.add(emiRef);
            consolidatedLedger.push({
              _id: `FIN-EMI-${f._id}-${inst.installmentNumber}`,
              type: "INFLOW",
              category: "EMI_COLLECTION",
              amount: Number(inst.amount || 0),
              date: inst.paidDate || todayStr,
              time: "02:00 PM",
              referenceNo: emiRef,
              description: `Counter Cash EMI #${inst.installmentNumber} · ${f.financeProvider}`,
              partyName: f.customerName,
              recordedBy: inst.collectedBy || "Store Cashier",
              source: "FINANCE_EMI",
              at: momentOf(inst.paidDate || todayStr),
            });
          }
        }
      });
    }
  });

  cashExpenses.forEach((exp) => {
    if (!seenRefs.has(exp.expenseNo)) {
      seenRefs.add(exp.expenseNo);
      const expDate = exp.date ? exp.date.split("T")[0] : todayStr;
      consolidatedLedger.push({
        _id: `EXP-${exp._id}`,
        type: "OUTFLOW",
        category: "CASH_EXPENSE",
        amount: Number(exp.amount || 0),
        date: expDate,
        time: exp.createdAt ? new Date(exp.createdAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }) : "04:30 PM",
        referenceNo: exp.expenseNo,
        description: `Store Expense · ${exp.category} (${exp.description || ""})`,
        partyName: exp.category,
        recordedBy: "Store Manager",
        source: "EXPENSE",
        at: momentOf(undefined, undefined, (exp as any).createdAt) || momentOf(expDate),
      });
    }
  });

  consolidatedLedger.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  let totalInflow = 0;
  let totalOutflow = 0;
  let todayInflow = 0;
  let todayOutflow = 0;
  let bankDepositsTotal = 0;
  let mdHandoversTotal = 0;
  let cashExpensesTotal = 0;

  consolidatedLedger.forEach((item) => {
    const amt = Number(item.amount || 0);
    const isToday = item.date === todayStr;

    if (item.type === "INFLOW") {
      totalInflow += amt;
      if (isToday) todayInflow += amt;
    } else {
      totalOutflow += amt;
      if (isToday) todayOutflow += amt;

      if (item.category === "BANK_DEPOSIT") bankDepositsTotal += amt;
      else if (item.category === "MD_HANDOVER") mdHandoversTotal += amt;
      else if (item.category === "CASH_EXPENSE") cashExpensesTotal += amt;
    }
  });

  // What the cashier should hand over now: the cash that came in (less cash
  // spent or banked) after the last handover to the Admin. Only real cash
  // movements count — never the all-time total.
  const handovers = consolidatedLedger
    .filter((e) => e.category === "MD_HANDOVER")
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  const lastHandover = handovers[0] || null;
  const sinceAt = lastHandover?.at || 0;
  let cashSinceLastHandover = 0;
  const sinceLastHandover: any[] = [];
  consolidatedLedger.forEach((e) => {
    if (e.category === "MD_HANDOVER" || !(Number(e.at) > sinceAt)) return;
    cashSinceLastHandover += (e.type === "INFLOW" ? 1 : -1) * (Number(e.amount) || 0);
    sinceLastHandover.push(e);
  });

  const baseOpening = 200000;
  const currentBalance = Math.max(0, baseOpening + totalInflow - totalOutflow);

  return {
    currentBalance,
    baseOpening,
    totalInflow,
    totalOutflow,
    todayInflow,
    todayOutflow,
    bankDepositsTotal,
    mdHandoversTotal,
    cashExpensesTotal,
    cashSinceLastHandover: Math.max(0, Math.round(cashSinceLastHandover * 100) / 100),
    lastHandover: lastHandover ? { amount: lastHandover.amount, date: lastHandover.date, time: lastHandover.time, at: lastHandover.at } : null,
    sinceLastHandover: sinceLastHandover.sort((a, b) => (a.at || 0) - (b.at || 0)),
    ledger: consolidatedLedger,
  };
}
