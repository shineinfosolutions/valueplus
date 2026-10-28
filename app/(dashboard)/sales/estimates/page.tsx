"use client";

import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Plus, Search, FileText, Send, CheckCircle, Clock, Trash2, AlertTriangle, Eye, User, CalendarDays, WalletCards, Printer, MessageCircle, Pencil } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { AuthorizePinDialog, PinAuthResult } from "@/components/AuthorizePinDialog";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InvoiceCreationModal } from "@/components/InvoiceCreationModal";
import ValueplusInvoice from "@/app/invoice/page";

import { DateRangeFilter, resolveDateRange, isDateInRange } from "@/components/shared/date-range-filter";
import { useSession } from "next-auth/react";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";

interface EstimateItem {
  id: string;
  estimateNo: string;
  customerName: string;
  date: string;
  expiryDate: string;
  totalAmount: number;
  status: "sent" | "accepted" | "expired" | "draft";
}

export default function EstimatesPage() {
  const { data: session } = useSession();
  const userRole = ((session?.user as any)?.role || "admin").toLowerCase();
  const currentUserName = session?.user?.name || "Staff Member";
  const isSuperAdminOrAdmin = userRole === "admin" || userRole === "superadmin" || userRole === "manager";
  const isIndividualStaff = !isSuperAdminOrAdmin;

  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("This Month");
  const [dateRange, setDateRange] = useState(() => resolveDateRange("This Month"));
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [estimateToDelete, setEstimateToDelete] = useState<string | null>(null);
  const [activePrintEstimate, setActivePrintEstimate] = useState<any>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedEstimate, setSelectedEstimate] = useState<any | null>(null);
  const [convertingEstimate, setConvertingEstimate] = useState<any | null>(null);
  const [editingEstimate, setEditingEstimate] = useState<any | null>(null);

  const { data: estimates = [], isLoading } = useQuery({
    queryKey: ["estimates"],
    queryFn: async () => {
      const res = await fetch("/api/estimates");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const res = await fetch("/api/customers");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const [formData, setFormData] = useState({
    customerName: "",
    expiryDate: "",
    totalAmount: "",
  });

  const filtered = useMemo(() => {
    return estimates.filter((e: any) => {
      const matchesSearch = !search ||
        (e.estimateNumber || e.estimateNo)?.toLowerCase().includes(search.toLowerCase()) ||
        e.customerName?.toLowerCase().includes(search.toLowerCase());
      const matchesDate = isDateInRange(e.date || e.createdAt, dateRange.start, dateRange.end);
      return matchesSearch && matchesDate;
    });
  }, [estimates, search, dateRange]);

  const createEstimateMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to create estimate");
      return json.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["estimates"] });
      toast.success(`Estimate ${data.estimateNumber || ""} created & sent!`);
      setIsFormOpen(false);
      setFormData({ customerName: "", expiryDate: "", totalAmount: "" });
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred");
    }
  });

  // The server's verdict on the PIN, shown inside the authorisation dialog.
  const [authError, setAuthError] = useState<string | null>(null);

  const deleteEstimateMutation = useMutation({
    mutationFn: async ({ estimateNumber, pin, reason }: { estimateNumber: string; pin: string; reason: string }) => {
      const res = await fetch(`/api/estimates?estimateNumber=${encodeURIComponent(estimateNumber)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, reason }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete estimate");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["estimates"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Estimate deleted and archived to the audit trail");
      setEstimateToDelete(null);
      setAuthError(null);
    },
    onError: (error: any) => {
      setAuthError(error.message || "An error occurred while deleting");
    }
  });

  const handleConfirmDeleteEstimate = ({ pin, reason }: PinAuthResult) => {
    if (!estimateToDelete) return;
    setAuthError(null);
    deleteEstimateMutation.mutate({ estimateNumber: estimateToDelete, pin, reason });
  };

  const handleSave = async () => {
    if (!formData.customerName || !formData.totalAmount) {
      toast.error("Please fill Customer Name and Amount");
      return;
    }

    const payload = {
      estimateNumber: `EST-${new Date().getFullYear()}-${String(estimates.length + 1).padStart(4, "0")}`,
      customerName: formData.customerName,
      expiryDate: formData.expiryDate || new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
      total: Number(formData.totalAmount) || 0,
      salesperson: isIndividualStaff ? currentUserName : "AMIT SINGH",
      salesExecutive: isIndividualStaff ? currentUserName : "AMIT SINGH",
      createdBy: currentUserName,
      status: "Sent",
    };

    createEstimateMutation.mutate(payload);
  };

  return (
    <PageShell
      title="Estimates & Quotations"
      subtitle="Create and manage customer price quotes"
      breadcrumbs={[{ label: "Sales" }, { label: "Estimates" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Estimates & Quotations"
            subtitle={`${filtered.length} estimates`}
            data={(filtered as any[]).map((e) => ({
              "Estimate #": e.estimateNumber || e.estimateNo,
              Customer: e.customerName,
              Salesperson: e.salesperson || e.salesExecutive || "AMIT SINGH",
              Date: formatDate(e.date),
              "Valid Until": formatDate(e.expiryDate),
              Amount: e.total || e.totalAmount || 0,
              Status: e.status,
            }))}
            filename="estimates"
          />
          <Button size="sm" onClick={() => setIsFormOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> New Estimate
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[{ label: "Total Estimates", value: estimates.length }, { label: "Accepted", value: estimates.filter((e: any) => e.status === "accepted").length }, { label: "Pending", value: estimates.filter((e: any) => e.status === "sent").length }, { label: "Total Value", value: formatCurrency(estimates.reduce((a: any, b: any) => a + (b.total || b.totalAmount || 0), 0)) }].map((s) => (
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
            <Input placeholder="Search estimates..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
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
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Estimate #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Customer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Salesperson</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Valid Until</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Amount</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase w-10">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <TableShimmer rows={7} cols={8} />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No estimates found</td>
                </tr>
              ) : filtered.map((e: any) => (
                <tr key={e._id || e.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-[#3F63AD]">{e.estimateNumber || e.estimateNo}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{e.customerName}</td>
                  <td className="px-4 py-3 text-xs font-bold text-[#3F63AD] uppercase">
                    {e.salesperson || e.salesExecutive || "AMIT SINGH"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(e.date)}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(e.expiryDate)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatCurrency(e.total || e.totalAmount)}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={e.status === "Accepted" ? "success" : e.status === "Sent" ? "info" : e.status === "Converted" ? "default" : "secondary"}>{e.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right flex items-center justify-end gap-1.5">
                    {e.status !== "Converted" && (
                      !isIndividualStaff ? (
                        <Button
                          size="sm"
                          className="h-7 px-2.5 text-[11px] font-bold bg-[#76C043] hover:bg-[#60a82c] text-white shadow-xs"
                          onClick={() => setConvertingEstimate(e)}
                          title="Make Tax Invoice / Bill from this Estimate"
                        >
                          ⚡ Make Bill
                        </Button>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-amber-700 bg-amber-50 border-amber-200">
                          Active Estimate
                        </Badge>
                      )
                    )}
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-7 px-2 text-[11px] font-semibold border-[#3F63AD]/40 text-[#3F63AD] hover:bg-[#3F63AD] hover:text-white"
                      onClick={() => { 
                        setActivePrintEstimate({
                          ...e,
                          type: "estimate",
                          isEstimate: true,
                          salesperson: e.salesperson || e.salesExecutive || "AMIT SINGH",
                          salesExecutive: e.salesperson || e.salesExecutive || "AMIT SINGH",
                        }); 
                        setIsPreviewOpen(true); 
                      }}
                      title="Print Estimate / Quotation"
                    >
                      <Printer className="w-3 h-3 mr-1" /> Print
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-7 w-7 p-0 border-emerald-500 text-emerald-600 hover:bg-emerald-500 hover:text-white"
                      onClick={() => {
                        const cleanPhone = (e.customerPhone || "").replace(/\D/g, "");
                        const ph = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
                        const sp = e.salesperson || e.salesExecutive || "AMIT SINGH";
                        const msg = encodeURIComponent(
                          `*VALUE PLUS / ASHOKA ENTERPRISES*\nCommercial Estimate #${e.estimateNumber || e.estimateNo}\nDate: ${e.date || "Today"}\nCustomer: ${e.customerName}\nSalesperson: ${sp}\nEstimated Amount: ₹${Number(e.total || e.totalAmount || 0).toLocaleString("en-IN")}\nValid Until: ${e.expiryDate || "15 Days"}\n\nThank you for choosing Value Plus!`
                        );
                        window.open(ph ? `https://wa.me/${ph}?text=${msg}` : `https://wa.me/?text=${msg}`, '_blank');
                      }}
                      title="Share on WhatsApp"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                    </Button>
                    {e.status !== "Converted" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-amber-700 hover:bg-amber-50"
                        onClick={() => setEditingEstimate(e)}
                        title="Edit Estimate"
                        aria-label={"Edit estimate " + (e.estimateNumber || e.estimateNo)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-[#3F63AD] hover:bg-blue-50" onClick={() => setSelectedEstimate(e)} title="View Info">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => setEstimateToDelete(e.estimateNumber || e.estimateNo)} title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <InvoiceCreationModal 
        isOpen={isFormOpen} 
        onClose={() => setIsFormOpen(false)} 
        mode="estimate" 
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["estimates"] });
          setIsFormOpen(false);
        }} 
      />

      <InvoiceCreationModal
        isOpen={!!editingEstimate}
        onClose={() => setEditingEstimate(null)}
        mode="estimate"
        editEstimate={editingEstimate}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["estimates"] });
          setEditingEstimate(null);
        }}
      />

      <InvoiceCreationModal 
        isOpen={!!convertingEstimate} 
        onClose={() => setConvertingEstimate(null)} 
        mode="invoice"
        preloadedEstimate={convertingEstimate}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["estimates"] });
          queryClient.invalidateQueries({ queryKey: ["invoices"] });
          setConvertingEstimate(null);
        }} 
      />

      {selectedEstimate && (
        <Dialog open={!!selectedEstimate} onOpenChange={() => setSelectedEstimate(null)}>
          <DialogContent className="max-w-4xl p-0 rounded-2xl border-none shadow-2xl overflow-y-auto bg-slate-50/50">
            {/* Header */}
            <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-6 pr-14 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20 shrink-0">
                  <FileText className="w-6 h-6 text-yellow-400" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xl font-bold tracking-tight truncate">Estimate: {selectedEstimate.estimateNumber || selectedEstimate.estimateNo}</h3>
                  <p className="text-xs text-slate-300 mt-0.5 flex items-center gap-2 flex-wrap">
                    <CalendarDays className="w-3.5 h-3.5" /> Date: {formatDate(selectedEstimate.date)}
                    <span className="opacity-50">|</span>
                    Valid Until: {formatDate(selectedEstimate.expiryDate)}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className={`text-sm py-1 px-3 border-white/30 shrink-0 ${selectedEstimate.status === "Converted" ? "bg-emerald-500 text-white" : "bg-white/10 text-white"}`}>
                {selectedEstimate.status ? selectedEstimate.status.toUpperCase() : "DRAFT"}
              </Badge>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
              {/* Customer Details */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex flex-none items-center justify-center">
                  <User className="w-5 h-5 text-[#3F63AD]" />
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-slate-900">{selectedEstimate.customerName}</h4>
                </div>
              </div>

              {/* Line Items */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-slate-100 p-3 border-b flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-500" />
                  <span className="font-bold text-slate-700 text-sm uppercase">Estimated Items</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold text-slate-500">Item Details</th>
                        <th className="px-4 py-2 text-center font-semibold text-slate-500">Qty</th>
                        <th className="px-4 py-2 text-right font-semibold text-slate-500">Rate (₹)</th>
                        <th className="px-4 py-2 text-right font-semibold text-slate-500">Total (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {selectedEstimate.items?.map((item: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <p className="font-bold text-slate-900">{item.name || item.itemName}</p>
                          </td>
                          <td className="px-4 py-3 text-center font-semibold">{item.quantity || item.qty || 1}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(item.rate || 0)}</td>
                          <td className="px-4 py-3 text-right font-bold text-slate-800">{formatCurrency((item.rate || 0) * (item.quantity || item.qty || 1))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payment Summary */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50/30 p-5 rounded-xl border border-blue-100 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                    <WalletCards className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-blue-900">Total Estimate Value</p>
                    <p className="text-xs text-blue-700/80 mt-0.5">Including taxes</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-black text-blue-600 text-2xl">{formatCurrency(selectedEstimate.total || selectedEstimate.totalAmount || 0)}</p>
                </div>
              </div>
            </div>

            <DialogFooter className="bg-slate-100 px-6 py-4 rounded-b-2xl border-t border-slate-200 flex items-center justify-between">
              <div className="text-xs text-slate-500 font-medium">
                {selectedEstimate.notes && <span>{selectedEstimate.notes}</span>}
              </div>
              <Button onClick={() => setSelectedEstimate(null)} className="bg-slate-800 hover:bg-slate-900 text-white px-8 font-bold">
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Deleting an estimate goes through the same PIN + reason as an invoice, so
          it shows up in the dashboard's Payment Leakage audit too. */}
      <AuthorizePinDialog
        open={!!estimateToDelete}
        onOpenChange={(open) => {
          if (!open) {
            setEstimateToDelete(null);
            setAuthError(null);
          }
        }}
        onConfirm={handleConfirmDeleteEstimate}
        title={`Delete Estimate ${estimateToDelete || ""}`}
        description="The estimate is removed from the list, but a full copy is archived so the admin can still see what was deleted, by whom and why."
        confirmLabel="Delete Estimate"
        isPending={deleteEstimateMutation.isPending}
        errorMessage={authError}
      />

      {/* FULL ESTIMATE PREVIEW MODAL */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-2">
          {activePrintEstimate && (() => {
            const customer = customers.find((c: any) => c.name === activePrintEstimate.customerName);
            const enrichedData = { 
              ...activePrintEstimate,
              type: "estimate",
              isEstimate: true,
              salesperson: activePrintEstimate.salesperson || activePrintEstimate.salesExecutive || "AMIT SINGH",
              salesExecutive: activePrintEstimate.salesperson || activePrintEstimate.salesExecutive || "AMIT SINGH",
            };
            if (customer) {
              if (!enrichedData.customerAddress) enrichedData.customerAddress = customer.billingAddress?.line1 || customer.address || "";
              if (!enrichedData.customerCity) enrichedData.customerCity = customer.billingAddress?.city || customer.city || "";
              if (!enrichedData.customerState) enrichedData.customerState = customer.billingAddress?.state || customer.state || "";
              if (!enrichedData.customerPin) enrichedData.customerPin = customer.billingAddress?.pincode || customer.pincode || customer.pin || "";
              if (!enrichedData.customerPhone) enrichedData.customerPhone = customer.phone || "";
              if (!enrichedData.customerEmail) enrichedData.customerEmail = customer.email || "";
            }
            return <ValueplusInvoice invoiceData={enrichedData} />;
          })()}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

