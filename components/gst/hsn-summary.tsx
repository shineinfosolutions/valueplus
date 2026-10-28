"use client";

/**
 * GSTR-1 Table 12 — HSN-wise summary of sales, split into B2B and B2C.
 * Shared by the "HSN Summary" tab in GST Reports and its own page
 * (/gst/hsn-summary); data comes from /api/gstr-reports?type=HSN_SUMMARY.
 */
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { exportSheetsToExcel } from "@/lib/export/excel";

const money = (n: unknown) => `₹${(Number(n) || 0).toLocaleString("en-IN")}`;

/** GSTR-1 Table 12 columns, in the portal's own order. */
export const HSN_COLUMNS = [
  "HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate (%)", "Taxable Value",
  "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount",
];

const sumBy = (rows: any[], key: string) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

/** One part (B2B or B2C) of the HSN Summary, with a totals row and each row
 *  openable to the bill lines behind it. */
function HsnTable({
  title,
  note,
  rows,
  linesByRow,
  loading,
}: {
  title: string;
  note: string;
  rows: any[];
  linesByRow: Record<string, any[]>;
  loading: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const keyOf = (r: any) => `${r.HSN}__${r["Rate (%)"]}`;
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  const tax = (r: any) =>
    (Number(r["Integrated Tax Amount"]) || 0) + (Number(r["Central Tax Amount"]) || 0) + (Number(r["State/UT Tax Amount"]) || 0);

  return (
    <div className="bg-white border rounded-2xl overflow-hidden">
      <div className="p-4 border-b">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1">{note}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left whitespace-nowrap">
          <thead className="text-[10px] text-muted-foreground bg-slate-50 border-b uppercase">
            <tr>
              <th className="px-3 py-2.5">HSN</th>
              <th className="px-3 py-2.5">Description</th>
              <th className="px-3 py-2.5">UQC</th>
              <th className="px-3 py-2.5 text-right">Qty Sold</th>
              <th className="px-3 py-2.5 text-right">Rate (%)</th>
              <th className="px-3 py-2.5 text-right">Taxable Value</th>
              <th className="px-3 py-2.5 text-right">IGST</th>
              <th className="px-3 py-2.5 text-right">CGST</th>
              <th className="px-3 py-2.5 text-right">SGST</th>
              <th className="px-3 py-2.5 text-right">Cess</th>
              <th className="px-3 py-2.5 text-right">Total GST</th>
              <th className="px-3 py-2.5 text-right">Total Value</th>
              <th className="px-3 py-2.5 text-right">Bills</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={13} className="p-0"><TableShimmer rows={4} cols={13} /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={13} className="text-center p-8 text-muted-foreground">No sales found for this period</td></tr>
            ) : (
              <>
                {rows.map((row: any) => {
                  const k = keyOf(row);
                  const isOpen = open.has(k);
                  const lines = linesByRow[k] || [];
                  return (
                    <React.Fragment key={k}>
                      <tr className={cn("hover:bg-slate-50/50 cursor-pointer", isOpen && "bg-blue-50/40")} onClick={() => toggle(k)}>
                        <td className={cn("px-3 py-2.5 font-mono font-bold", row.HSN === "HSN missing" ? "text-rose-600" : "text-[#3F63AD]")}>{row.HSN}</td>
                        <td className="px-3 py-2.5 max-w-[220px] truncate" title={row.Description}>{row.Description || "—"}</td>
                        <td className="px-3 py-2.5">{row.UQC}</td>
                        <td className="px-3 py-2.5 text-right font-medium">{row["Total Quantity"]}</td>
                        <td className="px-3 py-2.5 text-right">{row["Rate (%)"]}%</td>
                        <td className="px-3 py-2.5 text-right font-medium">{money(row["Taxable Value"])}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["Integrated Tax Amount"])}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["Central Tax Amount"])}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["State/UT Tax Amount"])}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["Cess Amount"])}</td>
                        <td className="px-3 py-2.5 text-right font-semibold">{money(tax(row))}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["Total Value"])}</td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="text-xs font-bold text-[#3F63AD]">{row.Bills} {isOpen ? "▴" : "▾"}</span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={13} className="px-3 py-2">
                            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                              <table className="w-full min-w-[680px] text-xs">
                                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                                  <tr>
                                    <th className="px-2.5 py-2 text-left">Bill #</th>
                                    <th className="px-2.5 py-2 text-left">Date</th>
                                    <th className="px-2.5 py-2 text-left">Customer</th>
                                    <th className="px-2.5 py-2 text-left">Product</th>
                                    <th className="px-2.5 py-2 text-right">Qty</th>
                                    <th className="px-2.5 py-2 text-right">Taxable</th>
                                    <th className="px-2.5 py-2 text-right">GST</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  {lines.map((l: any, i: number) => (
                                    <tr key={`${l.invoiceNumber}-${i}`}>
                                      <td className="px-2.5 py-1.5 font-mono font-bold text-[#3F63AD] whitespace-nowrap">
                                        {l.invoiceNumber}
                                        {l.isCreditNote && <span className="ml-1 text-[10px] text-rose-600">(Credit Note)</span>}
                                      </td>
                                      <td className="px-2.5 py-1.5 whitespace-nowrap">{l.date}</td>
                                      <td className="px-2.5 py-1.5">
                                        {l.customerName}
                                        {l.customerGST && <span className="block text-[10px] font-mono text-slate-400">{l.customerGST}</span>}
                                      </td>
                                      <td className="px-2.5 py-1.5 whitespace-normal">{l.itemName}</td>
                                      <td className="px-2.5 py-1.5 text-right font-mono">{l.quantity}</td>
                                      <td className="px-2.5 py-1.5 text-right font-mono">{money(l.taxable)}</td>
                                      <td className="px-2.5 py-1.5 text-right font-mono">{money(l.tax)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                <tr className="bg-slate-100/70 font-semibold">
                  <td className="px-3 py-2.5" colSpan={3}>Total</td>
                  <td className="px-3 py-2.5 text-right">{sumBy(rows, "Total Quantity")}</td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-right">{money(sumBy(rows, "Taxable Value"))}</td>
                  <td className="px-3 py-2.5 text-right">{money(sumBy(rows, "Integrated Tax Amount"))}</td>
                  <td className="px-3 py-2.5 text-right">{money(sumBy(rows, "Central Tax Amount"))}</td>
                  <td className="px-3 py-2.5 text-right">{money(sumBy(rows, "State/UT Tax Amount"))}</td>
                  <td className="px-3 py-2.5 text-right">{money(sumBy(rows, "Cess Amount"))}</td>
                  <td className="px-3 py-2.5 text-right">{money(rows.reduce((a, r) => a + tax(r), 0))}</td>
                  <td className="px-3 py-2.5 text-right">{money(sumBy(rows, "Total Value"))}</td>
                  <td className="px-3 py-2.5 text-right">{sumBy(rows, "Bills")}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const taxOf = (rows: any[]) =>
  sumBy(rows, "Integrated Tax Amount") + sumBy(rows, "Central Tax Amount") + sumBy(rows, "State/UT Tax Amount");

export interface HsnSummary {
  b2b: any[];
  b2c: any[];
  all: any[];
  meta: any;
  loading: boolean;
}

/** HSN Summary for one month (0-11). */
export function useHsnSummary(month: number, year: number, enabled = true): HsnSummary {
  const { data, isLoading } = useQuery({
    queryKey: ["gstr-reports", "HSN_SUMMARY", month, year],
    queryFn: async () => {
      const res = await fetch(`/api/gstr-reports?type=HSN_SUMMARY&month=${month}&year=${year}`);
      const json = await res.json();
      return json.success
        ? { b2b: json.data.b2b || [], b2c: json.data.b2c || [], meta: json.meta || {} }
        : { b2b: [], b2c: [], meta: {} };
    },
    enabled,
  });
  const b2b: any[] = data?.b2b || [];
  const b2c: any[] = data?.b2c || [];
  return { b2b, b2c, all: [...b2b, ...b2c], meta: data?.meta || {}, loading: isLoading };
}

/** One combined table (with a Section column) for the generic Excel/PDF export. */
export function hsnExportRows({ b2b, b2c }: HsnSummary) {
  return [
    ...b2b.map(({ Bills, ...r }) => ({ Section: "B2B", ...r })),
    ...b2c.map(({ Bills, ...r }) => ({ Section: "B2C", ...r })),
  ];
}

/** One .xlsx with hsn(b2b) and hsn(b2c) sheets, in the GST portal's column order. */
export function exportHsnSummaryExcel({ b2b, b2c }: HsnSummary, period: string) {
  exportSheetsToExcel(
    [
      { name: "hsn(b2b)", rows: b2b.map(({ Bills, ...r }) => r), headers: HSN_COLUMNS },
      { name: "hsn(b2c)", rows: b2c.map(({ Bills, ...r }) => r), headers: HSN_COLUMNS },
    ],
    `gstr1_hsn_summary_${period.replace(" ", "_")}`
  );
}

/** Summary cards, warnings and the B2B / B2C tables. */
export function HsnSummaryView({ summary }: { summary: HsnSummary }) {
  const { b2b, b2c, all, meta, loading } = summary;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: "Total Taxable Value", value: money(sumBy(all, "Taxable Value")) },
          { label: "Total GST Collected", value: money(taxOf(all)) },
          {
            label: "B2B Sales",
            lines: [
              { label: "Taxable", value: money(sumBy(b2b, "Taxable Value")) },
              { label: "GST", value: money(taxOf(b2b)) },
            ],
          },
          {
            label: "B2C Sales",
            lines: [
              { label: "Taxable", value: money(sumBy(b2c, "Taxable Value")) },
              { label: "GST", value: money(taxOf(b2c)) },
            ],
          },
          { label: "HSN Codes Sold", value: String(new Set(all.map((r) => r.HSN)).size) },
        ].map((c: { label: string; value?: string; lines?: { label: string; value: string }[] }) => (
          <div key={c.label} className="bg-white rounded-2xl border p-4">
            <p className="text-xs font-medium text-muted-foreground">{c.label}</p>
            {loading ? (
              <h3 className="text-lg font-bold mt-1">…</h3>
            ) : c.lines ? (
              // Two amounts in one card: one labelled line each, never wrapped mid-amount.
              <div className="mt-1 space-y-0.5">
                {c.lines.map((l) => (
                  <div key={l.label} className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">{l.label}</span>
                    <span className="text-base font-bold whitespace-nowrap">{l.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <h3 className="text-lg font-bold mt-1 whitespace-nowrap">{c.value}</h3>
            )}
          </div>
        ))}
      </div>

      {(meta.missingHsnLines > 0 || meta.creditNotes > 0) && (
        <div className="space-y-2">
          {meta.missingHsnLines > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 w-fit">
              ⚠️ {meta.missingHsnLines} bill line(s) have no HSN code on the bill or in the product master — shown as
              "HSN missing". Add the HSN in Masters → Items before filing.
            </p>
          )}
          {meta.creditNotes > 0 && (
            <p className="text-xs text-slate-600 bg-slate-50 border rounded px-2 py-1 w-fit">
              {meta.creditNotes} credit note(s) this period are subtracted from the figures.
            </p>
          )}
        </div>
      )}

      <HsnTable
        title="GSTR-1 — Table 12: HSN Summary · B2B"
        note="Sales to GST-registered customers (valid 15-character GSTIN), one row per HSN and tax rate. Click a row to see the bills behind it. Verify with your CA before filing."
        rows={b2b}
        linesByRow={meta.linesByRow?.b2b || {}}
        loading={loading}
      />
      <HsnTable
        title="GSTR-1 — Table 12: HSN Summary · B2C"
        note="Sales to unregistered customers (no valid GSTIN), one row per HSN and tax rate. Click a row to see the bills behind it. Verify with your CA before filing."
        rows={b2c}
        linesByRow={meta.linesByRow?.b2c || {}}
        loading={loading}
      />
    </div>
  );
}
