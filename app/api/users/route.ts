import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import bcrypt from "bcryptjs";

export async function GET() {
  try {
    await connectToDatabase();
    const rawUsers = await User.find({}).select("-password").sort({ createdAt: -1 }).lean();
    const users = rawUsers.map((u: any) => ({
      ...u,
      assignedBrand: u.assignedBrand || (u.email === "salesman@valueplus.in" ? "HAIER" : ""),
    }));
    return NextResponse.json({ success: true, data: users });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await connectToDatabase();
    const body = await req.json();

    const {
      name,
      email,
      password,
      role = "salesman",
      mobile,
      avatar,
      address,
      city,
      state,
      pincode,
      idProofType,
      idProofNumber,
      idProofDoc,
      designation,
      monthlySalary,
      salaryType,
      joiningDate,
      advanceBalance,
      monthlyAdvanceDeduction,
      bankName,
      bankAccountNo,
      bankIfsc,
      assignedWarehouseId,
      assignedWarehouseName,
    } = body;

    if (!name || !email || !password) {
      return NextResponse.json(
        { success: false, error: "Name, Email, and Password are required." },
        { status: 400 }
      );
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return NextResponse.json(
        { success: false, error: "A user with this email address already exists." },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role,
      mobile: mobile || "",
      avatar: avatar || "",
      address: address || "",
      city: city || "Gorakhpur",
      state: state || "Uttar Pradesh",
      pincode: pincode || "273008",
      idProofType: idProofType || "Aadhaar Card",
      idProofNumber: idProofNumber || "",
      idProofDoc: idProofDoc || "",
      designation: designation || "Staff",
      monthlySalary: Number(monthlySalary || 0),
      salaryType: salaryType || "Fixed",
      joiningDate: joiningDate || new Date().toISOString().split("T")[0],
      advanceBalance: Number(advanceBalance || 0),
      monthlyAdvanceDeduction: Number(monthlyAdvanceDeduction || 0),
      bankName: bankName || "",
      bankAccountNo: bankAccountNo || "",
      bankIfsc: bankIfsc || "",
      assignedWarehouseId: assignedWarehouseId || "",
      assignedWarehouseName: assignedWarehouseName || "",
      assignedBrand: body.assignedBrand || "",
      assignedBrands: Array.isArray(body.assignedBrands) ? body.assignedBrands : (body.assignedBrand ? [body.assignedBrand] : []),
      status: "active",
    });

    const userObj = newUser.toObject();
    delete userObj.password;

    return NextResponse.json({ success: true, data: userObj, message: "User registered successfully!" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    await connectToDatabase();
    const body = await req.json();
    const { id, password, ...updateFields } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: "User ID is required" }, { status: 400 });
    }

    if (password && password.trim().length > 0) {
      updateFields.password = await bcrypt.hash(password, 10);
    }

    const updated = await User.findByIdAndUpdate(id, updateFields, { new: true })
      .select("-password")
      .lean();

    if (!updated) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: updated, message: "User profile updated successfully!" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ success: false, error: "User ID is required" }, { status: 400 });
    }

    await User.findByIdAndDelete(id);
    return NextResponse.json({ success: true, message: "User deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
