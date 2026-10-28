"use client";

import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AutocompleteSearch } from "@/components/shared/autocomplete-search";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Search, ClipboardList, Trash2, AlertTriangle, MoreHorizontal, XCircle, Printer, Download, Eye, UploadCloud, Ban, History, Wallet } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AuthorizePinDialog, PinAuthResult } from "@/components/AuthorizePinDialog";
import { useState, useMemo, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PurchaseCreationModal } from "@/components/PurchaseCreationModal";
import { PurchaseBillPrintModal } from "@/components/PurchaseBillPrintModal";
import { PurchaseImportModal } from "@/components/purchase/PurchaseImportModal";
import { RecordBillPaymentDialog } from "@/components/purchase/RecordBillPaymentDialog";

/** Paid / due / status of a bill as stored, with a balance under one paisa
 *  counted as settled (bills saved before amounts were rounded). */
function billMoney(e: any) {
  const total = Number(e.total) || (Number(e.amount || e.subtotal) || 0) + (Number(e.totalTax || e.gst) || 0);
  const paid = Number(e.paid) || 0;
  let balance = e.balance !== undefined ? Number(e.balance) || 0 : Math.max(0, total - paid);
  if (balance < 0.01) balance = 0;
  const status =
    e.status === "cancelled" ? "cancelled" : e.type === "debit-note" ? e.status : balance === 0 && total > 0 ? "paid" : paid > 0 ? "partial" : "pending";
  return { total, paid, balance, status };
}
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangeFilter, resolveDateRange, isDateInRange } from "@/components/shared/date-range-filter";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";

interface PurchaseEntryItem {
  id: string;
  billNo: string;
  supplierName: string;
  billDate: string;
  dueDate: string;
  subtotal: number;
  gst: number;
  total: number;
  paid: number;
  balance: number;
  status: "paid" | "pending" | "partial" | "overdue";
}

function PurchaseEntriesContent() {
  const searchParams = useSearchParams();
  const actionParam = searchParams?.get("action");
  const newParam = searchParams?.get("new");

  const queryClient = useQueryClient();
  const { data: entries = [], isLoading: loading } = useQuery({
    queryKey: ["purchase-entries"],
    queryFn: async () => {
      const res = await fetch("/api/purchase-entries");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const res = await fetch("/api/suppliers");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("This Month");
  const [dateRange, setDateRange] = useState(() => resolveDateRange("This Month"));
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<string | null>(null);
  const [entryToCancel, setEntryToCancel] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isDeletedBillsOpen, setIsDeletedBillsOpen] = useState(false);
  const [billToPrint, setBillToPrint] = useState<any | null>(null);
  const [billToPay, setBillToPay] = useState<any | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  // Rows resolved by the import flow, handed to PurchaseCreationModal as
  // preloadedItems. Cleared whenever the creation modal closes, so a later
  // plain "New Purchase Entry" click doesn't reopen with stale import data.
  const [importedItems, setImportedItems] = useState<any[] | null>(null);
  // Whatever supplier name/phone/GSTIN the import flow read off the PDF's
  // own letterhead — cleared alongside importedItems for the same reason.
  const [importedSupplier, setImportedSupplier] = useState<{ name?: string; phone?: string; gstin?: string } | null>(null);

  useEffect(() => {
    if (actionParam === "create" || newParam === "true" || actionParam === "new") {
      setIsFormOpen(true);
    }
  }, [actionParam, newParam]);

  const deleteMutation = useMutation({
    mutationFn: async ({ billNo, pin, reason }: { billNo: string; pin: string; reason: string }) => {
      const res = await fetch(`/api/purchase-entries?billNo=${encodeURIComponent(billNo)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, reason }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete entry");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-entries"] });
      toast.success("Purchase bill deleted and archived to the audit trail");
      setEntryToDelete(null);
      setAuthError(null);
    },
    onError: (error: any) => {
      setAuthError(error.message || "An error occurred while deleting");
    }
  });

  const cancelMutation = useMutation({
    mutationFn: async ({ billNo, pin, reason }: { billNo: string; pin: string; reason: string }) => {
      const res = await fetch(`/api/purchase-entries?billNo=${encodeURIComponent(billNo)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", pin, reason }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to cancel entry");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-entries"] });
      toast.success("Purchase bill cancelled successfully");
      setEntryToCancel(null);
      setAuthError(null);
    },
    onError: (error: any) => {
      setAuthError(error.message || "An error occurred while cancelling");
    }
  });

  const handleConfirmDelete = ({ pin, reason }: PinAuthResult) => {
    if (!entryToDelete) return;
    setAuthError(null);
    deleteMutation.mutate({ billNo: entryToDelete, pin, reason });
  };

  const handleConfirmCancel = ({ pin, reason }: PinAuthResult) => {
    if (!entryToCancel) return;
    setAuthError(null);
    cancelMutation.mutate({ billNo: entryToCancel, pin, reason });
  };

  const { data: deletedBills = [], isLoading: loadingDeletedBills } = useQuery({
    queryKey: ["purchase-entries-deleted"],
    queryFn: async () => {
      const res = await fetch("/api/audit?view=deleted-purchase-entries");
      const json = await res.json();
      return json.success ? json.data.rows : [];
    },
    enabled: isDeletedBillsOpen,
  });

  const filtered = useMemo(() => {
    return entries.filter((e: any) => {
      const matchesSearch = !search ||
        (e.billNo || e.billNumber || "").toLowerCase().includes(search.toLowerCase()) ||
        (e.supplierName || e.supplier || "").toLowerCase().includes(search.toLowerCase());
      const matchesDate = isDateInRange(e.date || e.billDate || e.createdAt, dateRange.start, dateRange.end);
      return matchesSearch && matchesDate;
    });
  }, [entries, search, dateRange]);

  return (
    <PageShell
      title="Purchase Entry (Supplier Bills)"
      subtitle="Record and manage supplier purchase invoices & payables"
      breadcrumbs={[{ label: "Purchase" }, { label: "Purchase Entry" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Purchase Entry (Supplier Bills)"
            subtitle={`${filtered.length} supplier bills`}
            data={filtered.map((e: any) => ({
              "Bill No": e.billNo,
              "Supplier Name": e.supplierName,
              "Linked PO": e.linkedPoNo || "Direct Inward",
              "Bill Date": formatDate(e.date || e.billDate),
              Subtotal: e.amount || e.subtotal,
              GST: e.totalTax || e.gst,
              "Total Amount": (e.amount || e.subtotal) + (e.totalTax || e.gst),
              Paid: billMoney(e).paid,
              "Balance Due": billMoney(e).balance,
              Status: billMoney(e).status,
            }))}
            filename="purchase-entries"
          />
          <Button variant="outline" size="sm" onClick={() => setIsDeletedBillsOpen(true)}>
            <History className="w-4 h-4 mr-1.5" /> Deleted Bills
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsImportOpen(true)}>
            <UploadCloud className="w-4 h-4 mr-1.5" /> Upload Excel / PDF
          </Button>
          <Button size="sm" onClick={() => setIsFormOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> New Purchase Entry
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[{ label: "Total Billed", value: formatCurrency(entries.reduce((a: any, b: any) => a + (b.total || b.totalAmount || 0), 0)) }, { label: "Paid to Suppliers", value: formatCurrency(entries.reduce((a: any, b: any) => a + (b.paid || 0), 0)) }, { label: "Payables Balance", value: formatCurrency(entries.filter((b: any) => b.status !== "cancelled" && b.type !== "debit-note").reduce((a: any, b: any) => a + billMoney(b).balance, 0)) }, { label: "Total Bills", value: entries.length }].map((s) => (
          <div key={s.label} className="metric-card">
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="data-table-container">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b">
          <AutocompleteSearch
            data={entries}
            searchKeys={["billNumber", "billNo", "supplierName"]}
            displayKey="billNo"
            subDisplayKey="supplierName"
            placeholder="Search Bill #, Supplier..."
            value={search}
            onSearchChange={(val) => setSearch(val)}
            className="flex-1 max-w-sm"
          />
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
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Supplier Bill #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Supplier Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Linked PO</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Bill Date</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Subtotal</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">GST</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Total Amount</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Paid</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Balance Due</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={11} className="p-0"><TableShimmer rows={6} cols={11} /></td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">No purchase entries found</td>
                </tr>
              ) : (
                filtered.map((e: any) => (
                  <tr key={e._id || e.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-[#3F63AD]">
                      <span 
                        className="cursor-pointer hover:underline flex items-center gap-1"
                        onClick={() => setBillToPrint(e)}
                        title="Click to View & Print Bill"
                      >
                        {e.billNo}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{e.supplierName}</td>
                    <td className="px-4 py-3">
                      {e.linkedPoNo ? (
                        <span className="font-mono text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                          {e.linkedPoNo}
                        </span>
                      ) : (
                        <div className="text-xs text-slate-400">
                          <span>Direct Inward</span>
                          {e.noPoReason && (
                            <p
                              className="text-[10px] text-slate-500 mt-0.5 max-w-[160px] truncate"
                              title={e.noPoReason}
                            >
                              {e.noPoReason}
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(e.date || e.billDate)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(e.amount || e.subtotal)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{formatCurrency(e.totalTax || e.gst)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency((e.amount || e.subtotal) + (e.totalTax || e.gst))}</td>
                    <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(billMoney(e).paid)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${billMoney(e).balance > 0 && billMoney(e).status !== "cancelled" ? "text-rose-600" : "text-slate-400"}`}>
                      {formatCurrency(billMoney(e).status === "cancelled" ? 0 : billMoney(e).balance)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        {(() => {
                          const st = billMoney(e).status;
                          return (
                            <Badge variant={st === "paid" ? "success" : st === "cancelled" ? "secondary" : st === "partial" ? "info" : "warning"}>
                              {st === "pending" ? "unpaid" : st}
                            </Badge>
                          );
                        })()}
                        {e.lastModifiedReason === "content-edit" && (
                          <Badge variant="outline" className="gap-1 whitespace-nowrap text-[10px] border-blue-300 text-blue-700 bg-blue-50">Edited</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-8 w-8 text-slate-500 hover:text-[#3F63AD] hover:bg-blue-50"
                          onClick={() => setBillToPrint(e)}
                          title="Print / Download Bill"
                        >
                          <Printer className="w-4 h-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem
                              className="gap-2 cursor-pointer"
                              onClick={() => setBillToPrint(e)}
                            >
                              <Eye className="w-4 h-4 text-blue-600" /> View / Print Bill
                            </DropdownMenuItem>
                            {e.status !== "cancelled" && e.type !== "debit-note" && billMoney(e).balance > 0 && (
                              <DropdownMenuItem
                                className="gap-2 text-emerald-700 focus:bg-emerald-50 focus:text-emerald-700 cursor-pointer"
                                onClick={() => setBillToPay({ ...e, ...billMoney(e) })}
                              >
                                <Wallet className="w-4 h-4" /> Record Payment
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            {e.status !== "cancelled" && (
                              <DropdownMenuItem
                                className="gap-2 text-amber-700 focus:bg-amber-50 focus:text-amber-700 cursor-pointer"
                                onClick={() => setEntryToCancel(e.billNo)}
                              >
                                <Ban className="w-4 h-4" /> Cancel Bill
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="gap-2 text-red-600 focus:bg-red-50 focus:text-red-700 cursor-pointer"
                              onClick={() => setEntryToDelete(e.billNo)}
                            >
                              <XCircle className="w-4 h-4" /> Delete Entry
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PurchaseCreationModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setImportedItems(null);
          setImportedSupplier(null);
        }}
        mode="entry"
        preloadedItems={importedItems || undefined}
        preloadedSupplier={importedSupplier || undefined}
      />

      <PurchaseImportModal
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        onResolved={(items, supplier) => {
          setImportedItems(items);
          setImportedSupplier(supplier || null);
          setIsImportOpen(false);
          setIsFormOpen(true);
        }}
      />

      <RecordBillPaymentDialog bill={billToPay} onOpenChange={(open) => !open && setBillToPay(null)} />

      {/* Print / Download Purchase Bill Modal */}
      <PurchaseBillPrintModal
        isOpen={!!billToPrint}
        onClose={() => setBillToPrint(null)}
        billData={billToPrint}
      />

      {/* Delete and Cancel both go through the one authorisation dialog: a PIN the
          server verifies, and a reason the audit trail keeps. */}
      <AuthorizePinDialog
        open={!!entryToDelete}
        onOpenChange={(open) => {
          if (!open) {
            setEntryToDelete(null);
            setAuthError(null);
          }
        }}
        onConfirm={handleConfirmDelete}
        title={`Delete Bill ${entryToDelete || ""}`}
        description="The bill is removed from the live list, but a full copy is archived so the admin can still see what was deleted, by whom and why. Stock and supplier balance are reversed."
        confirmLabel="Delete Bill"
        isPending={deleteMutation.isPending}
        errorMessage={authError}
      />

      <AuthorizePinDialog
        open={!!entryToCancel}
        onOpenChange={(open) => {
          if (!open) {
            setEntryToCancel(null);
            setAuthError(null);
          }
        }}
        onConfirm={handleConfirmCancel}
        title={`Cancel Bill ${entryToCancel || ""}`}
        description="Voids the bill and reverses stock and the supplier balance. The bill stays on record, marked Cancelled."
        confirmLabel="Confirm Cancellation"
        destructive={false}
        isPending={cancelMutation.isPending}
        errorMessage={authError}
      />

      {/* Archive of hard-deleted bills — nothing here can be restored, it's a
          read-only record of what was removed, by whom and why. */}
      <Dialog open={isDeletedBillsOpen} onOpenChange={setIsDeletedBillsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-4 h-4 text-red-600" /> Deleted Purchase Bills
            </DialogTitle>
            <DialogDescription>
              Bills removed from the live list. Each one keeps its full data and who/why it was deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Bill #</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Supplier</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase">Total</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Deleted By</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Reason</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">When</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loadingDeletedBills ? (
                  <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : deletedBills.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No deleted bills</td></tr>
                ) : (
                  deletedBills.map((d: any) => (
                    <tr key={d._id}>
                      <td className="px-3 py-2 font-mono font-bold">{d.billNo}</td>
                      <td className="px-3 py-2">{d.supplierName}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(d.total || 0)}</td>
                      <td className="px-3 py-2">{d.deletedBy}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[160px] truncate" title={d.deleteReason}>{d.deleteReason}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDate(d.deletedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

export default function PurchaseEntriesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs font-bold text-slate-500">Loading Purchase Inward Entries...</div>}>
      <PurchaseEntriesContent />
    </Suspense>
  );
}
