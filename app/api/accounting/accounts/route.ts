import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Account from "@/models/Account";

export async function GET() {
  try {
    await connectToDatabase();
    const accounts = await Account.find({}).sort({ code: 1 });
    return NextResponse.json({ success: true, data: accounts });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    const account = await Account.create(body);
    return NextResponse.json({ success: true, data: account });
  } catch (error: any) {
    if (error.code === 11000) {
       return NextResponse.json({ success: false, error: "Account code or name already exists" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
