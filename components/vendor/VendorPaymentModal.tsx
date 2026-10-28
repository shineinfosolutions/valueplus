"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WalletCards } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { todayInIndia } from "@/lib/today";

/**
 * Modes are free text on the model, but the counter picks from this list so the
 * strings stay classifiable by lib/payment-modes.ts — "NEFT / IMPS / RTGS" lands
 * in the same "online" bucket the sales dashboard uses.
 */
const PAYMENT_MODES = [
  "Cash",
  "UPI",
  "NEFT",
  "IMPS",
  "RTGS",
  "Bank Transfer",
  "Cheque",
  "Card",
];

export function VendorPaymentModal({
  open,
  onOpenChange,
  vendorId,
  vendors = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected vendor; when absent the user picks one. */
  vendorId?: string;
  vendors?: any[];
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    vendorId: vendorId || "",
    amount: "",
    mode: "Cash",
    date: todayInIndia(),
    refNo: "",
    againstBillNo: "",
    notes: "",
    type: "received" as "received" | "paid",
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      vendorId: vendorId || "",
      amount: "",
      mode: "Cash",
      date: todayInIndia(),
      refNo: "",
      againstBillNo: "",
      notes: "",
      type: "received",
    });
  }, [open, vendorId]);

  const { data: ledger } = useQuery({
    queryKey: ["vendor-ledger", form.vendorId],
    queryFn: async () => {
      const res = await fetch(`/api/vendors/ledger?party=vendor&id=${form.vendorId}`);
      const json = await res.json();
      return json.success ? json.data : null;
    },
    enabled: open && Boolean(form.vendorId),
  });

  const { data: bills = [] } = useQuery({
    queryKey: ["vendor-bills", form.vendorId],
    queryFn: async () => {
      const res = await fetch(`/api/vendors/bills?vendorId=${form.vendorId}`);
      const json = await res.json();
      return json.success ? json.data : [];
    },
    enabled: open && Boolean(form.vendorId),
  });

  const openBills = useMemo(
    () => (bills as any[]).filter((b) => b.status !== "cancelled"),
    [bills]
  );

  const pending = ledger?.summary?.closingBalance ?? 0;

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/vendors/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: form.vendorId,
          amount: Number(form.amount),
          mode: form.mode,
          date: form.date,
          refNo: form.refNo.trim(),
          againstBillNo: form.againstBillNo === "none" ? "" : form.againstBillNo,
          notes: form.notes.trim(),
          type: form.type,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not record the payment");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Payment recorded");
      queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["party-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-ledger-all"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!form.vendorId) return toast.error("Select a vendor");
    if (!(Number(form.amount) > 0)) return toast.error("Enter an amount greater than zero");
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 rounded-2xl border-none shadow-2xl overflow-y-auto">
        <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-5 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
            <WalletCards className="w-5 h-5 text-[#76C043]" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight">Record Vendor Payment</h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Money received from a vendor, or a refund issued back to them
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4 bg-slate-50/50 max-h-[65vh] overflow-y-auto">
          {!vendorId && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Vendor *</Label>
              <Select value={form.vendorId} onValueChange={(v) => setForm({ ...form, vendorId: v })}>
                <SelectTrigger className="bg-white border-slate-300">
                  <SelectValue placeholder="Select vendor…" />
                </SelectTrigger>
                <SelectContent className="max-h-[260px]">
                  {vendors.map((v: any) => (
                    <SelectItem key={v._id} value={v._id}>
                      {v.name} ({v.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {form.vendorId && (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Current Pending
              </span>
              <span className="text-lg font-black tabular-nums text-amber-600">
                {formatCurrency(pending)}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Amount (₹) *</Label>
              <Input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="bg-white border-slate-300 font-semibold"
              />
              {pending > 0 && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, amount: String(pending) })}
                  className="text-[10px] font-semibold text-[#3F63AD] hover:underline"
                >
                  Fill full pending {formatCurrency(pending)}
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Date *</Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="bg-white border-slate-300"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Payment Mode *</Label>
              <Select value={form.mode} onValueChange={(v) => setForm({ ...form, mode: v })}>
                <SelectTrigger className="bg-white border-slate-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Direction</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v as "received" | "paid" })}
              >
                <SelectTrigger className="bg-white border-slate-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="received">Received from vendor (In)</SelectItem>
                  <SelectItem value="paid">Refund to vendor (Out)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">
                Txn / Cheque / UTR Ref
              </Label>
              <Input
                value={form.refNo}
                onChange={(e) => setForm({ ...form, refNo: e.target.value })}
                className="bg-white border-slate-300"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Against Bill</Label>
              <Select
                value={form.againstBillNo || "none"}
                onValueChange={(v) => setForm({ ...form, againstBillNo: v })}
              >
                <SelectTrigger className="bg-white border-slate-300">
                  <SelectValue placeholder="On account" />
                </SelectTrigger>
                <SelectContent className="max-h-[220px]">
                  <SelectItem value="none">On account (no specific bill)</SelectItem>
                  {openBills.map((b: any) => (
                    <SelectItem key={b.billNo} value={b.billNo}>
                      {b.billNo} — {formatCurrency(b.total)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">Notes</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="bg-white border-slate-300"
            />
          </div>
        </div>

        <div className="bg-white px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Record Payment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
