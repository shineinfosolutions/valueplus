import React from "react";

const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

function Bar({ pct, done }: { pct: number; done: boolean }) {
  return (
    <div className="h-1.5 rounded-full bg-white border border-purple-200 overflow-hidden">
      <div className={`h-full ${done ? "bg-emerald-500" : "bg-purple-500"}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

/**
 * What a sales-target task asks for, and how far the salesperson has got:
 * by product (units of a product / brand) and by amount (₹), each with a bar.
 */
export function TargetProgress({ task }: { task: any }) {
  const what = task.targetProduct || task.targetBrand || "";
  const qtyT = Number(task.targetQty) || 0;
  const amtT = Number(task.targetAmount) || 0;
  const qty = Number(task.currentQty) || 0;
  const amt = Number(task.currentAmount) || 0;
  const qtyPct = qtyT ? Math.round((qty / qtyT) * 100) : 0;
  const amtPct = amtT ? Math.round((amt / amtT) * 100) : 0;

  return (
    <div className="mt-1.5 p-2 rounded-lg bg-purple-50 border border-purple-200 space-y-2 text-[11px] min-w-[240px]">
      {(what || qtyT > 0) && (
        <div className="space-y-0.5">
          <div className="flex justify-between gap-2 font-bold text-purple-900">
            <span>By product: {what || "Any product"}{task.targetBrand && task.targetProduct ? ` (${task.targetBrand})` : ""}</span>
            {qtyT > 0 && <span>{qty} / {qtyT} units · {qtyPct}%</span>}
          </div>
          {qtyT > 0 ? (
            <>
              <Bar pct={qtyPct} done={qty >= qtyT} />
              <p className="text-[10px] text-purple-700">{qty >= qtyT ? "Target reached" : `${qtyT - qty} unit${qtyT - qty === 1 ? "" : "s"} to go`}</p>
            </>
          ) : (
            <p className="text-[10px] text-purple-700">{qty} sold so far</p>
          )}
        </div>
      )}
      {amtT > 0 && (
        <div className="space-y-0.5">
          <div className="flex justify-between gap-2 font-bold text-purple-900">
            <span>By amount{what ? ` (${what} sales)` : " (all sales)"}</span>
            <span>{inr(amt)} / {inr(amtT)} · {amtPct}%</span>
          </div>
          <Bar pct={amtPct} done={amt >= amtT} />
          <p className="text-[10px] text-purple-700">{amt >= amtT ? "Target reached" : `${inr(amtT - amt)} to go`}</p>
        </div>
      )}
      {!what && qtyT <= 0 && amtT <= 0 && <p className="text-purple-700">No numeric target set.</p>}
    </div>
  );
}
