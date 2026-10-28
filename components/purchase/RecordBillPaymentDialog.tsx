"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { todayInIndia } from "@/lib/today";

/**
 * Pay a supplier against one purchase bill — the whole balance or part of it.
 * The payment goes through the same payments API as Supplier Payments, with the
 * bill number as its reference, so the bill's paid / balance / status, the
 * supplier's balance and the supplier ledger all move together.
 */

const MODES = ["Cash", "UPI", "NEFT", "RTGS", "IMPS", "Cheque", "Card"];
const today = () => todayInIndia();

export function RecordBillPaymentDialog({
  bill,
  onOpenChange,
}: {
  bill: any | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const due = Math.max(0, Math.round((Number(bill?.balance) || 0) * 100) / 100);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("NEFT");
  const [date, setDate] = useState(today());
  const [txnRef, setTxnRef] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (bill) {
      setAmount(String(due));
      setMode("NEFT");
      setDate(today());
      setTxnRef("");
      setNotes("");
    }
  }, [bill, due]);

  const pay = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: `TXN-${Date.now()}`,
          partyType: "Supplier",
          partyId: bill.supplierId ? String(bill.supplierId) : undefined,
          partyName: bill.supplierName,
          amount: Number(amount),
          paymentMode: mode,
          date,
          referenceId: bill.billNo,
          bankTxnRef: txnRef.trim(),
          notes: notes.trim() || `Payment against bill ${bill.billNo}`,
          type: "paid",
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not record the payment");
      return json;
    },
    onSuccess: (json) => {
      const left = Number(json.bill?.balance) || 0;
      toast.success(left > 0 ? `Payment recorded. ${formatCurrency(left)} is still due on ${bill.billNo}.` : `${bill.billNo} is now fully paid.`);
      queryClient.invalidateQueries({ queryKey: ["purchase-entries"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-payments"] });
      queryClient.invalidateQueries({ queryKey: ["all-ledgers"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const value = Number(amount) || 0;
  const invalid = !(value > 0) || value > due + 0.001;

  return (
    <Dialog open={!!bill} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment — {bill?.billNo}</DialogTitle>
          <DialogDescription>
            {bill?.supplierName}. Bill {formatCurrency(Number(bill?.total) || 0)}, paid {formatCurrency(Number(bill?.paid) || 0)},{" "}
            <span className="font-bold text-rose-600">due {formatCurrency(due)}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Amount paid now (₹)</Label>
            <Input type="number" min={0} max={due} value={amount} onChange={(e) => setAmount(e.target.value)} className="font-bold" />
            <p className="text-[11px] text-slate-500">
              {value > due + 0.001
                ? `More than the ${formatCurrency(due)} due.`
                : value > 0 && value < due
                ? `Part payment — ${formatCurrency(Math.round((due - value) * 100) / 100)} will still be due.`
                : "Pays the bill in full."}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">UTR / Cheque no. (optional)</Label>
            <Input value={txnRef} onChange={(e) => setTxnRef(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={invalid || pay.isPending} onClick={() => pay.mutate()}>
            {pay.isPending ? "Saving..." : `Record ${formatCurrency(value)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
