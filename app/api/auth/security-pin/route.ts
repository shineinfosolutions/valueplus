import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import { getActor } from "@/lib/requirePermission";
import { hashSecurityPin, verifySecurityPin } from "@/lib/securityPin";

/** Whether the signed-in user has set their own PIN yet. */
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
    }

    await connectToDatabase();
    const user = await User.findById(actor.id).select("+securityPin +pinLockedUntil");
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    const locked = Boolean(user.pinLockedUntil && user.pinLockedUntil > new Date());

    return NextResponse.json({
      success: true,
      data: {
        hasPin: Boolean(user.securityPin),
        pinUpdatedAt: user.pinUpdatedAt || null,
        locked,
        lockedUntil: locked ? user.pinLockedUntil : null,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** Set or change the signed-in user's own PIN. */
export async function PUT(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
    }

    const body = await req.json();
    await connectToDatabase();

    const user = await User.findById(actor.id).select("+securityPin");
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    // Changing an existing PIN needs the current one; setting the first PIN needs
    // the account password, so a walk-up at an unlocked screen cannot claim it.
    if (user.securityPin) {
      const check = await verifySecurityPin(actor, body.currentPin || "");
      if (!check.ok) {
        return NextResponse.json({ success: false, error: check.error }, { status: 400 });
      }
    } else {
      const withPassword = await User.findById(actor.id).select("+password");
      const password = String(body.password || "");
      const passwordOk = withPassword?.password
        ? await bcrypt.compare(password, withPassword.password)
        : Boolean(password);
      if (!passwordOk) {
        return NextResponse.json(
          { success: false, error: "Enter your account password to set a PIN for the first time." },
          { status: 400 }
        );
      }
    }

    const { hash, error } = await hashSecurityPin(body.newPin || "");
    if (error) {
      return NextResponse.json({ success: false, error }, { status: 400 });
    }

    await User.findByIdAndUpdate(actor.id, {
      securityPin: hash,
      pinUpdatedAt: new Date(),
      pinFailCount: 0,
      pinLockedUntil: null,
    });

    return NextResponse.json({ success: true, message: "Security PIN updated" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
