"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { lineIncentive, ruleText, type IncentiveRule } from "@/lib/incentive-rules";

/**
 * Edits a product's list of salesman incentive rules. A product may have any number of rules — for example
 * "₹500 per piece" and "2%" together — and every running rule adds to the incentive (lib/incentive-rules.ts).
 * Values are kept as typed (strings allowed) and cleaned by the server.
 */

export type EditableRule = Omit<IncentiveRule, "value" | "minPrice"> & { value: number | string; minPrice?: number | string };

export const blankRule = (type: "fixed" | "percentage" = "fixed"): EditableRule => ({
  type,
  value: "",
  minPrice: "",
  label: "",
  startDate: "",
  endDate: "",
  active: true,
});

interface Props {
  rules: EditableRule[];
  onChange: (rules: EditableRule[]) => void;
  /** The product's selling price (GST-inclusive), for the "earns at selling price" preview. */
  sellingPrice?: number;
  gstRate?: number;
}

export function IncentiveRulesEditor({ rules, onChange, sellingPrice = 0, gstRate = 18 }: Props) {
  const set = (idx: number, patch: Partial<EditableRule>) =>
    onChange(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const remove = (idx: number) => onChange(rules.filter((_, i) => i !== idx));

  const usable = rules
    .map((r) => ({ ...r, value: Number(r.value) || 0, minPrice: Number(r.minPrice) || 0 }))
    .filter((r) => r.value > 0) as IncentiveRule[];
  const atSelling = sellingPrice > 0 ? lineIncentive(usable, { rate: sellingPrice, qty: 1, gstRate }) : 0;

  return (
    <div className="space-y-3">
      {rules.length === 0 && (
        <p className="text-xs text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-3 text-center">
          No incentive on this product. Add a ₹ or % rule below.
        </p>
      )}

      {rules.map((r, idx) => (
        <div key={idx} className={cn("rounded-lg border p-3 space-y-3", r.active === false ? "bg-slate-50 border-slate-200 opacity-70" : "bg-white border-slate-300")}>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-slate-300 overflow-hidden text-[11px] font-bold">
              {(["fixed", "percentage"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set(idx, { type: t })}
                  className={cn("px-2.5 py-1.5", r.type === t ? "bg-[#3F63AD] text-white" : "bg-white text-slate-600")}
                >
                  {t === "fixed" ? "₹ per piece" : "% of taxable"}
                </button>
              ))}
            </div>
            <Input
              placeholder="Label (optional), e.g. Brand scheme"
              value={r.label || ""}
              onChange={(e) => set(idx, { label: e.target.value })}
              className="h-8 text-xs flex-1 min-w-0"
            />
            <div className="flex items-center gap-1.5 shrink-0" title="Rule on / off">
              <Switch checked={r.active !== false} onCheckedChange={(v: boolean) => set(idx, { active: v })} />
            </div>
            <button type="button" onClick={() => remove(idx)} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded shrink-0" aria-label="Remove rule">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-slate-600">{r.type === "percentage" ? "Incentive %" : "Incentive ₹ / piece"} *</Label>
              <Input
                type="number"
                min={0}
                placeholder={r.type === "percentage" ? "e.g. 2" : "e.g. 500"}
                value={r.value}
                onChange={(e) => set(idx, { value: e.target.value })}
                className="h-8 text-xs font-semibold"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-slate-600">Min. selling price ₹</Label>
              <Input
                type="number"
                min={0}
                placeholder="Any price"
                value={r.minPrice ?? ""}
                onChange={(e) => set(idx, { minPrice: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-slate-600">From</Label>
              <Input type="date" value={r.startDate || ""} onChange={(e) => set(idx, { startDate: e.target.value })} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-slate-600">To</Label>
              <Input type="date" value={r.endDate || ""} onChange={(e) => set(idx, { endDate: e.target.value })} className="h-8 text-xs" />
            </div>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange([...rules, blankRule("fixed")])}
          className="inline-flex items-center gap-1 text-xs font-bold text-[#3F63AD] border border-[#3F63AD]/40 rounded-lg px-3 py-1.5 hover:bg-blue-50"
        >
          <Plus className="w-3.5 h-3.5" /> Add ₹ rule
        </button>
        <button
          type="button"
          onClick={() => onChange([...rules, blankRule("percentage")])}
          className="inline-flex items-center gap-1 text-xs font-bold text-[#3F63AD] border border-[#3F63AD]/40 rounded-lg px-3 py-1.5 hover:bg-blue-50"
        >
          <Plus className="w-3.5 h-3.5" /> Add % rule
        </button>
      </div>

      {usable.length > 0 && (
        <p className="text-[11px] text-slate-600 leading-relaxed bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          All running rules add up: <b>{usable.map(ruleText).join(" + ")}</b>
          {sellingPrice > 0 && (
            <>
              {" "}· at the selling price of ₹{sellingPrice.toLocaleString("en-IN")} the salesman earns{" "}
              <b>₹{atSelling.toLocaleString("en-IN")}</b> per piece.
            </>
          )}
        </p>
      )}
    </div>
  );
}
