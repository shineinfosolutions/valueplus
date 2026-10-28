"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Printer,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Wallet,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DateRangeFilter, resolveDateRange } from "@/components/shared/date-range-filter";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { usePermissions } from "@/components/shared/role-guard";

/**
 * One ledger view for every party type.
 *
 * All figures come from /api/vendors/ledger, which derives them from the source
 * bills and payments. Nothing is recomputed here, so the panel cannot disagree
 * with the summary rows on the listing pages the way the three separate
 * hand-rolled ledger modals used to disagree with each other.
 */

export type LedgerParty = "vendor" | "supplier" | "customer";

interface LedgerRow {
  kind: "opening" | "bill" | "payment";
  date: string;
  ref: string;
  label: string;
  amount: number;
  mode?: string;
  refNo?: string;
  dueDate?: string;
  by?: string;
  notes?: string;
  reverse?: boolean;
  debit: number;
  credit: number;
  balance: number;
}

interface LedgerBillRow {
  billNo: string;
  date: string;
  dueDate?: string;
  type?: string;
  itemCount: number;
  total: number;
  paid: number;
  balance: number;
  status: "paid" | "partial" | "pending" | "overdue" | "debit-note";
}

interface LedgerPayload {
  party: {
    _id: string;
    code: string;
    name: string;
    phone?: string;
    email?: string;
    gstNumber?: string;
    city?: string;
    state?: string;
    creditDays?: number;
    status?: string;
  };
  summary: {
    openingBalance: number;
    totalBilled: number;
    totalPaid: number;
    closingBalance: number;
    billCount: number;
    paymentCount: number;
    lastPaymentDate: string | null;
    lastPaymentAmount: number;
    lastPaymentMode: string | null;
    ageing: { current: number; d31to60: number; d61to90: number; d90plus: number };
    overdueAmount: number;
    byBucket: Record<string, number>;
  };
  rows: LedgerRow[];
  // Only present for a single-party detail fetch (?id=…) — a bill-by-bill
  // breakdown with its own payment-allocation status, on top of the running
  // ledger above.
  bills?: LedgerBillRow[];
}

const BILL_STATUS_STYLE: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  pending: "bg-slate-100 text-slate-600 border-slate-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
  "debit-note": "bg-purple-50 text-purple-700 border-purple-200",
};

const BUCKET_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  online: "NEFT / IMPS / Bank",
  card: "Card",
  finance: "Finance",
  due: "Due",
};

export function PartyLedgerPanel({
  party,
  partyId,
  onRecordPayment,
}: {
  party: LedgerParty;
  partyId: string;
  onRecordPayment?: () => void;
}) {
  const { can } = usePermissions();
  const [dateFilter, setDateFilter] = useState("All Time");
  const [range, setRange] = useState<{ start?: string; end?: string }>({});

  const { data, isLoading, isFetching, refetch, error } = useQuery<LedgerPayload>({
    queryKey: ["party-ledger", party, partyId, range.start, range.end],
    queryFn: async () => {
      const qs = new URLSearchParams({ party, id: partyId });
      if (range.start) qs.set("from", range.start);
      if (range.end) qs.set("to", range.end);
      const res = await fetch(`/api/vendors/ledger?${qs.toString()}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not load the ledger");
      return json.data;
    },
    enabled: Boolean(partyId),
  });

  const isPayable = party === "supplier";
  const summary = data?.summary;
  const rows = data?.rows || [];

  const modeBreakdown = useMemo(() => {
    if (!summary?.byBucket) return [];
    return Object.entries(summary.byBucket)
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1]);
  }, [summary]);

  const handleDateChange = (value: string, start?: string, end?: string) => {
    setDateFilter(value);
    if (value === "All Time") {
      setRange({});
      return;
    }
    const resolved = start && end ? { start, end } : resolveDateRange(value);
    setRange({ start: resolved.start, end: resolved.end });
  };

  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
        <p className="text-sm font-semibold text-slate-800">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col max-h-[85vh]">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-6 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
              <FileText className="w-6 h-6 text-[#76C043]" />
            </div>
            <div>
              <h3 className="text-xl font-bold tracking-tight">
                {data?.party.name || "Loading…"}
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                {data?.party.code}
                {data?.party.phone ? ` • ${data.party.phone}` : ""}
                {data?.party.gstNumber ? ` • GST ${data.party.gstNumber}` : ""}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] uppercase tracking-wider text-slate-300 font-semibold">
              {isPayable ? "We Owe" : "Pending From Party"}
            </p>
            <p
              className={cn(
                "text-2xl font-black tabular-nums",
                (summary?.closingBalance || 0) > 0 ? "text-amber-300" : "text-emerald-300"
              )}
            >
              {formatCurrency(summary?.closingBalance || 0)}
            </p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3 bg-white border-b border-slate-200 shrink-0">
        <DateRangeFilter value={dateFilter} onChange={handleDateChange} className="w-[150px]" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleDateChange("All Time")}
          className={cn("h-8 text-xs", dateFilter === "All Time" && "border-[#3F63AD] text-[#3F63AD]")}
        >
          All Time
        </Button>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="h-8 text-xs">
          <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
        <div className="flex-1" />
        {onRecordPayment && can("payment.record") && (
          <Button size="sm" onClick={onRecordPayment} className="h-8 text-xs">
            <Wallet className="w-3.5 h-3.5 mr-1.5" /> Record Payment
          </Button>
        )}
        {can("ledger.export") && (
          <>
            <ExportMenu
              className="h-8 text-xs"
              title={`${data?.party.name || "Party"} — Ledger`}
              subtitle={`${rows.length} entries`}
              data={rows.map((r) => ({
                Date: r.date,
                Particulars: r.label,
                Reference: r.ref,
                Mode: r.mode || "",
                "Ref No": r.refNo || "",
                By: r.by || "",
                Debit: r.debit || "",
                Credit: r.credit || "",
                Balance: r.balance,
              }))}
              filename={`${data?.party.code || "party"}-ledger`}
            />
            <Button variant="outline" size="sm" onClick={() => window.print()} className="h-8 text-xs">
              <Printer className="w-3.5 h-3.5 mr-1.5" /> Print
            </Button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50 p-6 space-y-5">
        {/* Summary tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryTile
            label={isPayable ? "Total Purchased" : "Total Billed"}
            value={formatCurrency(summary?.totalBilled || 0)}
            sub={`${summary?.billCount || 0} bills`}
            icon={<TrendingUp className="w-4 h-4 text-slate-400" />}
          />
          <SummaryTile
            label={isPayable ? "Total Paid" : "Total Received"}
            value={formatCurrency(summary?.totalPaid || 0)}
            sub={`${summary?.paymentCount || 0} payments`}
            tone="emerald"
            icon={<TrendingDown className="w-4 h-4 text-emerald-500" />}
          />
          <SummaryTile
            label="Pending Balance"
            value={formatCurrency(summary?.closingBalance || 0)}
            sub={summary?.openingBalance ? `Opening ${formatCurrency(summary.openingBalance)}` : "No opening balance"}
            tone="amber"
          />
          <SummaryTile
            label="Overdue"
            value={formatCurrency(summary?.overdueAmount || 0)}
            sub={
              summary?.lastPaymentDate
                ? `Last paid ${formatDate(summary.lastPaymentDate)}`
                : "No payment yet"
            }
            tone={(summary?.overdueAmount || 0) > 0 ? "red" : "slate"}
          />
        </div>

        {/* Ageing + mode split */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">
              Ageing of Pending Amount
            </p>
            <div className="grid grid-cols-4 gap-2">
              <AgeingChip label="0-30 d" value={summary?.ageing.current || 0} tone="emerald" />
              <AgeingChip label="31-60 d" value={summary?.ageing.d31to60 || 0} tone="amber" />
              <AgeingChip label="61-90 d" value={summary?.ageing.d61to90 || 0} tone="orange" />
              <AgeingChip label="90+ d" value={summary?.ageing.d90plus || 0} tone="red" />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">
              Payments by Mode
            </p>
            {modeBreakdown.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">No payments recorded in this period.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {modeBreakdown.map(([bucket, amount]) => (
                  <div
                    key={bucket}
                    className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200"
                  >
                    <p className="text-[10px] font-semibold uppercase text-slate-500">
                      {BUCKET_LABELS[bucket] || bucket}
                    </p>
                    <p className="text-sm font-bold text-slate-800 tabular-nums">
                      {formatCurrency(amount)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bill-by-bill breakdown — which specific bills are still open */}
        {data?.bills && data.bills.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Bills
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    <th className="px-4 py-2.5 text-left">Bill #</th>
                    <th className="px-4 py-2.5 text-left">Date</th>
                    <th className="px-4 py-2.5 text-right">Total</th>
                    <th className="px-4 py-2.5 text-right">Paid</th>
                    <th className="px-4 py-2.5 text-right">Balance</th>
                    <th className="px-4 py-2.5 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.bills.map((b) => (
                    <tr key={b.billNo} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-700">{b.billNo}</td>
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                        {b.date ? formatDate(b.date) : "—"}
                        {b.dueDate && (
                          <p className="text-[10px] text-slate-400">Due {formatDate(b.dueDate)}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-800">
                        {formatCurrency(b.total)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600">
                        {b.paid ? formatCurrency(b.paid) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-bold text-slate-900">
                        {b.balance ? formatCurrency(b.balance) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] font-semibold capitalize", BILL_STATUS_STYLE[b.status])}
                        >
                          {b.status.replace("-", " ")}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Ledger table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                <tr className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Particulars</th>
                  <th className="px-4 py-3 text-left">Mode / Ref</th>
                  <th className="px-4 py-3 text-left">By</th>
                  <th className="px-4 py-3 text-right">{isPayable ? "Credit (Billed)" : "Debit (Billed)"}</th>
                  <th className="px-4 py-3 text-right">{isPayable ? "Debit (Paid)" : "Credit (Received)"}</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#3F63AD]" />
                      Loading ledger…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400">
                      No transactions in this period.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => (
                    <tr key={`${row.ref}-${idx}`} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                        {row.date ? formatDate(row.date) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <p
                          className={cn(
                            "font-semibold",
                            row.kind === "payment" ? "text-emerald-700" : "text-slate-800"
                          )}
                        >
                          {row.label}
                        </p>
                        {row.dueDate && row.kind === "bill" && (
                          <p className="text-[10px] text-slate-400">Due {formatDate(row.dueDate)}</p>
                        )}
                        {row.notes && (
                          <p className="text-[10px] text-slate-400 truncate max-w-[240px]">{row.notes}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">
                        {row.mode ? (
                          <Badge variant="secondary" className="text-[10px] font-semibold">
                            {row.mode}
                          </Badge>
                        ) : (
                          "—"
                        )}
                        {row.refNo && <p className="text-[10px] text-slate-400 mt-0.5">{row.refNo}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{row.by || "—"}</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-slate-800">
                        {row.debit ? formatCurrency(row.debit) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-emerald-600">
                        {row.credit ? formatCurrency(row.credit) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-900">
                        {formatCurrency(row.balance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  sub,
  tone = "slate",
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "slate" | "emerald" | "amber" | "red";
  icon?: React.ReactNode;
}) {
  const toneClass = {
    slate: "text-slate-900",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-red-600",
  }[tone];

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        {icon}
      </div>
      <p className={cn("text-lg font-black mt-1 tabular-nums", toneClass)}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function AgeingChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "orange" | "red";
}) {
  const toneClass = {
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    orange: "bg-orange-50 border-orange-200 text-orange-700",
    red: "bg-red-50 border-red-200 text-red-700",
  }[tone];

  return (
    <div className={cn("rounded-lg border px-2.5 py-2", value > 0 ? toneClass : "bg-slate-50 border-slate-200 text-slate-400")}>
      <p className="text-[10px] font-bold uppercase tracking-wide">{label}</p>
      <p className="text-sm font-bold tabular-nums mt-0.5">{formatCurrency(value)}</p>
    </div>
  );
}
