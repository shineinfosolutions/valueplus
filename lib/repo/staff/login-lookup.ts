/**
 * The sign-in look-up (lib/authOptions.ts authorize) through the read:staff switch, made safe for D1.
 *
 * The query is auth.loginLookup: the user whose email equals the typed text (any capitals) or whose mobile equals
 * it, as a lean document WITH the password hash (needed for the bcrypt check; MongoDB's read returns it too) and
 * without the select:false PIN fields.
 *
 *  - 'mongo' / 'shadow': MongoDB's answer, exactly as before (shadow compares D1 after the response).
 *  - 'd1': D1 does the search (on MongoDB the case-insensitive email match cannot use an index), then MongoDB, the
 *    source of truth, CONFIRMS the candidate by primary key: it must still exist, still match the typed text the
 *    way the MongoDB query matches it, and still hold the same password hash. The user returned is MongoDB's copy.
 *    When D1 finds nobody, or the confirmation fails (the D1 copy is behind: a user deleted, renamed or given a new
 *    password moments ago), the original MongoDB query answers. A D1 error is answered by MongoDB (the framework).
 *    So sign-in never accepts a user, or a password, that MongoDB would not, and a miss is never decided by D1
 *    alone (which matters: authorize CREATES a seed account when nobody is found).
 */
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import { getReadMode } from "@/lib/d1/read-source";
import { STAFF_READS } from "./index";
import { readStaff } from "./shadow-read";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does this MongoDB user match the typed text the way the look-up's filter does? */
function matchesIdentifier(u: any, inputIdentifier: string): boolean {
  const email = new RegExp(`^${escapeRegex(inputIdentifier)}$`, "i");
  return (typeof u?.email === "string" && email.test(u.email)) || u?.mobile === inputIdentifier;
}

export async function loginLookup(inputIdentifier: string): Promise<any> {
  const user: any = await readStaff("auth.loginLookup", inputIdentifier);
  if ((await getReadMode("staff")) !== "d1") return user;

  if (user?._id) {
    await connectToDatabase();
    const confirmed: any = await User.findById(String(user._id)).lean();
    if (confirmed && matchesIdentifier(confirmed, inputIdentifier) && confirmed.password === user.password) return confirmed;
  }
  return STAFF_READS["auth.loginLookup"].mongo(inputIdentifier);
}
