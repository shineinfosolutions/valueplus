import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import bcrypt from "bcryptjs";
import { getActor } from "@/lib/requirePermission";

export async function GET() {
  try {
    // Resets the demo staff accounts to their default passwords. The middleware
    // does not see /api/auth/* (withAuth skips it), so the check lives here.
    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    }
    if (actor.role !== "admin") {
      return NextResponse.json({ success: false, error: "Only an admin can do this." }, { status: 403 });
    }

    await connectToDatabase();
    
    const seedUsers = [
      {
        name: "Shiva Rai (Super Admin)",
        email: "admin@valueplus.in",
        password: await bcrypt.hash("admin123", 10),
        role: "admin",
        mobile: "9140860604",
        designation: "Managing Director",
        monthlySalary: 100000,
        salaryType: "Fixed",
        idProofType: "PAN Card",
        idProofNumber: "ANHPJ7242D",
        assignedWarehouseName: "Ashoka Enterprises (Kunraghat Showroom)",
        status: "active",
      },
      {
        name: "Ramesh Yadav (Godown Incharge)",
        email: "warehouse@valueplus.in",
        password: await bcrypt.hash("warehouse123", 10),
        role: "warehouse",
        mobile: "9839123456",
        designation: "Chief Logistics Officer",
        monthlySalary: 35000,
        salaryType: "Fixed",
        idProofType: "Aadhaar Card",
        idProofNumber: "6543 2198 7654",
        assignedWarehouseName: "Gorakhpur Central Godown & Logistics Hub",
        status: "active",
      },
      {
        name: "Amit Kumar Singh (Sales Executive)",
        email: "salesman@valueplus.in",
        password: await bcrypt.hash("salesman123", 10),
        role: "salesman",
        mobile: "9450123456",
        designation: "Senior Sales Executive",
        monthlySalary: 25000,
        salaryType: "Fixed + Incentive",
        idProofType: "Aadhaar Card",
        idProofNumber: "9876 5432 1098",
        assignedWarehouseName: "Ashoka Enterprises (Kunraghat Showroom)",
        status: "active",
      },
      {
        name: "Rohan Verma (POS Cashier)",
        email: "cashier@valueplus.in",
        password: await bcrypt.hash("cashier123", 10),
        role: "cashier",
        mobile: "9125123456",
        designation: "Counter Cashier",
        monthlySalary: 22000,
        salaryType: "Fixed",
        idProofType: "Aadhaar Card",
        idProofNumber: "1234 5678 9012",
        assignedWarehouseName: "Ashoka Enterprises (Kunraghat Showroom)",
        status: "active",
      },
      {
        name: "Suresh Gupta (Chief Accountant)",
        email: "accounts@valueplus.in",
        password: await bcrypt.hash("accounts123", 10),
        role: "accounts",
        mobile: "9794123456",
        designation: "Chartered Accountant",
        monthlySalary: 45000,
        salaryType: "Fixed",
        idProofType: "PAN Card",
        idProofNumber: "ABCDE1234F",
        assignedWarehouseName: "Ashoka Enterprises (Kunraghat Showroom)",
        status: "active",
      },
      {
        name: "Priya Sharma (HR Operations)",
        email: "hr@valueplus.in",
        password: await bcrypt.hash("hr123", 10),
        role: "hr",
        mobile: "9696123456",
        designation: "HR & Payroll Manager",
        monthlySalary: 30000,
        salaryType: "Fixed",
        idProofType: "Aadhaar Card",
        idProofNumber: "5544 3322 1100",
        assignedWarehouseName: "Ashoka Enterprises (Kunraghat Showroom)",
        status: "active",
      },
      {
        name: "Vikram Singh (Store Incharge & Branch Admin)",
        email: "storeincharge@valueplus.in",
        password: await bcrypt.hash("store123", 10),
        role: "manager",
        mobile: "9838123456",
        designation: "Store Incharge & Branch Admin",
        monthlySalary: 40000,
        salaryType: "Fixed + Incentive",
        idProofType: "Aadhaar Card",
        idProofNumber: "8899 7766 5544",
        assignedWarehouseName: "Ashoka Enterprises (Kunraghat Showroom)",
        status: "active",
      },
      {
        name: "Samsung India (Vendor Portal)",
        email: "supplier@valueplus.in",
        password: await bcrypt.hash("supplier123", 10),
        role: "supplier",
        mobile: "9988776655",
        designation: "Authorized OEM Supplier",
        monthlySalary: 0,
        salaryType: "Fixed",
        idProofType: "PAN Card",
        idProofNumber: "SAMSG9988Z",
        assignedWarehouseName: "Gorakhpur Central Godown & Logistics Hub",
        status: "active",
      },
    ];

    for (const u of seedUsers) {
      await User.findOneAndUpdate({ email: u.email }, { $set: u }, { upsert: true, new: true });
    }

    return NextResponse.json({
      success: true,
      message: "7 Role Demo Accounts Seeded/Updated Successfully!",
      users: seedUsers.map((u) => ({ name: u.name, email: u.email, role: u.role })),
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
