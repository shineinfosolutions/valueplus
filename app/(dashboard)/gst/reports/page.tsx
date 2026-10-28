"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/shared/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, ArrowDownRight, Calculator, FileSpreadsheet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { HsnSummaryView, useHsnSummary, hsnExportRows, exportHsnSummaryExcel } from "@/components/gst/hsn-summary";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * GSTR-1 (Sales) and GSTR-2 (Purchases) below use the SAME column set the
 * admin's own Tally Sales Register export uses — same header text (including
 * its "IGST Outwad" typo) — so a row here drops straight into whatever
 * filing workflow that sheet already fits into, and the exported .xlsx keeps
 * every one of those columns rather than a trimmed-down summary. An HSN
 * Code column is added on top (not part of the original sheet) since a GST
 * return needs it per product and this ERP already knows each item's code.
 */

const money = (n: unknown) => `₹${(Number(n) || 0).toLocaleString("en-IN")}`;

export default function GSTReportsPage() {
  // Today's own month — always a valid, immediately-useful starting point
  // (the old hardcoded "August 2026" stayed stuck there forever, so every
  // invoice/bill raised in a later month never showed up until the admin
  // happened to notice the dropdown was out of date).
  const [period, setPeriod] = useState(() => monthLabel(new Date()));
  const [activeTab, setActiveTab] = useState<"gstr3b" | "gstr1" | "gstr2" | "b2b" | "b2c" | "hsn">("gstr3b");

  const parsePeriod = (p: string) => {
    const [month, year] = p.split(" ");
    const monthIndex = new Date(`${month} 1, 2000`).getMonth();
    return { month: monthIndex, year: parseInt(year) };
  };
  const selectedFilter = parsePeriod(period);

  const { data: gstr1 = [], isLoading: loadingGstr1 } = useQuery({
    queryKey: ["gstr-reports", "GSTR1"],
    queryFn: async () => {
      const res = await fetch("/api/gstr-reports?type=GSTR1");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: gstr2 = [], isLoading: loadingGstr2 } = useQuery({
    queryKey: ["gstr-reports", "GSTR2"],
    queryFn: async () => {
      const res = await fetch("/api/gstr-reports?type=GSTR2");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: b2bRows = [], isLoading: loadingB2B } = useQuery({
    queryKey: ["gstr-reports", "GSTR1_B2B", selectedFilter.month, selectedFilter.year],
    queryFn: async () => {
      const res = await fetch(`/api/gstr-reports?type=GSTR1_B2B&month=${selectedFilter.month}&year=${selectedFilter.year}`);
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: b2cData, isLoading: loadingB2C } = useQuery({
    queryKey: ["gstr-reports", "GSTR1_B2C", selectedFilter.month, selectedFilter.year],
    queryFn: async () => {
      const res = await fetch(`/api/gstr-reports?type=GSTR1_B2C&month=${selectedFilter.month}&year=${selectedFilter.year}`);
      const json = await res.json();
      return json.success
        ? { rows: json.data, b2clCandidates: json.meta?.b2clCandidates || 0, billsByRow: json.meta?.billsByRow || {} }
        : { rows: [], b2clCandidates: 0, billsByRow: {} };
    }
  });
  const b2cRows = b2cData?.rows || [];

  const hsn = useHsnSummary(selectedFilter.month, selectedFilter.year, activeTab === "hsn");
  const b2clCandidates = b2cData?.b2clCandidates || 0;
  const b2cBillsByRow: Record<string, any[]> = (b2cData as any)?.billsByRow || {};
  // Which B2C rows are opened to show their bills.
  const [openB2cRows, setOpenB2cRows] = useState<Set<string>>(new Set());
  const b2cRowKey = (row: any) => `${row["Place of Supply"]}__${row["Rate (%)"]}`;
  const toggleB2cRow = (key: string) =>
    setOpenB2cRows((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const allB2cOpen = b2cRows.length > 0 && b2cRows.every((r: any) => openB2cRows.has(b2cRowKey(r)));

  // Every month that actually has a Sales or Purchase record, newest first —
  // replaces the old fixed Aug/Jul/Jun list, which silently hid any period
  // outside those three (including whichever month it actually is today).
  // The current month is always present even with zero records yet, so
  // there's never a dropdown with nothing selectable.
  const availablePeriods = useMemo(() => {
    const months = new Set<string>([monthLabel(new Date())]);
    const addDate = (raw: string) => {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) months.add(monthLabel(d));
    };
    gstr1.forEach((r: any) => r["Inv Date"] && addDate(r["Inv Date"]));
    gstr2.forEach((r: any) => r["Bill Date"] && addDate(r["Bill Date"]));
    return Array.from(months).sort((a, b) => {
      const da = new Date(`1 ${a}`).getTime();
      const db = new Date(`1 ${b}`).getTime();
      return db - da;
    });
  }, [gstr1, gstr2]);

  const filterByPeriod = (data: any[], dateKey: string) => {
    return data.filter((row: any) => {
      const d = new Date(row[dateKey]);
      if (isNaN(d.getTime())) return false;
      return d.getMonth() === selectedFilter.month && d.getFullYear() === selectedFilter.year;
    });
  };

  const filteredGstr1 = filterByPeriod(gstr1, "Inv Date");
  const filteredGstr2 = filterByPeriod(gstr2, "Bill Date");

  // Calculations for GSTR-3B — each row's own CGST/SGST/IGST columns summed,
  // there's no longer a single pre-combined "totalTax" field on the row.
  const totalSalesAmount = filteredGstr1.reduce((acc: number, r: any) => acc + (Number(r.Gross) || 0), 0);
  const gstr1Cgst = filteredGstr1.reduce((a: number, r: any) => a + (Number(r["Output CGST @9%"]) || 0), 0);
  const gstr1Sgst = filteredGstr1.reduce((a: number, r: any) => a + (Number(r["Output SGST @9%"]) || 0), 0);
  const gstr1Igst = filteredGstr1.reduce((a: number, r: any) => a + (Number(r["Output IGST @18%"]) || 0), 0);
  const totalOutputTax = gstr1Cgst + gstr1Sgst + gstr1Igst;

  const totalPurchaseAmount = filteredGstr2.reduce((acc: number, r: any) => acc + (Number(r.Gross) || 0), 0);
  const gstr2Cgst = filteredGstr2.reduce((a: number, r: any) => a + (Number(r["Input CGST @9%"]) || 0), 0);
  const gstr2Sgst = filteredGstr2.reduce((a: number, r: any) => a + (Number(r["Input SGST @9%"]) || 0), 0);
  const gstr2Igst = filteredGstr2.reduce((a: number, r: any) => a + (Number(r["Input IGST @18%"]) || 0), 0);
  const totalInputTax = gstr2Cgst + gstr2Sgst + gstr2Igst;

  const netGstPayable = totalOutputTax - totalInputTax;

  // Export always reflects whichever tab is open, never a merged blob of
  // two differently-shaped registers — Sales and Purchases keep their own
  // column sets exactly as the reference sheet does.
  const exportConfig =
    activeTab === "gstr2"
      ? { data: filteredGstr2, filename: "gst_purchase_register", title: "GST Purchase Register (GSTR-2)" }
      : activeTab === "b2b"
      ? { data: b2bRows, filename: "gstr1_b2b", title: "GSTR-1 B2B Invoices" }
      : activeTab === "b2c"
      ? { data: b2cRows, filename: "gstr1_b2c", title: "GSTR-1 B2C (Small) Summary" }
      : activeTab === "hsn"
      ? {
          data: hsnExportRows(hsn),
          filename: "gstr1_hsn_summary",
          title: "GSTR-1 HSN Summary (B2B + B2C)",
        }
      : { data: filteredGstr1, filename: "gst_sales_register", title: "GST Sales Register (GSTR-1)" };

  return (
    <PageShell
      title="GST Reports"
      subtitle="GSTR-1, GSTR-2, and GSTR-3B filings"
      breadcrumbs={[{ label: "GST" }, { label: "Reports" }]}
      actions={
        <div className="flex items-center gap-3">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="h-9 px-3 py-1 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#3F63AD]"
          >
            {availablePeriods.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {activeTab === "hsn" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportHsnSummaryExcel(hsn, period)}
              disabled={hsn.all.length === 0}
              title="One Excel file with separate hsn(b2b) and hsn(b2c) sheets, in the GST portal's column order"
            >
              <FileSpreadsheet className="w-4 h-4 mr-1.5" /> HSN Excel (B2B + B2C)
            </Button>
          )}
          <ExportMenu
            size="sm"
            title={exportConfig.title}
            subtitle={`${period} · ${exportConfig.data.length} records`}
            data={exportConfig.data}
            filename={exportConfig.filename}
          />
        </div>
      }
    >
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full">
        <TabsList className="grid w-full max-w-3xl grid-cols-3 sm:grid-cols-6 h-auto mb-6 bg-slate-100 p-1 [&>button]:whitespace-normal [&>button]:text-xs sm:[&>button]:text-sm">
          <TabsTrigger value="gstr3b" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">GSTR-3B (Summary)</TabsTrigger>
          <TabsTrigger value="gstr1" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">GSTR-1 (Tally)</TabsTrigger>
          <TabsTrigger value="b2b" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">GSTR-1 B2B</TabsTrigger>
          <TabsTrigger value="b2c" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">GSTR-1 B2C</TabsTrigger>
          <TabsTrigger value="hsn" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">HSN Summary</TabsTrigger>
          <TabsTrigger value="gstr2" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">GSTR-2 (Purchases)</TabsTrigger>
        </TabsList>

        <TabsContent value="gstr3b" className="space-y-6">
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-2xl border p-6 flex flex-col justify-between">
              <div>
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                  <ArrowUpRight className="w-5 h-5" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">Output Tax (GSTR-1)</p>
                <h3 className="text-3xl font-bold mt-1">{money(totalOutputTax)}</h3>
              </div>
              <p className="text-xs text-muted-foreground mt-4 border-t pt-4">Total Tax Collected from Customers</p>
            </div>

            <div className="bg-white rounded-2xl border p-6 flex flex-col justify-between">
              <div>
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
                  <ArrowDownRight className="w-5 h-5" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">Input Tax Credit (GSTR-2)</p>
                <h3 className="text-3xl font-bold mt-1">{money(totalInputTax)}</h3>
              </div>
              <p className="text-xs text-muted-foreground mt-4 border-t pt-4">Total Tax Paid to Suppliers (ITC)</p>
            </div>

            <div className={`bg-gradient-to-br ${netGstPayable > 0 ? 'from-[#3F63AD] to-[#2E4F95] text-white' : 'from-emerald-500 to-emerald-700 text-white'} rounded-2xl border border-transparent p-6 shadow-sm flex flex-col justify-between`}>
              <div>
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mb-4">
                  <Calculator className="w-5 h-5 text-white" />
                </div>
                <p className="text-sm font-medium text-white/80">Net GST Payable</p>
                <h3 className="text-3xl font-bold mt-1">{money(Math.abs(netGstPayable))}</h3>
              </div>
              <p className="text-xs text-white/70 mt-4 border-t border-white/20 pt-4">
                {netGstPayable > 0 ? "Amount to be paid to Government" : "Excess ITC to be carried forward"}
              </p>
            </div>
          </div>

          <div className="bg-white border rounded-2xl overflow-hidden">
            <div className="p-5 border-b flex items-center justify-between">
              <h3 className="font-semibold text-lg">Tax Computation Summary</h3>
              <Button size="sm" className="bg-[#3F63AD] hover:bg-[#2E4F95]">File GSTR-3B</Button>
            </div>
            {/* Six columns do not fit a phone, so the summary scrolls sideways there. */}
            <div className="divide-y text-sm overflow-x-auto [&>div]:min-w-[680px] [&>div]:gap-4">
              <div className="flex justify-between p-4 bg-slate-50 font-medium text-muted-foreground">
                <span>Description</span>
                <span>Taxable Value</span>
                <span>IGST</span>
                <span>CGST</span>
                <span>SGST</span>
                <span>Total Tax</span>
              </div>
              <div className="flex justify-between p-4 hover:bg-slate-50 transition-colors">
                <span className="font-medium">3.1 Outward supplies (GSTR-1)</span>
                <span>{money(totalSalesAmount)}</span>
                <span>{money(gstr1Igst)}</span>
                <span>{money(gstr1Cgst)}</span>
                <span>{money(gstr1Sgst)}</span>
                <span className="font-semibold">{money(totalOutputTax)}</span>
              </div>
              <div className="flex justify-between p-4 hover:bg-slate-50 transition-colors">
                <span className="font-medium">4. Eligible ITC (GSTR-2)</span>
                <span>{money(totalPurchaseAmount)}</span>
                <span>{money(gstr2Igst)}</span>
                <span>{money(gstr2Cgst)}</span>
                <span>{money(gstr2Sgst)}</span>
                <span className="font-semibold text-emerald-600">{money(totalInputTax)}</span>
              </div>
              <div className="flex justify-between p-5 bg-slate-100/50 font-semibold text-base">
                <span>Net Tax Payable</span>
                <span>-</span>
                <span>-</span>
                <span>-</span>
                <span>-</span>
                <span className={netGstPayable > 0 ? "text-red-600" : "text-emerald-600"}>
                  {netGstPayable > 0 ? `Payable: ${money(netGstPayable)}` : `Refund/Carry: ${money(Math.abs(netGstPayable))}`}
                </span>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="gstr1">
          <div className="bg-white border rounded-2xl overflow-hidden">
            <div className="p-4 border-b">
              <h3 className="font-semibold">GSTR-1 — Sales Register (Output Tax)</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Same columns as the reference Sales Register export, plus an HSN Code column per product.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left whitespace-nowrap">
                <thead className="text-[10px] text-muted-foreground bg-slate-50 border-b uppercase">
                  <tr>
                    <th className="px-3 py-2.5">Inv Date</th>
                    <th className="px-3 py-2.5">Inv No.</th>
                    <th className="px-3 py-2.5">Name</th>
                    <th className="px-3 py-2.5">GSTIN</th>
                    <th className="px-3 py-2.5">HSN Code</th>
                    <th className="px-3 py-2.5 text-right">Gross</th>
                    <th className="px-3 py-2.5 text-right">Net Amount</th>
                    <th className="px-3 py-2.5 text-right">Output CGST @9%</th>
                    <th className="px-3 py-2.5 text-right">Output SGST @9%</th>
                    <th className="px-3 py-2.5 text-right">Output IGST @18%</th>
                    <th className="px-3 py-2.5 text-right">Round Off</th>
                    <th className="px-3 py-2.5">EWB No</th>
                    <th className="px-3 py-2.5">EWB Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingGstr1 ? (
                    <tr><td colSpan={13} className="p-0"><TableShimmer rows={6} cols={13} /></td></tr>
                  ) : filteredGstr1.length === 0 ? (
                    <tr><td colSpan={13} className="text-center p-8 text-muted-foreground">No GSTR-1 records found for this period</td></tr>
                  ) : (
                    filteredGstr1.map((row: any, i: number) => (
                      <tr key={row["Inv No."] || i} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2.5">{row["Inv Date"]}</td>
                        <td className="px-3 py-2.5 font-medium text-blue-600">{row["Inv No."]}</td>
                        <td className="px-3 py-2.5">{row.Name}</td>
                        <td className="px-3 py-2.5 font-mono">{row.GSTIN}</td>
                        <td className="px-3 py-2.5 font-mono">{row["HSN Code"] || "—"}</td>
                        <td className="px-3 py-2.5 text-right font-medium">{money(row.Gross)}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["Net Amount"])}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["Output CGST @9%"])}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["Output SGST @9%"])}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["Output IGST @18%"])}</td>
                        <td className="px-3 py-2.5 text-right">{row["Round Off"]}</td>
                        <td className="px-3 py-2.5">{row["EWB No"] || "—"}</td>
                        <td className="px-3 py-2.5">{row["EWB Date"] || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground p-3 border-t bg-slate-50/50">
              Export (top right) includes every column from the reference sheet — A/C Group, Original Bill No/Date,
              IRN No, Accode, Tin No are left blank where this ERP doesn't track them, rather than guessed at.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="b2b">
          <div className="bg-white border rounded-2xl overflow-hidden">
            <div className="p-4 border-b">
              <h3 className="font-semibold">GSTR-1 — Table 4: B2B Invoices</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Every tax invoice billed to a GST-registered business this period, invoice-wise by recipient GSTIN —
                matches the official GSTR-1 B2B table shape. Verify with your CA before filing.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left whitespace-nowrap">
                <thead className="text-[10px] text-muted-foreground bg-slate-50 border-b uppercase">
                  <tr>
                    <th className="px-3 py-2.5">GSTIN/UIN of Recipient</th>
                    <th className="px-3 py-2.5">Receiver Name</th>
                    <th className="px-3 py-2.5">Invoice Number</th>
                    <th className="px-3 py-2.5">Invoice Date</th>
                    <th className="px-3 py-2.5 text-right">Invoice Value</th>
                    <th className="px-3 py-2.5">Place of Supply</th>
                    <th className="px-3 py-2.5 text-right">Rate (%)</th>
                    <th className="px-3 py-2.5 text-right">Taxable Value</th>
                    <th className="px-3 py-2.5 text-right">IGST</th>
                    <th className="px-3 py-2.5 text-right">CGST</th>
                    <th className="px-3 py-2.5 text-right">SGST</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingB2B ? (
                    <tr><td colSpan={11} className="p-0"><TableShimmer rows={6} cols={11} /></td></tr>
                  ) : b2bRows.length === 0 ? (
                    <tr><td colSpan={11} className="text-center p-8 text-muted-foreground">No B2B invoices found for this period</td></tr>
                  ) : (
                    b2bRows.map((row: any, i: number) => (
                      <tr key={row["Invoice Number"] || i} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2.5 font-mono">{row["GSTIN/UIN of Recipient"]}</td>
                        <td className="px-3 py-2.5">{row["Receiver Name"]}</td>
                        <td className="px-3 py-2.5 font-medium text-blue-600">{row["Invoice Number"]}</td>
                        <td className="px-3 py-2.5">{row["Invoice Date"]}</td>
                        <td className="px-3 py-2.5 text-right font-medium">{money(row["Invoice Value"])}</td>
                        <td className="px-3 py-2.5">{row["Place of Supply"]}</td>
                        <td className="px-3 py-2.5 text-right">{row["Rate (%)"]}%</td>
                        <td className="px-3 py-2.5 text-right">{money(row["Taxable Value"])}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["IGST Amount"])}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["CGST Amount"])}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["SGST Amount"])}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="b2c">
          <div className="bg-white border rounded-2xl overflow-hidden">
            <div className="p-4 border-b">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">GSTR-1 — Table 7: B2C (Small) Consolidated Summary</h3>
                {b2cRows.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpenB2cRows(allB2cOpen ? new Set() : new Set(b2cRows.map(b2cRowKey)))}
                    className="text-xs font-bold text-[#3F63AD] hover:underline"
                  >
                    {allB2cOpen ? "Hide all bills" : "Show all bills"}
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Every sale with no business GSTIN, consolidated by Place of Supply + Tax Rate — matches the official
                GSTR-1 B2C Small table shape. Verify with your CA before filing.
              </p>
              {b2clCandidates > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 inline-block">
                  ⚠️ {b2clCandidates} inter-state sale(s) over ₹2,50,000 excluded here — these belong in GSTR-1's
                  separate B2C Large (B2CL) table, not this consolidated summary. Review them manually.
                </p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left whitespace-nowrap">
                <thead className="text-[10px] text-muted-foreground bg-slate-50 border-b uppercase">
                  <tr>
                    <th className="px-3 py-2.5">Place of Supply</th>
                    <th className="px-3 py-2.5 text-right">Rate (%)</th>
                    <th className="px-3 py-2.5 text-right">Taxable Value</th>
                    <th className="px-3 py-2.5 text-right">IGST</th>
                    <th className="px-3 py-2.5 text-right">CGST</th>
                    <th className="px-3 py-2.5 text-right">SGST</th>
                    <th className="px-3 py-2.5 text-right">Invoice Count</th>
                    <th className="px-3 py-2.5 text-right">Bills</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingB2C ? (
                    <tr><td colSpan={8} className="p-0"><TableShimmer rows={6} cols={8} /></td></tr>
                  ) : b2cRows.length === 0 ? (
                    <tr><td colSpan={8} className="text-center p-8 text-muted-foreground">No B2C sales found for this period</td></tr>
                  ) : (
                    b2cRows.map((row: any, i: number) => {
                      const key = b2cRowKey(row);
                      const isOpen = openB2cRows.has(key);
                      const bills = b2cBillsByRow[key] || [];
                      return (
                        <React.Fragment key={`${key}-${i}`}>
                          <tr className={cn("hover:bg-slate-50/50 cursor-pointer", isOpen && "bg-blue-50/40")} onClick={() => toggleB2cRow(key)}>
                            <td className="px-3 py-2.5">{row["Place of Supply"]}</td>
                            <td className="px-3 py-2.5 text-right">{row["Rate (%)"]}%</td>
                            <td className="px-3 py-2.5 text-right font-medium">{money(row["Taxable Value"])}</td>
                            <td className="px-3 py-2.5 text-right">{money(row["IGST Amount"])}</td>
                            <td className="px-3 py-2.5 text-right">{money(row["CGST Amount"])}</td>
                            <td className="px-3 py-2.5 text-right">{money(row["SGST Amount"])}</td>
                            <td className="px-3 py-2.5 text-right">{row["Invoice Count"]}</td>
                            <td className="px-3 py-2.5 text-right">
                              <span className="text-xs font-bold text-[#3F63AD] whitespace-nowrap">{isOpen ? "Hide ▴" : "View bills ▾"}</span>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-slate-50/60">
                              <td colSpan={8} className="px-3 py-2">
                                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                  <table className="w-full min-w-[760px] text-xs">
                                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                                      <tr>
                                        <th className="px-2.5 py-2 text-left">Bill #</th>
                                        <th className="px-2.5 py-2 text-left">Date</th>
                                        <th className="px-2.5 py-2 text-left">Customer</th>
                                        <th className="px-2.5 py-2 text-left">Products (GST %)</th>
                                        <th className="px-2.5 py-2 text-right">Taxable</th>
                                        <th className="px-2.5 py-2 text-right">CGST + SGST / IGST</th>
                                        <th className="px-2.5 py-2 text-right">Bill Total</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                      {bills.map((b: any) => (
                                        <tr key={b.invoiceNumber}>
                                          <td className="px-2.5 py-1.5 font-mono font-bold text-[#3F63AD] whitespace-nowrap">{b.invoiceNumber}</td>
                                          <td className="px-2.5 py-1.5 whitespace-nowrap">{b.date}</td>
                                          <td className="px-2.5 py-1.5">
                                            {b.customerName}
                                            {b.customerPhone && <span className="block text-[10px] text-slate-400">{b.customerPhone}</span>}
                                          </td>
                                          <td className="px-2.5 py-1.5">
                                            {b.items.map((l: any, k: number) => (
                                              <span key={k} className="block">
                                                {l.name}
                                                {l.quantity > 1 ? ` ×${l.quantity}` : ""}{" "}
                                                <span className={cn("font-mono text-[10px]", l.gstRate === 28 ? "text-rose-600 font-bold" : "text-slate-400")}>
                                                  ({l.gstRate}%{l.hsn ? ` · HSN ${l.hsn}` : ""})
                                                </span>
                                              </span>
                                            ))}
                                          </td>
                                          <td className="px-2.5 py-1.5 text-right font-mono">{money(b.taxable)}</td>
                                          <td className="px-2.5 py-1.5 text-right font-mono">{money(b.igst > 0 ? b.igst : b.cgst + b.sgst)}</td>
                                          <td className="px-2.5 py-1.5 text-right font-mono font-bold">{money(b.total)}</td>
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
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="hsn">
          <HsnSummaryView summary={hsn} />
        </TabsContent>

        <TabsContent value="gstr2">
          <div className="bg-white border rounded-2xl overflow-hidden">
            <div className="p-4 border-b">
              <h3 className="font-semibold">GSTR-2 — Purchase Register (Input Tax Credit)</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Same column style as the Sales Register, mirrored for inward supplies, plus HSN Code per product.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left whitespace-nowrap">
                <thead className="text-[10px] text-muted-foreground bg-slate-50 border-b uppercase">
                  <tr>
                    <th className="px-3 py-2.5">Bill Date</th>
                    <th className="px-3 py-2.5">Bill No.</th>
                    <th className="px-3 py-2.5">Loc.</th>
                    <th className="px-3 py-2.5">Name</th>
                    <th className="px-3 py-2.5">GSTIN</th>
                    <th className="px-3 py-2.5">HSN Code</th>
                    <th className="px-3 py-2.5 text-right">Gross</th>
                    <th className="px-3 py-2.5 text-right">Net Amount</th>
                    <th className="px-3 py-2.5 text-right">Input CGST @9%</th>
                    <th className="px-3 py-2.5 text-right">Input SGST @9%</th>
                    <th className="px-3 py-2.5 text-right">Input IGST @18%</th>
                    <th className="px-3 py-2.5 text-right text-emerald-600">Round Off</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingGstr2 ? (
                    <tr><td colSpan={12} className="p-0"><TableShimmer rows={6} cols={12} /></td></tr>
                  ) : filteredGstr2.length === 0 ? (
                    <tr><td colSpan={12} className="text-center p-8 text-muted-foreground">No GSTR-2 records found for this period</td></tr>
                  ) : (
                    filteredGstr2.map((row: any, i: number) => (
                      <tr key={row["Bill No."] || i} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2.5">{row["Bill Date"]}</td>
                        <td className="px-3 py-2.5 font-medium">{row["Bill No."]}</td>
                        <td className="px-3 py-2.5">{row["Loc."] || "—"}</td>
                        <td className="px-3 py-2.5">{row.Name}</td>
                        <td className="px-3 py-2.5 font-mono">{row.GSTIN}</td>
                        <td className="px-3 py-2.5 font-mono">{row["HSN Code"] || "—"}</td>
                        <td className="px-3 py-2.5 text-right font-medium">{money(row.Gross)}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["Net Amount"])}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["Input CGST @9%"])}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["Input SGST @9%"])}</td>
                        <td className="px-3 py-2.5 text-right">{money(row["Input IGST @18%"])}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-emerald-600">{row["Round Off"]}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground p-3 border-t bg-slate-50/50">
              Export (top right) includes every column from the reference sheet — A/C Group, EWB No/Date, IRN No,
              Accode, Tin No, Original Bill No/Date are left blank where this ERP doesn't track them for purchases.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
