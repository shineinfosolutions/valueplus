"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { MONEY_FIELDS, type EditChange } from "@/lib/bill-edit-diff";

interface EditRow {
  at: string;
  by: string;
  role?: string;
  reason?: string;
  kind: "bill" | "details";
  changes: EditChange[];
}

const when = (d: string) =>
  d
    ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

/** The text of one side of a changed field; rupee fields get the ₹ sign. */
const text = (c: EditChange, v: string | string[]) => (Array.isArray(v) ? v.join("\n") : MONEY_FIELDS.has(c.field) && v !== "—" && Number.isFinite(Number(v)) ? formatCurrency(Number(v)) : v);

/**
 * A bill from "Bills Modified": every time it was edited, by whom and why, and for each thing that changed what it was
 * before and what it is now. The lines of the bill and the payments show which line was taken out (red) and which was
 * put in (green).
 */
export function BillEditDetailDialog({ bill, onClose }: { bill: any | null; onClose: () => void }) {
  const edits: EditRow[] = bill?.edits || [];
  return (
    <Dialog open={!!bill} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            What changed in {bill?.invoiceNumber} <span className="text-sm font-normal text-slate-500">· {bill?.customerName}</span>
          </DialogTitle>
          <DialogDescription>
            {edits.length > 1 ? `Edited ${edits.length} times, newest first.` : "Edited once."} Before is what the bill said earlier; Now is what it says today.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {edits.map((e, i) => (
            <div key={i} className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="bg-orange-50 border-b border-orange-200 px-3 py-2 text-xs">
                <p className="font-bold text-orange-900">
                  {e.by}
                  {e.role ? <span className="font-normal text-orange-700"> ({e.role})</span> : null} · {when(e.at)}
                  <span className="ml-2 rounded bg-white/70 border border-orange-200 px-1.5 py-0.5 text-[10px] font-bold uppercase">
                    {e.kind === "details" ? "details corrected" : "bill edited"}
                  </span>
                </p>
                {e.reason ? <p className="text-orange-900/90 mt-0.5">Reason: {e.reason}</p> : null}
              </div>

              {e.changes.length === 0 ? (
                <p className="px-3 py-4 text-xs text-slate-500">
                  The fields recorded for this edit did not change. Older edits did not record a change of the sales executive; from now on it is shown here too.
                </p>
              ) : (
                <div className="divide-y">
                  {e.changes.map((c) => (
                    <div key={c.field} className="grid grid-cols-1 sm:grid-cols-[130px_1fr_1fr] gap-x-3 gap-y-1 px-3 py-2 text-xs">
                      <p className="font-bold text-slate-700">{c.label}</p>
                      <Side label="Before" change={c} value={c.before} other={c.after} tone="before" />
                      <Side label="Now" change={c} value={c.after} other={c.before} tone="after" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {edits.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No edit record for this bill.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Side({ label, change, value, other, tone }: { label: string; change: EditChange; value: string | string[]; other: string | string[]; tone: "before" | "after" }) {
  const isList = Array.isArray(value) || Array.isArray(other);
  const mine = Array.isArray(value) ? value : [];
  const theirs = Array.isArray(other) ? other : [];
  return (
    <div className={tone === "before" ? "rounded-lg bg-rose-50/60 border border-rose-100 p-2" : "rounded-lg bg-emerald-50/60 border border-emerald-100 p-2"}>
      <p className={tone === "before" ? "text-[10px] font-black uppercase text-rose-700" : "text-[10px] font-black uppercase text-emerald-700"}>{label}</p>
      {isList ? (
        mine.length === 0 ? (
          <p className="text-slate-400">—</p>
        ) : (
          <ul className="space-y-0.5">
            {mine.map((line, i) => {
              const changed = !theirs.includes(line);
              return (
                <li
                  key={i}
                  className={
                    changed
                      ? tone === "before"
                        ? "text-rose-800 line-through decoration-rose-400"
                        : "text-emerald-800 font-semibold"
                      : "text-slate-500"
                  }
                >
                  {line}
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <p className="whitespace-pre-wrap break-words font-semibold text-slate-800">{text(change, value)}</p>
      )}
    </div>
  );
}
