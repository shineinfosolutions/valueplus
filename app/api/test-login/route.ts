import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import bcrypt from "bcryptjs";

export async function GET() {
  try {
    await connectToDatabase();
    const user = await User.findOne({ email: "admin" }).lean();
    if (!user) return NextResponse.json({ error: "User not found" });

    const isMatch = await bcrypt.compare("123456", user.password || "");
    return NextResponse.json({ 
      user: { name: user.name, email: user.email, role: user.role },
      isMatch 
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.toString() });
  }
}
