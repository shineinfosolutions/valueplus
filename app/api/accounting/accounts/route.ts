import { crmRead } from "@/lib/repo/crm/shadow";
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Account from "@/models/Account";

export async function GET() {
  try {
    // The chart of accounts by code, through the crm read switch (MongoDB, MongoDB compared with D1, or D1).
    const accounts = await crmRead("accounts.list");
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
