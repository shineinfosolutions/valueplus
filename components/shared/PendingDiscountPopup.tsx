"use client";

import { useExclusivePopup } from "@/lib/popup-queue";
import { useLive } from "@/components/providers/RealtimeProvider";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { playNotificationSound } from "@/lib/notification-sound";

/**
 * Pops up for the Store Manager (discount up to 10%) and the Admin (all) when someone asks for a discount of
 * 1% or more below a product's selling price: who asked, the product and brand, the percent and the amount.
 * Checked the moment a discount request is sent or decided (live-update socket), since the person at the counter is waiting.
 */
export function PendingDiscountPopup() {
  const { data: session } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const isReviewer = ["admin", "superadmin", "manager"].includes(role);
  const [open, setOpen] = useState<any[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState(false);

  const check = async () => {
    try {
      const json = await (await fetch("/api/discount-approvals?status=pending")).json();
      if (!json.success) return;
      const rows: any[] = json.data;
      const fresh = rows.filter((r) => !seen.current.has(String(r._id)));
      fresh.forEach((r) => seen.current.add(String(r._id)));
      setOpen(rows);
      if (fresh.length > 0) {
        setDismissed(false);
        playNotificationSound();
      }
    } catch {
      /* checked again on the next change */
    }
  };

  useEffect(() => {
    if (isReviewer) check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReviewer]);
  // Checked again only when the server announces a change (live-update socket), not on a timer.
  useLive(["/api/discount-approvals"], () => check(), isReviewer);

  const showPopup = useExclusivePopup("pending-discount", open.length > 0 && !dismissed);
  if (!isReviewer) return null;

  const decide = async (r: any, decision: "approve" | "reject") => {
    let note = "";
    if (decision === "reject") {
      const n = window.prompt("Reason for rejecting (optional):");
      if (n === null) return;
      note = n;
    }
    const json = await (await fetch("/api/discount-approvals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r._id, decision, note }) })).json();
    if (json.success) {
      toast.success(json.message);
      setOpen((prev) => prev.filter((x) => x._id !== r._id));
    } else {
      toast.error(json.error || "Could not save the decision");
    }
  };

  return (
    <Dialog open={showPopup} onOpenChange={(o) => { if (!o) setDismissed(true); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{open.length === 1 ? "Discount approval needed" : `${open.length} discounts need approval`}</DialogTitle>
          <DialogDescription>Someone is waiting at the counter. Check the details and decide.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {open.map((r) => (
            <div key={r._id} className={`rounded-lg border p-3 text-sm ${r.tier === "admin" ? "border-rose-300 bg-rose-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex justify-between gap-2">
                <span className="font-bold">{r.itemName}</span>
                <span className="font-black text-rose-700">{r.percent}% off</span>
              </div>
              <p className="text-xs text-slate-600">{r.brand ? `Brand: ${r.brand} · ` : ""}Qty {r.quantity} · {r.context === "estimate" ? "Estimate" : "Bill"} for {r.customerName}</p>
              <div className="mt-1 grid grid-cols-3 gap-1 text-center text-[11px]">
                <div><p className="text-slate-500">Selling price</p><p className="font-bold">{formatCurrency(r.sellingPrice)}</p></div>
                <div><p className="text-slate-500">Offered</p><p className="font-bold">{formatCurrency(r.price)}</p></div>
                <div><p className="text-slate-500">Less (total)</p><p className="font-bold text-rose-700">{formatCurrency((r.sellingPrice - r.price) * (r.quantity || 1))}</p></div>
              </div>
              <p className="mt-1 text-xs">Requested by <b>{r.requestedBy}</b> <span className="capitalize text-slate-500">({r.requestedByRole})</span>{r.tier === "admin" ? " · above 10%, Admin only" : ""}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => decide(r, "approve")}>Approve</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs text-rose-700 border-rose-300" onClick={() => decide(r, "reject")}>Reject</Button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDismissed(true)}>Later</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
