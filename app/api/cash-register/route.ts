import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import CashTransaction from "@/models/CashTransaction";
import BankAccount from "@/models/BankAccount";
import Expense from "@/models/Expense";
import { getCashRegisterSummary } from "@/lib/cashRegister";
import AuditLog from "@/models/AuditLog";
import mongoose from "mongoose";
import { notifyAdmins, notifyAssignee } from "@/lib/notify";
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
      // A handover recorded by anyone but the Admin waits for the Admin to confirm receiving the cash.
      ...(category === "MD_HANDOVER" && !["admin", "superadmin"].includes(actor.role) ? { adminStatus: "pending" } : {}),
    });

    if (category === "MD_HANDOVER" && !["admin", "superadmin"].includes(actor.role)) {
      await notifyAdmins({
        type: "general",
        title: `Cash handover ₹${Number(amount).toLocaleString("en-IN")} waiting for you`,
        message: `${actor.name} says they handed over ₹${Number(amount).toLocaleString("en-IN")} to you. Confirm on the Dashboard once you have received it.`,
        link: "/dashboard",
        createdBy: actor.name,
      });
    }

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

/**
 * The Admin confirms (or refuses) a cashier's handover. Until it is confirmed the cash is still counted as
 * the cashier's. Body: { id, action: "confirm" | "reject", reason? }. Admin only.
 */
export async function PATCH(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!["admin", "superadmin"].includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin can confirm a cash handover." }, { status: 403 });
    }
    const body = await req.json();
    const action = String(body.action || "");
    if (!mongoose.isValidObjectId(body.id) || !["confirm", "reject"].includes(action)) {
      return NextResponse.json({ success: false, error: "Handover not found." }, { status: 400 });
    }
    const reason = String(body.reason || "").trim();
    if (action === "reject" && reason.length < 3) {
      return NextResponse.json({ success: false, error: "Write why the cash was not received." }, { status: 400 });
    }
    await connectToDatabase();
    const txn: any = await CashTransaction.findById(body.id);
    if (!txn || txn.category !== "MD_HANDOVER" || txn.adminStatus !== "pending") {
      return NextResponse.json({ success: false, error: "This handover is no longer waiting for you." }, { status: 404 });
    }
    txn.adminStatus = action === "confirm" ? "confirmed" : "rejected";
    txn.adminReviewedBy = actor.name;
    txn.adminReviewedAt = new Date().toISOString();
    if (action === "reject") txn.adminRejectReason = reason;
    await txn.save();

    try {
      await AuditLog.create({
        action: action === "confirm" ? "cash.handover.confirm" : "cash.handover.reject",
        entityType: "CashTransaction",
        entityRef: txn.referenceNo,
        entityId: String(txn._id),
        amount: txn.amount,
        reason: action === "confirm" ? "Admin received the cash handed over by the cashier" : reason,
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        metadata: { cashier: txn.recordedBy, date: txn.date, time: txn.time },
      });
    } catch (e) {
      console.warn("Notice: audit log for cash handover review:", e);
    }
    await notifyAssignee(txn.recordedBy, undefined, {
      type: "general",
      title: action === "confirm" ? `Admin received your ₹${Number(txn.amount).toLocaleString("en-IN")} handover` : `Admin did not receive your ₹${Number(txn.amount).toLocaleString("en-IN")} handover`,
      message: action === "confirm" ? "The handover is complete." : `Reason: ${reason}`,
      link: "/dashboard",
      createdBy: actor.name,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
