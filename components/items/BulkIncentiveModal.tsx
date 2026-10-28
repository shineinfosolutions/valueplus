"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gift, Eye, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, cn } from "@/lib/utils";

/**
 * Set one incentive rule across every item in a category (and optionally a
 * brand), instead of opening each product one at a time.
 *
 * A category is required — applying to the entire catalog in one shot would be
 * too easy to do by accident, so the API refuses a request with no filter and
 * this form never offers an "all categories" option.
 */

export function BulkIncentiveModal({
  open,
  onOpenChange,
  categories = [],
  brands = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories?: any[];
  brands?: any[];
}) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("all");
  const [incentiveType, setIncentiveType] = useState<"fixed" | "percentage">("fixed");
  const [value, setValue] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [preview, setPreview] = useState<{ matched: number; sample: any[] } | null>(null);

  const reset = () => {
    setCategory("");
    setBrand("all");
    setIncentiveType("fixed");
    setValue("");
    setTargetAmount("");
    setPreview(null);
  };

  const buildBody = (dryRun: boolean) => ({
    category,
    brand,
    incentiveType,
    incentiveValue: Number(value) || 0,
    incentiveTargetAmount: Number(targetAmount) || 0,
    dryRun,
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/items/bulk-incentive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(true)),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not preview");
      return json;
    },
    onSuccess: (json) => setPreview({ matched: json.matched, sample: json.sample || [] }),
    onError: (e: any) => toast.error(e.message),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/items/bulk-incentive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(false)),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not apply");
      return json;
    },
    onSuccess: (json) => {
      toast.success(`Incentive rule applied to ${json.modified} product(s)`);
      queryClient.invalidateQueries({ queryKey: ["items"] });
      reset();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handlePreview = () => {
    if (!category) return toast.error("Choose a category first");
    if (!(Number(value) > 0)) return toast.error("Enter a reward value greater than zero");
    previewMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg p-0 rounded-2xl border-none shadow-2xl overflow-y-auto">
        <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-5 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
            <Gift className="w-5 h-5 text-[#76C043]" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight">Bulk Apply Incentive</h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Set one incentive rule across a whole category at once
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4 bg-slate-50/50 max-h-[65vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Category *</Label>
              <Select value={category} onValueChange={(v) => { setCategory(v); setPreview(null); }}>
                <SelectTrigger className="bg-white border-slate-300">
                  <SelectValue placeholder="Select category…" />
                </SelectTrigger>
                <SelectContent className="max-h-[240px]">
                  {categories.map((c: any) => (
                    <SelectItem key={c._id || c.name} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Brand (optional)</Label>
              <Select value={brand} onValueChange={(v) => { setBrand(v); setPreview(null); }}>
                <SelectTrigger className="bg-white border-slate-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[240px]">
                  <SelectItem value="all">Every brand</SelectItem>
                  {brands.map((b: any) => (
                    <SelectItem key={b._id || b.name} value={b.name}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setIncentiveType("fixed"); setPreview(null); }}
                className={cn(
                  "flex-1 py-2 rounded-lg text-xs font-bold border transition-colors",
                  incentiveType === "fixed"
                    ? "bg-[#3F63AD] text-white border-[#3F63AD]"
                    : "bg-white text-slate-600 border-slate-300"
                )}
              >
                Fixed ₹ per unit
              </button>
              <button
                type="button"
                onClick={() => { setIncentiveType("percentage"); setPreview(null); }}
                className={cn(
                  "flex-1 py-2 rounded-lg text-xs font-bold border transition-colors",
                  incentiveType === "percentage"
                    ? "bg-[#3F63AD] text-white border-[#3F63AD]"
                    : "bg-white text-slate-600 border-slate-300"
                )}
              >
                Percentage %
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Reward {incentiveType === "percentage" ? "(%)" : "(₹)"} *
                </Label>
                <Input
                  type="number"
                  placeholder={incentiveType === "percentage" ? "1.5" : "500"}
                  value={value}
                  onChange={(e) => { setValue(e.target.value); setPreview(null); }}
                  className="bg-slate-50 border-slate-300 font-semibold"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Target Price (₹)</Label>
                <Input
                  type="number"
                  placeholder="Optional"
                  value={targetAmount}
                  onChange={(e) => { setTargetAmount(e.target.value); setPreview(null); }}
                  className="bg-slate-50 border-slate-300"
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Leave Target Price blank to reward every sale of a matching product, whatever the
              rate. Set it to reward only sales at or above that price.
            </p>
          </div>

          {preview && (
            <div
              className={cn(
                "rounded-xl border p-4",
                preview.matched > 0
                  ? "bg-emerald-50 border-emerald-200"
                  : "bg-amber-50 border-amber-200"
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                {preview.matched > 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                )}
                <p className="text-sm font-bold text-slate-800">
                  {preview.matched} product{preview.matched === 1 ? "" : "s"} will be updated
                </p>
              </div>
              {preview.sample.length > 0 && (
                <ul className="text-xs text-slate-600 space-y-1 pl-1">
                  {preview.sample.map((it: any) => (
                    <li key={it.code} className="flex items-center justify-between">
                      <span className="truncate max-w-[240px]">{it.name}</span>
                      <span className="font-mono text-slate-400">{formatCurrency(it.sellingPrice)}</span>
                    </li>
                  ))}
                  {preview.matched > preview.sample.length && (
                    <li className="text-slate-400">
                      + {preview.matched - preview.sample.length} more…
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="bg-white px-5 py-4 border-t border-slate-200 flex items-center justify-between gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handlePreview} disabled={previewMutation.isPending}>
              <Eye className="w-3.5 h-3.5 mr-1.5" />
              {previewMutation.isPending ? "Checking…" : "Preview"}
            </Button>
            <Button
              onClick={() => applyMutation.mutate()}
              disabled={!preview || preview.matched === 0 || applyMutation.isPending}
            >
              {applyMutation.isPending
                ? "Applying…"
                : preview
                ? `Apply to ${preview.matched}`
                : "Apply"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
