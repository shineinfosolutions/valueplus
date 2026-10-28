import * as XLSX from "xlsx";

/**
 * Read an Excel (or CSV) file into a raw grid of cells.
 *
 * `header: 1` is what makes SheetJS hand back `string[][]` instead of guessing
 * object keys from the first row — resolveRows() does its own header
 * detection, so the raw grid is what it needs.
 */
export function extractRowsFromExcel(buffer: Buffer): string[][] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  return grid.map((row) => row.map((cell) => String(cell ?? "")));
}
