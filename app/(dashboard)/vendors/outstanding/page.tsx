"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { Search, FileText, RefreshCw } from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { RoleGuard, usePermissions } from "@/components/shared/role-guard";
import { PartyLedgerPanel } from "@/components/PartyLedgerPanel";

/**
 * Ageing report: what is outstanding, and how old it is.
 *
 * A bucket only holds what is genuinely unsettled — the ledger engine applies
 * every payment received against the oldest bills first, so a party who pays
 * regularly shows nothing in 90+ even when old bills are still on file.
 */

const BUCKETS = [
  { key: "current", label: "0-30 Days", tone: "emerald" },
  { key: "d31to60", label: "31-60 Days", tone: "amber" },
  { key: "d61to90", label: "61-90 Days", tone: "orange" },
  { key: "d90plus", label: "90+ Days", tone: "red" },
] as const;

export default function OutstandingPage() {
  return (
    <RoleGuard permission="ledger.supplier.view">
      <OutstandingInner />
    </RoleGuard>
  );
}

function OutstandingInner() {
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [bucketFilter, setBucketFilter] = useState<string>("all");
  const [drawerParty, setDrawerParty] = useState<any | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["outstanding", "supplier"],
    queryFn: async () => {
      const res = await fetch("/api/vendors/ledger?party=supplier");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
  });

  const rows = useMemo(() => {
    const list = ((data?.parties || []) as any[]).filter((p) => p.summary.closingBalance > 0);
    const q = search.trim().toLowerCase();
    const searched = q
      ? list.filter((p) => p.name?.toLowerCase().includes(q) || p.code?.toLowerCase().includes(q))
      : list;

    const bucketed =
      bucketFilter === "all"
        ? searched
        : searched.filter((p) => (p.summary.ageing as any)[bucketFilter] > 0);

    return bucketed.sort((a, b) => b.summary.ageing.d90plus - a.summary.ageing.d90plus ||
      b.summary.closingBalance - a.summary.closingBalance);
  }, [data, search, bucketFilter]);

  const totals = data?.totals;

  return (
    <PageShell
      title="Outstanding & Ageing"
      subtitle="How much we still owe suppliers, and how long it has been sitting"
      breadcrumbs={[{ label: "Suppliers & Ledger" }, { label: "Outstanding" }]}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9">
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", isFetching && "animate-spin")} /> Refresh
          </Button>
          {can("ledger.export") && (
            <ExportMenu
              className="h-9"
              title="Supplier Outstanding & Ageing"
              subtitle={`${rows.length} suppliers`}
              data={rows.map((p: any) => ({
                Code: p.code,
                Name: p.name,
                Phone: p.phone || "",
                Pending: p.summary.closingBalance,
                "0-30": p.summary.ageing.current,
                "31-60": p.summary.ageing.d31to60,
                "61-90": p.summary.ageing.d61to90,
                "90+": p.summary.ageing.d90plus,
                "Last Payment": p.summary.lastPaymentDate || "Never",
              }))}
              filename="supplier-ageing"
            />
          )}
        </div>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {BUCKETS.map((b) => {
          const value = (totals?.ageing as any)?.[b.key] || 0;
          const active = bucketFilter === b.key;
          return (
            <button
              key={b.key}
              onClick={() => setBucketFilter(active ? "all" : b.key)}
              className={cn(
                "metric-card text-left transition-all hover:shadow-md",
                active && "ring-2 ring-[#3F63AD] ring-offset-1"
              )}
            >
              <p
                className={cn(
                  "text-2xl font-bold",
                  b.tone === "emerald" && "text-emerald-600",
                  b.tone === "amber" && "text-amber-600",
                  b.tone === "orange" && "text-orange-600",
                  b.tone === "red" && "text-red-600"
                )}
              >
                {formatCurrency(value)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{b.label}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {active ? "Filtering — click to clear" : "Click to filter"}
              </p>
            </button>
          );
        })}
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
            Total outstanding: <strong>{formatCurrency(totals?.outstanding || 0)}</strong>
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr className="text-xs font-semibold text-muted-foreground uppercase">
                <th className="px-4 py-3 text-left">Party</th>
                <th className="px-4 py-3 text-right">Pending</th>
                {BUCKETS.map((b) => (
                  <th key={b.key} className="px-4 py-3 text-right">
                    {b.label}
                  </th>
                ))}
                <th className="px-4 py-3 text-left">Last Payment</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <TableShimmer rows={6} cols={8} />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center p-10 text-muted-foreground">
                    Nothing outstanding here.
                  </td>
                </tr>
              ) : (
                rows.map((p: any) => (
                  <tr
                    key={p._id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => setDrawerParty(p)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-foreground">{p.name}</p>
                      <p className="text-xs font-mono text-[#3F63AD]">{p.code}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-amber-600">
                      {formatCurrency(p.summary.closingBalance)}
                    </td>
                    {BUCKETS.map((b) => {
                      const value = (p.summary.ageing as any)[b.key] || 0;
                      return (
                        <td
                          key={b.key}
                          className={cn(
                            "px-4 py-3 text-right tabular-nums",
                            value > 0
                              ? b.tone === "red"
                                ? "text-red-600 font-semibold"
                                : "text-slate-700"
                              : "text-slate-300"
                          )}
                        >
                          {value > 0 ? formatCurrency(value) : "—"}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-xs">
                      {p.summary.lastPaymentDate ? (
                        <>
                          <p className="text-slate-700 font-medium">{formatDate(p.summary.lastPaymentDate)}</p>
                          <p className="text-slate-400">{formatCurrency(p.summary.lastPaymentAmount)}</p>
                        </>
                      ) : (
                        <span className="text-red-500 font-medium">Never paid</span>
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

      <Dialog open={Boolean(drawerParty)} onOpenChange={(o) => !o && setDrawerParty(null)}>
        <DialogContent className="max-w-5xl p-0 overflow-y-auto rounded-2xl border-none shadow-2xl">
          {drawerParty && <PartyLedgerPanel party="supplier" partyId={drawerParty._id} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
