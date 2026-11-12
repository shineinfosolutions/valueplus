"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StoreExitDialog, type StoreExitBill } from "@/components/delivery/StoreExitDialog";
import { StoreExitPhotos } from "@/components/delivery/StoreExitPhotos";
import { cn, formatDate } from "@/lib/utils";

/**
 * The goods that are leaving the store: bills still to take out (scan + photos, then delivery or the customer taking
 * them) and the ones already taken out. A salesman sees only his own bills (the server decides).
 * `onSkipScan` (Admin / Manager) lets a bill go out for delivery without the scan, with a reason.
 */
export function TakeOutList({
  tabs = ["todo", "done"],
  onChanged,
  onSkipScan,
  initialTab,
}: {
  tabs?: ("todo" | "done")[];
  onChanged?: () => void;
  onSkipScan?: (bill: any) => void;
  initialTab?: "todo" | "done";
}) {
  const [tab, setTab] = useState<"todo" | "done">(initialTab || tabs[0]);
  const [search, setSearch] = useState("");
  const [bill, setBill] = useState<StoreExitBill | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);

  const q = search.trim();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["store-exit", tab, q],
    queryFn: async () => {
      const res = await fetch(`/api/delivery/store-exit?list=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not load the bills.");
      return json as { data: any[]; canViewPhotos: boolean };
    },
    meta: { live: true },
  });
  const rows = data?.data || [];
  const canView = !!data?.canViewPhotos;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {tabs.length > 1 &&
          tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn("px-3 h-8 rounded-full border text-xs font-bold", tab === t ? "bg-[#30539C] border-[#30539C] text-white" : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50")}
            >
              {t === "todo" ? "To take out" : "Taken out"}
            </button>
          ))}
        <Input className="max-w-xs h-8" placeholder="Search bill no, customer or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button size="sm" variant="outline" onClick={() => refetch()}>Refresh</Button>
      </div>
      {!q && tab === "todo" && <p className="text-xs text-slate-500 mb-2">Bills of the last 14 days. Search a bill number to find an older one.</p>}

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">{tab === "todo" ? "No bill is waiting to be taken out." : "Nothing taken out yet."}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r: any) => (
            <div key={r.invoiceNumber} className="rounded-xl border bg-white p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-800">
                  {r.invoiceNumber} <span className="font-semibold text-slate-500">· {formatDate(r.date)}</span>
                </p>
                <p className="text-xs text-slate-600">{r.customerName}{r.customerPhone ? ` · ${r.customerPhone}` : ""}{canView && r.salesExecutive ? ` · ${r.salesExecutive}` : ""}</p>
                <p className="text-[11px] text-slate-500 truncate">{r.products.map((p: any) => `${p.itemName} x${p.quantity}`).join(", ")}</p>
                {tab === "done" && r.storeExit && (
                  <p className="text-[11px] font-bold text-emerald-700">
                    {r.storeExit.mode === "self" ? `Taken by ${r.storeExit.takenByName} (${r.storeExit.takenByPhone}) in person` : "Sent for delivery"}
                    {" · "}by {r.storeExit.completedBy}
                    {r.storeExit.lines.some((l: any) => !l.serialMatched) && <span className="text-amber-700"> · serial not matched on some product</span>}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {tab === "todo" ? (
                  <>
                    {r.storeExit?.lines?.length > 0 && <Badge variant="outline" className="text-[10px]">{r.storeExit.lines.length} of {r.products.length} checked</Badge>}
                    <Button size="sm" onClick={() => setBill(r)}>Take out</Button>
                    {onSkipScan && (
                      <Button size="sm" variant="ghost" className="text-xs text-slate-500" onClick={() => onSkipScan(r)} title="Send for delivery without the scan (needs a reason)">
                        Skip scan
                      </Button>
                    )}
                  </>
                ) : (
                  canView && <Button size="sm" variant="outline" onClick={() => setViewing(r)}>📷 Store photos</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <StoreExitDialog bill={bill} onClose={() => setBill(null)} onChanged={() => { refetch(); onChanged?.(); }} />
      {viewing && (
        <StoreExitPhotos
          chip={false}
          open={!!viewing}
          onOpenChange={(o) => { if (!o) setViewing(null); }}
          invoiceNumber={viewing.invoiceNumber}
          lines={viewing.storeExit?.lines || []}
          by={viewing.storeExit?.completedBy}
        />
      )}
    </div>
  );
}
