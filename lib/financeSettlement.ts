import mongoose from "mongoose";
import Invoice from "@/models/Invoice";
import Customer from "@/models/Customer";
import BankAccount from "@/models/BankAccount";
import FinanceTransaction from "@/models/FinanceTransaction";
import PaymentTransaction from "@/models/PaymentTransaction";

/**
 * Resolve the store bank account a receipt landed in. The client sends the
 * account's id; older callers (the Bank NACH & Payouts form) only send a display
 * string such as "HDFC Bank - Current A/C (A/C: 50200084920193)", so the account
 * number inside it is used as a fallback.
 */
export async function resolveBankAccount(bankAccountId?: string, bankAccountRef?: string) {
  if (bankAccountId && mongoose.isValidObjectId(bankAccountId)) {
    const byId = await BankAccount.findById(bankAccountId);
    if (byId) return byId;
  }
  const number = String(bankAccountRef || "").match(/A\/C:\s*([\w-]+)/i)?.[1];
  if (number) {
    const byNumber = await BankAccount.findOne({ number });
    if (byNumber) return byNumber;
  }
  return null;
}

export function bankAccountLabel(acc: any): string {
  return acc ? `${acc.name} - ${acc.bank} (A/C: ${acc.number})` : "";
}

/** Credit (or, with a negative amount, reverse) a store bank account's running balance. */
export async function creditBankAccount(bankAccountId: string | undefined, amount: number) {
  if (!amount || !bankAccountId || !mongoose.isValidObjectId(bankAccountId)) return;
  await BankAccount.updateOne({ _id: bankAccountId }, { $inc: { balance: amount } });
}

export interface FinancePayoutInput {
  doId?: string;
  invoiceNumber?: string;
  /** What the financier actually credited — usually less than the loan, net of subvention and fees. */
  amount?: number;
  bankAccountId?: string;
  bankAccountRef?: string;
  utr?: string;
  date?: string;
  by?: string;
  remarks?: string;
}

/**
 * The one place a finance payout is recorded, whichever screen it comes from
 * (Bank NACH & Payouts, or the dashboard's finance-pending list).
 *
 * A financed sale leaves the loan portion as the invoice's balance. That balance
 * is owed by the finance company, and it is settled in full the moment their
 * payout lands — whatever they deducted on the way is their charge, not a due the
 * customer still owes. So this closes the invoice, marks the DO disbursed with
 * the bank account + UTR, credits that bank account, and writes exactly one
 * "Finance Disbursement" receipt. Calling it again for the same bill (editing the
 * UTR or account afterwards) updates those records instead of duplicating them.
 */
export async function recordFinancePayout(input: FinancePayoutInput) {
  const financeRecord: any = input.doId
    ? await FinanceTransaction.findOne({ doId: input.doId })
    : input.invoiceNumber
      ? await FinanceTransaction.findOne({ invoiceNumber: input.invoiceNumber })
      : null;

  const invoiceNumber = input.invoiceNumber || financeRecord?.invoiceNumber || "";
  const invoice: any = invoiceNumber ? await Invoice.findOne({ invoiceNumber }) : null;

  if (!financeRecord && !invoice) {
    throw new Error("No finance record or invoice found for this payout");
  }

  const account = await resolveBankAccount(input.bankAccountId, input.bankAccountRef);
  const bankAccountId = account ? String(account._id) : "";
  const bankAccountRef = account ? bankAccountLabel(account) : String(input.bankAccountRef || "");

  const outstanding = Math.max(0, Number(invoice?.balanceAmount) || 0);
  const amount =
    Number(input.amount) ||
    Number(financeRecord?.actualReceivedAmount) ||
    Number(financeRecord?.netDisbursement) ||
    outstanding;
  const date = input.date || new Date().toISOString().split("T")[0];
  const utr = String(input.utr || "").trim();
  const partyName = invoice?.customerName || financeRecord?.customerName || "Finance Customer";

  // Finance bills used to be closed through the khata "Clear Due" flow, which left
  // a TXN-DUE-* receipt behind. That receipt IS this payout, so it is reused (and
  // relabelled below) rather than joined by a second one for the same money.
  const existingReceipt: any = invoiceNumber
    ? await PaymentTransaction.findOne({
        referenceId: invoiceNumber,
        type: "received",
        $or: [{ paymentMode: "Finance Disbursement" }, { transactionId: /^TXN-(DUE|FIN)-/ }],
      })
    : null;

  // Undo the previous credit before applying the new one, so correcting the
  // amount or the account on an already-recorded payout never double-credits.
  if (existingReceipt) {
    await creditBankAccount(existingReceipt.bankAccountId, -(Number(existingReceipt.amount) || 0));
  }
  await creditBankAccount(bankAccountId, amount);

  if (financeRecord) {
    const alreadyDisbursed = financeRecord.approvalStatus === "Disbursed" || financeRecord.approvalStatus === "Reconciled";
    if (!alreadyDisbursed) {
      financeRecord.approvalStatus = "Disbursed";
      financeRecord.approvalDate = new Date().toISOString();
    }
    financeRecord.actualReceivedAmount = amount;
    financeRecord.bankAccountRef = bankAccountRef;
    financeRecord.bankAccountId = bankAccountId;
    if (utr) financeRecord.transactionRef = utr;
    financeRecord.paymentReceivedDate = date;
    if (input.by) financeRecord.approvedBy = input.by;
    if (input.remarks) financeRecord.remarks = input.remarks;
    await financeRecord.save();
  }

  if (invoice) {
    invoice.paidAmount = Number(invoice.total) || 0;
    invoice.balanceAmount = 0;
    if (invoice.status !== "cancelled" && invoice.status !== "draft") invoice.status = "paid";
    invoice.financeApprovalStatus = "Disbursed";
    invoice.financeActualDisbursement = amount;
    if (utr) invoice.financeBankRef = utr;
    invoice.financeBankAccountId = bankAccountId;
    invoice.financeBankAccount = bankAccountRef;
    invoice.financePayoutDate = date;
    invoice.lastModifiedReason = "finance-sync";
    await invoice.save();

    // The loan portion was added to the customer's outstanding at billing time.
    if (outstanding > 0 && invoice.customerId && mongoose.isValidObjectId(invoice.customerId)) {
      await Customer.findByIdAndUpdate(invoice.customerId, { $inc: { outstandingBalance: -outstanding } });
    }
  }

  const doLabel = financeRecord ? `DO ${financeRecord.doId} (${financeRecord.financeProvider})` : `Invoice #${invoiceNumber}`;
  const notes = `Finance payout credited for ${doLabel}${bankAccountRef ? ` into ${bankAccountRef}` : ""}, UTR: ${utr || "-"}`;

  if (existingReceipt) {
    existingReceipt.amount = amount;
    existingReceipt.paymentMode = "Finance Disbursement";
    existingReceipt.date = date;
    existingReceipt.bankAccountId = bankAccountId;
    existingReceipt.bankAccountRef = bankAccountRef;
    existingReceipt.bankTxnRef = utr || existingReceipt.bankTxnRef;
    existingReceipt.notes = notes;
    await existingReceipt.save();
  } else {
    await PaymentTransaction.create({
      transactionId: `TXN-FIN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      partyId: invoice?.customerId || financeRecord?.customerId || financeRecord?.doId || invoiceNumber,
      partyType: "Customer",
      partyName,
      amount,
      paymentMode: "Finance Disbursement",
      date,
      referenceId: invoiceNumber,
      notes,
      type: "received",
      bankAccountId,
      bankAccountRef,
      bankTxnRef: utr,
    });
  }

  return { financeRecord, invoice, amount, bankAccountRef, settledBalance: outstanding };
}
