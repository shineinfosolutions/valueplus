import bcrypt from "bcryptjs";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import { Permission } from "@/lib/permissions";
import { SessionActor } from "@/lib/requirePermission";

/**
 * Server-side verification of the supervisor PIN that authorises a cancel or a
 * delete.
 *
 * Before this, the PIN was the string "1234" compared in the browser
 * (app/(dashboard)/sales/invoices/page.tsx and the billing modal). Anyone who
 * opened devtools could read it, and the API accepted a cancel or delete with no
 * PIN at all — so the check protected nothing. Verification now happens here,
 * against a per-user bcrypt hash, and the routes refuse to act without it.
 */

/** The shared PIN that the browser used to check. Kept only as a fallback. */
const LEGACY_SHARED_PIN = "1234";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export interface PinVerification {
  ok: boolean;
  /** Message to show the user when `ok` is false. */
  error?: string;
  /** True when this user has no PIN of their own and the legacy one was accepted. */
  usedLegacyPin?: boolean;
  /** Attempts left before a lockout, when the PIN was wrong. */
  attemptsLeft?: number;
  lockedUntil?: Date;
}

/**
 * Check a PIN for the acting user.
 *
 * A user with no `securityPin` falls back to the legacy shared PIN so existing
 * staff keep working; the response says so, and the UI nudges them to set their
 * own. Five wrong attempts lock the PIN for fifteen minutes.
 */
export async function verifySecurityPin(
  actor: SessionActor,
  pin: string
): Promise<PinVerification> {
  const candidate = String(pin || "").trim();

  if (!candidate) {
    return { ok: false, error: "Enter the supervisor PIN to authorise this." };
  }

  await connectToDatabase();

  const user = await User.findById(actor.id).select(
    "+securityPin +pinFailCount +pinLockedUntil"
  );

  if (!user) {
    return { ok: false, error: "Your user account could not be found." };
  }

  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    const minutes = Math.ceil((user.pinLockedUntil.getTime() - Date.now()) / 60_000);
    return {
      ok: false,
      error: `Too many wrong PIN attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      lockedUntil: user.pinLockedUntil,
    };
  }

  const hasOwnPin = Boolean(user.securityPin);
  const matches = hasOwnPin
    ? await bcrypt.compare(candidate, user.securityPin as string)
    : candidate === LEGACY_SHARED_PIN;

  if (!matches) {
    const failures = (user.pinFailCount || 0) + 1;
    const update: any = { pinFailCount: failures };
    if (failures >= MAX_ATTEMPTS) {
      update.pinLockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
      update.pinFailCount = 0;
    }
    await User.findByIdAndUpdate(user._id, update);

    if (failures >= MAX_ATTEMPTS) {
      return {
        ok: false,
        error: `Too many wrong PIN attempts. The PIN is locked for ${LOCKOUT_MINUTES} minutes.`,
        lockedUntil: update.pinLockedUntil,
      };
    }

    return {
      ok: false,
      error: "Incorrect PIN. Supervisor authorisation failed.",
      attemptsLeft: MAX_ATTEMPTS - failures,
    };
  }

  if (user.pinFailCount) {
    await User.findByIdAndUpdate(user._id, { pinFailCount: 0, pinLockedUntil: null });
  }

  return { ok: true, usedLegacyPin: !hasOwnPin };
}

/** Hash a new PIN after checking it looks like one. */
export async function hashSecurityPin(pin: string): Promise<{ hash?: string; error?: string }> {
  const candidate = String(pin || "").trim();

  if (!/^\d{4,6}$/.test(candidate)) {
    return { error: "The PIN must be 4 to 6 digits." };
  }
  if (/^(\d)\1+$/.test(candidate)) {
    return { error: "Choose a PIN that is not the same digit repeated." };
  }
  if (candidate === LEGACY_SHARED_PIN) {
    return { error: "That is the old shared PIN. Choose a different one." };
  }

  return { hash: await bcrypt.hash(candidate, 10) };
}

/**
 * Verify a PIN and confirm the actor may perform the action.
 *
 * Both halves matter: the permission says the role is allowed to do this at all,
 * the PIN says the person at the keyboard is the one who is allowed to.
 */
export async function requirePinAndPermission(
  actor: SessionActor,
  permission: Permission,
  pin: string
): Promise<PinVerification> {
  if (actor.role !== "admin" && !actor.permissions.includes(permission)) {
    return {
      ok: false,
      error: `Your role (${actor.role || "unknown"}) is not allowed to do this.`,
    };
  }
  return verifySecurityPin(actor, pin);
}
