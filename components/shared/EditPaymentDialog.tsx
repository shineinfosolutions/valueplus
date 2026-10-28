"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayInIndia } from "@/lib/today";

const MODES = ["Cash", "UPI", "Bank Transfer", "NEFT", "RTGS", "IMPS", "Credit Card", "Debit Card", "Cheque"];

/**
 * Correct a saved payment (PUT /api/payments). The Admin's correction is made
 * at once; anyone else's goes to the Admin and is made only once approved.
 */
export function EditPaymentDialog({ payment, onClose }: { payment: any | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ amount: "", paymentMode: "Cash", date: "", bankTxnRef: "", notes: "", reason: "" });

  useEffect(() => {
    if (payment) {
      setForm({
        amount: String(payment.amount ?? ""),
        paymentMode: payment.paymentMode || "Cash",
        date: String(payment.date || "").slice(0, 10),
        bankTxnRef: payment.bankTxnRef || "",
        notes: payment.notes || "",
        reason: "",
      });
    }
  }, [payment]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/payments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: payment._id, ...form, amount: Number(form.amount) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || "Could not update the payment");
      return json;
    },
    onSuccess: (json: any) => {
      if (json.pendingApproval) {
        toast.info(json.message || "Sent to the Admin for approval.", { duration: 8000 });
      } else {
        toast.success("Payment updated");
        queryClient.invalidateQueries({ queryKey: ["payments"] });
        queryClient.invalidateQueries({ queryKey: ["supplier-payments"] });
        queryClient.invalidateQueries({ queryKey: ["customers"] });
        queryClient.invalidateQueries({ queryKey: ["suppliers"] });
        queryClient.invalidateQueries({ queryKey: ["invoices"] });
        queryClient.invalidateQueries({ queryKey: ["purchase-entries"] });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("erp-payment-created"));
          window.dispatchEvent(new CustomEvent("erp-invoice-created"));
          window.dispatchEvent(new CustomEvent("erp-customer-updated"));
        }
      }
      onClose();
    },
    onError: (error: any) => toast.error(error.message || "Could not update the payment"),
  });

  const handleSave = () => {
    if (!(Number(form.amount) > 0)) return toast.error("Enter a valid amount.");
    if (!form.date) return toast.error("Enter the payment date.");
    if (!form.reason.trim()) return toast.error("Give a reason for the correction.");
    save.mutate();
  };

  return (
    <Dialog open={!!payment} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Edit Payment {payment?.transactionId}</DialogTitle>
          <DialogDescription>
            {payment?.partyName}
            {payment?.referenceId ? ` · against ${payment.referenceId}` : ""}. A correction by anyone other than the Admin is
            made only after the Admin approves it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">Amount (₹) *</Label>
            <Input type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="font-bold" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">Payment Date *</Label>
            <Input type="date" max={todayInIndia()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">Payment Mode *</Label>
            <Select value={form.paymentMode} onValueChange={(v) => setForm({ ...form, paymentMode: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(MODES.includes(form.paymentMode) ? MODES : [form.paymentMode, ...MODES]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">UTR / Bank Ref</Label>
            <Input value={form.bankTxnRef} onChange={(e) => setForm({ ...form, bankTxnRef: e.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs font-semibold text-slate-700">Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs font-semibold text-slate-700">Reason for correction *</Label>
            <Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. wrong amount entered" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={save.isPending} className="bg-[#3F63AD] hover:bg-[#35548f] text-white">
            {save.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
