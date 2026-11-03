"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/utils";

/**
 * Own-brand sales against other brands.
 * - `staffId` given (Admin / Store Manager, in the Staff Directory): pieces and amounts, other brands by name.
 * - no `staffId` (the salesman's own panel): pieces only.
 */
export function BrandSalesCard({ staffId }: { staffId?: string }) {
  const [range, setRange] = useState<"month" | "all">("month");
  const withAmount = !!staffId;
  const { data } = useQuery({
    queryKey: ["brand-sales", staffId || "me", range],
    queryFn: async () => {
      const json = await (await fetch(`/api/staff/brand-sales?range=${range}${staffId ? `&id=${staffId}` : ""}`)).json();
      return json.success ? json.data : null;
    },
  });

  const brand = data?.assignedBrand || "";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-wider text-slate-600">Brand sales{brand ? ` - ${brand}` : ""}</p>
        <div className="flex gap-1">
          {(["month", "all"] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)} className={`rounded-md px-2.5 py-1 text-[11px] font-bold ${range === r ? "bg-[#30539C] text-white" : "bg-slate-100 text-slate-600"}`}>
              {r === "month" ? "This month" : "All time"}
            </button>
          ))}
        </div>
      </div>
      {!data ? (
        <p className="py-3 text-xs text-slate-400">Loading...</p>
      ) : (
        <>
          {!brand && <p className="mt-1 text-[11px] text-amber-700">No brand is assigned to this person, so every sale counts under "other brands".</p>}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5">
              <p className="text-[10px] font-bold uppercase text-slate-500">{brand ? `Own brand (${brand})` : "Own brand"}</p>
              <p className="text-xl font-black text-emerald-800">{data.own.quantity} <span className="text-xs font-bold">pcs</span></p>
              {withAmount && <p className="font-mono text-xs font-bold text-emerald-800">{formatCurrency(data.own.amount)}</p>}
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5">
              <p className="text-[10px] font-bold uppercase text-slate-500">Other brands</p>
              <p className="text-xl font-black text-amber-800">{data.other.quantity} <span className="text-xs font-bold">pcs</span></p>
              {withAmount && <p className="font-mono text-xs font-bold text-amber-800">{formatCurrency(data.other.amount)}</p>}
            </div>
          </div>
          {data.otherBrands.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase text-slate-500">
                  <tr><th className="py-1">Other brand</th><th className="text-right">Pcs</th>{withAmount && <th className="text-right">Amount</th>}</tr>
                </thead>
                <tbody>
                  {data.otherBrands.map((r: any) => (
                    <tr key={r.brand} className="border-t border-slate-100">
                      <td className="py-1 font-semibold">{r.brand}</td>
                      <td className="text-right">{r.quantity}</td>
                      {withAmount && <td className="text-right font-mono">{formatCurrency(r.amount)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
