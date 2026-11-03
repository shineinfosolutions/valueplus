"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PackagePlus } from "lucide-react";

/**
 * Stock order requests on the dashboard.
 *  - "admin": requests waiting for the Admin, with who asked and how many units.
 *  - "salesman": the salesman's own requests by status, and a link to order more.
 */
export function StockOrdersCard({ mode }: { mode: "admin" | "salesman" }) {
  const { data: orders = [] } = useQuery({
    queryKey: ["dashboard-stock-orders"],
    meta: { live: ["/api/stock-orders"] },
    queryFn: async () => {
      const json = await (await fetch("/api/stock-orders")).json();
      return json.success ? (json.data as any[]) : [];
    },
  });
  const pending = orders.filter((o) => o.status === "pending");

  if (mode === "admin") {
    return (
      <div className={`rounded-2xl border shadow-sm p-3 ${pending.length > 0 ? "bg-blue-50 border-blue-300" : "bg-white border-slate-200"}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-black text-slate-900 uppercase tracking-wide flex items-center gap-1.5">
            <PackagePlus className="w-4 h-4 text-[#30539C]" /> Stock order requests ({pending.length})
          </p>
          <Link href="/sales/new-stock?tab=requests" className="text-[11px] font-bold text-[#30539C] hover:underline shrink-0">Open</Link>
        </div>
        {pending.length === 0 ? (
          <p className="text-[11px] text-slate-500 mt-1">No requests waiting.</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {pending.slice(0, 4).map((o) => (
              <Link key={o._id} href="/sales/new-stock?tab=requests" className="flex items-center justify-between gap-2 bg-white rounded-xl border border-blue-200 px-2.5 py-1.5 no-underline">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 truncate">{o.salesperson}</p>
                  <p className="text-xs text-slate-500 truncate">{o.requestNumber} · {o.items.length} product{o.items.length === 1 ? "" : "s"}</p>
                </div>
                <span className="text-xs font-black text-slate-900 shrink-0">{o.totalQuantity} units</span>
              </Link>
            ))}
            {pending.length > 4 && <p className="text-xs text-slate-500">+{pending.length - 4} more</p>}
          </div>
        )}
      </div>
    );
  }

  const count = (s: string) => orders.filter((o) => o.status === s).length;
  return (
    <Link href="/sales/new-stock" className="rounded-2xl p-3 border border-slate-200 bg-white shadow-sm block no-underline">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
        <PackagePlus className="w-3.5 h-3.5 text-[#30539C]" /> Stock orders
      </p>
      <p className="text-2xl font-black text-slate-900 mt-0.5">{pending.length}</p>
      <p className="text-xs text-slate-500">
        waiting for Admin · {count("approved") + count("sent")} approved · {count("rejected")} rejected
      </p>
    </Link>
  );
}
