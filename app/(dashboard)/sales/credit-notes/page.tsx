"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus, Search, FileMinus, MoreHorizontal, FileText, XCircle,
  CheckCircle2, Printer, MessageCircle, Truck
} from "lucide-react";
import { InvoiceCreationModal } from "@/components/InvoiceCreationModal";
import { toast } from "sonner";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";

export default function CreditNotesPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-muted-foreground">Loading Credit Notes...</div>}>
      <CreditNotesContent />
    </Suspense>
  );
}

function CreditNotesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [isFormOpen, setIsFormOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("new") === "true") {
      setIsFormOpen(true);
    }
  }, [searchParams]);

  // 1. Fetch Invoices Credit Notes
  const { data: invoiceCreditNotes = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ["creditNotes"],
    queryFn: async () => {
      const res = await fetch("/api/invoices?type=credit-note");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  // 2. Fetch Delivery Challan Claims (CNR / Approved)
  const { data: challans = [], isLoading: loadingChallans } = useQuery({
    queryKey: ["delivery-challans-credit"],
    queryFn: async () => {
      const res = await fetch("/api/delivery-challans");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  // Combine into single unified list of Credit Notes
  const unifiedCreditNotes = useMemo(() => {
    const list: any[] = [];
    const seenRefs = new Set<string>();

    // 1. Add Direct Invoice Credit Notes
    invoiceCreditNotes.forEach((inv: any) => {
      seenRefs.add(inv.invoiceNumber);
      list.push({
        id: inv._id || inv.invoiceNumber,
        docNo: inv.invoiceNumber,
        date: inv.date || inv.createdAt,
        customerName: inv.customerName,
        customerPhone: inv.customerPhone || "",
        itemName: inv.items?.[0]?.itemName || "Sales Return",
        vpCode: inv.items?.[0]?.vpCode || "",
        serialNumber: inv.items?.[0]?.serialNumber || "",
        quantity: inv.items?.[0]?.quantity || 1,
        unit: inv.items?.[0]?.unit || "PCS",
        total: inv.total || inv.subtotal || 0,
        status: inv.status || "paid",
        isApproved: inv.status === "paid" || inv.balanceAmount === 0,
        notes: inv.notes || "",
        originalData: inv,
        source: "invoice",
      });
    });

    // 2. Add Approved Delivery Challans (CNR / Customer Returns)
    challans.forEach((c: any) => {
      const cnRef = c.creditNoteRef || c.challanNo;
      // Avoid duplicate if already in invoiceCreditNotes
      if (seenRefs.has(cnRef) || seenRefs.has(c.challanNo)) return;

      const isApproved = c.approvalStatus === "approved";
      const totalAmount = Number(c.itemPrice || 0) * Number(c.quantity || 1);

      list.push({
        id: c._id || c.challanNo,
        docNo: c.creditNoteRef || c.challanNo,
        date: c.approvedAt || c.date || c.createdAt,
        customerName: c.sourceParty || "Customer Claim",
        customerPhone: c.sourcePhone || c.customerPhone || "",
        itemName: c.itemName,
        vpCode: c.vpCode || "",
        serialNumber: c.serialImei || "",
        quantity: c.quantity || 1,
        unit: c.unit || "PCS",
        total: totalAmount,
        status: isApproved ? "paid" : "pending",
        isApproved: isApproved,
        notes: `From Challan #${c.challanNo}${c.defectDescription ? ` (Fault: ${c.defectDescription})` : ""}`,
        originalData: c,
        source: "challan",
      });
    });

    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [invoiceCreditNotes, challans]);

  const deleteMutation = useMutation({
    mutationFn: async (docNo: string) => {
      const res = await fetch(`/api/invoices?invoiceNumber=${encodeURIComponent(docNo)}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete credit note");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["creditNotes"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-challans-credit"] });
      toast.success("Credit note deleted successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred while deleting");
    }
  });

  const totalCreditAmount = useMemo(() => {
    return unifiedCreditNotes.reduce((sum: number, note: any) => sum + (note.total || 0), 0);
  }, [unifiedCreditNotes]);

  const paidCount = useMemo(() => {
    return unifiedCreditNotes.filter((n: any) => n.isApproved).length;
  }, [unifiedCreditNotes]);

  const filtered = useMemo(() => {
    return unifiedCreditNotes.filter((inv: any) => {
      const matchSearch =
        !search ||
        inv.docNo?.toLowerCase().includes(search.toLowerCase()) ||
        inv.customerName?.toLowerCase().includes(search.toLowerCase()) ||
        inv.itemName?.toLowerCase().includes(search.toLowerCase()) ||
        inv.serialNumber?.toLowerCase().includes(search.toLowerCase());

      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "paid" && inv.isApproved) ||
        (statusFilter === "pending" && !inv.isApproved);

      return matchSearch && matchStatus;
    });
  }, [unifiedCreditNotes, search, statusFilter]);

  const loading = loadingInvoices || loadingChallans;

  return (
    <PageShell
      title="Credit Notes"
      subtitle={`${unifiedCreditNotes.length} Credit Notes issued • Total Refund & Credit Value: ${formatCurrency(totalCreditAmount)}`}
      breadcrumbs={[{ label: "Sales" }, { label: "Credit Notes" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Credit Notes"
            subtitle={`${unifiedCreditNotes.length} Credit Notes issued • Total Refund & Credit Value: ${formatCurrency(totalCreditAmount)}`}
            data={unifiedCreditNotes.map((i: any) => ({ ...i }))}
            filename="credit_notes"
          />
          <Button size="sm" onClick={() => setIsFormOpen(true)} className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white font-bold shadow-md">
            <Plus className="w-4 h-4 mr-1.5" /> Issue Credit Note
          </Button>
        </div>
      }
    >
      {/* Metric KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="metric-card">
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(totalCreditAmount)}</p>
          <p className="text-xs text-muted-foreground mt-1">Total Credit Value</p>
        </div>
        <div className="metric-card">
          <p className="text-2xl font-bold text-[#30539C]">{unifiedCreditNotes.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total Credit Notes</p>
        </div>
        <div className="metric-card">
          <p className="text-2xl font-bold text-emerald-600">{paidCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Status: Paid (Approved)</p>
        </div>
        <div className="metric-card">
          <p className="text-2xl font-bold text-amber-600">{unifiedCreditNotes.length - paidCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Status: Pending</p>
        </div>
      </div>

      <div className="data-table-container">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b">
          <div className="relative flex-1 min-w-48 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search Credit Note #, Customer, Item, Serial..." 
              value={search} 
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} 
              className="pl-9" 
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setStatusFilter("all")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                statusFilter === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              All ({unifiedCreditNotes.length})
            </button>
            <button
              onClick={() => setStatusFilter("paid")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                statusFilter === "paid" ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              )}
            >
              ✅ Paid ({paidCount})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Credit Note # & Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Customer Details</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Item Description</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Qty / Amount</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={6} className="p-0"><TableShimmer rows={6} cols={6} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-16 text-center text-muted-foreground">No credit notes found</td></tr>
              ) : (
                filtered
                  .slice((page - 1) * 10, page * 10)
                  .map((inv: any) => {
                    const isPaid = inv.isApproved;

                    return (
                      <tr key={inv.id || inv.docNo} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-mono font-bold text-[#30539C] flex items-center gap-1.5">
                            {inv.docNo}
                            <FileMinus className="w-3.5 h-3.5 text-red-500" />
                          </div>
                          <span className="block text-[10px] text-slate-400 font-normal">{formatDate(inv.date)}</span>
                        </td>

                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-900">{inv.customerName}</p>
                          {inv.customerPhone && <p className="text-xs text-slate-500 font-mono">Ph: {inv.customerPhone}</p>}
                        </td>

                        <td className="px-4 py-3">
                          <div>
                            <p className="font-bold text-slate-900">{inv.itemName}</p>
                            <div className="flex flex-wrap items-center gap-1 mt-0.5">
                              {inv.vpCode && <span className="text-[10px] font-mono bg-blue-50 text-[#30539C] px-1 rounded">VP: {inv.vpCode}</span>}
                              {inv.serialNumber && <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1 rounded">SN: {inv.serialNumber}</span>}
                            </div>
                            {inv.notes && (
                              <p className="text-[10px] text-slate-500 italic mt-0.5">{inv.notes}</p>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-3 text-center">
                          <span className="font-bold text-slate-900 font-mono">
                            {inv.quantity || 1} {inv.unit || "PCS"}
                          </span>
                          <span className="block text-[11px] font-mono font-bold text-red-600">
                            -{formatCurrency(inv.total || 0)}
                          </span>
                        </td>

                        {/* STATUS COLUMN: SHOWS PAID / APPROVED */}
                        <td className="px-4 py-3 text-center">
                          {isPaid ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-xs py-0.5">
                              ✅ Paid (Approved)
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-bold text-xs py-0.5">
                              ⏳ Pending
                            </Badge>
                          )}
                        </td>

                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const phone = (inv.customerPhone || "").replace(/\D/g, "");
                                const ph = phone.length === 10 ? `91${phone}` : phone;
                                const msg = encodeURIComponent(
                                  `*VALUE PLUS / ASHOKA ENTERPRISES*\nCredit Note #${inv.docNo}\nCustomer: ${inv.customerName}\nItem: ${inv.itemName}\nAmount: ₹${inv.total}\nStatus: Paid (Approved)\n\nThank you!`
                                );
                                window.open(ph ? `https://wa.me/${ph}?text=${msg}` : `https://wa.me/?text=${msg}`, "_blank");
                              }}
                              className="h-7 px-2 text-emerald-600 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold"
                              title="Send on WhatsApp"
                            >
                              <MessageCircle className="w-3 h-3" />
                            </Button>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem 
                                  className="gap-2 text-red-600 focus:bg-red-50 focus:text-red-700 cursor-pointer text-xs"
                                  onClick={() => {
                                    if(confirm(`Are you sure you want to delete ${inv.docNo}?`)) {
                                      deleteMutation.mutate(inv.docNo);
                                    }
                                  }}
                                >
                                  <XCircle className="w-4 h-4" /> Delete Credit Note
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
        
        {filtered.length > 10 && (
          <div className="p-4 border-t flex items-center justify-between bg-slate-50 rounded-b-xl">
            <span className="text-xs text-muted-foreground">Showing {(page - 1) * 10 + 1} to {Math.min(page * 10, filtered.length)} of {filtered.length} entries</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
              <Button variant="outline" size="sm" disabled={page * 10 >= filtered.length} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      <InvoiceCreationModal 
        isOpen={isFormOpen} 
        onClose={() => setIsFormOpen(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["creditNotes"] })}
        mode="credit-note"
      />
    </PageShell>
  );
}

