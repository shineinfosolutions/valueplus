/** A GSTIN's own 3rd-12th characters ARE the party's PAN by design — no
 *  separate lookup needed once a valid-length GSTIN is on hand. */
export function derivePanFromGstin(gstin?: string | null): string {
  const clean = String(gstin || "").trim().toUpperCase();
  if (clean.length !== 15) return "";
  return clean.slice(2, 12);
}
