/**
 * The Value Plus Retail Pvt Ltd tax invoice (the distributor's SAP print) has
 * no table pdf-parse can find, and its text comes out right to left, one item
 * per line:
 *
 *   Amount  IGST-amt  IGST%  SGST-amt  SGST%  CGST-amt  CGST%  Qty Taxable  HSN  Description  [S.No]
 *
 * with a long description wrapping onto the next line(s) and the S.No on a
 * line of its own:
 *
 *   "8,700.00\t0.00\t0.0\t663.56\t9.0\t663.56\t9.0\t1 7,372.88\t84501100\tVP0005367 -"
 *   "WTT70UHA/BRSSWH5POD 1200586-"
 *   "VOLTASBEKO"
 *   "11"
 *
 * Read generically, the wrapped part of the name was lost ("VP0005367 -") and
 * on ₹1 "OU" lines the S.No was taken as the amount. This reads the layout as
 * it is and returns a plain grid with a header, so the normal column reader
 * takes it from there with the right qty, taxable value and GST.
 */

const NUM = String.raw`-?[\d,]+(?:\.\d+)?`;
const ITEM_LINE = new RegExp(
  String.raw`^(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(\d+(?:\.\d+)?)\s+(${NUM})\s+(\d{4,8})\s+(.*)$`
);
const SERIAL_NO_LINE = /^\d{1,3}$/;
const PAGE_MARK = /^--\s*\d+\s+of\s+\d+\s*--$/i;

const num = (raw: string) => Number(String(raw).replace(/,/g, "")) || 0;

export const VALUEPLUS_RETAIL_HEADER = ["Description", "HSN", "Qty", "Taxable Value", "GST %", "Amount"];

/**
 * The second Value Plus Retail print ("ARInvoice", e.g. ARInvoice11.2026315122.pdf). pdf-parse reads it with the
 * description FIRST (its wrapped name, then the "S/R : ..." serial lines) and the figures on the line after, tab
 * separated, with the Amount LAST instead of first:
 *
 *   "VP0002116 - EI3V-C1(I)-P IVORY- HAIER"
 *   "S/R : GA07LP00E013AS7FDAE9,S/R :"
 *   "GA07LP00E013AS7FEGJ6"
 *   "0.00\t0\t469.83\t9\t469.83\t9\t2.00 5,220.34\t85161000\t1 6,160.00"
 *    IGST amt, IGST %, SGST amt, SGST %, CGST amt, CGST %, "Qty Taxable", HSN, "S.No Amount"
 *
 * That is not the layout `parseValuePlusRetailLines` reads, so such an invoice used to give "No product rows could be
 * found". This reads it and returns the same grid, plus each unit's serial (the invoice has no separate serial page).
 */
const AR_DATA_LINE = new RegExp(
  String.raw`^(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(\d+(?:\.\d+)?)\s+(${NUM})\s+(\d{4,8})\s+(\d{1,3})\s+(${NUM})$`
);
const AR_CODE_LINE = /^(VP\d{4,})\s*-/i;
const AR_SERIAL = /S\/?R\s*:\s*([A-Za-z0-9-]+)/gi;

export function parseValuePlusRetailArLines(lines: string[]): { grid: string[][]; serials: { code: string; serial: string }[] } | null {
  const rows: string[][] = [];
  const serials: { code: string; serial: string }[] = [];
  let started = false;
  let code = "";
  let desc: string[] = [];
  let sr: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const data = line.match(AR_DATA_LINE);
    if (data && started) {
      // Capture groups: 1 igst amt, 2 igst %, 3 sgst amt, 4 sgst %, 5 cgst amt, 6 cgst %, 7 qty, 8 taxable, 9 hsn, 10 s.no, 11 amount.
      const [qty, taxable, hsn, amount] = [data[7], data[8], data[9], data[11]];
      const gst = num(data[2]) + num(data[4]) + num(data[6]);
      rows.push([desc.join(" ").replace(/\s+/g, " ").trim(), hsn, qty, taxable.replace(/,/g, ""), gst.toFixed(1), amount.replace(/,/g, "")]);
      for (const s of sr.join(" ").matchAll(AR_SERIAL)) serials.push({ code, serial: s[1] });
      started = false;
      desc = [];
      sr = [];
      continue;
    }
    const codeMatch = line.match(AR_CODE_LINE);
    if (codeMatch) {
      started = true;
      code = codeMatch[1].toUpperCase();
      desc = [line.replace(/\t/g, " ")];
      sr = [];
      continue;
    }
    if (!started) continue;
    // From the first "S/R :" line on, every line until the figures is serial text (a long serial wraps).
    if (sr.length > 0 || /^S\/?R\s*:/i.test(line)) {
      sr.push(line);
      continue;
    }
    desc.push(line.replace(/\t/g, " "));
    // Guard against running into the invoice footer if the figures line is ever missing.
    if (desc.length > 5) started = false;
  }

  return rows.length > 0 ? { grid: [VALUEPLUS_RETAIL_HEADER, ...rows], serials } : null;
}

/** Item rows of a Value Plus Retail invoice, or null when the text isn't one. */
export function parseValuePlusRetailLines(lines: string[]): string[][] | null {
  const rows: string[][] = [];
  let open: { cells: string[]; desc: string[] } | null = null;

  const close = () => {
    if (!open) return;
    open.cells[0] = open.desc.join(" ").replace(/\s+/g, " ").trim();
    rows.push(open.cells);
    open = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const m = line.match(ITEM_LINE);
    if (m) {
      close();
      const [, amount, , igstPct, , sgstPct, , cgstPct, qty, taxable, hsn, rest] = m;
      // The S.No can trail the description on the same line, after a tab.
      const desc = rest.replace(/\t\s*\d{1,3}\s*$/, "").replace(/\t/g, " ").trim();
      const gst = num(igstPct) + num(sgstPct) + num(cgstPct);
      open = {
        cells: ["", hsn, qty, taxable.replace(/,/g, ""), gst.toFixed(1), amount.replace(/,/g, "")],
        desc: [desc],
      };
      // A description that already ended in its S.No is complete.
      if (/\t\s*\d{1,3}\s*$/.test(rest)) close();
      continue;
    }
    if (!open) continue;
    // The S.No on its own line, a page break or a blank ends the wrapped name.
    if (!line || SERIAL_NO_LINE.test(line) || PAGE_MARK.test(line)) {
      close();
      continue;
    }
    open.desc.push(line.replace(/\t/g, " "));
    // Guard against running into the invoice footer if an S.No is ever missing.
    if (open.desc.length > 4) close();
  }
  close();

  return rows.length > 0 ? [VALUEPLUS_RETAIL_HEADER, ...rows] : null;
}
