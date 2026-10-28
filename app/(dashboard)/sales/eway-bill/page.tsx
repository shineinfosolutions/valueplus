"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Truck, Plus, Search, CheckCircle2, FileText, Printer, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/context/BranchContext";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function EWayBillPage() {
  const queryClient = useQueryClient();
  const { activeLocation } = useBranch();
  const [searchTerm, setSearchTerm] = useState("");
  const [isPrepModalOpen, setIsPrepModalOpen] = useState(false);

  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices", activeLocation?.name],
    queryFn: async () => {
      const whParam = activeLocation?.name ? `?warehouse=${encodeURIComponent(activeLocation.name)}` : "";
      const res = await fetch(`/api/invoices${whParam}`);
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const { data: ewayBills = [], isLoading } = useQuery({
    queryKey: ["ewayBills"],
    queryFn: async () => {
      const res = await fetch("/api/eway-bills");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const [form, setForm] = useState({
    invoiceNumber: "",
    customerName: "",
    customerGstin: "",
    deliveryAddress: "",
    vehicleNumber: "",
    transporterName: "Direct Store Dispatch",
    transporterId: "",
    taxableValue: 0,
    totalGst: 0,
    totalAmount: 0,
    items: [] as any[],
  });

  const selectInvoiceForEway = (invNumber: string) => {
    const inv = invoices.find((i: any) => i.invoiceNumber === invNumber);
    if (inv) {
      setForm({
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName,
        customerGstin: inv.customerGST || "",
        deliveryAddress: inv.customerAddress || "Gorakhpur, Uttar Pradesh",
        vehicleNumber: inv.vehicleNumber || "UP53 CA 1234",
        transporterName: "Direct Store Logistics",
        transporterId: "TRANS-0912",
        taxableValue: inv.taxableAmount || inv.subtotal,
        totalGst: inv.totalGST,
        totalAmount: inv.total,
        items: (inv.items || []).map((it: any) => ({
          itemName: it.itemName,
          hsn: it.hsn || it.hsnCode || "8528",
          quantity: it.quantity,
          taxableValue: it.taxableAmount,
          gstRate: it.gstRate,
        })),
      });
    }
  };

  const createEwayMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/eway-bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to prepare E-Way bill");
      return json.data;
    },
    onSuccess: () => {
      toast.success("E-Way Bill prepared successfully");
      queryClient.invalidateQueries({ queryKey: ["ewayBills"] });
      setIsPrepModalOpen(false);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch("/api/eway-bills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to update");
      return json.data;
    },
    onSuccess: () => {
      toast.success("E-Way Bill status updated");
      queryClient.invalidateQueries({ queryKey: ["ewayBills"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const filtered = ewayBills.filter((b: any) =>
    (b.ewayBillNo || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (b.invoiceNumber || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (b.customerName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (b.vehicleNumber || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <PageShell
      title="E-Way Bill Document Preparation"
      description="Prepare and track electronic waybills for consignment movement above ₹50,000 threshold."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search E-Way Bill #, invoice or vehicle..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-50 border-slate-300 text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <ExportMenu
              title="E-Way Bills"
              subtitle={`${filtered.length} e-way bills`}
              data={(filtered as any[]).map((b) => ({
                "E-Way Bill #": b.ewayBillNo,
                "Invoice Number": b.invoiceNumber,
                Customer: b.customerName,
                "Delivery Address": b.deliveryAddress,
                "Vehicle Number": b.vehicleNumber,
                "Taxable Value": b.taxableValue,
                "Consignment Total": b.totalAmount,
                Status: b.status,
              }))}
              filename="eway-bills"
            />
            <Button
              onClick={() => setIsPrepModalOpen(true)}
              className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white text-xs font-bold shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Prepare E-Way Bill
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b text-slate-700 uppercase font-bold">
              <tr>
                <th className="p-3">E-Way Bill #</th>
                <th className="p-3">Invoice Number</th>
                <th className="p-3">Customer & Destination</th>
                <th className="p-3">Vehicle Number</th>
                <th className="p-3 text-right">Taxable Value</th>
                <th className="p-3 text-right">Consignment Total</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={8} className="p-0"><TableShimmer rows={6} cols={8} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-slate-500">No E-Way bills generated yet.</td></tr>
              ) : (
                filtered.map((b: any) => (
                  <tr key={b._id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-mono font-bold text-[#3F63AD]">{b.ewayBillNo}</td>
                    <td className="p-3 font-mono font-semibold text-slate-700">{b.invoiceNumber}</td>
                    <td className="p-3">
                      <p className="font-bold text-slate-900">{b.customerName}</p>
                      <span className="text-[10px] text-slate-500 block truncate max-w-xs">{b.deliveryAddress}</span>
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-800">{b.vehicleNumber}</td>
                    <td className="p-3 text-right font-mono font-bold">₹{b.taxableValue?.toLocaleString("en-IN")}</td>
                    <td className="p-3 text-right font-mono font-bold text-emerald-800">₹{b.totalAmount?.toLocaleString("en-IN")}</td>
                    <td className="p-3 text-center">
                      <Badge className={
                        b.status === "Generated" ? "bg-emerald-100 text-emerald-800" :
                        b.status === "Prepared" ? "bg-blue-100 text-blue-800" :
                        "bg-slate-100 text-slate-800"
                      }>
                        {b.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      {b.status === "Prepared" ? (
                        <Button
                          size="sm"
                          onClick={() => updateStatusMutation.mutate({ id: b._id, status: "Generated" })}
                          className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Mark Generated
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.print()}
                          className="h-7 text-xs font-bold"
                        >
                          <Printer className="w-3 h-3 mr-1" /> Print Slip
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
      </div>

      {/* PREPARE EWAY MODAL */}
      <Dialog open={isPrepModalOpen} onOpenChange={setIsPrepModalOpen}>
        <DialogContent className="max-w-md p-6 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2 text-slate-900">
              <Truck className="w-4 h-4 text-[#3F63AD]" /> Prepare E-Way Consignment Bill
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs pt-2">
            <div>
              <Label>Select Invoice *</Label>
              <select 
                value={form.invoiceNumber} 
                onChange={(e) => selectInvoiceForEway(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 bg-slate-50 text-xs px-2 mt-1 font-semibold"
              >
                <option value="">-- Select Tax Invoice --</option>
                {invoices.map((inv: any) => (
                  <option key={inv._id} value={inv.invoiceNumber}>
                    {inv.invoiceNumber} - {inv.customerName} (₹{inv.total?.toLocaleString("en-IN")})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Customer Name</Label>
              <Input readOnly value={form.customerName} className="mt-1 bg-slate-100 font-bold" />
            </div>
            <div>
              <Label>Destination / Delivery Address *</Label>
              <Input value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} className="mt-1 bg-white" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Vehicle Number *</Label>
                <Input value={form.vehicleNumber} onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })} className="mt-1 bg-white font-mono uppercase font-bold" />
              </div>
              <div>
                <Label>Transporter Name</Label>
                <Input value={form.transporterName} onChange={(e) => setForm({ ...form, transporterName: e.target.value })} className="mt-1 bg-white" />
              </div>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg flex justify-between font-bold">
              <span>Total Consignment Value:</span>
              <span className="text-[#3F63AD] font-mono">₹{form.totalAmount?.toLocaleString("en-IN")}</span>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setIsPrepModalOpen(false)}>Cancel</Button>
            <Button 
              onClick={() => createEwayMutation.mutate(form)} 
              disabled={createEwayMutation.isPending || !form.invoiceNumber} 
              className="bg-[#3F63AD] text-white font-bold"
            >
              Generate Prepared E-Way Bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
