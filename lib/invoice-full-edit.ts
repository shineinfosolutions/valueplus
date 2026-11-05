import mongoose from "mongoose";
import Invoice from "@/models/Invoice";
import Customer from "@/models/Customer";
import Item from "@/models/Item";
import AuditLog from "@/models/AuditLog";
import { applyStockMovement } from "@/lib/stock";
import { stampLineCosts } from "@/lib/sale-cost";
import { derivePaymentModeLabel, isCollectedMode, classifyPaymentMode } from "@/lib/payment-modes";
import { derivePanFromGstin } from "@/lib/gst";
import { entityOf, entityLabel } from "@/lib/billing-entity";
import { publishChange } from "@/lib/realtime";
import { onsitegoIncentiveOf } from "@/lib/onsitego";
import { stampLineIncentives } from "@/lib/incentive-server";
import { checkDoId, checkExtraDos, createExtraDOs, createFinanceDO, extraDosOf, financeFilesOf } from "@/lib/finance-do";

/**
 * Full edit of a saved tax invoice from the billing form: products, rates,
 * customer and payment can all change, and everything the original sale moved
 * is moved again to match — stock, serial numbers, the customer's balance, the
 * bill's own payment receipt, extended warranties, its delivery challan and
 * finance DO.
 *
 * Kept as they were on the original bill: number, company (billing entity),
 * the warehouse the stock came from, and any advance already deducted on it
 * (Advance Booking or Receive Payment credit). Money collected later against
 * the bill (due clearances) stays collected.
 *
 * The date may change under the same rule as a new bill: Admin or Store
 * Manager only, never in the future, and a Store Manager's back-dated bill
 * goes to the Admin for approval (a rejection puts the old date back).
 */

type Result = { ok: true; invoice: any } | { ok: false; status: number; error: string };

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const isRealItemId = (id: any) => mongoose.isValidObjectId(id);

// Fields the edit may not overwrite: identity, history and what the server
// derives itself.
const PROTECTED_FIELDS = [
  "_id", "__v", "invoiceNumber", "type", "date", "billingEntity", "warehouseId", "warehouse",
  "createdAt", "updatedAt", "status", "paidAmount", "balanceAmount",
  "advanceAdjusted", "advanceReceiptNo", "creditAdjusted",
  "deliveryOtp", "deliveryStatus", "deliveryChallanNo", "deliveredAt",
  "backdateStatus", "backdateMadeOn", "backdateRequestedBy",
  "cancelledAt", "cancelledBy", "cancelReason",
  "dueClearedMode", "dueClearedBy", "dueClearedNotes", "dueClearedTxnId", "dueClearedAt",
  "printLogs", "reprintCount", "linkedEstimateNumber", "offlineId",
  "createdBy", "dispatchType",
  "pin", "reason", "action",
];

const txt = (v: any) => String(v ?? "").trim();
const money = (v: any) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : 0);

/**
 * A readable, comparable picture of a bill, for the audit log and for the Admin's approval screen. The same function
 * describes the bill as it is and the bill as it would become, so every field that can change shows up as "was -> will be".
 * An empty value and a missing one read the same, so only real changes show.
 */
export function summariseInvoice(inv: any) {
  const line = (it: any) => {
    const parts = [`${txt(it.itemName)} x${it.quantity} @ ${money(it.rate)}`];
    if (Number(it.discount) > 0) parts.push(`discount ${it.discount}${it.discountType === "percent" ? "%" : ""}`);
    if (it.gstRate !== undefined && it.gstRate !== null && it.gstRate !== "") parts.push(`GST ${it.gstRate}%`);
    if (txt(it.serialNumber)) parts.push(`serial ${txt(it.serialNumber)}`);
    if (txt(it.extendedWarrantyPlan)) parts.push(`warranty ${txt(it.extendedWarrantyPlan)}`);
    return parts.join(" · ");
  };
  const pays = (inv.payments || []).map((p: any) => `${txt(p.mode)} ${money(p.amount)}${txt(p.txnId) ? ` (${txt(p.txnId)})` : ""}`);
  return {
    customer: `${txt(inv.customerName)} ${txt(inv.customerPhone)}`.trim(),
    customerGST: txt(inv.customerGST),
    customerAddress: txt(inv.customerAddress),
    placeOfSupply: txt(inv.placeOfSupply),
    shippingAddress: txt(inv.shippingAddress),
    vehicleNumber: txt(inv.vehicleNumber),
    expectedDeliveryDate: txt(inv.expectedDeliveryDate).slice(0, 10),
    items: (inv.items || []).map(line),
    discount: money(inv.discount),
    taxableAmount: money(inv.taxableAmount),
    totalGST: money(inv.totalGST),
    total: inv.total,
    paid: inv.paidAmount,
    balance: inv.balanceAmount,
    paymentMode: inv.paymentMode,
    payments: pays,
    dueDate: txt(inv.dueDate).slice(0, 10),
    date: String(inv.date || "").slice(0, 10),
    notes: txt(inv.notes),
  };
}

/**
 * `dryRun` runs every check and stops before anything is written, so a Store
 * Manager is told straight away if a change cannot be made, instead of the
 * Admin finding out when approving it.
 */
export async function fullEditInvoice(
  existing: any,
  incoming: any,
  actor: { name: string; id?: string; role?: string; email?: string },
  reason: string,
  meta: { ip?: string; userAgent?: string; usedLegacyPin?: boolean } = {},
  opts: { dryRun?: boolean } = {}
): Promise<Result> {
  // ── 1. What may be edited ────────────────────────────────────────────────
  if (existing.type !== "tax-invoice") {
    return { ok: false, status: 400, error: "Only a tax invoice can be edited in the billing form." };
  }
  if (existing.status === "cancelled") {
    return { ok: false, status: 400, error: "A cancelled invoice cannot be edited." };
  }
  const items: any[] = Array.isArray(incoming.items) ? incoming.items : [];
  if (items.length === 0) {
    return { ok: false, status: 400, error: "The bill needs at least one product." };
  }
  for (const it of items) {
    if (!(Number(it.quantity) > 0)) {
      return { ok: false, status: 400, error: `Quantity for "${it.itemName || "a product"}" must be more than 0.` };
    }
  }

  // Bill date: same rule as making a bill.
  const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const oldDate = String(existing.date || "").slice(0, 10);
  let billDate = String(incoming.date || oldDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate)) billDate = oldDate;
  const dateChanged = billDate !== oldDate;
  const dateUpdate: any = {};
  let backdateNeedsApproval = false;
  // Only the Admin may move a bill's date (e.g. back to the day before); the invoice number stays the same.
  if (dateChanged && !["admin", "superadmin"].includes(String(actor.role || "").toLowerCase())) {
    return { ok: false, status: 403, error: "Only the Admin can change a bill's date." };
  }
  if (dateChanged) {
    if (billDate > todayIst) {
      return { ok: false, status: 400, error: "A bill cannot be dated in the future." };
    }
    const role = String(actor.role || "");
    dateUpdate.date = billDate;
    if (billDate < todayIst) {
      dateUpdate.backdateMadeOn = todayIst;
      if (role === "manager") {
        dateUpdate.backdateStatus = "pending";
        dateUpdate.backdateRequestedBy = actor.name;
        backdateNeedsApproval = true;
      } else {
        dateUpdate.backdateStatus = "approved";
      }
    } else {
      dateUpdate.backdateStatus = "";
      dateUpdate.backdateRequestedBy = "";
      dateUpdate.backdateMadeOn = "";
    }
  }

  const PaymentTransaction = (await import("@/models/PaymentTransaction")).default;
  const SerialNumber = (await import("@/models/SerialNumber")).default;
  const ExtendedWarranty = (await import("@/models/ExtendedWarranty")).default;
  const FinanceTransaction = (await import("@/models/FinanceTransaction")).default;
  const DeliveryChallan = (await import("@/models/DeliveryChallan")).default;

  // Products must belong to the bill's own company (same rule as a new bill).
  const entity = entityOf(existing.billingEntity);
  const productIds = items.map((it) => it.itemId).filter(isRealItemId);
  if (productIds.length > 0) {
    const products = await Item.find({ _id: { $in: productIds } }, { name: 1, billingEntity: 1 }).lean();
    const others = (products as any[]).filter((p) => entityOf(p) !== entity);
    if (others.length > 0) {
      return {
        ok: false,
        status: 400,
        error: `This bill is for ${entityLabel(entity)}, but these products belong to ${entityLabel(others[0])}: ${others
          .map((p) => p.name)
          .join(", ")}.`,
      };
    }
  }

  // A serial number may only be added if it is free (or already on this bill).
  const oldSerials = new Set<string>((existing.items || []).map((it: any) => String(it.serialNumber || "").trim()).filter(Boolean));
  const newSerials = new Set<string>(items.map((it) => String(it.serialNumber || "").trim()).filter(Boolean));
  for (const serial of newSerials) {
    if (oldSerials.has(serial)) continue;
    const sn: any = await SerialNumber.findOne({ serialNumber: serial }).lean();
    if (sn && sn.status === "SOLD" && sn.invoiceNumber && sn.invoiceNumber !== existing.invoiceNumber) {
      return { ok: false, status: 400, error: `Serial ${serial} is already sold on bill ${sn.invoiceNumber}.` };
    }
  }

  // Finance stays finance (and not-finance stays not-finance): its DO is a loan
  // record with the finance company, which an edit cannot open or close.
  const splitRows = (Array.isArray(incoming.payments) ? incoming.payments : [])
    .map((p: any) => ({
      mode: String(p?.mode || "Cash"),
      amount: Math.max(0, Number(p?.amount) || 0),
      txnId: p?.txnId || "",
      reference: p?.reference || "",
      receivedBy: p?.receivedBy || "",
      notes: p?.notes || "",
    }))
    .filter((p: any) => p.amount > 0);
  const isSplit = splitRows.length > 1;
  // A bill is a finance bill when it has its own DO, or is linked to another bill's DO (one loan, several bills).
  const oldIsFinance = await FinanceTransaction.exists({
    $or: [{ invoiceNumber: existing.invoiceNumber }, { "linkedInvoices.invoiceNumber": existing.invoiceNumber }],
  });
  const newIsFinance =
    incoming.paymentMode === "Finance" || splitRows.some((p: any) => classifyPaymentMode(p.mode) === "finance");
  const actorIsAdmin = ["admin", "superadmin"].includes(String(actor.role || "").toLowerCase());
  // The Admin may turn an existing bill into a finance bill (its DO is made below, dated with the bill);
  // a finance bill cannot be turned back, because its DO may already be with the bank.
  const addingFinance = !oldIsFinance && Boolean(newIsFinance);
  if (oldIsFinance && !newIsFinance) {
    return {
      ok: false,
      status: 400,
      error: "This is a finance bill with a DO — its payment mode cannot be changed away from Finance. Cancel it and make a new bill instead.",
    };
  }
  if (addingFinance && !actorIsAdmin) {
    return { ok: false, status: 403, error: "Only the Admin can add finance to an existing bill." };
  }
  // A DO ID typed here may be this customer's existing DO (the bill joins it) but never another customer's.
  // Checked before anything is written, so a clash never leaves half an edit.
  if (addingFinance) {
    const check = await checkDoId(String(incoming.financeDoId || ""), {
      invoiceNumber: existing.invoiceNumber,
      customerPhone: incoming.customerPhone || existing.customerPhone,
      customerName: incoming.customerName || existing.customerName,
    });
    if (check && "error" in check) return { ok: false, status: 400, error: check.error };
  }
  // More DOs on the bill (the loan split across several DOs): checked here too, before anything is written.
  const extraDos = newIsFinance ? extraDosOf(incoming) : [];
  let extraDosLoan = 0;
  if (extraDos.length) {
    const ownDo: any = await FinanceTransaction.findOne({ invoiceNumber: existing.invoiceNumber }, { doId: 1 }).lean();
    const splitLoan = splitRows.filter((p: any) => classifyPaymentMode(p.mode) === "finance").reduce((t: number, p: any) => t + p.amount, 0);
    extraDosLoan = splitLoan > 0 ? splitLoan : Number(incoming.financeGrossLoan || 0);
    const err = await checkExtraDos(
      extraDos,
      String(incoming.financeDoId || ownDo?.doId || ""),
      extraDosLoan,
      { invoiceNumber: existing.invoiceNumber, customerPhone: incoming.customerPhone || existing.customerPhone, customerName: incoming.customerName || existing.customerName }
    );
    if (err) return { ok: false, status: 400, error: err };
  }

  // ── 2. Money ─────────────────────────────────────────────────────────────
  const total = round2(incoming.total);
  const advance = round2(existing.advanceAdjusted);
  const credit = round2(existing.creditAdjusted);

  // What was collected after the bill was made (due clearances, receipts
  // naming the bill) stays collected; only the amount paid at billing changes.
  const linkedTxns: any[] = await PaymentTransaction.find({
    partyType: "Customer",
    referenceId: existing.invoiceNumber,
  }).lean();
  const isInitialTxn = (t: any) => /^Initial payment for/i.test(String(t.notes || ""));
  const initialTxn = linkedTxns.find(isInitialTxn) || null;
  const collectedLater = round2(
    linkedTxns
      .filter((t) => !isInitialTxn(t))
      .reduce((s, t) => s + (t.type === "paid" ? -1 : 1) * (Number(t.amount) || 0), 0)
  );

  let paidAtBilling: number;
  let paymentMode = String(incoming.paymentMode || existing.paymentMode || "Cash");
  if (splitRows.length > 0) {
    const allocated = splitRows.reduce((s: number, p: any) => s + p.amount, 0);
    const payable = round2(total - advance);
    if (Math.abs(allocated - payable) > 1) {
      return {
        ok: false,
        status: 400,
        error: `Split payments (₹${allocated.toFixed(2)}) do not match the amount payable (₹${payable.toFixed(2)}).`,
      };
    }
    paymentMode = derivePaymentModeLabel(splitRows);
    paidAtBilling = round2(splitRows.filter((p: any) => isCollectedMode(p.mode)).reduce((s: number, p: any) => s + p.amount, 0));
  } else {
    paidAtBilling = round2(Math.max(0, Number(incoming.paidAmount) || 0));
  }

  // Money already received on the bill (at billing, later, and as advance) is
  // never quietly written down: a total below it means a refund is owed,
  // which is a Credit Note, not an edit.
  const receivedAtBilling = initialTxn
    ? round2(initialTxn.amount)
    : round2(Math.max(0, (Number(existing.paidAmount) || 0) - collectedLater));
  const alreadyReceived = round2(advance + collectedLater + receivedAtBilling);
  if (total + 0.5 < alreadyReceived) {
    return {
      ok: false,
      status: 400,
      error: `The new total (₹${total.toFixed(2)}) is less than what this customer has already paid on the bill (₹${alreadyReceived.toFixed(2)} incl. advance). Make a Credit Note for the refund instead.`,
    };
  }
  // Due / Finance / Split say exactly what was paid at billing; Cash, UPI and
  // card mean "the rest was paid", which the cap below works out.
  const paidIsExplicit = paymentMode === "Due / Credit" || Boolean(newIsFinance) || splitRows.length > 0;
  if (paidIsExplicit && paidAtBilling + collectedLater > total - advance + 1) {
    return {
      ok: false,
      status: 400,
      error: `Paid at billing (₹${paidAtBilling.toFixed(2)}) plus ₹${collectedLater.toFixed(2)} collected later is more than the amount payable (₹${(total - advance).toFixed(2)}).`,
    };
  }
  // Never record more paid than the bill is worth.
  paidAtBilling = round2(Math.min(paidAtBilling, Math.max(0, total - advance - collectedLater)));
  const paidAmount = round2(paidAtBilling + collectedLater);
  const balanceAmount = round2(Math.max(0, total - advance - paidAmount));
  const status = balanceAmount <= 1 ? "paid" : paidAmount > 0 ? "partial" : "sent";

  // ── 3. Customer ──────────────────────────────────────────────────────────
  let customerId = String(incoming.customerId || existing.customerId || "");
  let createCustomer = false;
  if (!mongoose.isValidObjectId(customerId)) {
    const phone = String(incoming.customerPhone || "").replace(/\D/g, "");
    const found: any = phone ? await Customer.findOne({ phone }) : null;
    if (found) customerId = String(found._id);
    else createCustomer = true;
  }
  const customerChanged = createCustomer || String(existing.customerId || "") !== customerId;
  if (customerChanged && advance > 0) {
    return {
      ok: false,
      status: 400,
      error: "An advance from this customer was used on the bill, so it cannot be moved to a different customer. Cancel it and make a new bill instead.",
    };
  }

  // Every check has passed. A dry run stops here, before anything is written.
  if (opts.dryRun) return { ok: true, invoice: existing };

  if (createCustomer) {
    const phone = String(incoming.customerPhone || "").replace(/\D/g, "");
    const last: any = await Customer.findOne({ code: /^CUST-\d+$/ }).sort({ code: -1 }).lean();
    const lastNum = last?.code ? parseInt(String(last.code).replace("CUST-", ""), 10) || 0 : 0;
    const created: any = await Customer.create({
      code: `CUST-${String(lastNum + 1).padStart(3, "0")}`,
      name: incoming.customerName || "Walk-in Customer",
      phone: phone || "0000000000",
      email: incoming.customerEmail || "",
      gstNumber: incoming.customerGST || "",
      billingAddress: {
        line1: incoming.customerAddress || "Address not provided",
        city: incoming.customerCity || "City Not Specified",
        state: incoming.customerState || "Uttar Pradesh",
        pincode: incoming.customerPin || "",
        country: "India",
      },
    });
    customerId = String(created._id);
  }

  // ── 4. Apply ─────────────────────────────────────────────────────────────
  const before = existing.toObject ? existing.toObject() : { ...existing };
  const warehouseId = existing.warehouseId ? String(existing.warehouseId) : null;

  // 4a. Stock: put back what the bill used to take, take what it takes now.
  const netByItem = new Map<string, number>();
  for (const it of existing.items || []) {
    if (isRealItemId(it.itemId)) netByItem.set(String(it.itemId), (netByItem.get(String(it.itemId)) || 0) + (Number(it.quantity) || 0));
  }
  for (const it of items) {
    if (isRealItemId(it.itemId)) netByItem.set(String(it.itemId), (netByItem.get(String(it.itemId)) || 0) - (Number(it.quantity) || 0));
  }
  for (const [itemId, delta] of netByItem) {
    if (delta) await applyStockMovement(itemId, warehouseId, delta);
  }

  // 4b. Serial numbers.
  for (const serial of oldSerials) {
    if (newSerials.has(serial)) continue;
    await SerialNumber.findOneAndUpdate(
      { serialNumber: serial, invoiceNumber: existing.invoiceNumber },
      {
        status: "AVAILABLE",
        invoiceId: "",
        invoiceNumber: "",
        customerName: "",
        customerPhone: "",
        soldDate: "",
        $push: { history: { action: "Removed from bill (edit)", date: new Date(), performedBy: actor.name, details: `Invoice #${existing.invoiceNumber}` } },
      }
    );
  }
  for (const serial of newSerials) {
    await SerialNumber.findOneAndUpdate(
      { serialNumber: serial },
      {
        status: "SOLD",
        invoiceId: String(existing._id),
        invoiceNumber: existing.invoiceNumber,
        customerName: incoming.customerName || existing.customerName,
        customerPhone: incoming.customerPhone || existing.customerPhone || "",
        soldDate: billDate,
        ...(oldSerials.has(serial)
          ? {}
          : { $push: { history: { action: "Sold via Tax Invoice (edit)", date: new Date(), performedBy: actor.name, details: `Invoice #${existing.invoiceNumber}` } } }),
      }
    );
  }

  // 4c. Customer balance: undo the old bill's effect, apply the new one.
  const oldCustomerId = String(existing.customerId || "");
  if (mongoose.isValidObjectId(oldCustomerId)) {
    const undo = -round2(existing.balanceAmount);
    if (undo) await Customer.findByIdAndUpdate(oldCustomerId, { $inc: { outstandingBalance: undo } });
  }
  if (balanceAmount) await Customer.findByIdAndUpdate(customerId, { $inc: { outstandingBalance: balanceAmount } });

  // 4d. The bill's own receipt for what was paid at billing.
  const receiptMode = incoming.financeProvider
    ? incoming.financeDownPaymentMode || incoming.downPaymentMode || "Unclassified"
    : paymentMode || "Unclassified";
  const customerName = incoming.customerName || existing.customerName;
  if (isSplit) {
    // Split bills keep their per-mode breakdown on the invoice, not a receipt.
    if (initialTxn) await PaymentTransaction.deleteOne({ _id: initialTxn._id });
  } else if (initialTxn) {
    if (paidAtBilling > 0) {
      await PaymentTransaction.updateOne(
        { _id: initialTxn._id },
        { $set: { amount: paidAtBilling, paymentMode: receiptMode, partyId: customerId, partyName: customerName, date: billDate } }
      );
    } else {
      await PaymentTransaction.deleteOne({ _id: initialTxn._id });
    }
  } else if (paidAtBilling > 0) {
    await PaymentTransaction.create({
      transactionId: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      partyId: customerId,
      partyType: "Customer",
      partyName: customerName,
      amount: paidAtBilling,
      paymentMode: receiptMode,
      date: billDate,
      referenceId: existing.invoiceNumber,
      notes: `Initial payment for invoice ${existing.invoiceNumber}`,
      type: "received",
    });
  }
  // Receipts collected later follow the bill to its customer.
  if (customerChanged) {
    await PaymentTransaction.updateMany(
      { partyType: "Customer", referenceId: existing.invoiceNumber },
      { $set: { partyId: customerId, partyName: customerName } }
    );
  }

  // 4e. Extended warranties: drop the ones no longer on the bill, add new ones.
  const warrantyKey = (w: { itemId?: any; serialNumber?: any; planName?: any; extendedWarrantyPlan?: any }) =>
    `${w.itemId || ""}|${String(w.serialNumber || "").trim()}|${w.planName || w.extendedWarrantyPlan || ""}`;
  const wantedWarranties = items.filter((it) => it.extendedWarrantyPlan && (Number(it.extendedWarrantyAmount) || 0) > 0);
  const wantedKeys = new Set(wantedWarranties.map(warrantyKey));
  const existingWarranties: any[] = await ExtendedWarranty.find({ invoiceNumber: existing.invoiceNumber }).lean();
  const keptKeys = new Set<string>();
  const warrantyEnd = (months: number) => {
    const end = new Date(billDate);
    end.setMonth(end.getMonth() + months);
    return end.toISOString().split("T")[0];
  };
  for (const w of existingWarranties) {
    const k = warrantyKey(w);
    if (wantedKeys.has(k) && !keptKeys.has(k)) {
      keptKeys.add(k);
      if (dateChanged) {
        await ExtendedWarranty.updateOne(
          { _id: w._id },
          { $set: { startDate: billDate, endDate: warrantyEnd(Number(w.durationMonths) || 12) } }
        );
      }
    } else await ExtendedWarranty.deleteOne({ _id: w._id });
  }
  for (const it of wantedWarranties) {
    if (keptKeys.has(warrantyKey(it))) continue;
    const duration = it.extendedWarrantyDuration || 12;
    const count = await ExtendedWarranty.countDocuments();
    await ExtendedWarranty.create({
      warrantyId: `EW-2026-${String(count + 1).padStart(4, "0")}-${Math.floor(1000 + Math.random() * 9000)}`,
      invoiceNumber: existing.invoiceNumber,
      customerName,
      customerPhone: incoming.customerPhone || "",
      itemId: it.itemId,
      productName: it.itemName,
      vpCode: it.vpCode || it.itemCode || "",
      serialNumber: it.serialNumber || "",
      planName: it.extendedWarrantyPlan,
      durationMonths: duration,
      startDate: billDate,
      endDate: warrantyEnd(duration),
      warrantyAmount: it.extendedWarrantyAmount,
      salesStaff: incoming.salesExecutive || existing.salesExecutive || "",
      status: "Active",
      remarks: it.extendedWarrantyPolicyNo ? `Provider policy #: ${it.extendedWarrantyPolicyNo}` : "",
    });
  }

  // 4f. Delivery challan made with the bill.
  if (existing.deliveryChallanNo) {
    const first = items[0] || {};
    await DeliveryChallan.updateOne(
      { challanNo: existing.deliveryChallanNo },
      {
        $set: {
          destinationParty: customerName,
          customerPhone: incoming.customerPhone || existing.customerPhone || "",
          itemName: first.itemName || "Assorted Products",
          vpCode: first.vpCode || first.itemCode || "",
          hsn: first.hsn || "",
          serialImei: items.map((it) => it.serialNumber).filter(Boolean).join(", "),
          quantity: items.reduce((s, it) => s + (Number(it.quantity) || 1), 0),
        },
      }
    );
  }

  // 4g. Finance DO: product and price follow the bill.
  if (oldIsFinance) {
    const first = items[0] || {};
    await FinanceTransaction.updateOne(
      { invoiceNumber: existing.invoiceNumber },
      {
        $set: {
          customerName,
          customerMobile: incoming.customerPhone || existing.customerPhone || "N/A",
          productPrice: total,
          date: billDate,
          model: first.itemName || "",
          productModel: first.itemName || "",
          oemCategory: first.itemName || "Electronics",
          ...(first.brand ? { brand: first.brand, manufacturer: first.brand } : {}),
        },
      }
    );
  } else if (addingFinance) {
    // Finance added by the Admin on an edit: the DO is made the same way as on a new bill, dated with the bill.
    await createFinanceDO(
      {
        invoiceNumber: existing.invoiceNumber,
        customerName,
        customerPhone: incoming.customerPhone || existing.customerPhone,
        customerAddress: incoming.customerAddress || existing.customerAddress,
        date: billDate,
        total,
        balance: balanceAmount,
      },
      incoming,
      splitRows
    );
  }
  // Extra DOs written on the edit that do not exist yet get their own DO record.
  if (extraDos.length) {
    await createExtraDOs(
      {
        invoiceNumber: existing.invoiceNumber,
        customerName,
        customerPhone: incoming.customerPhone || existing.customerPhone,
        customerAddress: incoming.customerAddress || existing.customerAddress,
        date: billDate,
      },
      extraDos,
      incoming
    );
    // DO 1 (the bill's first DO) carries what is left of the loan after the other DOs.
    const extraIds = extraDos.map((r) => r.doId);
    const main: any = await FinanceTransaction.findOne({ invoiceNumber: existing.invoiceNumber, doId: { $nin: extraIds } }).sort({ createdAt: 1 });
    if (main && extraDosLoan > 0) {
      const rest = Math.max(0, round2(extraDosLoan - extraDos.reduce((t, r) => t + r.amount, 0)));
      main.grossLoanAmount = rest;
      main.netLoanAmount = rest;
      main.netDisbursement = Math.max(0, round2(rest - (Number(main.totalDeductions) || 0)));
      await main.save();
    }
  }
  // DO files added on the edit go onto the bill's DO (its own, or the one it is linked to).
  {
    const files = financeFilesOf(incoming);
    if (files.length && oldIsFinance) {
      await FinanceTransaction.updateOne(
        { $or: [{ invoiceNumber: existing.invoiceNumber }, { "linkedInvoices.invoiceNumber": existing.invoiceNumber }] },
        { $addToSet: { uploadedPdfUrls: { $each: files } } }
      );
    }
  }

  // 4h. The invoice itself.
  const update: any = { ...incoming };
  for (const f of PROTECTED_FIELDS) delete update[f];
  if (update.customerGST) update.customerPAN = update.customerPAN || derivePanFromGstin(update.customerGST);
  update.items = await stampLineCosts(items, existing.items as any[]);
  update.onsitegoIncentive = onsitegoIncentiveOf(update.items);
  {
    const stamped = await stampLineIncentives(update.items, existing.items as any[], billDate);
    update.items = stamped.items;
    update.salesExecutiveIncentive = stamped.total;
  }
  update.customerId = customerId;
  update.paymentMode = paymentMode;
  update.payments = splitRows.length > 0 ? splitRows : [];
  update.paidAmount = paidAmount;
  update.balanceAmount = balanceAmount;
  update.status = status;
  update.total = total;
  update.lastModifiedReason = "content-edit";
  Object.assign(update, dateUpdate);

  const saved = await Invoice.findOneAndUpdate({ _id: existing._id }, { $set: update }, { new: true });

  // A Store Manager's back-dated edit: the Admin is asked to approve it. A
  // rejection sets the date back to what it was before this edit.
  if (backdateNeedsApproval) {
    try {
      const StoreActivityApproval = (await import("@/models/StoreActivityApproval")).default;
      const { notifyAdmins } = await import("@/lib/notify");
      await StoreActivityApproval.create({
        activityId: `ACT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}-${Math.floor(100 + Math.random() * 900)}`,
        storeName: existing.warehouse || "Store",
        storeInchargeName: actor.name,
        storeInchargeEmail: actor.email || actor.name,
        activityType: "general",
        title: `Back-dated bill ${existing.invoiceNumber} (${billDate}) — edited`,
        description: `${customerName} · ₹${total.toLocaleString("en-IN")} · date changed from ${oldDate} to ${billDate} on ${todayIst}`,
        amount: total,
        payload: { kind: "backdated_invoice", invoiceNumber: existing.invoiceNumber, date: billDate, madeOn: oldDate },
        status: "pending",
      });
      publishChange(["/api/approvals"]);
      await notifyAdmins({
        type: "approval_request",
        title: `🔔 Approve back-dated bill ${existing.invoiceNumber}`,
        message: `${actor.name} changed its date from ${oldDate} to ${billDate} · ${customerName} · ₹${total.toLocaleString("en-IN")}`,
        link: "/admin/approvals",
        createdBy: actor.name,
      });
    } catch (approvalErr) {
      console.warn("Notice: back-date approval request (edit):", approvalErr);
    }
  }

  // ── 5. Audit trail ───────────────────────────────────────────────────────
  try {
    const summarise = summariseInvoice;
    await AuditLog.create({
      action: "invoice.edit",
      entityType: "Invoice",
      entityRef: existing.invoiceNumber,
      entityId: String(existing._id),
      partyName: customerName,
      amount: total,
      reason,
      performedBy: actor.name,
      performedByUserId: actor.id,
      performedByRole: actor.role,
      pinVerified: true,
      usedLegacyPin: meta.usedLegacyPin,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { before: summarise(before), after: summarise(saved) },
    });
  } catch (logErr) {
    console.warn("Notice: audit log for invoice edit:", logErr);
  }

  return { ok: true, invoice: saved };
}
