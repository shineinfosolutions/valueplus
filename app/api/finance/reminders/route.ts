import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import FinanceTransaction from "@/models/FinanceTransaction";

/**
 * Finance payouts that are marked as received in the bank but still have no bank
 * account or UTR on record. Read-only: it feeds the reminder that keeps asking
 * for those details until someone fills them in on Bank NACH & Payouts.
 */
export async function GET() {
  try {
    await connectToDatabase();

    const missing = { $in: ["", null] };
    const records = await FinanceTransaction.find(
      {
        approvalStatus: { $in: ["Disbursed", "Reconciled"] },
        $or: [{ bankAccountRef: missing }, { transactionRef: missing }],
      },
      {
        doId: 1,
        invoiceNumber: 1,
        customerName: 1,
        financeProvider: 1,
        date: 1,
        paymentReceivedDate: 1,
        actualReceivedAmount: 1,
        netDisbursement: 1,
        bankAccountRef: 1,
        transactionRef: 1,
      }
    )
      .sort({ paymentReceivedDate: 1 })
      .lean();

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
