"use client";

import { useExclusivePopup } from "@/lib/popup-queue";
import { useLive } from "@/components/providers/RealtimeProvider";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { playNotificationSound } from "@/lib/notification-sound";

/**
 * Pops up on the cashier's (and manager's / admin's) screen when a salesman
 * sends an estimate for approval, showing who made it. Checked when estimates change (live-update socket).
 */
export function PendingEstimatePopup() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const isReviewer = ["cashier", "manager", "admin", "superadmin"].includes(role);
  const [fresh, setFresh] = useState<any[]>([]);
  const seen = useRef<Set<string> | null>(null);

  const check = async () => {
    try {
      const res = await fetch("/api/estimates?approval=pending");
      const json = await res.json();
      if (!json.success) return;
      const pending: any[] = json.data;
      if (seen.current === null) {
        // First look after the page opens: show what is already waiting.
        seen.current = new Set();
      }
      const news = pending.filter((e) => !seen.current!.has(String(e._id)));
      news.forEach((e) => seen.current!.add(String(e._id)));
      if (news.length > 0) {
        setFresh((prev) => [...prev, ...news]);
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
  useLive(["/api/estimates"], () => check(), isReviewer);

  const showPopup = useExclusivePopup("pending-estimates", fresh.length > 0);
  if (!isReviewer) return null;

  return (
    <Dialog open={showPopup} onOpenChange={(open) => { if (!open) setFresh([]); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{fresh.length === 1 ? "New bill from a salesman" : `${fresh.length} bills from salesmen`}</DialogTitle>
          <DialogDescription>A customer is buying. Open the bill, confirm payment mode and delivery, and make the invoice.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {fresh.map((e) => (
            <div key={e._id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-mono font-bold">{e.estimateNumber}</span>
                <span className="font-bold">{formatCurrency(e.total || 0)}</span>
              </div>
              <p className="text-xs text-slate-700">Customer: {e.customerName}</p>
              <p className="text-xs font-semibold text-[#3F63AD]">Salesman: {e.salesperson || e.salesExecutive}</p>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setFresh([])}>Later</Button>
          <Button onClick={() => { setFresh([]); router.push("/sales/estimates"); }}>Open bills</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
