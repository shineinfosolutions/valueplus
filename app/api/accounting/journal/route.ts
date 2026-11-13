import { crmRead } from "@/lib/repo/crm/shadow";
import { istYear } from "@/lib/ist";
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import JournalEntry from "@/models/JournalEntry";
import Account from "@/models/Account";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const accountId = url.searchParams.get("accountId");

    // Every entry, or those with a line on this account, newest first, through the crm read switch (MongoDB, MongoDB compared with D1, or D1).
    const entries = await crmRead("journal.list", { accountId });
    return NextResponse.json({ success: true, data: entries });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    const totalDebit = body.lines.reduce((sum: number, line: any) => sum + (Number(line.debit) || 0), 0);
    const totalCredit = body.lines.reduce((sum: number, line: any) => sum + (Number(line.credit) || 0), 0);
    
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return NextResponse.json({ success: false, error: "Debits and Credits must balance" }, { status: 400 });
    }
    
    // Auto-generate entry number if not provided
    if (!body.entryNumber) {
      const count = await JournalEntry.countDocuments();
      body.entryNumber = `JE-${istYear()}-${String(count + 1).padStart(4, '0')}`;
    }
    
    body.totalDebit = totalDebit;
    body.totalCredit = totalCredit;
    
    const entry = await JournalEntry.create(body);
    
    // Update account balances
    for (const line of body.lines) {
      const account = await Account.findById(line.accountId);
      if (account) {
        // Normal balance rules:
        // Assets/Expenses increase with Debit, decrease with Credit
        // Liabilities/Equity/Revenue increase with Credit, decrease with Debit
        let change = 0;
        if (['asset', 'expense'].includes(account.type)) {
          change = (Number(line.debit) || 0) - (Number(line.credit) || 0);
        } else {
          change = (Number(line.credit) || 0) - (Number(line.debit) || 0);
        }
        account.balance += change;
        await account.save();
      }
    }
    
    return NextResponse.json({ success: true, data: entry });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
