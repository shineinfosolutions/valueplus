"use client";

import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrandSelect } from "@/components/shared/brand-select";

interface QuickAddItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialName?: string;
  onCreated: (item: any) => void;
  /** Company the new product belongs to — the one chosen on the form it is added from. */
  billingEntity?: "valueplus" | "ashoka" | "";
}

export function QuickAddItemModal({ isOpen, onClose, initialName = "", onCreated, billingEntity }: QuickAddItemModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: initialName,
    category: "",
    brand: "",
    unit: "PCS",
    hsn: "",
    gstRate: "18",
    purchasePrice: "",
    sellingPrice: "",
    mrp: "",
    openingStock: "0",
  });

  useEffect(() => {
    if (isOpen) {
      setForm((f) => ({ ...f, name: initialName }));
    }
  }, [isOpen, initialName]);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(billingEntity ? { ...payload, billingEntity } : payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to create item");
      return json.data;
    },
    onSuccess: (newItem) => {
      toast.success(`Product "${newItem.name}" created`);
      queryClient.invalidateQueries({ queryKey: ["items"] });
      onCreated(newItem);
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create item");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Product name is mandatory.");
      return;
    }
    if (!form.purchasePrice || !form.sellingPrice || !form.mrp) {
      toast.error("Purchase Price, Selling Price and MRP are mandatory.");
      return;
    }
    if (!form.category || !form.brand) {
      toast.error("Please select a Category and Brand.");
      return;
    }

    createMutation.mutate({
      code: `ITM-${Date.now().toString().slice(-8)}`,
      name: form.name.trim(),
      category: form.category,
      brand: form.brand,
      unit: form.unit || "PCS",
      hsnCode: form.hsn || "8528",
      gstRate: Number(form.gstRate) || 18,
      purchasePrice: Number(form.purchasePrice),
      sellingPrice: Number(form.sellingPrice),
      mrp: Number(form.mrp),
      openingStock: Number(form.openingStock) || 0,
      currentStock: Number(form.openingStock) || 0,
      status: "active",
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#3F63AD]" /> Quick Add New Product
          </DialogTitle>
          <DialogDescription>
            Create a minimal product record now — full details (categories, warranty plans, serials) can be filled in later from Masters &gt; Items.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-800">Product Name *</Label>
            <Input
              autoFocus
              placeholder="e.g. Samsung Galaxy M14 5G"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="font-semibold"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Category *</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue placeholder="Select category..." /></SelectTrigger>
                <SelectContent>
                  {categories.map((c: any) => (
                    <SelectItem key={c._id || c.id || c.name} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Brand *</Label>
              <BrandSelect
                value={form.brand}
                onValueChange={(v) => setForm({ ...form, brand: v })}
                placeholder="Select brand..."
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Unit</Label>
              <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">HSN Code</Label>
              <Input value={form.hsn} onChange={(e) => setForm({ ...form, hsn: e.target.value })} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">GST %</Label>
              <Input type="number" value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Purchase Price (₹) *</Label>
              <Input type="number" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Selling Price (₹) *</Label>
              <Input type="number" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} className="font-semibold text-[#3F63AD]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">MRP (₹) *</Label>
              <Input type="number" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} />
            </div>
          </div>

          <div className="space-y-1.5 w-1/3">
            <Label className="text-xs font-semibold text-slate-700">Opening Stock</Label>
            <Input type="number" value={form.openingStock} onChange={(e) => setForm({ ...form, openingStock: e.target.value })} />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending} className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white font-bold">
              {createMutation.isPending ? "Creating..." : "Create & Select"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
