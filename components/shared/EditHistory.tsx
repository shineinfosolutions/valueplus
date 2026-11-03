"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const LABELS: Record<string, string> = {
  "invoice.edit": "Bill edited",
  "invoice.details.edit": "Details corrected",
  "invoice.cancel": "Bill cancelled",
  "payment.edit": "Payment edited",
  "payment.delete": "Payment deleted",
  "purchase-entry.correct": "Purchase bill corrected",
  "purchase-entry.cancel": "Purchase bill cancelled",
  "change.requested": "Change sent for approval",
  "change.approved": "Approved by the Admin",
  "change.rejected": "Rejected by the Admin",
};

const short = (v: any, full: boolean) => {
  const t = Array.isArray(v) ? v.join("; ") : typeof v === "object" && v ? JSON.stringify(v) : String(v ?? "—");
  return !full && t.length > 140 ? `${t.slice(0, 140)}…` : t;
};

/** What changed, as "field: before → after" lines (cut short unless `full`). */
export function describeChange(before: any, after: any, full = false): string[] {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return [];
  return Object.keys({ ...before, ...after })
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => `${k}: ${short(before[k], full)} → ${short(after[k], full)}`);
}

const describe = (meta: any) => describeChange(meta?.before, meta?.after);

/**
 * Click the "Edited" mark on a bill to see every change made to it: who, when, why,
 * and what it was before. Needs the audit permission; without it the list says so.
 */
export function EditHistory({ refs, children }: { refs: string[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["edit-history", refs.join(",")],
    enabled: open,
    queryFn: async () => {
      const res = await fetch(`/api/audit?refs=${encodeURIComponent(refs.join(","))}&limit=40`, { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not load the history");
      return json.data.rows as any[];
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] max-h-[360px] overflow-y-auto p-3 text-xs">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">History</p>
        {isLoading ? (
          <p className="text-slate-400">Loading…</p>
        ) : !data ? (
          <p className="text-slate-500">The history is only visible to people with audit access.</p>
        ) : data.length === 0 ? (
          <p className="text-slate-400">Nothing recorded for this one yet (older changes were not logged).</p>
        ) : (
          <ul className="space-y-3">
            {data.map((r) => {
              const lines = describe(r.metadata);
              return (
                <li key={r._id} className="border-l-2 border-slate-200 pl-2">
                  <p className="font-semibold text-slate-800">{LABELS[r.action] || r.action}</p>
                  <p className="text-[10px] text-slate-500">
                    {r.performedBy}
                    {r.performedByRole ? ` (${r.performedByRole})` : ""} · {new Date(r.createdAt).toLocaleString("en-IN")}
                  </p>
                  {r.reason && <p className="mt-0.5 text-slate-600">Reason: {r.reason}</p>}
                  {lines.map((l, i) => (
                    <p key={i} className="mt-0.5 text-[11px] text-slate-500 break-words">{l}</p>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
