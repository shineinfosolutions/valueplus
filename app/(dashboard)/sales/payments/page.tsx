"use client";

import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, WalletCards, ArrowDownLeft, Building2, User, Trash2 } from "lucide-react";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PaymentModal } from "@/components/PaymentModal";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangeFilter, resolveDateRange, isDateInRange } from "@/components/shared/date-range-filter";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { todayInIndia } from "@/lib/today";

export default function ReceivePaymentPage() {
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("This Month");
  const [dateRange, setDateRange] = useState(() => resolveDateRange("This Month"));
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("customers");
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/payments?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json;
    },
    onSuccess: () => {
      toast.success("Payment deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("erp-payment-created"));
        window.dispatchEvent(new CustomEvent("erp-invoice-created"));
        window.dispatchEvent(new CustomEvent("erp-customer-updated"));
      }
      setDeletePaymentId(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete payment");
      setDeletePaymentId(null);
    }
  });

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ["payments"],
    queryFn: async () => {
      const res = await fetch("/api/payments");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const currentTabPayments = useMemo(() => {
    if (activeTab === "customers") {
      return payments.filter((p: any) => p.partyType !== "Supplier");
    } else {
      return payments.filter((p: any) => p.partyType === "Supplier");
    }
  }, [payments, activeTab]);

  const filtered = useMemo(() => {
    return currentTabPayments.filter((p: any) => {
      const matchesSearch = !search ||
        (p.transactionId || "").toLowerCase().includes(search.toLowerCase()) ||
        (p.partyName || "").toLowerCase().includes(search.toLowerCase()) ||
        (p.referenceId || "").toLowerCase().includes(search.toLowerCase());
      const matchesDate = isDateInRange(p.date || p.createdAt, dateRange.start, dateRange.end);
      return matchesSearch && matchesDate;
    });
  }, [currentTabPayments, search, dateRange]);

  const totalReceived = currentTabPayments.reduce((sum: number, p: any) => sum + (p.type === "received" ? (p.amount || 0) : -(p.amount || 0)), 0);
  const todayReceived = currentTabPayments
    .filter((p: any) => p.date === todayInIndia())
    .reduce((sum: number, p: any) => sum + (p.type === "received" ? (p.amount || 0) : -(p.amount || 0)), 0);

  return (
    <PageShell
      title="Receive Payments"
      subtitle="Track and record incoming payments from customers"
      breadcrumbs={[{ label: "Sales" }, { label: "Receive Payments" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title={activeTab === "customers" ? "Customer Receipts" : "Supplier Payouts"}
            subtitle={`${filtered.length} transactions`}
            data={(filtered as any[]).map((p) => ({
              "Transaction ID": p.transactionId,
              Date: formatDate(p.date),
              [activeTab === "customers" ? "Customer" : "Supplier"]: p.partyName,
              Mode: p.paymentMode,
              Reference: p.referenceId || "",
              Type: p.type === "received" ? "Received (In)" : "Paid (Out)",
              Amount: formatCurrency(p.amount),
            }))}
            filename="payments"
          />
          <Button size="sm" onClick={() => setIsFormOpen(true)} className="bg-[#76C043] hover:bg-[#65A639] text-white">
            <Plus className="w-4 h-4 mr-1.5" /> Record Payment
          </Button>
        </div>
      }
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-6 grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="customers">Customer Receipts</TabsTrigger>
          <TabsTrigger value="suppliers">Supplier Payouts</TabsTrigger>
        </TabsList>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[{ label: "Total Transactions", value: currentTabPayments.length }, { label: activeTab === "customers" ? "Today's Receipts" : "Today's Payouts", value: formatCurrency(todayReceived) }, { label: activeTab === "customers" ? "Total Collected" : "Total Paid", value: formatCurrency(totalReceived) }].map((s) => (
          <div key={s.label} className="metric-card bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center">
            <p className="text-2xl font-bold text-slate-800">{s.value}</p>
            <p className="text-xs text-slate-500 font-medium uppercase mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="data-table-container mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b bg-white rounded-t-xl">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search payments, reference..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
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

        <div className="overflow-x-auto bg-white rounded-b-xl border border-t-0 border-slate-200 shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Transaction ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{activeTab === "customers" ? "Customer" : "Supplier"}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Mode & Ref</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-0"><TableShimmer rows={6} cols={6} /></td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-500 font-medium">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <WalletCards className="w-10 h-10 text-slate-300" />
                      <p>No payments recorded yet</p>
                      <Button variant="outline" size="sm" onClick={() => setIsFormOpen(true)}>Record your first payment</Button>
                    </div>
                  </td>
                </tr>
              ) : filtered.map((p: any) => (
                <tr key={p._id || p.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded bg-emerald-100 flex items-center justify-center shrink-0">
                        <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
                      </div>
                      <span className="font-mono font-bold text-slate-700 text-xs">{p.transactionId}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs font-medium">{formatDate(p.date)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-slate-400" />
                      <span className="font-semibold text-slate-800">{p.partyName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <Badge variant="outline" className="w-fit text-[10px] uppercase font-bold tracking-wider bg-slate-50 text-slate-600 border-slate-200">
                        {p.paymentMode}
                      </Badge>
                      {p.referenceId && <span className="text-[10px] text-slate-500 font-mono mt-1">Ref: {p.referenceId}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={p.type === "received" ? "success" : "secondary"}>
                      {p.type === "received" ? "Received (In)" : "Paid (Out)"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-black text-base ${p.type === "received" ? "text-emerald-600" : "text-red-600"}`}>
                      {p.type === "received" ? "+" : "-"}{formatCurrency(p.amount)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => setDeletePaymentId(p._id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      </Tabs>

      <PaymentModal 
        isOpen={isFormOpen} 
        onClose={() => setIsFormOpen(false)} 
        onSuccess={() => setIsFormOpen(false)} 
        defaultPartyType={activeTab === "customers" ? "Customer" : "Supplier"}
      />

      <Dialog open={!!deletePaymentId} onOpenChange={(open) => !open && setDeletePaymentId(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Payment</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this payment? This will also revert the customer's outstanding balance. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePaymentId(null)} disabled={deleteMutation.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={() => deletePaymentId && deleteMutation.mutate(deletePaymentId)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
