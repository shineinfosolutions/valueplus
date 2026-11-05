import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import { getActor } from "@/lib/requirePermission";
import { hashSecurityPin, verifySecurityPin } from "@/lib/securityPin";
import AuditLog from "@/models/AuditLog";

const RESET_MAX_ATTEMPTS = 5;
const RESET_LOCK_MINUTES = 15;

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

    // Forgot PIN: a new PIN is set with the account (login) password instead of the old PIN. Wrong passwords count
    // towards the same 5-tries / 15-minute lock as wrong PINs, and the reset is written to the audit log.
    if (body.forgot) {
      const withSecrets: any = await User.findById(actor.id).select("+password +pinFailCount +pinLockedUntil");
      if (withSecrets?.pinLockedUntil && withSecrets.pinLockedUntil > new Date()) {
        const minutes = Math.ceil((withSecrets.pinLockedUntil.getTime() - Date.now()) / 60_000);
        return NextResponse.json({ success: false, error: `Too many wrong tries. Try again in ${minutes} minute(s).` }, { status: 429 });
      }
      const password = String(body.password || "");
      const passwordOk = Boolean(withSecrets?.password && password) && (await bcrypt.compare(password, withSecrets.password));
      if (!passwordOk) {
        const failures = (Number(withSecrets?.pinFailCount) || 0) + 1;
        const update: any = { pinFailCount: failures };
        if (failures >= RESET_MAX_ATTEMPTS) {
          update.pinLockedUntil = new Date(Date.now() + RESET_LOCK_MINUTES * 60_000);
          update.pinFailCount = 0;
        }
        await User.findByIdAndUpdate(actor.id, update);
        return NextResponse.json({ success: false, error: "That is not your account password." }, { status: 400 });
      }
      const { hash, error } = await hashSecurityPin(body.newPin || "");
      if (error) return NextResponse.json({ success: false, error }, { status: 400 });
      await User.findByIdAndUpdate(actor.id, { securityPin: hash, pinUpdatedAt: new Date(), pinFailCount: 0, pinLockedUntil: null });
      await AuditLog.create({
        action: "security.pin.reset",
        entityType: "User",
        entityRef: actor.name,
        entityId: actor.id,
        reason: "Forgot PIN: reset with the account password",
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
      }).catch((e: any) => console.warn("Notice: audit log for PIN reset:", e));
      return NextResponse.json({ success: true, message: "Security PIN reset" });
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
