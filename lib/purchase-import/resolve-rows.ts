/**
 * Turns a raw grid of cells — from an Excel sheet or a PDF table — into
 * structured purchase-entry rows.
 *
 * Both source formats end up as the same shape (`string[][]`, one array per
 * row) before reaching this file, so a supplier's Excel sheet and their PDF
 * invoice go through identical column-detection and row-building logic. Only
 * how the grid is produced differs (see excel.ts and pdf.ts).
 */

import { extractEmbeddedCode } from "./match-item";

export interface ParsedPurchaseRow {
  /** 1-based row number in the source file, for the admin to trace a mistake back. */
  sourceRow: number;
  name: string;
  quantity: number;
  rate: number;
  gstRate: number;
  hsn?: string;
  amount?: number;
  /** True when the row's own qty*rate doesn't reasonably match its amount column
   *  (when one was present) — a signal the row is worth a second look. */
  lowConfidence: boolean;
  /** What this row looked like before parsing, shown in the preview on request. */
  rawCells: string[];
}

const HEADER_KEYWORDS = {
  name: ["item", "product", "description", "particular", "goods", "material", "name"],
  quantity: ["qty", "quantity", "units", "nos", "no."],
  rate: ["rate", "price", "unit price", "unit rate", "unitprice"],
  // A flat single-rate column, e.g. a simple supplier sheet with just "GST %".
  // A GST tax invoice that breaks tax into CGST/SGST or IGST instead is
  // handled separately below — those percentages must be added together
  // (CGST 9% + SGST 9% = 18%), not read as if either alone were the full rate.
  gst: ["gst", "tax%", "tax %", "gst%", "gst %"],
  cgst: ["cgst"],
  sgst: ["sgst"],
  igst: ["igst"],
  hsn: ["hsn", "sac"],
  // A GST tax invoice's "Taxable Value" column is the line's pre-tax total —
  // conceptually a source for the unit rate (taxableValue ÷ qty), not the
  // same thing as "Amount"/"Total" (the tax-INCLUSIVE final line total). Both
  // contain the word "value"/"total" though, so without separating them the
  // taxable-value column claims the generic `amount` role first (it usually
  // appears earlier in the row) and the real, inclusive Amount column is
  // never read at all — silently breaking the row's own accuracy check.
  taxableValue: ["taxable value", "taxable amt", "taxable"],
  amount: ["amount", "total", "value", "net amt", "line total"],
} as const;

type ColumnRole = keyof typeof HEADER_KEYWORDS;

/** Strip currency symbols, commas and stray whitespace, then parse a number. */
function toNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[₹,]/g, "").replace(/[^\d.\-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function normaliseHeader(cell: string): string {
  return String(cell || "").toLowerCase().trim();
}

/** Does this row look like a header row rather than data? */
function looksLikeHeader(row: string[]): boolean {
  const joined = row.map(normaliseHeader).join(" ");
  let hits = 0;
  for (const keywords of Object.values(HEADER_KEYWORDS)) {
    if (keywords.some((k) => joined.includes(k))) hits += 1;
  }
  return hits >= 2;
}

/** Map each column index to the role its header text suggests, if any. */
function detectColumns(headerRow: string[]): Partial<Record<ColumnRole, number>> {
  const map: Partial<Record<ColumnRole, number>> = {};
  headerRow.forEach((cell, idx) => {
    const text = normaliseHeader(cell);
    if (!text) return;
    for (const [role, keywords] of Object.entries(HEADER_KEYWORDS) as [ColumnRole, readonly string[]][]) {
      if (map[role] !== undefined) continue;
      // "CGST Amt." matches the "cgst" keyword just as much as "CGST %" does —
      // only the percentage column is the rate; the amount column belongs to
      // no role here (its rupee value isn't useful for building the row).
      if ((role === "cgst" || role === "sgst" || role === "igst") && /amt|amount/.test(text)) continue;
      // A "Taxable Value"/"Taxable Amt" header must go to the dedicated
      // `taxableValue` role only — otherwise the generic `amount` role (whose
      // keywords include "value"/"amount") claims it first and the real,
      // tax-inclusive Amount/Total column never gets read.
      if (role === "amount" && text.includes("taxable")) continue;
      if (keywords.some((k) => text.includes(k))) {
        map[role] = idx;
      }
    }
  });
  return map;
}

/**
 * Every column whose header text is clearly tax/GST-related — including a
 * CGST/SGST/IGST *amount* column, which `detectColumns` deliberately leaves
 * unassigned to any role (its rupee value has no role in the row) but which
 * is just as unfit to be blindly guessed as a quantity or rate as the columns
 * that DO get a role. Used only to keep such columns out of that guess.
 */
function taxRelatedColumns(headerRow: string[]): Set<number> {
  const cols = new Set<number>();
  headerRow.forEach((cell, idx) => {
    const text = normaliseHeader(cell);
    if (/cgst|sgst|igst|\bgst\b|\btax\b/.test(text)) cols.add(idx);
  });
  return cols;
}

/**
 * Lines that are obviously not a product row — invoice chrome, not goods.
 *
 * Every alternative ends in `\b`, a word boundary. Without it, a bare prefix
 * match on "total" also matched "Totally New Product" and "pan" matched
 * "Panasonic" — real product rows silently vanishing with no indication why.
 * `\b` only fires between a word character and a non-word one, so "total"
 * matches "Total" and "Total:" but not "Totally", and "pan" matches "PAN No:"
 * but not "Panasonic".
 */
const SKIP_LINE_PATTERN =
  /^(sr\.?\s*no\.?\b|s\.?\s*no\.?\b|total\b|sub\s*-?\s*total\b|grand\s*total\b|tax\b|gst\b|cgst\b|sgst\b|igst\b|invoice\b|bill\b|date\b|gstin\b|pan\b|terms\b|amount in words|declaration\b|signature\b|page \d)/i;

export interface ResolveOptions {
  /** Fallback GST rate when no column supplies one. */
  defaultGstRate?: number;
  /**
   * Set by the PDF text-fallback path only — used when pdf-parse couldn't
   * find an actual table, so the grid is just each line of raw text with no
   * header and no reliable column order (a real supplier invoice was seen to
   * extract its data row in reverse, Amount-first, with unrelated lines like
   * addresses, GSTINs and bank details scattered in between as "rows" of
   * their own). None of the normal column-position guessing is trustworthy
   * there, so a row is only accepted at all when its text contains this
   * business's own embedded product code (e.g. "VP0011286") — every line
   * that doesn't carry one is invoice chrome, not a line item, full stop.
   */
  requireEmbeddedCode?: boolean;
}

/** Does this look like a bare HSN/SAC code — a plain integer, comma-free, long
 *  enough that it's not a quantity, but with no decimal point like a price? */
function looksLikeHsn(raw: string): boolean {
  return /^\d{4,8}$/.test(raw.trim());
}

// Every GST slab actually in force, plus the half-rate each splits into on
// an intra-state invoice's CGST/SGST columns (e.g. 18% becomes two 9% cells).
// A cell is only trusted as a percentage if its value is actually ONE of
// these — not just "any smallish decimal" — because an unusually low-priced
// line item (a near-free bundled accessory, ₹1.70 taxable on a gift item)
// has rupee figures that fall in the very same 0–100, one-or-two-decimal
// shape a GST% cell has, and were getting swept up as extra "tax rate"
// points, inflating the derived GST rate well past what the invoice says.
const VALID_GST_RATES = new Set([
  0, 0.05, 0.1, 0.125, 0.25, 0.75, 1.5, 2.5, 3, 3.75, 4.5, 5, 6, 7, 7.5, 9, 12, 14, 18, 28,
]);

/**
 * Does this look like a GST percentage cell — "9.0", "18.00", "0.0"?
 *
 * A decimal point is required deliberately — a bare "1" or "18" with no
 * decimal is indistinguishable by range alone from a quantity or an S.No,
 * and every GST-rate cell actually seen on a real invoice carries one
 * ("9.0", not "9"). Without this, the row's own quantity (typically the
 * smallest whole number on the line) kept getting counted as an extra GST
 * percentage point and inflating the derived rate.
 */
function looksLikePercent(raw: string, value: number): boolean {
  if (!/^\d{1,3}\.\d+$/.test(raw.trim())) return false;
  return Array.from(VALID_GST_RATES).some((r) => Math.abs(r - value) < 0.01);
}

/**
 * Recover a row from one line of raw PDF text whose column order can't be
 * trusted at all — only that it contains this shop's own product code
 * somewhere in it. Classifies each OTHER cell by what it LOOKS like (an HSN
 * code, a GST%, or a rupee figure) rather than by position, then derives the
 * rate from amount ÷ quantity ÷ (1 + GST%) — sidestepping the need to tell a
 * taxable-value cell apart from a CGST/SGST rupee-amount cell, which look
 * identical in isolation and can't be told apart by shape alone.
 */
function resolveEmbeddedCodeRow(
  row: string[],
  sourceRow: number,
  defaultGst: number
): ParsedPurchaseRow | null {
  let nameIdx = -1;
  let bestLetters = -1;
  row.forEach((cell, idx) => {
    if (!extractEmbeddedCode(cell)) return;
    const letters = (cell.match(/[A-Za-z]/g) || []).length;
    if (letters > bestLetters) {
      bestLetters = letters;
      nameIdx = idx;
    }
  });
  if (nameIdx === -1) return null;

  const name = row[nameIdx].trim();

  let hsn: string | undefined;
  const percents: number[] = [];
  const currencyOrQty: number[] = [];
  row.forEach((cell, idx) => {
    if (idx === nameIdx) return;
    const raw = (cell || "").trim();
    if (!raw) return;
    const value = toNumber(raw);
    if (value <= 0) return;
    if (looksLikeHsn(raw)) {
      hsn = raw;
    } else if (looksLikePercent(raw, value)) {
      percents.push(value);
    } else {
      currencyOrQty.push(value);
    }
  });

  if (currencyOrQty.length === 0) return null;

  // The line's tax-inclusive total is its single biggest rupee figure; the
  // quantity is the smallest whole number among the rest (a unit count is
  // never a fraction, and is essentially always far smaller than a price).
  // Excluding BY VALUE here ("!== amount") dropped the real quantity too
  // whenever it happened to equal the amount in rupees — a genuine qty-2
  // line priced at exactly ₹2 (a near-free bundled accessory) always came
  // back as qty 1, since both cells read "2" and the filter couldn't tell
  // them apart. Excluding the one INDEX the max came from, instead, leaves
  // every other cell — even ones sharing that same value — still eligible.
  const amount = Math.max(...currencyOrQty);
  const amountIdx = currencyOrQty.indexOf(amount);
  const wholeNumberCandidates = currencyOrQty.filter((n, i) => i !== amountIdx && Number.isInteger(n));
  const quantity = wholeNumberCandidates.length > 0 ? Math.min(...wholeNumberCandidates) : 1;

  const gstRate = percents.length > 0 ? percents.reduce((a, b) => a + b, 0) || defaultGst : defaultGst;
  const rate = Math.round((amount / quantity / (1 + gstRate / 100)) * 100) / 100;

  return {
    sourceRow,
    name,
    quantity,
    rate,
    gstRate,
    hsn,
    amount,
    // Reconstructed from raw text with no header to anchor it — always
    // surfaced for a look, the same as every other guess-mode row.
    lowConfidence: true,
    rawCells: row,
  };
}

/**
 * Build structured rows from a raw grid.
 *
 * If the first row reads as a header, its columns are located by keyword and
 * every following row is mapped through them. If nothing reads as a header —
 * common for a PDF table with no captured header, or a bare data dump — a
 * fixed left-to-right guess (name, qty, rate, gst) is used instead, and every
 * row is marked low-confidence so the preview screen highlights it for a
 * closer look rather than presenting a guess as a fact.
 */
export function resolveRows(grid: string[][], options: ResolveOptions = {}): ParsedPurchaseRow[] {
  const defaultGst = options.defaultGstRate ?? 18;
  const rows = grid
    .map((r) => (r || []).map((c) => String(c ?? "").trim()))
    .filter((r) => r.some((c) => c.length > 0));

  if (rows.length === 0) return [];

  if (options.requireEmbeddedCode) {
    const results: ParsedPurchaseRow[] = [];
    rows.forEach((row, i) => {
      const parsed = resolveEmbeddedCodeRow(row, i + 1, defaultGst);
      if (parsed) results.push(parsed);
    });
    return results;
  }

  const firstRowIsHeader = looksLikeHeader(rows[0]);
  const columns = firstRowIsHeader ? detectColumns(rows[0]) : {};
  const taxCols = firstRowIsHeader ? taxRelatedColumns(rows[0]) : new Set<number>();
  const dataRows = firstRowIsHeader ? rows.slice(1) : rows;
  const startIndex = firstRowIsHeader ? 2 : 1;

  const nameCol = columns.name ?? 0;
  const qtyCol = columns.quantity;
  const rateCol = columns.rate;
  const gstCol = columns.gst;
  const cgstCol = columns.cgst;
  const sgstCol = columns.sgst;
  const igstCol = columns.igst;
  const hsnCol = columns.hsn;
  const amountCol = columns.amount;
  const taxableValueCol = columns.taxableValue;

  const results: ParsedPurchaseRow[] = [];

  dataRows.forEach((row, i) => {
    const sourceRow = startIndex + i;
    const name = (row[nameCol] || "").trim();
    if (!name || SKIP_LINE_PATTERN.test(name)) return;
    // A row that is entirely numeric in its first cell is almost always a
    // stray total/subtotal line that slipped past the keyword filter.
    if (/^[\d.,₹\s\-]+$/.test(name)) return;
    // Fewer than 3 letters isn't a product name — page-footer fragments like
    // "-- 1 of 1 --" land here when a line has no other numeric structure to
    // flag it as chrome.
    if ((name.match(/[a-zA-Z]/g) || []).length < 3) return;
    // No header row was found for the WHOLE grid (common for a PDF with no
    // captured table), so a repeated column-heading line — "Item Description
    // Qty Rate Amount" — reads as an ordinary data row unless it's checked
    // here too, not just against row 0.
    if (!firstRowIsHeader && looksLikeHeader(row)) return;

    let quantity = qtyCol !== undefined ? toNumber(row[qtyCol]) : 0;
    let rate = rateCol !== undefined ? toNumber(row[rateCol]) : 0;
    const taxableValue = taxableValueCol !== undefined ? toNumber(row[taxableValueCol]) : undefined;
    const amount = amountCol !== undefined ? toNumber(row[amountCol]) : undefined;
    // A GST tax invoice conventionally splits tax as either CGST+SGST (intra-state)
    // or IGST alone (inter-state) — the two halves must be added, never read as
    // if one alone were the full rate, and only whichever pair is actually
    // present on this invoice applies (an intra-state bill has no IGST column
    // at all, and vice versa).
    let gstRate: number;
    if (cgstCol !== undefined || sgstCol !== undefined) {
      const cgstRate = cgstCol !== undefined ? toNumber(row[cgstCol]) : 0;
      const sgstRate = sgstCol !== undefined ? toNumber(row[sgstCol]) : 0;
      gstRate = cgstRate + sgstRate || defaultGst;
    } else if (igstCol !== undefined) {
      gstRate = toNumber(row[igstCol]) || defaultGst;
    } else if (gstCol !== undefined) {
      gstRate = toNumber(row[gstCol]) || defaultGst;
    } else {
      gstRate = defaultGst;
    }
    const hsn = hsnCol !== undefined ? (row[hsnCol] || "").trim() : undefined;
    // Whether this sheet actually told us it charges GST, as opposed to
    // `gstRate` just being the bare 18% fallback with nothing behind it — a
    // plain non-tax purchase sheet (no gst/cgst/sgst/igst/taxable-value
    // column at all) has its Amount equal to qty × rate with nothing added
    // on top, and must not be compared as if 18% were secretly baked in.
    const hasGstColumn =
      cgstCol !== undefined ||
      sgstCol !== undefined ||
      igstCol !== undefined ||
      gstCol !== undefined ||
      taxableValueCol !== undefined;

    let lowConfidence = !firstRowIsHeader;
    let rateIsTaxInclusive = false;

    // Neither a quantity nor a rate column was found — recover them from
    // whatever numeric cells the row has. The count of numbers decides the
    // reading: three trailing numbers on an invoice line are conventionally
    // qty, rate, amount — the LAST one is the derived total, not a second
    // price, so taking the final two ([rate, amount]) as [qty, rate] read a
    // ₹90,000 line item as "45,000 units at ₹90,000 each". Two numbers means
    // no amount column exists, so they are read as [qty, rate] directly.
    if (!qtyCol && !rateCol) {
      // Every column whose role is already known — HSN code, GST%/GST-amount,
      // taxable value, the final amount — must be kept out of this guess.
      // Without this, an HSN code like "84183010" (millions) or a GST-amount
      // cell was just as eligible a "quantity" or "rate" candidate as the
      // real numbers, and multiplying one into the total is how a single row
      // could inflate the whole invoice into a nonsense figure.
      const knownCols = new Set([
        ...taxCols,
        ...[nameCol, hsnCol, gstCol, cgstCol, sgstCol, igstCol, taxableValueCol, amountCol].filter(
          (c): c is number => c !== undefined
        ),
      ]);
      const numericCells = row.map(toNumber).filter((n, idx) => !knownCols.has(idx) && n > 0);
      if (numericCells.length === 1 && (taxableValue || amount)) {
        // A Taxable Value or Amount column WAS found by header — the sole
        // remaining unclaimed number is almost certainly the quantity, so
        // derive rate from the real invoice total instead of guessing at it
        // from cells that have no business being a rate.
        quantity = numericCells[0];
        rate = taxableValue
          ? Math.round((taxableValue / quantity) * 100) / 100
          : Math.round((amount! / quantity) * 100) / 100;
        rateIsTaxInclusive = !taxableValue;
      } else if (numericCells.length >= 3) {
        [quantity, rate] = numericCells.slice(-3, -1);
      } else if (numericCells.length === 2) {
        [quantity, rate] = numericCells;
      } else if (numericCells.length === 1) {
        quantity = 1;
        rate = numericCells[0];
      }
      // This whole branch is a guess made with no column headers to anchor
      // it, so every row through it is flagged for a look regardless of how
      // clean the numbers seem.
      lowConfidence = true;
    } else if (!rate && taxableValue && quantity) {
      // A GST invoice's Taxable Value is the line's pre-tax total — dividing
      // by quantity gives the same pre-tax unit rate a Rate column would,
      // without GST double-counted on top of it later.
      rate = Math.round((taxableValue / quantity) * 100) / 100;
    } else if (!quantity && amount && rate) {
      quantity = Math.round((amount / rate) * 100) / 100;
    } else if (!rate && amount && quantity) {
      // No Rate or Taxable Value column at all — only a tax-inclusive Amount
      // to fall back on. Rate derived this way IS the tax-inclusive per-unit
      // price (not backed out of GST), which the lowConfidence check below
      // needs to know so it doesn't add GST on top of it a second time.
      rate = Math.round((amount / quantity) * 100) / 100;
      rateIsTaxInclusive = true;
    }

    if (!quantity) quantity = 1;

    // A row whose declared amount disagrees with the rate is flagged, not
    // rejected — the admin decides, this never silently drops or "corrects"
    // a number on its own. `amount` (when present) is the invoice's own
    // tax-INCLUSIVE total for the line, while `rate` is a pre-tax unit price
    // in every case except the fallback above — so the expected total needs
    // GST added on top of qty × rate before comparing, except there.
    if (amount && rate && quantity) {
      const expected =
        rateIsTaxInclusive || !hasGstColumn ? quantity * rate : quantity * rate * (1 + gstRate / 100);
      if (Math.abs(expected - amount) / Math.max(amount, 1) > 0.05) {
        lowConfidence = true;
      }
    }

    if (!(rate > 0)) lowConfidence = true;

    results.push({
      sourceRow,
      name,
      quantity: quantity || 1,
      rate: Math.round(rate * 100) / 100,
      gstRate,
      hsn: hsn || undefined,
      amount,
      lowConfidence,
      rawCells: row,
    });
  });

  return results;
}
