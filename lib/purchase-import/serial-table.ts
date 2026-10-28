/**
 * Parses a "Serial Number Details" style table — one row per physical unit
 * (S.No / Description / Qty / Serial Number) — into serial numbers grouped by
 * the product they belong to, so they can be attached to the matching
 * line-item row parsed out of the main table on page 1.
 */

import { extractEmbeddedCode } from "./match-item";

const DESCRIPTION_KEYWORDS = ["description", "particular", "item", "product"];
const SERIAL_KEYWORDS = ["serial", "imei", "s/r", "sr no"];

function normaliseHeader(cell: string): string {
  return String(cell || "").toLowerCase().trim();
}

function normaliseName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Strip a leading "S/R :" / "IMEI:" style label some invoices prefix the value with. */
function cleanSerialValue(raw: string): string {
  return String(raw || "")
    .replace(/^\s*(s\/?r|imei|serial(?:\s*no\.?)?)\s*[:.\-]?\s*/i, "")
    .trim();
}

function detectColumn(headerRow: string[], keywords: string[]): number | undefined {
  for (let i = 0; i < headerRow.length; i++) {
    const text = normaliseHeader(headerRow[i]);
    if (keywords.some((k) => text.includes(k))) return i;
  }
  return undefined;
}

/**
 * Group a serial-number grid's rows by the product they describe.
 *
 * Returns a map keyed by the description's embedded VP/item code when one is
 * present (the same key `resolveRows`'s callers can compute for a line-item
 * row via `extractEmbeddedCode`), falling back to the normalised description
 * text itself when no code is embedded — still enough to line up against an
 * identically-worded line-item row.
 */
export function groupSerialsByProduct(grid: string[][]): Record<string, string[]> {
  const rows = (grid || [])
    .map((r) => (r || []).map((c) => String(c ?? "").trim()))
    .filter((r) => r.some((c) => c.length > 0));

  if (rows.length < 2) return {};

  const descCol = detectColumn(rows[0], DESCRIPTION_KEYWORDS) ?? 1;
  const serialCol = detectColumn(rows[0], SERIAL_KEYWORDS) ?? rows[0].length - 1;

  const groups: Record<string, string[]> = {};

  rows.slice(1).forEach((row) => {
    const description = (row[descCol] || "").trim();
    const serial = cleanSerialValue(row[serialCol] || "");
    if (!description || !serial) return;

    const key = extractEmbeddedCode(description) || normaliseName(description);
    if (!key) return;

    if (!groups[key]) groups[key] = [];
    groups[key].push(serial);
  });

  return groups;
}

/** Look up the serial group for one line-item row's parsed name, same key logic as above. */
export function findSerialsForRow(rowName: string, groups: Record<string, string[]>): string[] | undefined {
  const byCode = extractEmbeddedCode(rowName);
  if (byCode && groups[byCode]) return groups[byCode];

  const byName = normaliseName(rowName);
  if (byName && groups[byName]) return groups[byName];

  return undefined;
}
