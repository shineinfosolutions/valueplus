"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gift, ChevronRight, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ruleText, type IncentiveRule } from "@/lib/incentive-rules";

interface PlanRow {
  _id: string;
  name: string;
  code: string;
  brand: string;
  category: string;
  sellingPrice: number;
  inStock: boolean;
  rules: IncentiveRule[];
  atSellingPrice: number;
  /** The price the rules pay best at (the selling price, or a rule's higher minimum price) and what it pays. */
  bestPrice: number;
  atBestPrice: number;
  percentOfPrice: number;
}

const shortDate = (d?: string) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";

/**
 * "Incentive Plan" tile on the salesman's dashboard. Tapping it lists every product with an incentive running today:
 * its rules (₹ per piece and/or %, minimum price, last date) and what one piece earns at the selling price.
 */
export function IncentivePlanCard() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("all");
  const [sort, setSort] = useState<"amount" | "percent">("amount");
  const [inStockOnly, setInStockOnly] = useState(false);

  const { data: rows = [], isLoading } = useQuery<PlanRow[]>({
    queryKey: ["incentive-plan"],
    meta: { live: ["/api/items"] },
    queryFn: async () => {
      const json = await (await fetch("/api/items/incentive-plan")).json();
      return json.success ? json.data : [];
    },
  });

  const brands = useMemo(() => Array.from(new Set(rows.map((r) => r.brand).filter(Boolean))).sort(), [rows]);
  const best = rows.reduce((m, r) => Math.max(m, r.atBestPrice), 0);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => brand === "all" || r.brand === brand)
      .filter((r) => !inStockOnly || r.inStock)
      .filter((r) => !q || `${r.name} ${r.code} ${r.brand} ${r.category}`.toLowerCase().includes(q))
      .sort((a, b) => (sort === "amount" ? b.atBestPrice - a.atBestPrice : b.percentOfPrice - a.percentOfPrice));
  }, [rows, search, brand, sort, inStockOnly]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left bg-white rounded-2xl p-3 border border-emerald-200 shadow-sm hover:bg-emerald-50/50 transition-colors"
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
            <Gift className="w-3.5 h-3.5 text-emerald-600" /> Incentive Plan
          </p>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase">Products</p>
            <p className="text-lg font-black text-slate-800">{rows.length}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase">Best per piece</p>
            <p className="text-lg font-black text-emerald-700">{formatCurrency(best)}</p>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">Tap to see what each product pays you</p>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-emerald-600" /> Incentive Plan
            </DialogTitle>
            <DialogDescription>
              Every running incentive, product-wise. All rules on a product add up; the amount is for one piece sold at
              the selling price, or at the minimum price a rule asks for when that is higher.
            </DialogDescription>
          </DialogHeader>

          <div className="px-4 space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search product, VP code, brand"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="h-8 rounded-md border border-slate-300 bg-white px-2 font-semibold text-slate-700"
              >
                <option value="all">All brands</option>
                {brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <div className="flex rounded-md border border-slate-300 overflow-hidden font-bold">
                {(
                  [
                    ["amount", "Highest ₹"],
                    ["percent", "Highest %"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSort(k)}
                    className={cn("px-2.5 py-1.5", sort === k ? "bg-emerald-600 text-white" : "bg-white text-slate-600")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
                <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
                In stock only
              </label>
              <span className="ml-auto text-slate-400">{shown.length} products</span>
            </div>
          </div>

          <div className="overflow-y-auto px-4 pb-4 pt-2 space-y-2">
            {isLoading && <p className="text-sm text-slate-500 py-6 text-center">Loading…</p>}
            {!isLoading && shown.length === 0 && (
              <p className="text-sm text-slate-500 py-6 text-center">No product with a running incentive matches.</p>
            )}
            {shown.map((r) => (
              <div key={r._id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-slate-800 leading-snug">{r.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {[r.code, r.brand, r.category].filter(Boolean).join(" · ")}
                      {!r.inStock && <span className="ml-1 text-rose-500 font-semibold">· out of stock</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-black text-emerald-700">{formatCurrency(r.atBestPrice)}</p>
                    <p className="text-[10px] text-slate-500">
                      per pc at {formatCurrency(r.bestPrice)}
                      {r.bestPrice > r.sellingPrice ? " (above selling price)" : ""}
                      {r.percentOfPrice > 0 ? ` · ${r.percentOfPrice}%` : ""}
                    </p>
                    {r.bestPrice > r.sellingPrice && (
                      <p className="text-[10px] text-amber-700">at {formatCurrency(r.sellingPrice)}: {formatCurrency(r.atSellingPrice)}</p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.rules.map((rule, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5"
                    >
                      {ruleText(rule)}
                      {rule.label ? <span className="text-emerald-600 font-normal">· {rule.label}</span> : null}
                      {(rule.minPrice || 0) > 0 ? (
                        <span className="text-amber-700 font-normal">· at ₹{(rule.minPrice || 0).toLocaleString("en-IN")}+</span>
                      ) : null}
                      {rule.endDate ? <span className="text-slate-500 font-normal">· till {shortDate(rule.endDate)}</span> : null}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
