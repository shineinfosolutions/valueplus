"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DateRangeFilter, resolveDateRange } from "@/components/shared/date-range-filter";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { Search, Trophy } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface StaffRow {
  staffName: string;
  totalSales: number;
  totalInvoices: number;
  totalCollected: number;
  unitsSold: number;
  netSales: number;
  averageOrderValue: number;
  warrantySales: number;
}

export default function StaffLeaderboardPage() {
  const [dateFilter, setDateFilter] = useState("This Month");
  const [dateRange, setDateRange] = useState(() => resolveDateRange("This Month"));
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["staff-leaderboard", dateRange.start, dateRange.end],
    queryFn: async () => {
      const res = await fetch(`/api/reports/performance?startDate=${dateRange.start}&endDate=${dateRange.end}`);
      const json = await res.json();
      return json.success ? (json.data as StaffRow[]) : [];
    },
  });

  const totals = useMemo(
    () => ({
      sales: rows.reduce((t, r) => t + (r.totalSales || 0), 0),
      bills: rows.reduce((t, r) => t + (r.totalInvoices || 0), 0),
      collected: rows.reduce((t, r) => t + (r.totalCollected || 0), 0),
    }),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.map((r, i) => ({ ...r, rank: i + 1 })).filter((r) => !q || r.staffName.toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <PageShell
      title="Staff Leaderboard"
      subtitle="Every sales executive ranked by billed sales revenue"
      breadcrumbs={[{ label: "Staff" }, { label: "Leaderboard" }]}
      actions={
        <ExportMenu
          title="Staff Leaderboard"
          subtitle={`${dateRange.start} to ${dateRange.end}`}
          data={filtered.map((r) => ({
            Rank: r.rank,
            Staff: r.staffName,
            Bills: r.totalInvoices,
            "Units Sold": r.unitsSold,
            "Sales (₹)": r.totalSales,
            "Collected (₹)": r.totalCollected,
            "Average Bill (₹)": r.averageOrderValue,
          }))}
          filename="staff-leaderboard"
        />
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Staff with sales", value: rows.length },
          { label: "Bills", value: totals.bills },
          { label: "Sales", value: formatCurrency(totals.sales) },
          { label: "Collected", value: formatCurrency(totals.collected) },
        ].map((s) => (
          <div key={s.label} className="metric-card">
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="data-table-container">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search staff..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <DateRangeFilter
            value={dateFilter}
            onChange={(val, s, e) => {
              setDateFilter(val);
              if (s && e) setDateRange({ start: s, end: e });
            }}
            className="w-40"
            showIcon={true}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase w-14">Rank</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Staff</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Bills</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Units</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Sales</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Collected</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Avg bill</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase w-40">Share of sales</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No staff sales recorded for this period</td></tr>
              ) : (
                filtered.map((r) => {
                  const share = totals.sales > 0 ? (r.totalSales / totals.sales) * 100 : 0;
                  return (
                    <tr key={r.staffName} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-black", r.rank === 1 ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700")}>
                          {r.rank === 1 ? <Trophy className="w-3.5 h-3.5" /> : `#${r.rank}`}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold">{r.staffName}</td>
                      <td className="px-4 py-3 text-right"><Badge variant="outline" className="font-mono">{r.totalInvoices}</Badge></td>
                      <td className="px-4 py-3 text-right font-mono">{r.unitsSold}</td>
                      <td className="px-4 py-3 text-right font-bold text-[#3F63AD] font-mono">{formatCurrency(r.totalSales)}</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-700">{formatCurrency(r.totalCollected)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(r.averageOrderValue)}</td>
                      <td className="px-4 py-3">
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full bg-[#3F63AD]" style={{ width: `${Math.min(100, share)}%` }} />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{share.toFixed(1)}%</p>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
}
