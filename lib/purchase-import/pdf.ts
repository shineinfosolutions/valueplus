// Supplies the DOMMatrix and in-process pdfjs worker that pdf-parse's
// pdfjs-dist engine needs, in a way that works both on Node and on Cloudflare
// Workers (where the native `@napi-rs/canvas` addon pdf-parse/worker relies on
// cannot load). `pdf-parse` itself is imported lazily in extractRowsFromPdf():
// as a server external, a static import would be loaded before this module
// body runs, and pdfjs would then fail at load time with "DOMMatrix is not
// defined".
import "./pdf-env";
import { extractEmbeddedCode } from "./match-item";
import { parseValuePlusRetailLines } from "./valueplus-retail";

/**
 * Break one extracted text line into cells resolveRows() can read as
 * name / quantity / rate / amount.
 *
 *   "LED TV 43 inch    5    20,000.00    100,000.00"  -> multi-space gaps
 *   "LED TV 43 inch 5 20000 100000"                    -> trailing numbers
 */
function splitPdfTextLine(line: string): string[] {
  // pdf-parse/pdfjs itself inserts a real tab between two text runs it saw as
  // separate columns (a wide x-gap in the PDF's own layout) — when a tab
  // survived, it's a far more reliable column boundary than anything this
  // function could guess from whitespace or trailing numbers, and it holds
  // even when the PDF's column ORDER isn't left-to-right the way a normal
  // Name-Qty-Rate-Amount sheet would read (a real supplier invoice was seen
  // to extract its line-item row as Amount ... Qty Description S.No, right
  // to left, because that's the order its own content stream drew them in).
  if (line.includes("\t")) {
    const cells: string[] = [];
    for (const raw of line.split("\t")) {
      const cell = raw.trim();
      if (!cell) continue;
      // Two columns that sit close together in the PDF (e.g. Qty right next
      // to Taxable Value) can land in the same tab-cell separated by just a
      // space instead of a tab — split those back into two cells so each
      // number is still its own column.
      const twoNumbers = cell.match(/^(-?[\d,]+\.?\d*)\s+(-?[\d,]+\.?\d*)$/);
      if (twoNumbers) {
        cells.push(twoNumbers[1], twoNumbers[2]);
      } else {
        cells.push(cell);
      }
    }
    if (cells.length >= 2) return cells;
  }

  const byGaps = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
  if (byGaps.length >= 2) return byGaps;

  // Lookbehind/lookahead keep this from matching the "14" inside a model
  // number like "M14" — only a token with no letter directly touching it
  // counts as a quantity/rate/amount. matchAll (not match) is used so each
  // hit keeps its position in the string — a plain string search for "where
  // does the last number start" would find the FIRST occurrence of that same
  // digit sequence if it also appears earlier in the line (a quantity "2"
  // reappearing inside a later price, for instance), slicing the name in the
  // wrong place.
  const numberToken = /(?<![A-Za-z])-?[\d,]+\.?\d*(?![A-Za-z])/g;
  const matches = [...line.matchAll(numberToken)];
  if (matches.length === 0) return [line];

  // A product description often carries its own standalone number — "55
  // Inch", "1.5 Ton" — indistinguishable from a real qty/rate/amount by value
  // alone. Only the trailing run is trusted to be the numeric columns; taking
  // the name up to where THAT run starts (not the position of the very last
  // number substring) is what keeps an earlier "55" inside the name instead
  // of truncating everything after it.
  const trailingCount = Math.min(matches.length, 3);
  const firstTrailing = matches[matches.length - trailingCount];
  const name = line.slice(0, firstTrailing.index).trim();
  const trailing = matches.slice(-trailingCount).map((m) => m[0]);

  return name ? [name, ...trailing] : [line];
}

export interface ExtractedSupplier {
  name?: string;
  phone?: string;
  gstin?: string;
}

/**
 * Pull the SELLING party's name/phone/GSTIN off a GST tax invoice's own
 * letterhead — never the buyer's. On every real invoice seen from this kind
 * of billing software, the buyer's "Contact No"/"GSTIN/PAN" appear as bare
 * label words with no value glued to them on the same line (the value sits
 * elsewhere in the reversed/reflowed text), while the SUPPLIER's own contact
 * line is always "Contact No : <10 digits>" and "GSTIN/PAN: <15 chars>" with
 * the value right there after a colon — that colon-attached shape is what
 * tells the two apart. The company name itself carries no label at all, so
 * it's found by scanning forward from the GSTIN/PAN line for the next line
 * that looks like a business name (a common legal-entity suffix) rather than
 * an address/bank-details line.
 */
function extractSupplierInfo(text: string): ExtractedSupplier {
  const phoneMatch = text.match(/Contact No\s*:\s*(\d{10})/i);
  const gstinMatch = text.match(/GSTIN\s*\/\s*PAN\s*:\s*([0-9A-Z]{15})/i);

  const lines = text.split("\n").map((l) => l.trim());
  const anchorIdx = lines.findIndex((l) => /GSTIN\s*\/\s*PAN\s*:/i.test(l));
  const nameSuffix =
    /(PRIVATE LIMITED|PVT\.?\s*LTD|LLP|ENTERPRISES|DISTRIBUTORS?|TRADERS?|ELECTRONICS|RETAIL(ERS)?|AGENC(Y|IES)|CORPORATION|INDUSTR(Y|IES)|ASSOCIATES|COMPANY|STORES?)\b/i;
  let name: string | undefined;
  if (anchorIdx !== -1) {
    for (let i = anchorIdx; i < Math.min(anchorIdx + 8, lines.length); i++) {
      if (nameSuffix.test(lines[i])) {
        name = lines[i];
        break;
      }
    }
  }

  return {
    name,
    phone: phoneMatch ? phoneMatch[1] : undefined,
    gstin: gstinMatch ? gstinMatch[1].toUpperCase() : undefined,
  };
}

/**
 * Read a PDF into the same kind of raw grid extractRowsFromExcel() produces,
 * so both feed the identical resolveRows() logic.
 *
 * Only text-based PDFs are supported — a scanned or photographed invoice has
 * no text layer for pdf-parse to read, and this deliberately does not fall
 * back to OCR (that belongs to a different, paid extraction path, not this
 * free one). `usedTableExtraction: false` tells the caller which case this
 * was, so the UI can say plainly that a scanned document isn't supported
 * rather than silently returning nothing.
 */
export async function extractRowsFromPdf(
  buffer: Buffer
): Promise<{
  grid: string[][];
  serialGrid: string[][];
  usedTableExtraction: boolean;
  rawText: string;
  supplier: ExtractedSupplier;
}> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });

  try {
    // Fetched up front and unconditionally — the supplier's letterhead only
    // lives in the plain text layer, never in the extracted table, so it has
    // to be read here even on the happy path where a table WAS found for the
    // line items below.
    const textResult = await parser.getText();
    const rawText = textResult.text || "";
    const supplier = extractSupplierInfo(rawText);

    // A real table structure, when pdf-parse can find one, is far more
    // reliable than guessing columns from flat text — column boundaries are
    // taken from the PDF's own layout instead of inferred from whitespace.
    const tableResult = await parser.getTable();
    const tables = tableResult.mergedTables || [];

    // A multi-page supplier invoice can carry a second table listing one row
    // per physical unit's serial/IMEI number (see SERIAL NUMBER DETAILS in
    // the sample invoice) — that table must not compete with the line-items
    // table for "biggest", or it either wins and replaces the real line items,
    // or loses and gets silently discarded. Pull it out by its header first.
    const serialGrid =
      tables.find((t) => (t[0] || []).some((cell) => /serial/i.test(String(cell || "")))) || [];
    const lineItemTables = serialGrid.length ? tables.filter((t) => t !== serialGrid) : tables;

    const biggest = lineItemTables.reduce<string[][] | null>((best, t) => {
      if (!best || t.length > best.length) return t;
      return best;
    }, null);

    if (biggest && biggest.length >= 2 && biggest[0].length >= 2) {
      return { grid: biggest, serialGrid, usedTableExtraction: true, rawText: "", supplier };
    }

    // No usable table — fall back to line-by-line text. resolveRows() still
    // needs the numbers split into their own cells to find quantity and rate,
    // so each line is split here before handing it over: first by wherever
    // the PDF's own multi-space column gaps survived extraction, and where a
    // line came through as one unbroken run of text, by peeling the trailing
    // numeric tokens (qty / rate / amount) off the end of it instead.
    const lines = rawText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // A "SERIAL NUMBER DETAILS" section (one line per physical unit, not a
    // line item) sits after the item table on a multi-page invoice — its
    // lines still carry the same embedded product code a real item line
    // does, so left in with the rest they get parsed as extra, bogus line
    // items instead of being recognised as serial data. Splitting them out
    // here keeps them out of the line-item grid entirely.
    const serialMarkerIdx = lines.findIndex((l) => /serial\s*number\s*details/i.test(l));
    const itemLines = serialMarkerIdx === -1 ? lines : lines.slice(0, serialMarkerIdx);
    const serialSectionLines = serialMarkerIdx === -1 ? [] : lines.slice(serialMarkerIdx + 1);

    // The distributor's own invoice layout is known exactly — read it as such
    // (full wrapped names, right qty/rate) before falling back to guessing.
    const knownLayoutGrid = parseValuePlusRetailLines(itemLines);
    const grid = knownLayoutGrid || itemLines.map((line) => splitPdfTextLine(line));

    // Column positions in this section aren't reliable as flat text (the
    // same reversed/merged-cell issue the item table has), so each unit's
    // serial is pulled straight off its "S/R : <value>" marker and matched
    // to a product by the embedded code on the same line, instead of trying
    // to align it to the section's own header cell-by-cell.
    //
    // A qty-2+ line lists every unit's serial on that SAME line, slash-
    // separated ("S/R : ABC123 / DEF456"), not one line per unit — capturing
    // only the text up to the first non-alphanumeric character (the old
    // regex) silently dropped every serial after the first, so a 2-unit line
    // always came back "1/2 Recorded" no matter how the admin filled it in.
    let textSerialGrid: string[][] = [];
    const serialEntries: { code: string; serial: string }[] = [];
    serialSectionLines.forEach((line) => {
      const srBlockMatch = line.match(/S\/?R\s*:\s*([^\t]+?)(?:\t|$)/i);
      const code = extractEmbeddedCode(line);
      if (!srBlockMatch || !code) return;
      srBlockMatch[1]
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((serial) => serialEntries.push({ code, serial }));
    });
    if (serialEntries.length > 0) {
      textSerialGrid = [["Description", "Serial Number"], ...serialEntries.map((e) => [e.code, e.serial])];
    }

    return { grid, serialGrid: textSerialGrid, usedTableExtraction: Boolean(knownLayoutGrid), rawText, supplier };
  } finally {
    await parser.destroy();
  }
}
