"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";

/**
 * "Incentive" tile on the salesman's dashboard. Tapping it shows his own incentive: earned (product
 * incentive + 10% of Onsitego plans), received, still to receive, the bills it came from and the payouts.
 * Numbers come from /api/staff/my-incentive, worked out from his login only.
 */
export function MyIncentiveCard() {
  const [open, setOpen] = useState(false);
  const live = { live: ["/api/invoices", "/api/staff/incentive-payout", "/api/staff/salary"] };

  const { data: sum } = useQuery({
    queryKey: ["salesman-incentive"],
    meta: live,
    queryFn: async () => {
      const json = await (await fetch("/api/staff/my-incentive")).json();
      return json.success ? (json.data as { earned: number; received: number; pending: number }) : null;
    },
  });
  const { data: detail, isLoading } = useQuery({
    queryKey: ["salesman-incentive-detail"],
    enabled: open,
    meta: live,
    queryFn: async () => {
      const json = await (await fetch("/api/staff/my-incentive?detail=1")).json();
      return json.success ? json.data : null;
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left bg-white rounded-2xl p-3 border border-amber-200 shadow-sm hover:bg-amber-50/50 transition-colors"
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Incentive
          </p>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </div>
        <div className="mt-1 grid grid-cols-3 gap-2">
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase">Earned</p>
            <p className="text-lg font-black text-emerald-700">{formatCurrency(sum?.earned || 0)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase">Received</p>
            <p className="text-lg font-black text-blue-700">{formatCurrency(sum?.received || 0)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase">To receive</p>
            <p className="text-lg font-black text-amber-700">{formatCurrency(sum?.pending || 0)}</p>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5">Tap to see the bills and payouts</p>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-500" /> My incentive
            </DialogTitle>
            <DialogDescription>On products sold above their target price, plus 10% of every Onsitego plan you sell.</DialogDescription>
          </DialogHeader>

          {isLoading || !detail ? (
            <div className="h-32 rounded-xl bg-slate-100 animate-pulse" />
          ) : (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <Box label="Earned" value={detail.earned} tone="text-emerald-700" sub={`Products ${formatCurrency(detail.product || 0)} · Onsitego ${formatCurrency(detail.onsitego || 0)}`} />
                <Box label="Still to receive" value={detail.pending} tone="text-amber-700" />
                <Box label="Paid out" value={detail.paidByPayout} tone="text-blue-700" />
                <Box label="Paid with salary" value={detail.paidInSalary} tone="text-blue-700" />
              </div>

              <div className="rounded-xl border">
                <p className="px-3 py-2 border-b font-black text-slate-800">Bills with incentive ({detail.bills.length})</p>
                {detail.bills.length === 0 ? (
                  <p className="px-3 py-4 text-center text-slate-400">No incentive yet.</p>
                ) : (
                  <div className="max-h-64 overflow-y-auto divide-y">
                    {detail.bills.map((b: any) => (
                      <div key={b.invoiceNumber} className="px-3 py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 truncate">{b.customerName}</p>
                          <p className="text-[11px] text-slate-500 font-mono truncate">{b.invoiceNumber} · {b.date}</p>
                          {b.onsitegoIncentive > 0 && <p className="text-[11px] text-emerald-700 font-semibold">Onsitego {formatCurrency(b.onsitegoIncentive)}</p>}
                        </div>
                        <span className="font-black text-emerald-700 shrink-0">{formatCurrency(b.incentive)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {detail.payouts.length > 0 && (
                <div className="rounded-xl border">
                  <p className="px-3 py-2 border-b font-black text-slate-800">Payouts received</p>
                  <div className="divide-y">
                    {detail.payouts.map((p: any, i: number) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between gap-2">
                        <span className="text-slate-600">{p.date} · {p.paymentMode}{p.note ? ` · ${p.note}` : ""}</span>
                        <span className="font-black text-blue-700">{formatCurrency(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Link href="/documents" className="block text-center text-[11px] font-bold text-[#30539C] hover:underline">
                Onsitego plans & price list (On Site Go folder)
              </Link>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Box({ label, value, tone, sub }: { label: string; value: number; tone: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-slate-50 p-2">
      <p className="text-[10px] font-bold text-slate-500 uppercase">{label}</p>
      <p className={`text-base font-black ${tone}`}>{formatCurrency(value || 0)}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
}
