import * as XLSX from "xlsx";

/**
 * Export a flat array of objects to a real .xlsx file — same signature as the
 * old `downloadCSV(data, filename)`, so every existing call site swaps in with
 * almost no change. Unlike CSV, columns are sized to fit their content, and a
 * genuine number (not a formatted string like "₹1,234") keeps its numeric type
 * instead of becoming quoted text Excel can't sum.
 *
 * No header styling (bold, fill colour): the `xlsx` community package this
 * app already depends on writes a cell's `.s` style object but silently drops
 * it — confirmed by round-tripping a written file, not assumed from the docs.
 * Making the header row bold for real needs a styling-capable fork
 * (`xlsx-js-style`), a separate dependency this task doesn't call for.
 */
export function exportToExcel(
  data: Record<string, unknown>[],
  filename: string,
  sheetName = "Sheet1"
): void {
  if (!data.length) return;

  const headers = Object.keys(data[0]);
  const worksheet = XLSX.utils.json_to_sheet(data, { header: headers });

  // Column width sized to the longer of the header or its widest value, capped
  // so one long note field doesn't blow the sheet out sideways.
  worksheet["!cols"] = headers.map((h) => {
    const longest = data.reduce((max, row) => {
      const len = String(row[h] ?? "").length;
      return len > max ? len : max;
    }, h.length);
    return { wch: Math.min(Math.max(longest + 2, 10), 50) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));

  const finalName = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  XLSX.writeFile(workbook, finalName);
}

/**
 * Several tables in one .xlsx, one sheet each (e.g. GSTR-1 HSN Summary's B2B
 * and B2C parts, which the portal keeps apart). An empty table still gets its
 * sheet, with just its header row, so the file always has the same shape.
 */
export function exportSheetsToExcel(
  sheets: { name: string; rows: Record<string, unknown>[]; headers: string[] }[],
  filename: string
): void {
  const workbook = XLSX.utils.book_new();
  sheets.forEach(({ name, rows, headers }) => {
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    worksheet["!cols"] = headers.map((h) => {
      const longest = rows.reduce((max, row) => {
        const len = String(row[h] ?? "").length;
        return len > max ? len : max;
      }, h.length);
      return { wch: Math.min(Math.max(longest + 2, 10), 50) };
    });
    XLSX.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31));
  });

  const finalName = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  XLSX.writeFile(workbook, finalName);
}
