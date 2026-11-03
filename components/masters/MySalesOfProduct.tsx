"use client";

import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";

/** For staff who do not see the purchase side: only their own sales of this product (date and units on each bill). */
export function MySalesOfProduct({ code, vpCode, name, unit }: { code?: string; vpCode?: string; name?: string; unit?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["my-sales-of-product", code, vpCode, name],
    queryFn: async () => {
      const qs = new URLSearchParams({ code: code || "", vp: vpCode || "", name: name || "" });
      const json = await (await fetch(`/api/items/my-sales?${qs}`)).json();
      if (!json.success) throw new Error(json.error);
      return json.data as { rows: { date: string; invoiceNumber: string; quantity: number }[]; totalUnits: number; bills: number };
    },
  });
  return (
    <div className="col-span-2 flex flex-col p-4 md:p-5">
      <h4 className="mb-3 flex items-center gap-2 border-b pb-2 text-sm font-bold text-slate-700">
        <TrendingUp className="h-4 w-4 text-[#3F63AD]" /> Your sales of this product
      </h4>
      {isLoading ? (
        <p className="text-xs text-slate-500">Loading...</p>
      ) : !data || data.rows.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-500">You have not sold this product yet.</p>
      ) : (
        <>
          <p className="mb-2 text-xs font-semibold text-slate-600">
            {data.totalUnits} {unit || "unit"}{data.totalUnits === 1 ? "" : "s"} sold on {data.bills} bill{data.bills === 1 ? "" : "s"}
          </p>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                <tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Bill</th><th className="px-3 py-2 text-right">Units</th></tr>
              </thead>
              <tbody className="divide-y">
                {data.rows.map((r) => (
                  <tr key={r.invoiceNumber}>
                    <td className="px-3 py-1.5 font-mono">{r.date}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-500">{r.invoiceNumber}</td>
                    <td className="px-3 py-1.5 text-right font-bold">{r.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
