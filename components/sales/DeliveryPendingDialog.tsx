"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/**
 * Mark a bill's goods as not handed over yet — kept aside till a later date
 * (e.g. the customer takes delivery in December). The sale, payment and stock
 * are untouched: the goods are sold and off stock. The bill moves to Order
 * Dispatch as pending, and a reminder reaches the bell two days before.
 */
export function DeliveryPendingDialog({ invoice, onOpenChange }: { invoice: any | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (invoice) {
      setDate(invoice.expectedDeliveryDate || "");
      setNote(invoice.deliveryNote || "");
    }
  }, [invoice]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/invoices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: invoice.invoiceNumber,
          action: "mark-delivery-pending",
          expectedDeliveryDate: date,
          deliveryNote: note,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not save the delivery date");
      return json;
    },
    onSuccess: (json) => {
      toast.success(json.message || "Delivery marked pending");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={!!invoice} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>🚚 Delivery pending — {invoice?.invoiceNumber}</DialogTitle>
          <DialogDescription>
            {invoice?.customerName}. The goods stay sold and off stock, kept aside for this customer. The bill moves to Order
            Dispatch as pending, and a reminder comes 2 days before the date.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Expected delivery date *</Label>
            <Input type="date" value={date} min={String(invoice?.date || "").slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Customer will take it after the house is ready" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!date || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving..." : "Mark delivery pending"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
