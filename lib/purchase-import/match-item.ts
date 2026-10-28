/**
 * Match one parsed row's product name against the existing Item catalog.
 *
 * Matching is deliberately conservative — an exact code match, or a name
 * match once both sides are lower-cased and stripped of punctuation. Fuzzy
 * "close enough" matching was left out on purpose: silently attaching a
 * purchase to the wrong existing product would move stock and cost onto that
 * product's record, which is worse than asking the admin to link an
 * unmatched row by hand in the preview screen.
 */

import { modelKey } from "./supplier-line";

/** Every code a product is known by: its own code, its VP code, and the
 *  supplier item codes (e.g. "VP0012023") learned from earlier purchases. */
function codesOf(it: any): string[] {
  return [it.code, it.vpCode, ...(Array.isArray(it.supplierCodes) ? it.supplierCodes : [])]
    .map((c) => String(c || "").trim().toUpperCase())
    .filter(Boolean);
}

/** A product saved the clean way — not "VP0012023 - …" and not "Unbranded". */
function isCleanProduct(it: any): boolean {
  return !/^\s*VP-?\d{4,}\s*-/i.test(String(it.name || "")) && !/^unbranded$/i.test(String(it.brand || "").trim());
}

function normaliseName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Some suppliers quote our own VP code back to us embedded inside a longer
// description — e.g. "VP0011286 - HFC-320DPW4- HAIER" — rather than as the
// whole cell. Pulling that token out gives an exact-match-quality signal
// without requiring the entire cell to equal the code.
export function extractEmbeddedCode(text: string): string | null {
  const match = String(text || "").match(/\bVP-?[A-Z0-9]{3,}\b/i);
  return match ? match[0].toUpperCase() : null;
}

export function findMatchingItem(rowName: string, items: any[]): any | null {
  const normalised = normaliseName(rowName);
  if (!normalised) return null;

  const raw = String(rowName || "").trim().toLowerCase();

  // Exact code / VP code hit first — the least ambiguous signal available.
  const byCode = items.find((it) => codesOf(it).includes(raw.toUpperCase()));
  if (byCode) return byCode;

  // A VP code embedded inside a longer description is just as unambiguous as
  // a whole-cell match — it just needs pulling out first.
  const embedded = extractEmbeddedCode(rowName);
  if (embedded) {
    const byEmbeddedCode = items.find((it) => codesOf(it).includes(embedded));
    if (byEmbeddedCode) return byEmbeddedCode;
  }

  // Same model number, ignoring the supplier code and the brand around it:
  // "VP0012023 - GLS19I3AGAHF- LLOYD" is the catalog's "GLS19I3AGAHF- LLOYD".
  // A variant suffix still counts ("… OU" is a different product). When an
  // older mis-saved duplicate shares the model, the cleanly saved one wins.
  const key = modelKey(rowName);
  if (key.length >= 5) {
    const sameModel = items.filter((it) => modelKey(it.name, it.brand) === key);
    if (sameModel.length > 0) return sameModel.find(isCleanProduct) || sameModel[0];
  }

  const byExactName = items.find((it) => normaliseName(it.name) === normalised);
  if (byExactName) return byExactName;

  // A row name that contains the full item name, or vice versa — catches
  // "Samsung 43 Inch LED TV (2024)" matching a master item just named
  // "Samsung 43 Inch LED TV" without guessing across unrelated products.
  const byContains = items.find((it) => {
    const itemName = normaliseName(it.name);
    if (!itemName) return false;
    // A short name on either side ("TV", "SIM") would match almost anything
    // as a substring, so containment only counts once the shorter of the two
    // names is specific enough to mean something on its own.
    const shorterLength = Math.min(itemName.length, normalised.length);
    if (shorterLength < 8) return false;
    return normalised.includes(itemName) || itemName.includes(normalised);
  });
  return byContains || null;
}
