"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AuthorizePinDialog, type PinAuthResult } from "@/components/AuthorizePinDialog";
import { useChangeRole, usePendingChanges } from "@/components/shared/pending-changes";
import { isBillBoundPayment } from "@/lib/payment-rules";
import { formatCurrency } from "@/lib/utils";
import { todayInIndia } from "@/lib/today";

const MODES = ["Cash", "UPI", "Bank Transfer", "Credit Card", "Debit Card", "Cheque", "Online"];

/**
 * Edit / delete buttons for one saved payment.
 *
 * Admin: the change is made as soon as the PIN and reason are given. Store Manager: it
 * is sent to the Admin and the payment stays exactly as it is until it is approved —
 * the row shows "Pending approval" meanwhile. Everyone else sees no buttons.
 * (The server enforces all of this; hiding buttons is only for convenience.)
 */
export function PaymentChangeControls({ payment, onChanged }: { payment: any; onChanged?: () => void }) {
  const { isManager, canChange } = useChangeRole();
  const pending = usePendingChanges();
  const queryClient = useQueryClient();

  const [stage, setStage] = useState<null | "edit" | "pin-edit" | "pin-delete">(null);
  const [form, setForm] = useState({ amount: "", paymentMode: "", date: "", notes: "" });
  const [error, setError] = useState<string | null>(null);

  const target = `payment:${payment._id}`;
  const isPending = pending.has(target);
  const billBound = isBillBoundPayment(payment);
  // A row built from an old bill (not a stored payment) has no payment record to change.
  const isRealPayment = !String(payment.transactionId || "").startsWith("TXN-LEGACY-");

  const close = () => {
    setStage(null);
    setError(null);
  };

  const mutation = useMutation({
    mutationFn: async ({ pin, reason }: PinAuthResult) => {
      const res =
        stage === "pin-delete"
          ? await fetch(`/api/payments?id=${payment._id}`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pin, reason }),
            })
          : await fetch("/api/payments", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: payment._id,
                pin,
                reason,
                changes: {
                  amount: Number(form.amount),
                  paymentMode: form.paymentMode,
                  date: form.date,
                  notes: form.notes,
                },
              }),
            });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || "Could not save the change");
      return json;
    },
    onSuccess: (json) => {
      toast.success(
        json.pending
          ? "Sent to the Admin for approval. The payment stays as it is until then."
          : stage === "pin-delete"
          ? "Payment deleted"
          : "Payment updated"
      );
      for (const key of ["payments", "supplier-payments", "customers", "suppliers", "invoices", "all-ledgers", "supplier-ledger-all", "purchase-entries", "pending-changes"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("erp-payment-created"));
        window.dispatchEvent(new CustomEvent("erp-customer-updated"));
      }
      close();
      onChanged?.();
    },
    onError: (e: any) => setError(e.message || "Could not save the change"),
  });

  if (!canChange || !isRealPayment) return null;

  if (isPending) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800"
        title="A change to this payment is waiting for the Admin's approval"
      >
        <Clock className="h-3 w-3" /> Pending approval
      </span>
    );
  }

  const startEdit = () => {
    setForm({
      amount: String(payment.amount ?? ""),
      paymentMode: payment.paymentMode || "Cash",
      date: String(payment.date || "").slice(0, 10) || todayInIndia(),
      notes: payment.notes || "",
    });
    setError(null);
    setStage("edit");
  };

  const modeOptions = MODES.includes(form.paymentMode) || !form.paymentMode ? MODES : [form.paymentMode, ...MODES];
  const who = isManager ? "The Admin will be asked to approve it; until then nothing changes." : "It is made as soon as you confirm, and recorded in the audit log.";

  return (
    <div className="inline-flex items-center gap-1">
      {!billBound && (
        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-[#3F63AD] hover:bg-blue-50" onClick={startEdit} title="Edit payment">
          <Pencil className="w-4 h-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
        onClick={() => {
          setError(null);
          setStage("pin-delete");
        }}
        title="Delete payment"
      >
        <Trash2 className="w-4 h-4" />
      </Button>

      <Dialog open={stage === "edit"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Edit payment — {payment.partyName}</DialogTitle>
            <DialogDescription>
              {payment.partyType === "Supplier" ? "Supplier balance and the bill it was paid against" : "Customer balance and the bill it was received against"} are
              adjusted to match. {who}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Amount (₹)</Label>
              <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1" />
              <p className="mt-1 text-[11px] text-muted-foreground">Now {formatCurrency(payment.amount)}{payment.referenceId ? ` · against ${payment.referenceId}` : ""}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Payment mode</Label>
                <Select value={form.paymentMode} onValueChange={(v) => setForm({ ...form, paymentMode: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {modeOptions.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" max={todayInIndia()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button
              className="bg-[#3F63AD] hover:bg-[#2E4F95]"
              disabled={!(Number(form.amount) > 0)}
              onClick={() => {
                setError(null);
                setStage("pin-edit");
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AuthorizePinDialog
        open={stage === "pin-edit" || stage === "pin-delete"}
        onOpenChange={(o) => !o && close()}
        onConfirm={(r) => mutation.mutate(r)}
        title={stage === "pin-delete" ? `Delete payment of ${formatCurrency(payment.amount)}` : "Confirm the change to this payment"}
        description={
          stage === "pin-delete"
            ? `The ${payment.partyType === "Supplier" ? "supplier's" : "customer's"} balance and the bill it was against go back to how they were. ${who}`
            : `The balance and the bill are adjusted to the new amount. ${who}`
        }
        confirmLabel={isManager ? "Send for approval" : stage === "pin-delete" ? "Delete Payment" : "Save Changes"}
        destructive={stage === "pin-delete"}
        isPending={mutation.isPending}
        errorMessage={error}
      />
    </div>
  );
}
