import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import Item from "@/models/Item";
import PriceUnlockSetting from "@/models/PriceUnlockSetting";
import { SessionActor } from "@/lib/requirePermission";

/**
 * Estimate approval and the locked minimum price.
 *
 * - The cashier (and admin / manager) approve or reject a salesman's estimate.
 * - Admin and manager lock a minimum price on a product (`Item.lockedMinPrice`).
 * - A line below that price is only accepted with the price-unlock PIN, which only
 *   the Admin can set. Wrong tries lock the person out like the security PIN does.
 */

export const ESTIMATE_APPROVER_ROLES = ["admin", "superadmin", "manager", "cashier"];
export const PRICE_LOCK_MANAGER_ROLES = ["admin", "superadmin", "manager"];

export const canApproveEstimate = (role?: string) => ESTIMATE_APPROVER_ROLES.includes(String(role || "").toLowerCase());
export const canManagePriceLock = (role?: string) => PRICE_LOCK_MANAGER_ROLES.includes(String(role || "").toLowerCase());

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/** An estimate made before the approval step existed has no value here and counts as approved. */
export function effectiveApproval(est: any): "pending" | "approved" | "rejected" {
  return est?.approvalStatus || "approved";
}

export async function isUnlockPinSet(): Promise<boolean> {
  await connectToDatabase();
  const doc = await PriceUnlockSetting.findOne({ key: "price-unlock" }).lean();
  return Boolean((doc as any)?.pinHash);
}

export async function setUnlockPin(pin: string, actorName: string): Promise<{ ok: boolean; error?: string }> {
  const candidate = String(pin || "").trim();
  if (!/^\d{4,6}$/.test(candidate)) return { ok: false, error: "The PIN must be 4 to 6 digits." };
  if (/^(\d)\1+$/.test(candidate)) return { ok: false, error: "Choose a PIN that is not the same digit repeated." };
  if (candidate === "1234") return { ok: false, error: "Choose a PIN that is not 1234." };
  await connectToDatabase();
  const pinHash = await bcrypt.hash(candidate, 10);
  await PriceUnlockSetting.findOneAndUpdate(
    { key: "price-unlock" },
    { $set: { pinHash, updatedBy: actorName } },
    { upsert: true, setDefaultsOnInsert: true }
  );
  // A fresh PIN clears every earlier lockout.
  await User.updateMany({}, { $set: { unlockPinFailCount: 0 }, $unset: { unlockPinLockedUntil: 1 } });
  return { ok: true };
}

/** Check the price-unlock PIN for the acting user, with a per-user wrong-try lockout. */
export async function verifyUnlockPin(actor: SessionActor, pin: string): Promise<{ ok: boolean; error?: string }> {
  const candidate = String(pin || "").trim();
  if (!candidate) return { ok: false, error: "Enter the price unlock PIN." };
  await connectToDatabase();

  const setting: any = await PriceUnlockSetting.findOne({ key: "price-unlock" }).lean();
  if (!setting?.pinHash) {
    return { ok: false, error: "No price unlock PIN has been set yet. Ask the Admin to set one in Settings." };
  }

  const user = await User.findById(actor.id).select("+unlockPinFailCount +unlockPinLockedUntil");
  if (!user) return { ok: false, error: "Your user account could not be found." };

  if (user.unlockPinLockedUntil && user.unlockPinLockedUntil > new Date()) {
    const minutes = Math.ceil((user.unlockPinLockedUntil.getTime() - Date.now()) / 60_000);
    return { ok: false, error: `Too many wrong PIN attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  if (!(await bcrypt.compare(candidate, setting.pinHash))) {
    const failures = (user.unlockPinFailCount || 0) + 1;
    if (failures >= MAX_ATTEMPTS) {
      await User.findByIdAndUpdate(user._id, {
        unlockPinFailCount: 0,
        unlockPinLockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000),
      });
      return { ok: false, error: `Too many wrong PIN attempts. The PIN is locked for ${LOCKOUT_MINUTES} minutes.` };
    }
    await User.findByIdAndUpdate(user._id, { unlockPinFailCount: failures });
    return { ok: false, error: `Incorrect price unlock PIN. ${MAX_ATTEMPTS - failures} attempt${MAX_ATTEMPTS - failures === 1 ? "" : "s"} left.` };
  }

  if (user.unlockPinFailCount) {
    await User.findByIdAndUpdate(user._id, { unlockPinFailCount: 0, $unset: { unlockPinLockedUntil: 1 } });
  }
  return { ok: true };
}

export interface BelowFloorLine {
  itemName: string;
  rate: number;
  lockedMin: number;
}

/**
 * Lines whose price (after discount) is under the product's locked minimum.
 * The locked minimum is always read from the product record, never from the request.
 */
export async function findBelowFloor(items: any[]): Promise<BelowFloorLine[]> {
  await connectToDatabase();
  const lines = Array.isArray(items) ? items : [];
  const ids = lines.map((l) => l?.itemId).filter((id) => mongoose.isValidObjectId(id));
  const names = lines.map((l) => String(l?.name || l?.itemName || "").trim()).filter(Boolean);
  const catalog: any[] = await Item.find(
    { $or: [{ _id: { $in: ids } }, { name: { $in: names } }], lockedMinPrice: { $gt: 0 } },
    { name: 1, lockedMinPrice: 1 }
  ).lean();
  if (catalog.length === 0) return [];

  const byId = new Map(catalog.map((c) => [String(c._id), c]));
  const byName = new Map(catalog.map((c) => [String(c.name).trim().toLowerCase(), c]));

  const out: BelowFloorLine[] = [];
  for (const l of lines) {
    const prod =
      (mongoose.isValidObjectId(l?.itemId) && byId.get(String(l.itemId))) ||
      byName.get(String(l?.name || l?.itemName || "").trim().toLowerCase());
    if (!prod) continue;
    const price = (Number(l.rate) || 0) - (Number(l.discount) || 0);
    if (price < Number(prod.lockedMinPrice)) {
      out.push({ itemName: String(l.name || l.itemName || prod.name), rate: price, lockedMin: Number(prod.lockedMinPrice) });
    }
  }
  return out;
}
