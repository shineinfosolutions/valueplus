import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Expense from "@/models/Expense";

export async function GET() {
  try {
    await connectToDatabase();
    const expenses = await Expense.find({}).sort({ createdAt: -1 });
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
      expenseNo: body.expenseNo || `EXP-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`,
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
