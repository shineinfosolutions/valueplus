import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Account from "@/models/Account";

const DEFAULT_ACCOUNTS = [
  { code: "1000", name: "Cash", type: "asset" },
  { code: "1010", name: "HDFC Bank Account", type: "asset" },
  { code: "1200", name: "Accounts Receivable", type: "asset" },
  { code: "1500", name: "Inventory Asset", type: "asset" },
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "2100", name: "CGST Payable", type: "liability" },
  { code: "2101", name: "SGST Payable", type: "liability" },
  { code: "2102", name: "IGST Payable", type: "liability" },
  { code: "3000", name: "Owner's Equity", type: "equity" },
  { code: "4000", name: "Sales Revenue", type: "revenue" },
  { code: "4010", name: "Service Revenue", type: "revenue" },
  { code: "5000", name: "Cost of Goods Sold", type: "expense" },
  { code: "6000", name: "Rent Expense", type: "expense" },
  { code: "6010", name: "Salary Expense", type: "expense" },
];

export async function GET() {
  try {
    await connectToDatabase();
    let seeded = 0;
    
    for (const acc of DEFAULT_ACCOUNTS) {
      const exists = await Account.findOne({ code: acc.code });
      if (!exists) {
        await Account.create(acc);
        seeded++;
      }
    }
    
    return NextResponse.json({ success: true, message: `Seeded ${seeded} accounts.` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
