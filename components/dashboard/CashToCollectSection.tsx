"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

/**
 * Second section of the dashboard's ledger card (Admin): the cash from cash bills (invoices) made after the last
 * handover to the Admin — what the cashier still has to hand over.
 */
export function CashToCollectSection() {
  const { data } = useQuery({
    queryKey: ["dashboard-cash-to-collect"],
    refetchInterval: 60000,
    queryFn: async () => {
      const json = await (await fetch("/api/cash-register")).json();
      return json.success ? json.data : null;
    },
  });

  const entries: any[] = data?.sinceLastHandover || [];
  // Cash that came from invoices after the last handover (nothing is taken off for what the cashier banked or spent).
  const invoiceCash = entries.filter((e) => e.type === "INFLOW" && e.source === "INVOICE");
  const toCollect = invoiceCash.reduce((t, e) => t + (Number(e.amount) || 0), 0);
  const last = data?.lastHandover;

  return (
    <div className="mt-4 pt-4 border-t border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200/60 flex items-center justify-center text-amber-700">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900 tracking-tight">Cash with the Cashier</h3>
            <p className="text-xs text-slate-500 font-medium">Cash from invoices since the last handover to the Admin</p>
          </div>
        </div>
        <Link href="/banking/accounts?ledger=open" className="text-sm font-bold text-indigo-600 hover:underline">
          Open Cash Ledger →
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={`rounded-xl border p-3.5 ${toCollect > 0 ? "bg-amber-50 border-amber-300" : "bg-emerald-50/60 border-emerald-200"}`}>
          <p className="text-[11px] font-black uppercase tracking-wider text-amber-900">Cash to collect from cashier</p>
          <p className="mt-1 text-2xl font-black font-mono text-amber-800">{formatCurrency(toCollect)}</p>
          <p className="mt-1 text-xs text-slate-600">
            {toCollect > 0
              ? `${invoiceCash.length} cash bill${invoiceCash.length === 1 ? "" : "s"} since the last handover — collect this from the cashier.`
              : "No cash bill since the last handover."}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
          <p className="text-[11px] font-black uppercase tracking-wider text-slate-600">Since the last handover</p>
          <div className="mt-1.5 space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-slate-600">Last handover</span><span className="font-mono font-bold text-slate-900">{last ? `${formatCurrency(last.amount)} · ${String(last.date).slice(0, 10)}` : "none yet"}</span></div>
            <div className="flex justify-between"><span className="text-slate-600">Cash bills since then</span><span className="font-mono font-bold text-emerald-700">{invoiceCash.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-600">Cash from those bills</span><span className="font-mono font-bold text-emerald-700">{formatCurrency(toCollect)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
