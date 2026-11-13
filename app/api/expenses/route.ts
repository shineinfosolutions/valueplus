import { istYear } from "@/lib/ist";
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Expense from "@/models/Expense";
import { readStock } from "@/lib/repo/stock/shadow-read";

export async function GET() {
  try {
    // Read through the read:stock switch (lib/repo/stock/shadow-read.ts): MongoDB, MongoDB compared with D1, or D1.
    const expenses = await readStock("expenses.list", {});
    return NextResponse.json({ success: true, data: expenses });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();

    const payload = {
      ...body,
      expenseNo: body.expenseNo || `EXP-${istYear()}-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`,
    };

    const expense = await Expense.create(payload);
    return NextResponse.json({ success: true, data: expense });
  } catch (error: any) {
    if (error.code === 11000) {
       return NextResponse.json({ success: false, error: "Expense number already exists" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const expenseNo = searchParams.get("expenseNo");
    
    if (!expenseNo) {
      return NextResponse.json({ success: false, error: "expenseNo is required" }, { status: 400 });
    }

    const body = await req.json();
    await connectToDatabase();
    
    const updatedExpense = await Expense.findOneAndUpdate({ expenseNo }, body, { new: true });
    
    if (!updatedExpense) {
      return NextResponse.json({ success: false, error: "Expense not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: updatedExpense });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const expenseNo = searchParams.get("expenseNo");
    
    if (!expenseNo) {
      return NextResponse.json({ success: false, error: "expenseNo is required" }, { status: 400 });
    }

    await connectToDatabase();
    const deletedExpense = await Expense.findOneAndDelete({ expenseNo });
    
    if (!deletedExpense) {
      return NextResponse.json({ success: false, error: "Expense not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: {} });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
