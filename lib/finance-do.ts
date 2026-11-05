import FinanceTransaction from "@/models/FinanceTransaction";
import { classifyPaymentMode } from "@/lib/payment-modes";

/**
 * Finance DOs.
 *
 * One DO (the financier's delivery order) normally belongs to one bill. A customer's one loan can also cover a second
 * bill (e.g. a cooler bought a few days after the TV under the same IDFC DO): that bill is *linked* to the existing DO
 * (`linkedInvoices`) instead of getting a DO of its own, and the DO's payout closes it too. A DO ID that belongs to a
 * different customer is refused.
 */

const digits10 = (s: any) => String(s || "").replace(/\D/g, "").slice(-10);
const normName = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase().replace(/^(mr|mrs|ms|shri|smt)\.?\s+/, "");

/** Is this existing DO for the same customer as the bill (same mobile, or same name when a mobile is missing)? */
export function sameFinanceCustomer(doc: any, bill: { customerPhone?: string; customerName?: string }): boolean {
  const a = digits10(doc?.customerMobile);
  const b = digits10(bill.customerPhone);
  if (a.length === 10 && b.length === 10) return a === b;
  return !!normName(doc?.customerName) && normName(doc?.customerName) === normName(bill.customerName);
}

/** The DO files a form sent: the list, plus the single field older forms send. */
export function financeFilesOf(body: any): string[] {
  const list = Array.isArray(body?.financePdfUrls) ? body.financePdfUrls : [];
  return [...new Set([...list, body?.financePdfUrl].map((u: any) => String(u || "").trim()).filter(Boolean))];
}

/**
 * A DO ID typed on a bill: `null` when it is free, `{ link }` when it is this customer's existing DO (the bill joins
 * it), `{ error }` when it is another customer's.
 */
export async function checkDoId(
  doId: string,
  bill: { invoiceNumber: string; customerPhone?: string; customerName?: string }
): Promise<null | { link: any } | { error: string }> {
  const id = String(doId || "").trim();
  if (!id) return null;
  const other: any = await FinanceTransaction.findOne({ doId: id }).lean();
  if (!other || other.invoiceNumber === bill.invoiceNumber) return null;
  if (sameFinanceCustomer(other, bill)) return { link: other };
  return {
    error: `DO ID ${id} is already used on bill ${other.invoiceNumber} of another customer (${other.customerName}). Enter this bill's own DO ID.`,
  };
}

/** Join a bill to an existing DO of the same customer, and add any new DO files to it. */
export async function linkBillToDO(doId: string, invoiceNumber: string, amount: number, files: string[] = []) {
  const doc: any = await FinanceTransaction.findOne({ doId });
  if (!doc) return null;
  if (doc.invoiceNumber !== invoiceNumber && !(doc.linkedInvoices || []).some((l: any) => l.invoiceNumber === invoiceNumber)) {
    doc.linkedInvoices = [...(doc.linkedInvoices || []), { invoiceNumber, amount: Math.max(0, Number(amount) || 0), linkedAt: new Date() }];
  }
  if (files.length) {
    const all = [...new Set([...(doc.uploadedPdfUrls || []), ...(doc.uploadedPdfUrl ? [doc.uploadedPdfUrl] : []), ...files])];
    doc.uploadedPdfUrls = all;
    if (!doc.uploadedPdfUrl) doc.uploadedPdfUrl = all[0];
  }
  await doc.save();
  return doc;
}

/** More DOs on the same bill (the loan split across several DOs), as the form sends them. */
export function extraDosOf(body: any): { provider: string; doId: string; amount: number }[] {
  return (Array.isArray(body?.financeDos) ? body.financeDos : [])
    .map((r: any) => ({ provider: String(r?.provider || "").trim(), doId: String(r?.doId || "").trim(), amount: Math.round((Number(r?.amount) || 0) * 100) / 100 }))
    .filter((r: any) => r.doId && r.amount > 0);
}

/**
 * Check a bill's extra DOs before anything is saved: each DO number once on the bill and different from DO 1, each
 * with a loan amount, together less than the bill's loan, and none of them another bill's DO.
 */
export async function checkExtraDos(
  rows: { provider: string; doId: string; amount: number }[],
  mainDoId: string,
  totalLoan: number,
  bill: { invoiceNumber: string; customerPhone?: string; customerName?: string }
): Promise<string | null> {
  if (rows.length === 0) return null;
  const ids = rows.map((r) => r.doId.toLowerCase());
  if (new Set(ids).size !== ids.length) return "The same DO number is written twice on this bill.";
  if (mainDoId && ids.includes(String(mainDoId).trim().toLowerCase())) return "An extra DO has the same number as DO 1.";
  if (!String(mainDoId || "").trim()) return "Enter DO 1's number before adding more DOs.";
  const extra = rows.reduce((t, r) => t + r.amount, 0);
  if (!(totalLoan > extra + 0.5)) return `The other DOs (₹${extra.toLocaleString("en-IN")}) must be less than the loan (₹${Math.round(totalLoan).toLocaleString("en-IN")}); DO 1 gets the rest.`;
  for (const r of rows) {
    const other: any = await FinanceTransaction.findOne({ doId: r.doId }, { invoiceNumber: 1, customerName: 1 }).lean();
    if (other && other.invoiceNumber !== bill.invoiceNumber) {
      return `DO ID ${r.doId} is already used on bill ${other.invoiceNumber} (${other.customerName}).`;
    }
  }
  return null;
}

/** Make the DO record for each extra DO of a bill that does not have one yet. */
export async function createExtraDOs(
  bill: { invoiceNumber: string; customerName: string; customerPhone?: string; customerAddress?: string; date: string },
  rows: { provider: string; doId: string; amount: number }[],
  base: any = {}
) {
  for (const r of rows) {
    if (await FinanceTransaction.exists({ doId: r.doId })) continue;
    const subsidy = Math.round(r.amount * 0.0354);
    const deductions = subsidy + 270;
    await FinanceTransaction.create({
      financeProvider: r.provider || base.financeProvider || "Bajaj Finance Limited",
      customerName: bill.customerName,
      customerMobile: bill.customerPhone || "N/A",
      deliveryAddress: bill.customerAddress || "Gorakhpur, Uttar Pradesh",
      invoiceNumber: bill.invoiceNumber,
      atosDealId: `CS${Date.now()}`,
      doId: r.doId,
      date: bill.date,
      productPrice: r.amount,
      grossLoanAmount: r.amount,
      netLoanAmount: r.amount,
      dealerInterestSubsidy: subsidy,
      totalGst: 118,
      convenienceFee: 270,
      customerDownPayment: 0,
      totalDeductions: deductions,
      netDisbursement: Math.max(0, r.amount - deductions),
      approvalStatus: "Pending",
      remarks: `Extra DO on bill ${bill.invoiceNumber} (the bill's loan is split across several DOs)`,
    });
  }
}

/**
 * The finance DO for a bill paid through finance — the same calculation the bill form uses when a finance bill is
 * made (app/api/invoices/route.ts, step 4.6). Used when the Admin adds finance to an existing bill on an edit. If the
 * DO ID is this customer's existing DO, the bill is linked to it instead.
 * A split bill's finance row is the loan (its other rows are counted through `payments`, so no down payment).
 */
export async function createFinanceDO(
  bill: { invoiceNumber: string; customerName: string; customerPhone?: string; customerAddress?: string; date: string; total: number; balance?: number },
  body: any,
  splitRows: { mode: string; amount: number }[] = []
) {
  const own = await FinanceTransaction.findOne({ invoiceNumber: bill.invoiceNumber }).lean();
  if (own) return own;
  const files = financeFilesOf(body);
  const typed = String(body.financeDoId || "").trim();
  const check = await checkDoId(typed, bill);
  if (check && "error" in check) throw new Error(check.error);
  if (check && "link" in check) return linkBillToDO(typed, bill.invoiceNumber, Number(bill.balance) || 0, files);

  const financeSplitAmount = splitRows
    .filter((p) => classifyPaymentMode(p.mode) === "finance")
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const doId = typed || `DO-${new Date().getFullYear()}-${Math.floor(100000000 + Math.random() * 900000000)}`;
  // DO 1 carries what is left of the loan after the bill's other DOs.
  const extraSum = extraDosOf(body).reduce((t, r) => t + r.amount, 0);
  const grossLoan = Math.max(0, (financeSplitAmount > 0 ? financeSplitAmount : Number(body.financeGrossLoan || bill.total || 0)) - extraSum);
  const downPayment = financeSplitAmount > 0 ? 0 : Number(body.downPayment || body.financeDownPayment || 0);
  const subsidy = Number(body.financeDealerSubsidy || Math.round(grossLoan * 0.0354));
  const deductions = downPayment + subsidy + 270;
  const first = (body.items || [])[0] || {};
  return FinanceTransaction.create({
    financeProvider: body.financeProvider || "Bajaj Finance Limited",
    customerName: bill.customerName,
    customerMobile: bill.customerPhone || "N/A",
    deliveryAddress: bill.customerAddress || "Gorakhpur, Uttar Pradesh",
    invoiceNumber: bill.invoiceNumber,
    atosDealId: body.financeAppId || `CS${Date.now()}`,
    doId,
    date: bill.date,
    assetCategory: first.category || "Electronics",
    oemCategory: first.itemName || "Electronics",
    manufacturer: first.brand || "Havells (Lloyd)",
    brand: first.brand || "Havells (Lloyd)",
    model: first.itemName || "",
    productModel: first.itemName || "",
    productPrice: bill.total,
    grossLoanAmount: grossLoan,
    netLoanAmount: grossLoan,
    marginMoney: 0,
    advanceEmi: 0,
    dealerInterestSubsidy: subsidy,
    totalGst: 118,
    convenienceFee: 270,
    customerDownPayment: downPayment,
    totalDeductions: deductions,
    netDisbursement: Math.max(0, grossLoan - deductions),
    approvalStatus: financeSplitAmount > 0 ? "Pending" : body.financeApprovalStatus || "Pending",
    uploadedPdfUrl: files[0] || "",
    uploadedPdfUrls: files.length ? files : undefined,
  });
}
