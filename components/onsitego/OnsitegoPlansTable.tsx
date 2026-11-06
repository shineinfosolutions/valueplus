"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ONSITEGO_INCENTIVE_RATE, slabLabel, type OnsitegoPlanRow } from "@/lib/onsitego";

/**
 * Every plan of the Onsite Go price list, one row each, grouped by the price list's own sections (Air Conditioner,
 * Television, Refrigerator / Washing Machine ...). Used on the Admin's "Onsite Go" page and in the salesman's
 * Incentive Plan, so both show the same list. Columns: plan, years, the product price it is for, VP Code, the price
 * the customer pays, and what the salesman earns on it (10%).
 */
export function OnsitegoPlansTable({ plans, maxHeightClass = "" }: { plans: OnsitegoPlanRow[]; maxHeightClass?: string }) {
  const [search, setSearch] = useState("");
  const [section, setSection] = useState("all");

  const sections = useMemo(() => Array.from(new Set(plans.map((p) => p.category || "Other"))).sort(), [plans]);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const shown = plans
      .filter((p) => section === "all" || (p.category || "Other") === section)
      .filter((p) => !q || `${p.planName} ${p.vpCode} ${p.category} ${p.device} ${p.kind}`.toLowerCase().includes(q))
      .sort((a, b) => a.device.localeCompare(b.device) || a.kind.localeCompare(b.kind) || a.years - b.years || a.minPrice - b.minPrice);
    const map = new Map<string, OnsitegoPlanRow[]>();
    for (const p of shown) map.set(p.category || "Other", [...(map.get(p.category || "Other") || []), p]);
    return { count: shown.length, groups: [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])) };
  }, [plans, search, section]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search plan, VP code" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 text-sm" />
        </div>
        <select
          value={section}
          onChange={(e) => setSection(e.target.value)}
          aria-label="Plan section"
          className="h-9 max-w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700"
        >
          <option value="all">All sections ({plans.length})</option>
          {sections.map((s) => (
            <option key={s} value={s}>
              {s} ({plans.filter((p) => (p.category || "Other") === s).length})
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-400 ml-auto">{grouped.count} plans</span>
      </div>

      <div className={`overflow-auto rounded-xl border border-slate-200 ${maxHeightClass}`}>
        <table className="w-full min-w-[640px] text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Plan</th>
              <th className="px-2 py-2 text-center">Years</th>
              <th className="px-2 py-2 text-left">For product price</th>
              <th className="px-2 py-2 text-left">VP Code</th>
              <th className="px-2 py-2 text-right">Customer price</th>
              <th className="px-3 py-2 text-right">You earn ({Math.round(ONSITEGO_INCENTIVE_RATE * 100)}%)</th>
            </tr>
          </thead>
          <tbody>
            {grouped.count === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  {plans.length === 0 ? "No Onsite Go plans have been uploaded yet." : "No plan matches."}
                </td>
              </tr>
            )}
            {grouped.groups.map(([name, rows]) => (
              <SectionRows key={name} name={name} rows={rows} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** ₹5,999 / ₹599.90: whole rupees plain, a part-rupee always with two decimals. */
const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

function SectionRows({ name, rows }: { name: string; rows: OnsitegoPlanRow[] }) {
  return (
    <>
      <tr className="bg-emerald-50">
        <td colSpan={6} className="px-3 py-1.5 text-[11px] font-black text-emerald-900">
          {name} <span className="font-semibold text-emerald-700">· {rows.length} plans</span>
        </td>
      </tr>
      {rows.map((p) => (
        <tr key={`${p.vpCode}-${p.planName}`} className="border-t border-slate-100 hover:bg-slate-50">
          <td className="px-3 py-1.5 font-semibold text-slate-800">{p.planName}</td>
          <td className="px-2 py-1.5 text-center font-mono">{p.years}</td>
          <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">{slabLabel(p)}</td>
          <td className="px-2 py-1.5 font-mono font-bold text-[#30539C] whitespace-nowrap">{p.vpCode}</td>
          <td className="px-2 py-1.5 text-right font-mono font-bold text-slate-900">{rupees(p.price)}</td>
          <td className="px-3 py-1.5 text-right font-mono font-black text-emerald-700">{rupees(Math.round(p.price * ONSITEGO_INCENTIVE_RATE * 100) / 100)}</td>
        </tr>
      ))}
    </>
  );
}
