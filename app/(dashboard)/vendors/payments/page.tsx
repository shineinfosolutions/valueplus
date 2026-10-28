"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { DateRangeFilter, resolveDateRange } from "@/components/shared/date-range-filter";
import { Plus, Search, Trash2, WalletCards, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { RoleGuard, usePermissions } from "@/components/shared/role-guard";
import { PaymentModal } from "@/components/PaymentModal";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function SupplierPaymentsPage() {
  return (
    <RoleGuard permission="ledger.supplier.view">
      <SupplierPaymentsInner />
    </RoleGuard>
  );
}

function SupplierPaymentsInner() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("All Time");
  const [range, setRange] = useState<{ start?: string; end?: string }>({});
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ["supplier-payments", range.start, range.end],
    queryFn: async () => {
      const res = await fetch("/api/payments?partyType=Supplier");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      let list = json.data as any[];
      if (range.start) list = list.filter((p) => p.date >= range.start!);
      if (range.end) list = list.filter((p) => p.date <= range.end!);
      return list;
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/payments?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json;
    },
    onSuccess: () => {
      toast.success("Payment removed");
      queryClient.invalidateQueries({ queryKey: ["supplier-payments"] });
      queryClient.invalidateQueries({ queryKey: ["all-ledgers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-ledger-all"] });
      setDeleteTarget(null);
    },
    onError: (e: any) => {
      toast.error(e.message);
      setDeleteTarget(null);
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return (payments as any[]).filter(
      (p) =>
        p.partyName?.toLowerCase().includes(q) ||
        p.transactionId?.toLowerCase().includes(q) ||
        p.referenceId?.toLowerCase().includes(q)
    );
  }, [payments, search]);

  const stats = useMemo(() => {
    let paidOut = 0;
    let refunded = 0;
    for (const p of filtered as any[]) {
      if (p.type === "paid") paidOut += Number(p.amount) || 0;
      else refunded += Number(p.amount) || 0;
    }
    return { paidOut, refunded, net: paidOut - refunded, count: filtered.length };
  }, [filtered]);

  const handleDateChange = (value: string, start?: string, end?: string) => {
    setDateFilter(value);
    if (value === "All Time") {
      setRange({});
      return;
    }
    const resolved = start && end ? { start, end } : resolveDateRange(value);
    setRange({ start: resolved.start, end: resolved.end });
  };

  return (
    <PageShell
      title="Supplier Payments"
      subtitle={`${stats.count} payment entries`}
      breadcrumbs={[{ label: "Suppliers & Ledger" }, { label: "Payments" }]}
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
          {can("ledger.export") && (
            <ExportMenu
              className="h-9"
              title="Supplier Payments"
              subtitle={`${stats.count} payment entries`}
              data={(filtered as any[]).map((p) => ({
                Date: formatDate(p.date),
                Supplier: p.partyName,
                Amount: p.amount,
                Mode: p.paymentMode,
                Direction: p.type,
                Ref: p.referenceId || "",
                Notes: p.notes || "",
              }))}
              filename="supplier-payments"
            />
          )}
          {can("payment.record") && (
            <Button size="sm" onClick={() => setIsFormOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> Record Payment
            </Button>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric label="Paid Out" value={formatCurrency(stats.paidOut)} tone="red" />
        <Metric label="Refunded In" value={formatCurrency(stats.refunded)} tone="emerald" />
        <Metric label="Net Paid" value={formatCurrency(stats.net)} />
        <Metric label="Entries" value={String(stats.count)} />
      </div>

      <div className="data-table-container">
        <div className="flex items-center gap-3 p-4 border-b">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search by supplier or reference…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                {["Date", "Supplier", "Mode / Ref", "Notes", "Amount", ""].map((h, i) => (
                  <th
                    key={i}
                    className={cn(
                      "px-4 py-3 text-xs font-semibold text-muted-foreground uppercase",
                      h === "Amount" ? "text-right" : "text-left"
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <TableShimmer rows={6} cols={6} />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center p-10 text-muted-foreground">
                    <WalletCards className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    No supplier payments recorded yet.
                  </td>
                </tr>
              ) : (
                (filtered as any[]).map((p) => (
                  <tr key={p._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDate(p.date)}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-foreground">{p.partyName}</p>
                      <p className="text-[10px] font-mono text-slate-400">{p.transactionId}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="text-[10px] font-semibold">
                        {p.paymentMode}
                      </Badge>
                      {p.referenceId && <p className="text-[10px] text-slate-400 mt-0.5">{p.referenceId}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{p.notes || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 font-bold tabular-nums",
                          p.type === "paid" ? "text-red-600" : "text-emerald-600"
                        )}
                      >
                        {p.type === "paid" ? (
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        ) : (
                          <ArrowDownLeft className="w-3.5 h-3.5" />
                        )}
                        {formatCurrency(p.amount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {can("payment.record") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:bg-red-50"
                          onClick={() => setDeleteTarget(p)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaymentModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["supplier-payments"] })}
        defaultPartyType="Supplier"
      />

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this payment?</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  {formatCurrency(deleteTarget.amount)} for {deleteTarget.partyName} on{" "}
                  {formatDate(deleteTarget.date)} will be removed, and their pending balance will be reversed.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => removeMutation.mutate(deleteTarget._id)}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function Metric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "emerald" | "red";
}) {
  const toneClass = { slate: "", emerald: "text-emerald-600", red: "text-red-600" }[tone];
  return (
    <div className="metric-card">
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
