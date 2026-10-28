import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import CashTransaction from "@/models/CashTransaction";
import BankAccount from "@/models/BankAccount";
import Expense from "@/models/Expense";
import { getCashRegisterSummary } from "@/lib/cashRegister";
import { getActor } from "@/lib/requirePermission";

export async function GET(req: Request) {
  try {
    // The whole cash ledger — only for someone signed in to the ERP.
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to see the cash register." }, { status: 401 });
    await connectToDatabase();
    const data = await getCashRegisterSummary();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to record cash." }, { status: 401 });
    const body = await req.json();
    await connectToDatabase();

    const {
      type, // "INFLOW" | "OUTFLOW"
      category, // "BANK_DEPOSIT" | "MD_HANDOVER" | "CASH_EXPENSE" | "OTHER_RECEIPT"
      amount,
      date,
      referenceNo,
      description, // Mandatory Reason
      partyName, // Expense Category or MD Name or Bank
      targetBankAccount,
      handedTo,
      recordedBy,
      time, // Explicit handover/transaction time — e.g. the cashier backdating when cash actually changed hands, not just "now"
    } = body;

    if (!type || !category || !amount || Number(amount) <= 0) {
      return NextResponse.json(
        { success: false, error: "Valid Type, Category and positive Amount are required" },
        { status: 400 }
      );
    }

    if (category === "CASH_EXPENSE" && (!description || !description.trim())) {
      return NextResponse.json(
        { success: false, error: "Expense Reason / Particulars description is required" },
        { status: 400 }
      );
    }

    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const genRef = referenceNo || (category === "CASH_EXPENSE" ? `EXP-${Date.now().toString().slice(-6)}` : `CSH-${Date.now().toString().slice(-6)}`);

    // Create Cash Transaction Entry in MongoDB
    const newTxn = await CashTransaction.create({
      type,
      category,
      amount: Number(amount),
      date: date || todayStr,
      time: time || new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }),
      referenceNo: genRef,
      description: description.trim(),
      partyName: partyName || (category === "MD_HANDOVER" ? handedTo : targetBankAccount) || "Showroom Expense",
      targetBankAccount: targetBankAccount || "",
      handedTo: handedTo || "",
      recordedBy: recordedBy || "Admin / Cashier",
    });

    // If Outflow is Bank Deposit -> Automatically credit target Bank Account in MongoDB
    if (category === "BANK_DEPOSIT" && targetBankAccount) {
      const bankAcc = await BankAccount.findOne({
        $or: [
          { name: targetBankAccount },
          { number: targetBankAccount.split("(").pop()?.replace(")", "").trim() },
          { bank: targetBankAccount },
        ],
      });

      if (bankAcc) {
        bankAcc.balance = Number(bankAcc.balance || 0) + Number(amount);
        await bankAcc.save();
      }
    }

    // If Outflow is Cash Expense -> Automatically create record in Expense collection with exact reason!
    if (category === "CASH_EXPENSE") {
      await Expense.create({
        expenseNo: genRef,
        category: partyName || "General Petty Cash & Miscellaneous",
        description: description.trim(),
        amount: Number(amount),
        date: date || todayStr,
        paymentMode: "Cash",
        status: "paid",
      });
    }

    return NextResponse.json({
      success: true,
      message: "Cash movement recorded and saved to MongoDB!",
      data: newTxn,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
