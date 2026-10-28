"use client";

import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { WalletCards, Banknote, CreditCard, Send, XCircle, X } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/utils";
import { todayInIndia } from "@/lib/today";

export function PaymentModal({ isOpen, onClose, onSuccess, defaultPartyType = "Customer", initialPartyId }: { isOpen: boolean; onClose: () => void; onSuccess?: () => void; defaultPartyType?: "Customer" | "Supplier"; initialPartyId?: string }) {
  const queryClient = useQueryClient();

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const res = await fetch("/api/customers");
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

  const [form, setForm] = useState({
    partyId: "",
    partyName: "",
    amount: "",
    paymentMode: "Cash",
    date: todayInIndia(),
    referenceId: "",
    notes: "",
    type: defaultPartyType === "Supplier" ? "paid" : "received",
  });

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setForm({
        partyId: "",
        partyName: "",
        amount: "",
        paymentMode: "Cash",
        date: todayInIndia(),
        referenceId: "",
        notes: "",
        type: defaultPartyType === "Supplier" ? "paid" : "received",
      });
    }
  }, [isOpen, defaultPartyType]);

  const parties = defaultPartyType === "Supplier" ? suppliers : customers;

  // Opened from a specific party's ledger — skip the picker and go straight
  // to their current balance, the same way choosing them manually would.
  useEffect(() => {
    if (isOpen && initialPartyId && parties.length > 0) {
      handleSelectParty(initialPartyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialPartyId, parties.length]);

  const handleSelectParty = (partyId: string) => {
    const found = parties.find((p: any) => p._id === partyId);
    if (found) {
      let paymentType = defaultPartyType === "Supplier" ? "paid" : "received";
      // If Customer has negative balance, we need to refund them (paid)
      // If Supplier has negative balance, we need to receive refund from them (received)
      const isNegative = (found.outstandingBalance || 0) < 0;
      if (defaultPartyType === "Customer" && isNegative) paymentType = "paid";
      if (defaultPartyType === "Supplier" && isNegative) paymentType = "received";

      setForm({ 
        ...form, 
        partyId: found._id, 
        partyName: found.name,
        type: paymentType,
        amount: isNegative ? Math.abs(found.outstandingBalance).toString() : ""
      });
    }
  };

  const selectedParty = parties.find((p: any) => p._id === form.partyId);

  const createPaymentMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to record payment");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Payment recorded successfully");
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("erp-payment-created"));
        window.dispatchEvent(new CustomEvent("erp-invoice-created"));
        window.dispatchEvent(new CustomEvent("erp-customer-updated"));
      }
      onSuccess?.();
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to record payment");
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.partyId || !form.amount || Number(form.amount) <= 0) {
      toast.error(`Please select a ${defaultPartyType.toLowerCase()} and enter a valid amount.`);
      return;
    }

    const payload = {
      transactionId: `TXN-${Date.now()}`,
      partyId: form.partyId,
      partyType: defaultPartyType,
      partyName: form.partyName,
      amount: Number(form.amount),
      paymentMode: form.paymentMode,
      date: form.date,
      referenceId: form.referenceId,
      notes: form.notes,
      type: form.type
    };

    createPaymentMutation.mutate(payload);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl p-0 rounded-2xl border-none shadow-2xl overflow-y-auto">
        <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-6 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
            <WalletCards className="w-6 h-6 text-[#76C043]" />
          </div>
          <div>
            <DialogTitle className="text-xl font-bold tracking-tight">
              {defaultPartyType === "Supplier" ? "Record Supplier Payout" : "Record Customer Payment Receipt"}
            </DialogTitle>
            <DialogDescription className="text-slate-300 text-xs mt-0.5">
              {defaultPartyType === "Supplier" ? "Record payouts made to suppliers or refunds received." : "Receive payments from customers or issue refunds to clear dues."}
            </DialogDescription>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 bg-slate-50/50">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">
                {defaultPartyType === "Supplier" ? "Supplier Name *" : "Customer Name *"}
              </Label>
              <Select value={form.partyId} onValueChange={handleSelectParty}>
                <SelectTrigger className="bg-slate-50 border-slate-300 font-semibold text-[#3F63AD]">
                  <SelectValue placeholder={defaultPartyType === "Supplier" ? "Select Supplier..." : "Select Customer..."} />
                </SelectTrigger>
                <SelectContent>
                  {parties.map((p: any) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.name} {p.phone ? `(${p.phone})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedParty && (
              <div className="bg-blue-50/50 p-3 rounded-lg border border-blue-100 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase">Current Outstanding Balance</p>
                  <p className={`text-lg font-black ${selectedParty.outstandingBalance > 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {formatCurrency(selectedParty.outstandingBalance || 0)}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Transaction Type *</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger className="bg-slate-50 border-slate-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="received">Receive Payment (In)</SelectItem>
                  <SelectItem value="paid">{defaultPartyType === "Supplier" ? "Make Payout (Out)" : "Refund / Pay to Customer (Out)"}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  {form.type === "paid" ? "Amount Refunded / Paid (₹) *" : "Amount Received (₹) *"}
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-500">₹</span>
                  <Input 
                    type="number" 
                    value={form.amount} 
                    onChange={(e) => setForm({ ...form, amount: e.target.value })} 
                    className="pl-8 bg-slate-50 border-slate-300 font-bold text-slate-900 text-lg" 
                    placeholder="0.00" 
                    autoFocus
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Payment Date *</Label>
                <Input 
                  type="date" 
                  value={form.date} 
                  onChange={(e) => setForm({ ...form, date: e.target.value })} 
                  className="bg-slate-50 border-slate-300" 
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Payment Mode *</Label>
                <Select value={form.paymentMode} onValueChange={(v) => setForm({ ...form, paymentMode: v })}>
                  <SelectTrigger className="bg-slate-50 border-slate-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                    <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                    <SelectItem value="Credit Card">Credit Card</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Reference / UTR / Cheque No.</Label>
                <Input 
                  value={form.referenceId} 
                  onChange={(e) => setForm({ ...form, referenceId: e.target.value })} 
                  className="bg-slate-50 border-slate-300 font-mono text-xs" 
                  placeholder="e.g. UTR123456789"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Internal Notes / Remarks</Label>
              <Input 
                value={form.notes} 
                onChange={(e) => setForm({ ...form, notes: e.target.value })} 
                className="bg-slate-50 border-slate-300 text-sm" 
                placeholder="Optional notes regarding this payment..."
              />
            </div>

          </div>

          <DialogFooter className="bg-slate-100 px-6 py-4 -mx-6 -mb-6 rounded-b-2xl border-t border-slate-200 flex items-center justify-between">
            <Button type="button" variant="ghost" onClick={onClose} className="text-slate-600">Cancel</Button>
            <Button type="submit" disabled={createPaymentMutation.isPending} className="bg-[#76C043] hover:bg-[#65A639] text-white shadow-lg shadow-green-900/20 font-bold px-8">
              {createPaymentMutation.isPending ? "Saving..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
