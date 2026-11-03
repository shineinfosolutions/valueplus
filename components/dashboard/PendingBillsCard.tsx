"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

/** Bills that salesmen have sent and the cashier has not yet turned into invoices. */
export function PendingBillsCard() {
  const { data: bills = [] } = useQuery({
    queryKey: ["pending-bills"],
    refetchInterval: 20000,
    queryFn: async () => {
      const res = await fetch("/api/estimates?approval=pending");
      const json = await res.json();
      return json.success ? (json.data as any[]) : [];
    },
  });

  return (
    <div className={`rounded-2xl border shadow-sm p-3 ${bills.length > 0 ? "bg-amber-50 border-amber-300" : "bg-white border-slate-200"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black text-slate-900 uppercase tracking-wide flex items-center gap-1.5">
          <Receipt className="w-4 h-4 text-amber-600" /> Bills from salesmen ({bills.length})
        </p>
        <Link href="/sales/estimates" className="text-[11px] font-bold text-[#30539C] hover:underline shrink-0">Open bills</Link>
      </div>
      {bills.length === 0 ? (
        <p className="text-[11px] text-slate-500 mt-1">No bills waiting.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {bills.slice(0, 5).map((b: any) => (
            <Link key={b._id} href="/sales/estimates" className="flex items-center justify-between gap-2 bg-white rounded-xl border border-amber-200 px-2.5 py-1.5 no-underline">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 truncate">{b.customerName}</p>
                <p className="text-xs text-slate-500 truncate">{b.estimateNumber} · by {b.salesperson || b.salesExecutive}</p>
              </div>
              <span className="text-xs font-black text-slate-900 shrink-0">{formatCurrency(b.total || 0)}</span>
            </Link>
          ))}
          {bills.length > 5 && <p className="text-xs text-slate-500">+{bills.length - 5} more</p>}
        </div>
      )}
    </div>
  );
}
