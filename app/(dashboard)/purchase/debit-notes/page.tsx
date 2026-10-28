"use client";

/**
 * VALUEPLUS ERP — Unified Debit Notes & Return Claims Dashboard
 */

import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Plus, Search, FileMinus, RotateCcw, Truck, CheckCircle2, 
  MoreHorizontal, XCircle, Printer, Filter
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PurchaseCreationModal } from "@/components/PurchaseCreationModal";
import { PurchaseBillPrintModal } from "@/components/PurchaseBillPrintModal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function DebitNotesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [noteToPrint, setNoteToPrint] = useState<any | null>(null);

  // 1. Fetch Purchase Debit Notes
  const { data: debitNotes = [], isLoading: loadingDebitNotes } = useQuery({
    queryKey: ["debit-notes"],
    queryFn: async () => {
      const res = await fetch("/api/purchase-entries?type=debit-note");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  // 2. Fetch Delivery Challan Claims (CNR / PR)
  const { data: challans = [], isLoading: loadingChallans, refetch: refetchChallans } = useQuery({
    queryKey: ["delivery-challans-debit"],
    queryFn: async () => {
      const res = await fetch("/api/delivery-challans");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  // Delete Purchase Debit Note
  const deleteMutation = useMutation({
    mutationFn: async (billNo: string) => {
      const res = await fetch(`/api/purchase-entries?billNo=${encodeURIComponent(billNo)}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete debit note");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["debit-notes"] });
      toast.success("Debit note deleted successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred while deleting");
    }
  });

  // Action: Switch or issue CNR (Credit Note Request) on Challan
  const handleChallanCNR = async (c: any) => {
    try {
      const res = await fetch("/api/delivery-challans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          challanNo: c.challanNo, 
          flowType: "CNR",
          creditNoteRef: `CN-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`✅ CNR Marked for Challan #${c.challanNo}`);
        refetchChallans();
      } else {
        toast.error(json.error || "Failed to update CNR");
      }
    } catch (e: any) {
      toast.error(e.message || "Network error");
    }
  };

  // Action: Approve Challan in Debit Notes
  const handleApproveChallan = async (c: any) => {
    try {
      const res = await fetch("/api/delivery-challans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          challanNo: c.challanNo, 
          action: "approve",
          approvedBy: "ACCOUNTS MANAGER" 
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`🎉 Challan #${c.challanNo} Approved & Settled!`);
        refetchChallans();
      } else {
        toast.error(json.error || "Failed to approve challan");
      }
    } catch (e: any) {
      toast.error("Error approving challan");
    }
  };

  // Combine into single unified list
  const unifiedRecords = useMemo(() => {
    const list: any[] = [];

    // Add Delivery Challan Claims
    challans.forEach((c: any) => {
      list.push({
        id: c._id || c.challanNo,
        recordType: "challan",
        docNo: c.challanNo,
        date: c.date || c.createdAt,
        partyName: c.sourceParty || "Customer",
        partyPhone: c.sourcePhone || c.customerPhone || "",
        partyAddress: c.sourceAddress || "",
        destination: c.destinationParty || "",
        itemName: c.itemName,
        vpCode: c.vpCode,
        serialImei: c.serialImei,
        defectDescription: c.defectDescription,
        invoiceNumber: c.invoiceNumber,
        quantity: c.quantity || 1,
        unit: c.unit || "PCS",
        amount: Number(c.itemPrice || 0) * Number(c.quantity || 1),
        flowType: c.flowType || "CNR",
        isApproved: c.approvalStatus === "approved",
        approvedBy: c.approvedBy,
        originalData: c,
      });
    });

    // Add Purchase Debit Notes
    debitNotes.forEach((d: any) => {
      list.push({
        id: d._id || d.billNo,
        recordType: "debit-note",
        docNo: d.billNo,
        date: d.billDate || d.date || d.createdAt,
        partyName: d.supplierName || "Supplier",
        partyPhone: d.supplierPhone || "",
        partyAddress: "",
        destination: "Vendor Account",
        itemName: d.items?.[0]?.name || "Purchased Goods Return",
        vpCode: d.items?.[0]?.itemId || "",
        serialImei: d.items?.[0]?.serialNumbers?.join(", ") || "",
        defectDescription: "",
        invoiceNumber: d.linkedPoNo || "",
        quantity: d.items?.reduce((sum: number, it: any) => sum + (it.quantity || 1), 0) || 1,
        unit: "PCS",
        amount: d.total || d.subtotal || 0,
        flowType: "PR",
        isApproved: true,
        approvedBy: "Auto-Settled",
        originalData: d,
      });
    });

    // Sort by date newest first
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [challans, debitNotes]);

  const filteredRecords = useMemo(() => {
    return unifiedRecords.filter((r) => {
      const matchSearch =
        !search ||
        r.docNo?.toLowerCase().includes(search.toLowerCase()) ||
        r.partyName?.toLowerCase().includes(search.toLowerCase()) ||
        r.itemName?.toLowerCase().includes(search.toLowerCase()) ||
        r.serialImei?.toLowerCase().includes(search.toLowerCase()) ||
        r.invoiceNumber?.toLowerCase().includes(search.toLowerCase());

      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "cnr" && !r.isApproved) ||
        (statusFilter === "approved" && r.isApproved);

      return matchSearch && matchStatus;
    });
  }, [unifiedRecords, search, statusFilter]);

  const pendingCount = unifiedRecords.filter((r) => !r.isApproved).length;
  const approvedCount = unifiedRecords.filter((r) => r.isApproved).length;
  const totalValue = unifiedRecords.reduce((sum, r) => sum + (r.amount || 0), 0);

  return (
    <PageShell
      title="Debit Notes & Return Claims"
      subtitle="Unified dashboard for purchase debit notes, customer credit claims (CNR) & approval settlements"
      breadcrumbs={[{ label: "Purchase" }, { label: "Debit Notes" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Debit Notes & Return Claims"
            subtitle={`${filteredRecords.length} claims & notes`}
            data={filteredRecords.map((r: any) => ({
              "Doc No": r.docNo,
              Date: formatDate(r.date),
              Type: r.recordType === "challan" ? "Delivery Challan" : "Purchase Debit Note",
              Party: r.partyName,
              Phone: r.partyPhone || "",
              Item: r.itemName,
              "VP Code": r.vpCode || "",
              "Serial/IMEI": r.serialImei || "",
              "Invoice Ref": r.invoiceNumber || "",
              Defect: r.defectDescription || "",
              Quantity: r.quantity,
              Unit: r.unit,
              Amount: r.amount,
              Status: r.isApproved ? "Approved" : "CNR",
            }))}
            filename="debit-notes"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/sales/challan")}
            className="border-slate-300 font-semibold"
          >
            <Truck className="w-4 h-4 mr-1.5 text-[#30539C]" /> View Delivery Challans
          </Button>
          <Button size="sm" onClick={() => setIsFormOpen(true)} className="bg-red-600 hover:bg-red-700 text-white shadow-md font-bold">
            <Plus className="w-4 h-4 mr-1.5" /> Issue Debit Note
          </Button>
        </div>
      }
    >
      {/* Metric KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="metric-card">
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(totalValue)}</p>
          <p className="text-xs text-muted-foreground mt-1">Total Return / Debit Value</p>
        </div>
        <div className="metric-card">
          <p className="text-2xl font-bold text-[#30539C]">{unifiedRecords.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total Claims & Notes</p>
        </div>
        <div className="metric-card">
          <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Status: CNR (Pending)</p>
        </div>
        <div className="metric-card">
          <p className="text-2xl font-bold text-emerald-600">{approvedCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Status: Approved</p>
        </div>
      </div>

      {/* ─── SINGLE UNIFIED TABLE SECTION ─── */}
      <div className="data-table-container">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search Note / Challan #, Customer, Supplier, Item, Serial/IMEI..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
              className="pl-9" 
            />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 font-semibold text-xs">
              <SelectValue placeholder="Filter Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status ({unifiedRecords.length})</SelectItem>
              <SelectItem value="cnr">🔄 Status: CNR ({pendingCount})</SelectItem>
              <SelectItem value="approved">✅ Status: Approved ({approvedCount})</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Doc # & Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Party (Customer / Supplier)</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Item Description & Defect</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Qty / Value</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loadingDebitNotes || loadingChallans ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading records...</td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No records found matching your filter</td>
                </tr>
              ) : (
                filteredRecords.map((r: any) => {
                  const isChallan = r.recordType === "challan";

                  return (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 font-mono font-bold">
                          <span className={cn(isChallan ? "text-[#30539C]" : "text-red-600")}>
                            {r.docNo}
                          </span>
                          {isChallan ? (
                            <Truck className="w-3.5 h-3.5 text-[#76C043]" title="Delivery Challan" />
                          ) : (
                            <FileMinus className="w-3.5 h-3.5 text-red-500" title="Purchase Debit Note" />
                          )}
                        </div>
                        <span className="block text-[10px] text-slate-400 font-normal">{formatDate(r.date)}</span>
                      </td>

                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-900">{r.partyName}</p>
                        {r.partyPhone && <p className="text-xs text-slate-500 font-mono">Ph: {r.partyPhone}</p>}
                        {r.destination && <p className="text-[10px] text-slate-400">→ {r.destination}</p>}
                      </td>

                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-900">{r.itemName}</p>
                        <div className="flex flex-wrap items-center gap-1 mt-0.5">
                          {r.vpCode && <span className="text-[10px] font-mono bg-blue-50 text-[#30539C] px-1 rounded">VP: {r.vpCode}</span>}
                          {r.serialImei && <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1 rounded">SN: {r.serialImei}</span>}
                          {r.invoiceNumber && <span className="text-[10px] font-mono bg-emerald-50 text-emerald-700 px-1 rounded font-bold">Ref #{r.invoiceNumber}</span>}
                        </div>
                        {r.defectDescription && (
                          <p className="text-[10px] text-rose-600 italic mt-0.5">Fault: {r.defectDescription}</p>
                        )}
                      </td>

                      <td className="px-4 py-3 text-center">
                        <span className="font-bold text-slate-900">{r.quantity} {r.unit}</span>
                        {r.amount ? (
                          <span className={cn("block text-[10px] font-mono font-bold", isChallan ? "text-emerald-700" : "text-red-600")}>
                            {isChallan ? "" : "-"}₹{Number(r.amount).toLocaleString("en-IN")}
                          </span>
                        ) : null}
                      </td>

                      {/* STATUS: CNR BY DEFAULT, BECOMES APPROVED WHEN APPROVED */}
                      <td className="px-4 py-3 text-center">
                        {r.isApproved ? (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-xs py-0.5">
                            ✅ Approved
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-bold text-xs py-0.5 animate-pulse">
                            🔄 CNR
                          </Badge>
                        )}
                      </td>

                      {/* ACTIONS: APPROVE / DELETE */}
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {isChallan ? (
                            <Button
                              size="sm"
                              disabled={r.isApproved}
                              onClick={() => handleApproveChallan(r.originalData)}
                              className={cn(
                                "h-7 px-3 text-xs font-bold transition-all text-white",
                                r.isApproved
                                  ? "bg-slate-200 text-slate-500 opacity-60 cursor-not-allowed"
                                  : "bg-emerald-600 hover:bg-emerald-700 shadow-sm"
                              )}
                              title={r.isApproved ? "Already Approved" : "Click to Approve claim"}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> {r.isApproved ? "Approved" : "Approve"}
                            </Button>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem
                                  className="gap-2 text-slate-700 focus:bg-slate-50 cursor-pointer text-xs"
                                  onClick={() => setNoteToPrint(r.originalData)}
                                >
                                  <Printer className="w-4 h-4" /> Print / Share
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="gap-2 text-red-600 focus:bg-red-50 focus:text-red-700 cursor-pointer text-xs"
                                  onClick={() => {
                                    if(confirm(`Are you sure you want to delete ${r.docNo}?`)) {
                                      deleteMutation.mutate(r.docNo);
                                    }
                                  }}
                                >
                                  <XCircle className="w-4 h-4" /> Delete Debit Note
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PurchaseCreationModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        mode="debit-note"
      />

      <PurchaseBillPrintModal
        isOpen={!!noteToPrint}
        onClose={() => setNoteToPrint(null)}
        billData={noteToPrint}
      />
    </PageShell>
  );
}


