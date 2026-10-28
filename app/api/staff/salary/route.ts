import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Salary from "@/models/Salary";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month");
    const employeeId = searchParams.get("employeeId");
    
    await connectToDatabase();
    
    const filter: any = {};
    if (month) filter.month = month;
    if (employeeId) filter.employeeId = employeeId;
    
    const salaries = await Salary.find(filter).sort({ employeeName: 1 });
    return NextResponse.json({ success: true, data: salaries });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    const payable = (Number(body.monthlySalary) || 0) + (Number(body.incentives) || 0) + (Number(body.commission) || 0) - (Number(body.deductions) || 0);
    body.payableAmount = payable;
    
    const salary = await Salary.create(body);
    return NextResponse.json({ success: true, data: salary });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    const { id, paymentAmount, paymentMode, txnRef, paymentStatus, ...updates } = body;
    if (!id) {
      return NextResponse.json({ success: false, error: "Salary record ID is required" }, { status: 400 });
    }
    
    const salary = await Salary.findById(id);
    if (!salary) {
      return NextResponse.json({ success: false, error: "Salary record not found" }, { status: 404 });
    }
    
    if (paymentAmount) {
      salary.history.push({
        date: new Date().toISOString().split("T")[0],
        amount: Number(paymentAmount),
        paymentMode: paymentMode || "Bank Transfer",
        txnRef: txnRef || "",
        notes: body.notes || "Salary payment released",
      });
      salary.paymentStatus = paymentStatus || "Paid";
      salary.paymentDate = new Date().toISOString().split("T")[0];
      salary.paymentMode = paymentMode || "Bank Transfer";
    }
    
    Object.assign(salary, updates);
    salary.payableAmount = (Number(salary.monthlySalary) || 0) + (Number(salary.incentives) || 0) + (Number(salary.commission) || 0) - (Number(salary.deductions) || 0);
    
    await salary.save();
    return NextResponse.json({ success: true, data: salary });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
