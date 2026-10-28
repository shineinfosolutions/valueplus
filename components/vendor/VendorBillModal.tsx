"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Receipt, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { todayInIndia } from "@/lib/today";

interface LineItem {
  name: string;
  quantity: string;
  rate: string;
}

const EMPTY_ITEM: LineItem = { name: "", quantity: "1", rate: "" };

export function VendorBillModal({
  open,
  onOpenChange,
  vendorId,
  vendors = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId?: string;
  vendors?: any[];
}) {
  const queryClient = useQueryClient();
  const [selectedVendor, setSelectedVendor] = useState(vendorId || "");
  const [date, setDate] = useState(todayInIndia());
  const [dueDate, setDueDate] = useState("");
  const [gstRate, setGstRate] = useState("18");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([{ ...EMPTY_ITEM }]);

  useEffect(() => {
    if (!open) return;
    setSelectedVendor(vendorId || "");
    setDate(todayInIndia());
    setDueDate("");
    setGstRate("18");
    setReference("");
    setNotes("");
    setItems([{ ...EMPTY_ITEM }]);
  }, [open, vendorId]);

  const totals = useMemo(() => {
    const subtotal = items.reduce(
      (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.rate) || 0),
      0
    );
    const gstAmount = (subtotal * (Number(gstRate) || 0)) / 100;
    return { subtotal, gstAmount, total: subtotal + gstAmount };
  }, [items, gstRate]);

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/vendors/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: selectedVendor,
          date,
          dueDate: dueDate || undefined,
          gstRate: Number(gstRate) || 0,
          reference: reference.trim(),
          notes: notes.trim(),
          items: items
            .filter((it) => it.name.trim())
            .map((it) => ({
              name: it.name.trim(),
              quantity: Number(it.quantity) || 1,
              rate: Number(it.rate) || 0,
              amount: (Number(it.quantity) || 1) * (Number(it.rate) || 0),
            })),
          subtotal: totals.subtotal,
          gstAmount: totals.gstAmount,
          total: totals.total,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not create the bill");
      return json.data;
    },
    onSuccess: (bill: any) => {
      toast.success(`Bill ${bill.billNo} created`);
      queryClient.invalidateQueries({ queryKey: ["vendor-bills"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["party-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-ledger-all"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!selectedVendor) return toast.error("Select a vendor");
    if (!(totals.total > 0)) return toast.error("Add at least one line with an amount");
    create.mutate();
  };

  const updateItem = (idx: number, patch: Partial<LineItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 rounded-2xl border-none shadow-2xl overflow-y-auto">
        <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-5 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
            <Receipt className="w-5 h-5 text-[#76C043]" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight">Raise Vendor Bill</h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Adds to what this vendor owes — the debit side of their ledger
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4 bg-slate-50/50 max-h-[62vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            {!vendorId && (
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs font-semibold text-slate-700">Vendor *</Label>
                <Select value={selectedVendor} onValueChange={setSelectedVendor}>
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
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Bill Date *</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-white border-slate-300"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Due Date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="bg-white border-slate-300"
              />
              <p className="text-[10px] text-slate-400">Left blank uses the vendor&apos;s credit days</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Line Items</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Line
              </Button>
            </div>

            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-6 space-y-1">
                  <Label className="text-[10px] text-slate-500">Description</Label>
                  <Input
                    placeholder="Item / service"
                    value={item.name}
                    onChange={(e) => updateItem(idx, { name: e.target.value })}
                    className="bg-slate-50 border-slate-300 h-9"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-[10px] text-slate-500">Qty</Label>
                  <Input
                    type="number"
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                    className="bg-slate-50 border-slate-300 h-9"
                  />
                </div>
                <div className="col-span-3 space-y-1">
                  <Label className="text-[10px] text-slate-500">Rate (₹)</Label>
                  <Input
                    type="number"
                    value={item.rate}
                    onChange={(e) => updateItem(idx, { rate: e.target.value })}
                    className="bg-slate-50 border-slate-300 h-9"
                  />
                </div>
                <div className="col-span-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-red-500 hover:bg-red-50"
                    disabled={items.length === 1}
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">GST Rate (%)</Label>
              <Input
                type="number"
                value={gstRate}
                onChange={(e) => setGstRate(e.target.value)}
                className="bg-white border-slate-300"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Reference</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="bg-white border-slate-300"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">Notes</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-white border-slate-300"
            />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-1.5">
            <Row label="Subtotal" value={formatCurrency(totals.subtotal)} />
            <Row label={`GST @ ${gstRate || 0}%`} value={formatCurrency(totals.gstAmount)} />
            <div className="pt-2 border-t border-slate-200">
              <Row label="Bill Total" value={formatCurrency(totals.total)} bold />
            </div>
          </div>
        </div>

        <div className="bg-white px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Create Bill"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? "text-sm font-bold text-slate-800" : "text-xs text-slate-500"}>
        {label}
      </span>
      <span
        className={
          bold
            ? "text-lg font-black tabular-nums text-slate-900"
            : "text-xs font-semibold tabular-nums text-slate-700"
        }
      >
        {value}
      </span>
    </div>
  );
}
