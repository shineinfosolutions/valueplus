"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Search, X, Plus } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

/**
 * The products a lead is interested in: any number of them, picked from the
 * product list or typed in by hand when the product is not in it. A lead is
 * only an enquiry — nothing here touches stock, sales or invoices.
 *
 * Saved in the same shape a lead made from an estimate already uses
 * ({ itemCode, name, quantity, rate, amount }), with `manual: true` on a
 * product typed in by hand.
 */

export interface LeadProduct {
  itemId?: string;
  itemCode?: string;
  name: string;
  quantity: number;
  rate: number;
  amount: number;
  manual?: boolean;
}

/** "A, B, C" — what the leads list shows as the interested product. */
export const leadProductsLabel = (items: LeadProduct[]) => items.map((p) => p.name).join(", ");
export const leadProductsTotal = (items: LeadProduct[]) => items.reduce((s, p) => s + (Number(p.amount) || 0), 0);

export function LeadProductPicker({ value, onChange }: { value: LeadProduct[]; onChange: (items: LeadProduct[]) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const { data: catalog = [] } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const res = await fetch("/api/items");
      const json = await res.json();
      return json.success ? json.data : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    const chosen = new Set(value.map((p) => p.itemId).filter(Boolean));
    return (catalog as any[])
      .filter((it) => !chosen.has(String(it._id)))
      .filter((it) => [it.name, it.code, it.vpCode, it.brand].some((v) => String(v || "").toLowerCase().includes(q)))
      .slice(0, 8);
  }, [catalog, q, value]);

  const add = (p: LeadProduct) => {
    onChange([...value, p]);
    setQuery("");
    setOpen(false);
  };

  const addFromCatalog = (it: any) => {
    const rate = Number(it.vsp || it.sellingPrice) || 0;
    add({ itemId: String(it._id), itemCode: it.vpCode || it.code || "", name: it.name, quantity: 1, rate, amount: rate });
  };

  const addTyped = () => {
    const name = query.trim();
    if (!name) return;
    if (value.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      setQuery("");
      return;
    }
    add({ name, quantity: 1, rate: 0, amount: 0, manual: true });
  };

  return (
    <div className="mt-1 space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((p, idx) => (
            <span
              key={`${p.itemId || p.name}-${idx}`}
              className={`inline-flex items-center gap-1 max-w-full rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                p.manual ? "bg-amber-50 text-amber-900 border-amber-200" : "bg-blue-50 text-blue-900 border-blue-200"
              }`}
              title={p.manual ? "Typed in — not in the product list" : p.itemCode || ""}
            >
              <span className="truncate max-w-[180px]">{p.name}</span>
              {p.rate > 0 && <span className="font-mono text-[10px] opacity-70">{formatCurrency(p.rate)}</span>}
              <button
                type="button"
                onClick={() => onChange(value.filter((_, i) => i !== idx))}
                className="rounded-full hover:bg-black/10 p-0.5"
                aria-label={`Remove ${p.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (matches.length > 0) addFromCatalog(matches[0]);
              else addTyped();
            }
          }}
          placeholder={value.length ? "Add another product…" : "Search product or type a name"}
          className="bg-white text-xs h-9 font-medium pl-8"
        />
        {open && q && (
          <div className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-56 overflow-y-auto">
            {matches.map((it: any) => (
              <button
                key={it._id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addFromCatalog(it)}
                className="w-full text-left px-3 py-2 hover:bg-blue-50 text-xs border-b border-slate-100 last:border-0"
              >
                <span className="block font-semibold text-slate-800 truncate">{it.name}</span>
                <span className="text-[10px] text-slate-400">
                  {it.brand || "—"} · {formatCurrency(Number(it.vsp || it.sellingPrice) || 0)} · stock {Number(it.currentStock) || 0}
                </span>
              </button>
            ))}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={addTyped}
              className="w-full text-left px-3 py-2 hover:bg-amber-50 text-xs font-semibold text-amber-800 flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Add &quot;{query.trim()}&quot; as typed (not in product list)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
