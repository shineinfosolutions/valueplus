import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import BankAccount from "@/models/BankAccount";
import { NOT_LEGACY_CASH_REGISTER } from "@/lib/legacy-rows";
import { readStock } from "@/lib/repo/stock/shadow-read";

const DEFAULT_ACCOUNTS = [
  {
    name: "HDFC Bank - Current A/C",
    bank: "HDFC Bank",
    number: "50200084920193",
    ifsc: "HDFC0000492",
    branch: "Kunraghat, Gorakhpur",
    type: "current",
    balance: 0,
    status: "active",
  },
  {
    name: "State Bank of India (SBI) - Main Store A/C",
    bank: "State Bank of India",
    number: "38492018402",
    ifsc: "SBIN0001849",
    branch: "Deoria Road, Gorakhpur",
    type: "current",
    balance: 0,
    status: "active",
  },
  {
    name: "ICICI Bank - POS & Payout A/C",
    bank: "ICICI Bank",
    number: "002905018492",
    ifsc: "ICIC0000029",
    branch: "Civil Lines, Gorakhpur",
    type: "current",
    balance: 0,
    status: "active",
  },
  {
    name: "Bank of Baroda - Showroom A/C",
    bank: "Bank of Baroda",
    number: "749201938402",
    ifsc: "BARB0KUNRAG",
    branch: "Kunraghat, Gorakhpur",
    type: "current",
    balance: 0,
    status: "active",
  }
];

export async function GET() {
  try {
    // Old cash-register rows are left out of the list. This used to delete them on every open (a database write
    // each time someone opened Bank Accounts); scripts/cleanup-legacy-bank-warehouse.ts now removes them once.
    // The list goes through the read:stock switch (lib/repo/stock/shadow-read.ts). When it needs a WRITE (no accounts
    // yet: the defaults are created; or an old account without an IFSC: it is filled in), the work below needs
    // mongoose documents, so that rare case reads MongoDB again and runs exactly as before. (A stored account without
    // an IFSC shows the schema's default IFSC on MongoDB's documents but none in D1's copy: that case also takes the
    // MongoDB path, so the answer is the same in every mode.)
    const listed: any[] = await readStock("bankAccounts.list", {});
    if (listed.length > 0 && listed.every((acc) => acc.ifsc)) {
      return NextResponse.json({ success: true, data: listed });
    }

    await connectToDatabase();
    let accounts = await BankAccount.find(NOT_LEGACY_CASH_REGISTER).sort({ createdAt: -1 });

    if (!accounts || accounts.length === 0) {
      accounts = await BankAccount.insertMany(DEFAULT_ACCOUNTS);
    } else {
      // Ensure ifsc exists on older bank records
      let updatedAny = false;
      for (const acc of accounts) {
        if (!acc.ifsc) {
          acc.ifsc = acc.bank?.includes("SBI") ? "SBIN0001849" :
                     acc.bank?.includes("ICICI") ? "ICIC0000029" :
                     acc.bank?.includes("Baroda") ? "BARB0KUNRAG" : "HDFC0000492";
          await acc.save();
          updatedAny = true;
        }
      }
      if (updatedAny) {
        accounts = await BankAccount.find(NOT_LEGACY_CASH_REGISTER).sort({ createdAt: -1 });
      }
    }

    return NextResponse.json({ success: true, data: accounts });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();

    if (!body.name || !body.bank || !body.number) {
      return NextResponse.json(
        { success: false, error: "Account Name, Bank Name, and Account Number are required" },
        { status: 400 }
      );
    }

    const newAccount = await BankAccount.create({
      name: body.name.trim(),
      bank: body.bank.trim(),
      number: body.number.trim(),
      ifsc: (body.ifsc || "HDFC0000492").trim().toUpperCase(),
      branch: (body.branch || "Kunraghat, Gorakhpur").trim(),
      type: body.type === "savings" ? "savings" : "current",
      balance: 0,
      status: body.status || "active",
    });

    return NextResponse.json({ success: true, data: newAccount });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();

    const { id, _id, ...updates } = body;
    const accountId = id || _id;

    if (!accountId) {
      return NextResponse.json({ success: false, error: "Account ID is required" }, { status: 400 });
    }

    if (updates.ifsc) updates.ifsc = updates.ifsc.trim().toUpperCase();

    const updated = await BankAccount.findByIdAndUpdate(accountId, updates, { new: true });
    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    await connectToDatabase();

    if (!id) {
      return NextResponse.json({ success: false, error: "Account ID is required" }, { status: 400 });
    }

    await BankAccount.findByIdAndDelete(id);
    return NextResponse.json({ success: true, message: "Bank account deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
