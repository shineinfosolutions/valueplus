import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import FinanceTransaction from "@/models/FinanceTransaction";
import Invoice from "@/models/Invoice";

function generateEmiSchedule(totalLoan: number, tenure: number, startDateStr: string) {
  const installments = [];
  const tenureCount = Math.max(1, tenure || 8);
  const monthlyAmt = Math.round(totalLoan / tenureCount);
  const baseDate = new Date(startDateStr || Date.now());
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 1; i <= tenureCount; i++) {
    const d = new Date(baseDate);
    d.setMonth(d.getMonth() + i);
    d.setDate(5); // 5th of every month standard EMI cycle
    const dueDateStr = d.toISOString().split("T")[0];
    
    installments.push({
      installmentNumber: i,
      dueDate: dueDateStr,
      amount: i === tenureCount ? Math.max(0, totalLoan - (monthlyAmt * (tenureCount - 1))) : monthlyAmt,
      status: d < today ? "Overdue" : "Pending",
      penaltyAmount: 0,
      notes: `Monthly EMI ${i} of ${tenureCount}`,
    });
  }
  return installments;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const invoiceNumber = searchParams.get("invoiceNumber");
    const doId = searchParams.get("doId");
    const status = searchParams.get("status");
    const provider = searchParams.get("provider");
    
    await connectToDatabase();
    
    const filter: any = {};
    if (invoiceNumber) filter.invoiceNumber = invoiceNumber;
    if (doId) filter.doId = doId;
    if (status && status !== "all") filter.approvalStatus = status;
    if (provider && provider !== "all") filter.financeProvider = provider;
    
    let transactions = await FinanceTransaction.find(filter).sort({ createdAt: -1 });

    // Auto-populate EMI schedule for records if missing
    for (const txn of transactions) {
      if (!txn.emiSchedule || txn.emiSchedule.length === 0) {
        const tenure = txn.tenureMonths || 8;
        const loanAmt = txn.grossLoanAmount || txn.netLoanAmount || txn.productPrice || 40000;
        txn.tenureMonths = tenure;
        txn.monthlyEmiAmount = Math.round(loanAmt / tenure);
        txn.emiSchedule = generateEmiSchedule(loanAmt, tenure, txn.date) as any;
        txn.totalPaidEmiAmount = txn.emiSchedule.filter((i: any) => i.status === "Paid").reduce((s: number, i: any) => s + (i.amount || 0), 0);
        txn.balanceDueAmount = Math.max(0, loanAmt - txn.totalPaidEmiAmount);
        await txn.save();
      }
    }

    return NextResponse.json({ success: true, data: transactions });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    if (!body.doId) {
      const count = await FinanceTransaction.countDocuments();
      body.doId = `DO-2026-${String(count + 1).padStart(4, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const tenure = Number(body.tenureMonths) || 8;
    const loanAmt = Number(body.grossLoanAmount || body.netLoanAmount || body.productPrice || 40000);
    body.tenureMonths = tenure;
    body.monthlyEmiAmount = Math.round(loanAmt / tenure);
    
    if (!body.emiSchedule || body.emiSchedule.length === 0) {
      body.emiSchedule = generateEmiSchedule(loanAmt, tenure, body.date || new Date().toISOString().split("T")[0]);
    }
    
    body.totalPaidEmiAmount = body.emiSchedule.filter((i: any) => i.status === "Paid").reduce((s: number, i: any) => s + (i.amount || 0), 0);
    body.balanceDueAmount = Math.max(0, loanAmt - body.totalPaidEmiAmount);
    
    const financeTxn = await FinanceTransaction.create(body);
    
    // Also update invoice finance fields if invoice exists
    if (body.invoiceNumber) {
      await Invoice.findOneAndUpdate(
        { invoiceNumber: body.invoiceNumber },
        {
          financeProvider: body.financeProvider,
          financeDoId: body.doId,
          financeGrossLoan: body.grossLoanAmount,
          financeNetLoan: body.netLoanAmount,
          financeDownPayment: body.customerDownPayment,
          financeApprovalStatus: body.approvalStatus || "Pending",
          financeExpectedDisbursement: body.netDisbursement,
          lastModifiedReason: "finance-sync",
        }
      );
    }
    
    return NextResponse.json({ success: true, data: financeTxn });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    const { 
      doId, 
      action,
      installmentNumber,
      paymentChannel,
      paymentMode,
      collectedBy,
      bankRef,
      receiptNumber,
      penaltyAmount,
      bounceReason,
      notes,
      approvalStatus, 
      approvedBy, 
      actualReceivedAmount, 
      bankAccountRef, 
      transactionRef, 
      remarks 
    } = body;

    if (!doId) {
      return NextResponse.json({ success: false, error: "DO ID is required" }, { status: 400 });
    }

    const financeRecord = await FinanceTransaction.findOne({ doId });
    if (!financeRecord) {
      return NextResponse.json({ success: false, error: "Finance record not found" }, { status: 404 });
    }

    // 1. ACTION: PAY EMI / RECORD INSTALLMENT
    if (action === "pay_emi" || action === "bounce_emi") {
      const instNum = Number(installmentNumber);
      const isPaid = action === "pay_emi";

      const updatedSchedule = financeRecord.emiSchedule.map((inst: any) => {
        if (inst.installmentNumber === instNum) {
          return {
            ...inst,
            status: isPaid ? "Paid" : "Bounced",
            paidDate: isPaid ? (body.paidDate || new Date().toISOString().split("T")[0]) : undefined,
            paymentChannel: isPaid ? (paymentChannel || "Shop Counter") : undefined,
            paymentMode: isPaid ? (paymentMode || "Cash") : undefined,
            collectedBy: isPaid ? (collectedBy || "Amit Singh (Cashier)") : undefined,
            bankRef: bankRef || "",
            receiptNumber: isPaid ? (receiptNumber || `REC-EMI-${instNum}-${Math.floor(1000 + Math.random() * 9000)}`) : undefined,
            bounceReason: !isPaid ? (bounceReason || "Insufficient Funds / NACH Return") : undefined,
            penaltyAmount: Number(penaltyAmount) || 0,
            notes: notes || (isPaid ? `EMI ${instNum} cleared via ${paymentMode || "Cash"}` : `EMI ${instNum} bounced`),
          };
        }
        return inst;
      });

      financeRecord.emiSchedule = updatedSchedule as any;
      const loanAmt = financeRecord.grossLoanAmount || financeRecord.netLoanAmount || financeRecord.productPrice;
      financeRecord.totalPaidEmiAmount = updatedSchedule.filter((i: any) => i.status === "Paid").reduce((sum: number, i: any) => sum + (i.amount || 0), 0);
      financeRecord.balanceDueAmount = Math.max(0, loanAmt - financeRecord.totalPaidEmiAmount);

      await financeRecord.save();
      return NextResponse.json({ success: true, message: `EMI #${instNum} recorded as ${isPaid ? "Paid" : "Bounced"}!`, data: financeRecord });
    }
    
    // 2. STANDARD DO APPROVAL & DISBURSEMENT UPDATE
    const updateData: any = {};
    if (approvalStatus) {
      updateData.approvalStatus = approvalStatus;
      if (approvalStatus === "Approved" || approvalStatus === "Disbursed" || approvalStatus === "Reconciled") {
        updateData.approvalDate = new Date().toISOString();
        if (approvedBy) updateData.approvedBy = approvedBy;
      }
    }
    if (actualReceivedAmount !== undefined) updateData.actualReceivedAmount = actualReceivedAmount;
    if (bankAccountRef) updateData.bankAccountRef = bankAccountRef;
    if (transactionRef) updateData.transactionRef = transactionRef;
    if (body.paymentReceivedDate) updateData.paymentReceivedDate = body.paymentReceivedDate;
    if (remarks) updateData.remarks = remarks;
    if (body.uploadedPdfUrl) updateData.uploadedPdfUrl = body.uploadedPdfUrl;
    
    // A payout landing in the bank goes through the shared settlement, which also
    // closes the invoice's balance and credits the bank account. Updating only the
    // DO here left the bill sitting in the due list after the money had arrived.
    if (approvalStatus === "Disbursed") {
      const { approvalStatus: _status, ...otherFields } = updateData;
      if (Object.keys(otherFields).length > 0) {
        await FinanceTransaction.updateOne({ doId }, otherFields);
      }
      const { recordFinancePayout } = await import("@/lib/financeSettlement");
      await recordFinancePayout({
        doId,
        amount: Number(actualReceivedAmount) || undefined,
        bankAccountId: body.bankAccountId,
        bankAccountRef,
        utr: transactionRef,
        date: body.paymentReceivedDate,
        by: approvedBy,
        remarks,
      });
      const settled = await FinanceTransaction.findOne({ doId });
      return NextResponse.json({ success: true, data: settled });
    }

    const updated = await FinanceTransaction.findOneAndUpdate({ doId }, updateData, { new: true });

    // Sync status with invoice
    if (updated && updated.invoiceNumber && approvalStatus) {
      await Invoice.findOneAndUpdate(
        { invoiceNumber: updated.invoiceNumber },
        {
          financeApprovalStatus: approvalStatus,
          financeActualDisbursement: actualReceivedAmount || updated.actualReceivedAmount,
          lastModifiedReason: "finance-sync",
        }
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
