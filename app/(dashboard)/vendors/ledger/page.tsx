"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { DateRangeFilter, resolveDateRange } from "@/components/shared/date-range-filter";
import {
  Search,
  RefreshCw,
  FileText,
  ArrowUpDown,
  AlertTriangle,
} from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { RoleGuard, usePermissions } from "@/components/shared/role-guard";
import { PartyLedgerPanel } from "@/components/PartyLedgerPanel";
import { PaymentModal } from "@/components/PaymentModal";

type SortKey = "name" | "billed" | "paid" | "pending" | "overdue";

export default function AllLedgersPage() {
  return (
    <RoleGuard permission="ledger.supplier.view">
      <AllLedgersInner />
    </RoleGuard>
  );
}

function AllLedgersInner() {
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("pending");
  const [sortDesc, setSortDesc] = useState(true);
  const [dateFilter, setDateFilter] = useState("All Time");
  const [range, setRange] = useState<{ start?: string; end?: string }>({});
  const [drawerParty, setDrawerParty] = useState<any | null>(null);
  const [paymentSupplierId, setPaymentSupplierId] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["all-ledgers", "supplier", range.start, range.end],
    queryFn: async () => {
      const qs = new URLSearchParams({ party: "supplier" });
      if (range.start) qs.set("from", range.start);
      if (range.end) qs.set("to", range.end);
      const res = await fetch(`/api/vendors/ledger?${qs.toString()}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not load ledgers");
      return json.data;
    },
  });

  const rows = useMemo(() => {
    const list = (data?.parties || []) as any[];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (p) =>
            p.name?.toLowerCase().includes(q) ||
            p.code?.toLowerCase().includes(q) ||
            p.phone?.includes(q)
        )
      : list;

    const value = (p: any) => {
      switch (sortKey) {
        case "name":
          return p.name?.toLowerCase() || "";
        case "billed":
          return p.summary.totalBilled;
        case "paid":
          return p.summary.totalPaid;
        case "overdue":
          return p.summary.overdueAmount;
        default:
          return p.summary.closingBalance;
      }
    };

    return [...filtered].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (typeof av === "string" || typeof bv === "string") {
        return sortDesc
          ? String(bv).localeCompare(String(av))
          : String(av).localeCompare(String(bv));
      }
      return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
  }, [data, search, sortKey, sortDesc]);

  const totals = data?.totals;

  const handleDateChange = (value: string, start?: string, end?: string) => {
    setDateFilter(value);
    if (value === "All Time") {
      setRange({});
      return;
    }
    const resolved = start && end ? { start, end } : resolveDateRange(value);
    setRange({ start: resolved.start, end: resolved.end });
  };

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  return (
    <PageShell
      title="All Ledgers"
      subtitle="Every supplier's position — purchases, payments made and what is still owed"
      breadcrumbs={[{ label: "Suppliers & Ledger" }, { label: "All Ledgers" }]}
      actions={
        <div className="flex items-center gap-2">
          <DateRangeFilter value={dateFilter} onChange={handleDateChange} className="w-[150px]" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDateChange("All Time")}
            className={cn("h-9 text-xs", dateFilter === "All Time" && "border-[#3F63AD] text-[#3F63AD]")}
          >
            All Time
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9">
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", isFetching && "animate-spin")} /> Refresh
          </Button>
          {can("ledger.export") && (
            <ExportMenu
              className="h-9"
              title="Supplier Ledger Summary"
              subtitle={`${rows.length} suppliers`}
              data={rows.map((p: any) => ({
                Code: p.code,
                Name: p.name,
                Phone: p.phone || "",
                "Total Billed": p.summary.totalBilled,
                "Total Paid": p.summary.totalPaid,
                Pending: p.summary.closingBalance,
                Overdue: p.summary.overdueAmount,
                "Last Payment": p.summary.lastPaymentDate || "",
                "Last Amount": p.summary.lastPaymentAmount || 0,
                "90+ Days": p.summary.ageing.d90plus,
              }))}
              filename="supplier-ledger-summary"
            />
          )}
        </div>
      }
    >
      {error ? (
        <div className="py-12 text-center bg-white rounded-xl border border-slate-200">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-800">{(error as Error).message}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Metric label="Total Purchased" value={formatCurrency(totals?.totalBilled || 0)} sub={`${totals?.parties || 0} parties`} />
            <Metric label="Total Paid Out" value={formatCurrency(totals?.totalPaid || 0)} tone="emerald" />
            <Metric label="We Still Owe" value={formatCurrency(totals?.outstanding || 0)} tone="amber" />
            <Metric
              label="Overdue"
              value={formatCurrency(totals?.overdue || 0)}
              sub={`90+ days: ${formatCurrency(totals?.ageing?.d90plus || 0)}`}
              tone="red"
            />
          </div>

          <div className="data-table-container">
            <div className="flex items-center gap-3 p-4 border-b">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search suppliers…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Click any row to open the full running-balance ledger
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr className="text-xs font-semibold text-muted-foreground uppercase">
                    <SortableTh label="Party" sortKey="name" active={sortKey} onSort={handleSort} />
                    <th className="px-4 py-3 text-left">Contact</th>
                    <SortableTh label="Purchased" sortKey="billed" active={sortKey} onSort={handleSort} align="right" />
                    <SortableTh label="Paid" sortKey="paid" active={sortKey} onSort={handleSort} align="right" />
                    <SortableTh label="Pending" sortKey="pending" active={sortKey} onSort={handleSort} align="right" />
                    <th className="px-4 py-3 text-left">Last Payment</th>
                    <SortableTh label="Overdue" sortKey="overdue" active={sortKey} onSort={handleSort} align="right" />
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} className="p-0">
                        <TableShimmer rows={8} cols={8} />
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center p-10 text-muted-foreground">
                        No suppliers to show.
                      </td>
                    </tr>
                  ) : (
                    rows.map((p: any) => (
                      <tr
                        key={p._id}
                        className="hover:bg-slate-50 transition-colors cursor-pointer"
                        onClick={() => setDrawerParty(p)}
                      >
                        <td className="px-4 py-3">
                          <p className="font-semibold text-foreground">{p.name}</p>
                          <p className="text-xs font-mono text-[#3F63AD]">{p.code}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          <p>{p.phone || "—"}</p>
                          <p>{[p.city, p.state].filter(Boolean).join(", ")}</p>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">
                          {formatCurrency(p.summary.totalBilled)}
                          <p className="text-[10px] text-slate-400">{p.summary.billCount} bills</p>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium text-emerald-600">
                          {formatCurrency(p.summary.totalPaid)}
                          <p className="text-[10px] text-slate-400">
                            {p.summary.paymentCount} payments
                          </p>
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-right tabular-nums font-bold",
                            p.summary.closingBalance > 0 ? "text-amber-600" : "text-emerald-600"
                          )}
                        >
                          {formatCurrency(p.summary.closingBalance)}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {p.summary.lastPaymentDate ? (
                            <>
                              <p className="font-medium text-slate-700">
                                {formatDate(p.summary.lastPaymentDate)}
                              </p>
                              <p className="text-slate-400">
                                {formatCurrency(p.summary.lastPaymentAmount)}
                                {p.summary.lastPaymentMode ? ` • ${p.summary.lastPaymentMode}` : ""}
                              </p>
                            </>
                          ) : (
                            <span className="text-slate-400">Never</span>
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-right tabular-nums font-semibold",
                            p.summary.overdueAmount > 0 ? "text-red-600" : "text-slate-400"
                          )}
                        >
                          {formatCurrency(p.summary.overdueAmount)}
                          {p.summary.ageing.d90plus > 0 && (
                            <p className="text-[10px] text-red-400">
                              90+: {formatCurrency(p.summary.ageing.d90plus)}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-blue-600 bg-blue-50/50 border-blue-200"
                            onClick={() => setDrawerParty(p)}
                          >
                            <FileText className="w-3.5 h-3.5" /> Ledger
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <Dialog open={Boolean(drawerParty)} onOpenChange={(o) => !o && setDrawerParty(null)}>
        <DialogContent className="max-w-5xl p-0 overflow-y-auto rounded-2xl border-none shadow-2xl">
          {drawerParty && (
            <PartyLedgerPanel
              party="supplier"
              partyId={drawerParty._id}
              onRecordPayment={() => {
                setPaymentSupplierId(drawerParty._id);
                setDrawerParty(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <PaymentModal
        isOpen={Boolean(paymentSupplierId)}
        onClose={() => setPaymentSupplierId(null)}
        onSuccess={() => refetch()}
        defaultPartyType="Supplier"
        initialPartyId={paymentSupplierId || undefined}
      />
    </PageShell>
  );
}

function SortableTh({
  label,
  sortKey,
  active,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  return (
    <th className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-[#3F63AD] transition-colors uppercase",
          active === sortKey && "text-[#3F63AD]"
        )}
      >
        {label}
        <ArrowUpDown className="w-3 h-3" />
      </button>
    </th>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "slate" | "emerald" | "amber" | "red";
}) {
  const toneClass = {
    slate: "",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-red-600",
  }[tone];
  return (
    <div className="metric-card">
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}
