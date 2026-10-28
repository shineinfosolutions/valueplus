import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

/**
 * Export a flat array of objects to a paginated table PDF, entirely
 * client-side (no server round trip) — the same "click, file downloads"
 * behaviour as the existing CSV export, just producing a real PDF instead.
 */
export interface ExportPdfOptions {
  title?: string;
  subtitle?: string;
  /** Explicit column order/labels; defaults to the keys of the first row. */
  columns?: { key: string; label: string }[];
}

export function exportToPdf(
  data: Record<string, unknown>[],
  filename: string,
  options: ExportPdfOptions = {}
): void {
  if (!data.length) return;

  const columns = options.columns || Object.keys(data[0]).map((key) => ({ key, label: key }));
  const doc = new jsPDF({ orientation: columns.length > 6 ? "landscape" : "portrait", unit: "pt" });

  const pageWidth = doc.internal.pageSize.getWidth();
  let cursorY = 40;

  doc.setFontSize(16);
  doc.setTextColor(63, 99, 173); // #3F63AD — the app's primary blue, matching every other printed document
  doc.text("Value Plus", 40, cursorY);

  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);
  cursorY += 20;
  if (options.title) {
    doc.text(options.title, 40, cursorY);
    cursorY += 16;
  }
  if (options.subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(options.subtitle, 40, cursorY);
    cursorY += 14;
  }

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Generated on ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`,
    pageWidth - 40,
    40,
    { align: "right" }
  );

  autoTable(doc, {
    startY: cursorY + 8,
    head: [columns.map((c) => c.label)],
    body: data.map((row) => columns.map((c) => formatCell(row[c.key]))),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [63, 99, 173], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 40, right: 40 },
  });

  // "Page X of Y" needs the FINAL page count, which isn't known yet while
  // autoTable is still drawing page X — a footer written during didDrawPage
  // would show "of 1", "of 2", "of 3" instead of "of 3" on every page. Doing
  // it as a second pass, after the table is fully laid out, is the
  // established fix for that.
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageWidth - 40,
      doc.internal.pageSize.getHeight() - 20,
      { align: "right" }
    );
  }

  const finalName = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  doc.save(finalName);
}

/** Numbers print as-is; everything else becomes a plain string, blanks stay blank. */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return String(value);
}
