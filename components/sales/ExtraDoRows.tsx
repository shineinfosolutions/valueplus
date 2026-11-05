"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";

/** One more DO on the same bill: the loan split across several DOs (same or different finance companies). */
export interface ExtraDo {
  provider: string;
  doId: string;
  amount: number | string;
}

export const FINANCE_PROVIDERS = [
  "Bajaj Finance Limited",
  "HDB Financial Services",
  "IDFC First Bank",
  "TVS Credit",
  "Kotak Mahindra Prime",
  "Home Credit India",
  "Other Finance",
];

/**
 * The bill's first DO is the one in the main finance fields; these rows add more. Each has its own finance company,
 * DO number and loan amount; the first DO's loan is what is left of the bill's loan.
 */
export function ExtraDoRows({
  rows,
  onChange,
  totalLoan,
  defaultProvider,
}: {
  rows: ExtraDo[];
  onChange: (rows: ExtraDo[]) => void;
  totalLoan: number;
  defaultProvider?: string;
}) {
  const extra = rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);
  const firstLoan = Math.round((totalLoan - extra) * 100) / 100;
  const set = (i: number, patch: Partial<ExtraDo>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-1 md:grid-cols-[1.4fr_1.2fr_1fr_auto] gap-2 items-end rounded-lg border border-orange-200 bg-white p-2">
          <div>
            <Label className="text-[11px] font-bold text-orange-950">DO {i + 2} · Finance company</Label>
            <select
              value={r.provider}
              onChange={(e) => set(i, { provider: e.target.value })}
              className="mt-1 h-9 w-full rounded-md border border-orange-300 bg-white px-2 text-xs font-semibold"
            >
              {FINANCE_PROVIDERS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-[11px] font-bold text-orange-950">DO / Sanction ID *</Label>
            <Input
              value={r.doId}
              onChange={(e) => set(i, { doId: e.target.value.trim() })}
              placeholder="e.g. B432262869"
              className="mt-1 h-9 bg-white border-orange-300 font-mono font-bold text-xs"
            />
          </div>
          <div>
            <Label className="text-[11px] font-bold text-orange-950">Loan amount (₹) *</Label>
            <Input
              type="number"
              min={0}
              value={r.amount}
              onChange={(e) => set(i, { amount: e.target.value })}
              className="mt-1 h-9 bg-white border-orange-300 font-bold text-xs"
            />
          </div>
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, k) => k !== i))}
            className="h-9 px-2 text-rose-500 hover:bg-rose-50 rounded"
            aria-label="Remove this DO"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChange([...rows, { provider: defaultProvider || FINANCE_PROVIDERS[0], doId: "", amount: "" }])}
          className="inline-flex items-center gap-1 text-xs font-bold text-orange-800 border border-orange-300 bg-white rounded-lg px-3 py-1.5 hover:bg-orange-50"
        >
          <Plus className="w-3.5 h-3.5" /> Add another DO
        </button>
        {rows.length > 0 && (
          <p className={`text-[11px] font-semibold ${firstLoan > 0 ? "text-slate-600" : "text-rose-600"}`}>
            Loan {formatCurrency(totalLoan)} = DO 1 {formatCurrency(Math.max(0, firstLoan))} + other DOs {formatCurrency(extra)}
            {firstLoan <= 0 ? " — the other DOs are more than the loan" : ""}
          </p>
        )}
      </div>
    </div>
  );
}
