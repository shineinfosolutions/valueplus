import { salesRead } from "@/lib/repo/sales/shadow";
import { NextResponse } from "next/server";

/**
 * Finance payouts that are marked as received in the bank but still have no bank
 * account or UTR on record. Read-only: it feeds the reminder that keeps asking
 * for those details until someone fills them in on Bank NACH & Payouts.
 */
export async function GET() {
  try {
    // Paid-out (Disbursed / Reconciled) DOs with no bank account or no UTR, oldest payout first
    // (lib/repo/sales/money.ts mongoFinanceReminders), through the sales read switch (MongoDB, MongoDB compared with D1, or D1).
    const records: any[] = await salesRead("finance.reminders");

    const data = (records as any[]).map((r) => ({
      doId: r.doId,
      invoiceNumber: r.invoiceNumber,
      customerName: r.customerName,
      financeProvider: r.financeProvider,
      payoutDate: r.paymentReceivedDate || r.date || "",
      amount: Number(r.actualReceivedAmount) || Number(r.netDisbursement) || 0,
      missingBankAccount: !r.bankAccountRef,
      missingUtr: !r.transactionRef,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
