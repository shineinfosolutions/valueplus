import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import CustomerAdvance from "@/models/CustomerAdvance";
import Customer from "@/models/Customer";

export async function GET(req: Request) {
  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get("phone");
    const status = searchParams.get("status");
    const search = searchParams.get("search");

    const query: any = {};
    if (phone) {
      query.customerPhone = phone.trim();
    }
    if (status && status !== "all") {
      query.status = status;
    }
    if (search) {
      const regex = new RegExp(search.trim(), "i");
      query.$or = [
        { customerName: regex },
        { customerPhone: regex },
        { receiptNumber: regex },
        { productBooked: regex },
        { targetBrand: regex },
      ];
    }

    const advances = await CustomerAdvance.find(query)
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ success: true, data: advances });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await connectToDatabase();
    const body = await req.json();

    const {
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      amount,
      paymentMode = "Cash",
      transactionRef = "",
      productBooked = "",
      targetBrand = "",
      targetCategory = "",
      notes = "",
      branchName = "Ashoka Enterprises (Kunraghat Showroom)",
      receivedBy = "Store Staff",
    } = body;

    if (!customerName || !customerPhone || !amount || Number(amount) <= 0) {
      return NextResponse.json(
        { success: false, error: "Customer Name, Mobile, and valid Amount (> 0) are required." },
        { status: 400 }
      );
    }

    const cleanPhone = String(customerPhone).replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid 10-digit mobile number." },
        { status: 400 }
      );
    }

    // Auto-generate receipt number ADV-YYYY-XXXX
    const currentYear = new Date().getFullYear();
    const count = await CustomerAdvance.countDocuments({});
    const receiptNumber = `ADV-${currentYear}-${String(count + 1).padStart(4, "0")}`;

    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

    const numAmount = Number(amount);

    // Create Advance Document
    const advance = await CustomerAdvance.create({
      receiptNumber,
      customerName: customerName.trim(),
      customerPhone: cleanPhone,
      customerEmail: customerEmail || "",
      customerAddress: customerAddress || "",
      amount: numAmount,
      paymentMode,
      transactionRef,
      productBooked: productBooked.trim(),
      targetBrand: targetBrand.trim(),
      targetCategory: targetCategory.trim(),
      notes,
      status: "Available",
      usedAmount: 0,
      remainingBalance: numAmount,
      branchName,
      receivedBy,
      date: dateStr,
      time: timeStr,
    });

    // Update Customer's advance balance in Customer Master
    const customer = await Customer.findOne({ phone: cleanPhone });
    if (customer) {
      customer.advanceBalance = (customer.advanceBalance || 0) + numAmount;
      await customer.save();
    } else {
      // Auto-create customer if does not exist
      const customerCount = await Customer.countDocuments({});
      await Customer.create({
        code: `CUST-${String(customerCount + 1).padStart(4, "0")}`,
        name: customerName.trim(),
        email: customerEmail || "",
        phone: cleanPhone,
        billingAddress: {
          line1: customerAddress || "Gorakhpur",
          city: "Gorakhpur",
          state: "Uttar Pradesh",
          pincode: "273008",
        },
        advanceBalance: numAmount,
        outstandingBalance: 0,
        creditLimit: 50000,
        status: "active",
      });
    }

    return NextResponse.json({
      success: true,
      data: advance,
      message: `Advance Receipt ${receiptNumber} created successfully!`,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    await connectToDatabase();
    const body = await req.json();
    const { id, action, refundAmount, notes } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: "Advance ID is required" }, { status: 400 });
    }

    const advance = await CustomerAdvance.findById(id);
    if (!advance) {
      return NextResponse.json({ success: false, error: "Advance receipt not found" }, { status: 404 });
    }

    if (action === "refund") {
      const refundVal = Number(refundAmount || advance.remainingBalance);
      if (refundVal <= 0 || refundVal > advance.remainingBalance) {
        return NextResponse.json(
          { success: false, error: `Invalid refund amount. Maximum refundable is ₹${advance.remainingBalance}` },
          { status: 400 }
        );
      }

      advance.remainingBalance -= refundVal;
      if (advance.remainingBalance === 0) {
        advance.status = "Refunded";
      } else {
        advance.status = "Partially Used";
      }
      advance.notes = `${advance.notes ? advance.notes + " | " : ""}Refunded ₹${refundVal} on ${new Date().toISOString().split("T")[0]}: ${notes || ""}`;
      await advance.save();

      // Deduct from customer's advance balance
      const customer = await Customer.findOne({ phone: advance.customerPhone });
      if (customer) {
        customer.advanceBalance = Math.max(0, (customer.advanceBalance || 0) - refundVal);
        await customer.save();
      }

      return NextResponse.json({ success: true, data: advance, message: `Refund of ₹${refundVal} processed successfully.` });
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
