import PurchaseEntry from "@/models/PurchaseEntry";

/**
 * Correcting a saved purchase bill's details.
 *
 * Only the fields that do not move money or stock can be corrected here: the bill
 * date, the due date, the supplier's GSTIN and the "why no PO" note. A wrong
 * amount, product, bill number or supplier means the bill is cancelled (PIN
 * protected) and entered again — those feed the supplier's balance, the stock
 * and the payments made against the bill.
 */

export interface PurchaseCorrection {
  billDate?: string;
  dueDate?: string;
  supplierGST?: string;
  noPoReason?: string;
}

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function summarisePurchaseDetails(e: any) {
  return {
    bill: `${e.billNo} · ${e.supplierName}`,
    billDate: String(e.billDate || "").slice(0, 10),
    dueDate: String(e.dueDate || "").slice(0, 10),
    supplierGST: e.supplierGST || "",
    noPoReason: e.noPoReason || "",
    total: e.total,
  };
}

export function checkPurchaseCorrection(
  entry: any,
  input: PurchaseCorrection
): { ok: true; next: Required<PurchaseCorrection>; changed: (keyof PurchaseCorrection)[] } | { ok: false; error: string } {
  if (!entry) return { ok: false, error: "Purchase bill not found." };
  if (entry.status === "cancelled") return { ok: false, error: "A cancelled bill cannot be corrected." };

  const next = {
    billDate: String(input.billDate ?? entry.billDate ?? "").slice(0, 10),
    dueDate: String(input.dueDate ?? entry.dueDate ?? "").slice(0, 10),
    supplierGST: String(input.supplierGST ?? entry.supplierGST ?? "").trim().toUpperCase(),
    noPoReason: String(input.noPoReason ?? entry.noPoReason ?? "").trim(),
  };

  if (!isDay(next.billDate)) return { ok: false, error: "Enter a valid bill date." };
  if (next.billDate > todayIst()) return { ok: false, error: "A bill cannot be dated in the future." };
  if (next.dueDate && !isDay(next.dueDate)) return { ok: false, error: "Enter a valid due date." };
  if (next.dueDate && next.dueDate < next.billDate) return { ok: false, error: "The due date cannot be before the bill date." };
  if (next.supplierGST && !/^[0-9A-Z]{15}$/.test(next.supplierGST)) {
    return { ok: false, error: "The supplier GSTIN must be 15 characters (or left empty)." };
  }
  if (next.noPoReason.length > 300) return { ok: false, error: "The note is too long (300 characters at most)." };

  const was = {
    billDate: String(entry.billDate || "").slice(0, 10),
    dueDate: String(entry.dueDate || "").slice(0, 10),
    supplierGST: String(entry.supplierGST || "").trim().toUpperCase(),
    noPoReason: String(entry.noPoReason || "").trim(),
  };
  const changed = (Object.keys(next) as (keyof PurchaseCorrection)[]).filter((k) => next[k] !== was[k]);
  if (changed.length === 0) return { ok: false, error: "Nothing was changed." };
  return { ok: true, next, changed };
}

export async function applyPurchaseCorrection(
  entry: any,
  input: PurchaseCorrection,
  actor: { name: string }
): Promise<{ ok: true; before: any; after: any } | { ok: false; error: string }> {
  const check = checkPurchaseCorrection(entry, input);
  if (!check.ok) return check;
  const before = summarisePurchaseDetails(entry);

  const set: any = { lastModifiedReason: "content-edit" };
  for (const k of check.changed) set[k] = check.next[k];
  if (check.changed.includes("billDate")) {
    // An Admin-approved date earlier than today is a back-dated bill that has been approved.
    if (check.next.billDate < todayIst()) {
      set.backdateStatus = "approved";
      set.backdateMadeOn = todayIst();
      set.backdateRequestedBy = actor.name;
    } else {
      set.backdateStatus = "";
      set.backdateMadeOn = "";
      set.backdateRequestedBy = "";
    }
  }
  await PurchaseEntry.updateOne({ _id: entry._id }, { $set: set });
  return { ok: true, before, after: { ...before, ...check.next } };
}
