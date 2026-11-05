"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Store } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { todayInIndia } from "@/lib/today";
import { qtyAtWarehouse } from "@/components/inventory/StockTransferDialog";

/**
 * Each active showroom / godown at a glance: stock (products, pieces, value at cost), bills made there (today, this
 * month, all) and stock moved in and out by transfers. Tapping a card opens that location's stock.
 */
export function LocationSummary({
  warehouses,
  items,
  transfers,
  onOpenStock,
}: {
  warehouses: any[];
  items: any[];
  transfers: any[];
  onOpenStock?: (name: string) => void;
}) {
  const { data: invoices = [] } = useQuery<any[]>({
    queryKey: ["invoices"],
    queryFn: async () => {
      const json = await (await fetch("/api/invoices")).json();
      return json.success ? json.data : [];
    },
  });
  const [period, setPeriod] = useState<"today" | "month" | "all">("month");
  const today = todayInIndia();
  const month = today.slice(0, 7);
  const locations = warehouses.filter((w) => w.status !== "inactive");

  const rows = useMemo(
    () =>
      locations.map((w) => {
        const id = String(w._id);
        const name = String(w.name || "");
        let products = 0;
        let pieces = 0;
        let value = 0;
        for (const it of items) {
          const q = qtyAtWarehouse(it, id);
          if (q !== 0) {
            products++;
            pieces += q;
            value += q * (Number(it.purchasePrice) || 0);
          }
        }
        const bills = invoices.filter(
          (b) =>
            !["proforma", "sales-order", "credit-note"].includes(b.type) &&
            b.status !== "cancelled" &&
            (String(b.warehouseId || "") === id || String(b.warehouse || "").toLowerCase() === name.toLowerCase())
        );
        const day = (b: any) => String(b.date || b.createdAt || "").slice(0, 10);
        const inPeriod = bills.filter((b) => (period === "today" ? day(b) === today : period === "month" ? day(b).startsWith(month) : true));
        const units = (list: any[]) => list.reduce((t, x) => t + (x.items || []).reduce((n: number, i: any) => n + (Number(i.quantity) || 0), 0), 0);
        const out = transfers.filter((t) => String(t.fromWarehouseId || "") === id || t.fromWarehouse === name);
        const inn = transfers.filter((t) => String(t.toWarehouseId || "") === id || t.toWarehouse === name);
        return {
          id,
          name,
          type: w.type,
          products,
          pieces,
          value,
          billCount: inPeriod.length,
          billAmount: inPeriod.reduce((t, b) => t + (Number(b.total) || 0), 0),
          billUnits: units(inPeriod.map((b) => ({ items: b.items }))),
          outCount: out.length,
          outUnits: units(out),
          inCount: inn.length,
          inUnits: units(inn),
        };
      }),
    [locations, items, invoices, transfers, period, today, month]
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Showroom & Godown Summary</h3>
          <p className="text-[11px] text-slate-500">Stock, bills and transfers for each location. Tap a card to see its stock.</p>
        </div>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-bold">
          {(
            [
              ["today", "Today"],
              ["month", "This month"],
              ["all", "All time"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setPeriod(k)} className={cn("px-3 py-1.5", period === k ? "bg-[#30539C] text-white" : "bg-white text-slate-600")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpenStock?.(r.name)}
            className="text-left rounded-2xl border border-slate-200 p-4 hover:border-[#30539C] hover:shadow-md transition-all"
          >
            <p className="font-black text-slate-900 flex items-center gap-2">
              {r.type === "godown" ? <Building2 className="w-4 h-4 text-amber-600" /> : <Store className="w-4 h-4 text-emerald-600" />}
              {r.name}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-blue-50 p-2">
                <p className="text-[10px] font-bold uppercase text-blue-700">Stock</p>
                <p className="text-lg font-black text-slate-900">{r.pieces}</p>
                <p className="text-[10px] text-slate-500">{r.products} products</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-2">
                <p className="text-[10px] font-bold uppercase text-emerald-700">Bills</p>
                <p className="text-lg font-black text-slate-900">{r.billCount}</p>
                <p className="text-[10px] text-slate-500">{r.billUnits} pcs sold</p>
              </div>
              <div className="rounded-xl bg-purple-50 p-2">
                <p className="text-[10px] font-bold uppercase text-purple-700">Sales</p>
                <p className="text-sm font-black text-slate-900 mt-1">{formatCurrency(r.billAmount)}</p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-1 text-[11px] text-slate-600">
              <span>Stock value (cost): <b>{formatCurrency(r.value)}</b></span>
              <span>
                Transfers: <b className="text-emerald-700">in {r.inCount} ({r.inUnits} pcs)</b> · <b className="text-amber-700">out {r.outCount} ({r.outUnits} pcs)</b>
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
