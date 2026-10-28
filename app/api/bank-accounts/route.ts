import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import BankAccount from "@/models/BankAccount";

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
    await connectToDatabase();
    
    // Purge any legacy cash register entries from bank accounts table
    await BankAccount.deleteMany({
      $or: [
        { type: "cash" },
        { name: { $regex: /cash register/i } },
        { number: { $regex: /cash-register/i } },
      ],
    });

    let accounts = await BankAccount.find({ type: { $ne: "cash" } }).sort({ createdAt: -1 });

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
        accounts = await BankAccount.find({ type: { $ne: "cash" } }).sort({ createdAt: -1 });
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
