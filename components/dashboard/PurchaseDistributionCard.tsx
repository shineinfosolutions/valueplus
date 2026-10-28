"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DateRangeFilter, resolveDateRange } from "@/components/shared/date-range-filter";
import { PartyLedgerPanel } from "@/components/PartyLedgerPanel";
import { ShoppingBag, AlertTriangle, ArrowRight } from "lucide-react";
import { formatNumber } from "@/lib/utils";

/**
 * Purchases for the period, split by supplier — the purchase-side twin of the
 * Payment & Bill Distribution card beside it. Value Plus Retail (the main
 * distributor) is always listed first, every other supplier after it. Clicking
 * a supplier opens that supplier's ledger right here.
 *
 * Cancelled bills are left out; debit notes (returns) are not purchases and are
 * not counted either. "Due" is what is still unpaid on the period's bills.
 */

export interface PurchaseCardFilter {
  value: string;
  start?: string;
  end?: string;
}

const PALETTE = ["#3F63AD", "#76C043", "#F59E0B", "#8B5CF6", "#06B6D4", "#EC4899", "#64748B"];
const MAX_ROWS = 6;
const isValuePlus = (name: string) => /value\s*plus/i.test(name);
const dayOf = (e: any) => String(e.billDate || e.date || e.createdAt || "").slice(0, 10);

export function PurchaseDistributionCard({
  filter,
  onFilterChange,
}: {
  filter: PurchaseCardFilter;
  onFilterChange: (f: PurchaseCardFilter) => void;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledgerFor, setLedgerFor] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      Promise.all([
        fetch("/api/purchase-entries").then((r) => r.json()),
        fetch("/api/suppliers").then((r) => r.json()),
      ])
        .then(([pe, sup]) => {
          if (cancelled) return;
          setEntries(pe.success && Array.isArray(pe.data) ? pe.data : []);
          setSuppliers(sup.success && Array.isArray(sup.data) ? sup.data : []);
        })
        .catch((e) => console.warn("Notice loading purchases:", e))
        .finally(() => !cancelled && setLoading(false));
    load();
    // A new purchase or supplier payment anywhere in the app refreshes the card.
    window.addEventListener("erp-purchase-created", load);
    window.addEventListener("erp-payment-created", load);
    return () => {
      cancelled = true;
      window.removeEventListener("erp-purchase-created", load);
      window.removeEventListener("erp-payment-created", load);
    };
  }, []);

  const { start, end } = resolveDateRange(filter.value, filter.start, filter.end);

  const summary = useMemo(() => {
    const bills = entries.filter(
      (e) => e.status !== "cancelled" && e.type !== "debit-note" && dayOf(e) >= start && dayOf(e) <= end
    );
    const bySupplier = new Map<string, { key: string; name: string; supplierId: string; count: number; total: number; due: number }>();
    for (const b of bills) {
      const name = String(b.supplierName || "Unknown supplier").trim();
      const key = name.toLowerCase();
      const row = bySupplier.get(key) || { key, name, supplierId: "", count: 0, total: 0, due: 0 };
      row.count += 1;
      row.total += Number(b.total) || 0;
      const due = Number(b.balance) || 0;
      row.due += due >= 0.01 ? due : 0;
      if (!row.supplierId && b.supplierId) row.supplierId = String(b.supplierId);
      bySupplier.set(key, row);
    }
    const rows = Array.from(bySupplier.values()).sort((a, b) => {
      if (isValuePlus(a.name) !== isValuePlus(b.name)) return isValuePlus(a.name) ? -1 : 1;
      return b.total - a.total;
    });
    const total = rows.reduce((s, r) => s + r.total, 0);
    const due = rows.reduce((s, r) => s + r.due, 0);
    return { rows, total, due, paid: Math.max(0, total - due), count: bills.length };
  }, [entries, start, end]);

  const supplierIdFor = (row: { name: string; supplierId: string }) =>
    row.supplierId ||
    String(suppliers.find((s: any) => String(s.name || "").trim().toLowerCase() === row.name.toLowerCase())?._id || "");

  const openLedger = (row: { name: string; supplierId: string }) => {
    const id = supplierIdFor(row);
    if (id) setLedgerFor({ id, name: row.name });
    else router.push("/vendors/ledger");
  };

  const rangeLabel = (() => {
    const asDay = (d: Date) => `${d.getDate()} ${d.toLocaleString("en-IN", { month: "short" })}`;
    if (filter.value === "Today") return asDay(new Date());
    if (filter.value === "Yesterday") {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      return asDay(y);
    }
    return filter.value;
  })();

  const shown = summary.rows.slice(0, MAX_ROWS);
  const hidden = summary.rows.slice(MAX_ROWS);

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-sm p-3 flex flex-col justify-between hover:shadow-md transition-all">
      <div className="pb-2.5 border-b border-slate-100 space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200/60 flex items-center justify-center text-emerald-700 shrink-0">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-black text-slate-900 tracking-tight truncate flex items-center gap-2">
              Purchase Distribution
              {loading && <span className="w-2.5 h-2.5 rounded-full border-2 border-slate-300 border-t-[#3F63AD] animate-spin" />}
            </h2>
            <p className="text-xs text-slate-500 font-medium truncate">Supplier-wise purchases & payables</p>
          </div>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <Badge className="bg-emerald-50 text-emerald-800 border-emerald-200 text-xs font-bold px-2 py-0.5">
            {summary.count} Total Bills
          </Badge>
          <DateRangeFilter
            value={filter.value}
            onChange={(val, s, e) => onFilterChange({ value: val, start: s, end: e })}
            className="flex-1 min-w-[115px] h-8 text-xs font-semibold"
          />
        </div>
      </div>

      <div className="py-2">
        <div className="bg-slate-100/70 rounded-xl p-3">
          <div onClick={() => router.push("/purchase/entries")} className="cursor-pointer group" title="Open purchase entries">
            <p className="text-sm font-bold text-slate-900 group-hover:text-[#3F63AD] transition-colors">Total Purchases</p>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {rangeLabel} • {summary.count} {summary.count === 1 ? "bill" : "bills"}
            </p>
            <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mt-2 leading-none">
              ₹ {formatNumber(Math.round(summary.total))}
            </p>
          </div>

          <div className="flex w-full h-2.5 rounded-full overflow-hidden bg-slate-300/70 mt-4">
            {summary.total > 0 ? (
              summary.rows.map((r, i) => (
                <div
                  key={r.key}
                  title={`${r.name} — ₹${formatNumber(Math.round(r.total))}`}
                  className="h-full"
                  style={{ width: `${(r.total / summary.total) * 100}%`, backgroundColor: PALETTE[Math.min(i, PALETTE.length - 1)] }}
                />
              ))
            ) : (
              <div className="h-full w-full bg-slate-300" />
            )}
          </div>

          <div className="mt-3 divide-y divide-slate-200/90">
            {shown.length === 0 && (
              <p className="py-2 text-xs text-slate-400 font-medium">— No purchases recorded this period</p>
            )}
            {shown.map((r, i) => {
              const share = summary.total > 0 ? (r.total / summary.total) * 100 : 0;
              return (
                <div
                  key={r.key}
                  onClick={() => openLedger(r)}
                  className="py-1.5 cursor-pointer group"
                  title={`Open ${r.name} ledger`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PALETTE[Math.min(i, PALETTE.length - 1)] }} />
                      <span className="text-sm font-semibold text-slate-700 truncate group-hover:text-[#3F63AD] transition-colors">
                        {r.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-[10px] font-mono font-bold text-slate-500 bg-white/80 border border-slate-200 rounded px-1.5 py-0.5">
                        {r.count}
                      </span>
                      <span className="text-sm font-bold text-slate-900 font-mono tabular-nums">₹ {formatNumber(Math.round(r.total))}</span>
                      <span className="text-xs font-medium text-slate-400 font-mono tabular-nums w-11 text-right">{share.toFixed(1)}%</span>
                    </div>
                  </div>
                  {r.due > 0 && (
                    <p className="pl-[22px] text-[11px] font-semibold text-rose-600">Due ₹ {formatNumber(Math.round(r.due))}</p>
                  )}
                </div>
              );
            })}
            {hidden.length > 0 && (
              <button
                type="button"
                onClick={() => router.push("/vendors/ledger")}
                className="w-full py-1.5 text-left text-xs font-semibold text-[#3F63AD] hover:underline"
              >
                +{hidden.length} more supplier{hidden.length === 1 ? "" : "s"} · ₹ {formatNumber(Math.round(hidden.reduce((s, r) => s + r.total, 0)))}
              </button>
            )}
          </div>

          {summary.total > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-200/90 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-emerald-800">Paid to suppliers</span>
                <span className="font-bold font-mono text-emerald-700">₹ {formatNumber(Math.round(summary.paid))}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-rose-800 flex items-center gap-1.5">
                  {summary.due > 0 && <AlertTriangle className="w-3.5 h-3.5" />} Still to pay
                </span>
                <span className="font-bold font-mono text-rose-700">₹ {formatNumber(Math.round(summary.due))}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-500 font-medium">
        <span className="truncate">Click a supplier to open its ledger</span>
        <button
          type="button"
          onClick={() => router.push("/vendors/ledger")}
          className="font-bold text-[#3F63AD] hover:underline flex items-center gap-0.5 whitespace-nowrap"
        >
          All ledgers <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <Dialog open={Boolean(ledgerFor)} onOpenChange={(o) => !o && setLedgerFor(null)}>
        <DialogContent className="max-w-5xl p-0 overflow-y-auto rounded-2xl border-none shadow-2xl">
          {ledgerFor && <PartyLedgerPanel party="supplier" partyId={ledgerFor.id} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
