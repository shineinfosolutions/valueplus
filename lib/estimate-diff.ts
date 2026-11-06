/**
 * Editing an estimate must change only what the user changed. These helpers tell whether a field that comes
 * back from the edit form really differs from what is saved, so an untouched field (or one the form merely
 * re-derives, like a line's amount) is never written again.
 */

const txt = (v: any) => String(v ?? "").trim();
const num = (v: any) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : 0);
const day = (v: any) => {
  if (!v) return "";
  const s = typeof v === "string" ? v : new Date(v).toISOString();
  return s.slice(0, 10);
};

/** The default note the form writes when the user typed none; the same as no note. */
const DEFAULT_NOTE = "Official Estimate Generated";
const note = (v: any) => (txt(v) === DEFAULT_NOTE ? "" : txt(v));

/** A line, reduced to what the user can actually change (works for an estimate line and for a bill line). */
function lineKey(it: any) {
  return [
    txt(it?.itemCode || it?.vpCode || ""),
    txt(it?.name || it?.itemName || "").toLowerCase(),
    num(it?.quantity ?? it?.qty ?? 1),
    num(it?.rate),
    num(it?.discount),
  ].join("|");
}

/** True when both lists hold the same lines (same products, quantities, rates and discounts, in any order). */
export function sameLines(a: any[] | undefined | null, b: any[] | undefined | null): boolean {
  const ka = (a || []).map(lineKey).sort();
  const kb = (b || []).map(lineKey).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/** Whether `incoming` is a different value from `saved` for this estimate field. */
export function estimateFieldChanged(field: string, saved: any, incoming: any): boolean {
  switch (field) {
    case "items":
      return !sameLines(saved, incoming);
    case "date":
    case "expiryDate":
      return day(saved) !== day(incoming);
    case "subTotal":
    case "taxTotal":
    case "total":
    case "advanceAmount":
      return Math.abs(num(saved) - num(incoming)) > 0.5;
    case "notes":
      return note(saved) !== note(incoming);
    default:
      return txt(saved) !== txt(incoming);
  }
}
