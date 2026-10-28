"use client";

import React, { useMemo, useState } from "react";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet } from "lucide-react";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { HsnSummaryView, useHsnSummary, hsnExportRows, exportHsnSummaryExcel } from "@/components/gst/hsn-summary";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** GSTR-1 HSN Summary (Table 12) on its own page — the same report as the
 *  "HSN Summary" tab in GST Reports, reachable straight from the sidebar. */
export default function HsnSummaryPage() {
  // The current month and the 23 before it, newest first.
  const periods = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 24 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return { label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`, month: d.getMonth(), year: d.getFullYear() };
    });
  }, []);
  const [periodIndex, setPeriodIndex] = useState(0);
  const period = periods[periodIndex];

  const hsn = useHsnSummary(period.month, period.year);
  const exportRows = hsnExportRows(hsn);

  return (
    <PageShell
      title="HSN Summary Report"
      subtitle="GSTR-1 Table 12 — HSN-wise sales and GST collected, B2B and B2C"
      breadcrumbs={[{ label: "GST" }, { label: "HSN Summary" }]}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={periodIndex}
            onChange={(e) => setPeriodIndex(Number(e.target.value))}
            className="h-9 px-3 py-1 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#3F63AD]"
          >
            {periods.map((p, i) => (
              <option key={p.label} value={i}>{p.label}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportHsnSummaryExcel(hsn, period.label)}
            disabled={hsn.all.length === 0}
            title="One Excel file with separate hsn(b2b) and hsn(b2c) sheets, in the GST portal's column order"
          >
            <FileSpreadsheet className="w-4 h-4 mr-1.5" /> HSN Excel (B2B + B2C)
          </Button>
          <ExportMenu
            size="sm"
            title="GSTR-1 HSN Summary (B2B + B2C)"
            subtitle={`${period.label} · ${exportRows.length} records`}
            data={exportRows}
            filename="gstr1_hsn_summary"
          />
        </div>
      }
    >
      <HsnSummaryView summary={hsn} />
    </PageShell>
  );
}
