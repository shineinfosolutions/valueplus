"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLive } from "@/components/providers/RealtimeProvider";
import { useExclusivePopup } from "@/lib/popup-queue";
import { playNotificationSound } from "@/lib/notification-sound";

/**
 * Pops up for a salesman when another salesman shares a lead with him: who, which customer and product.
 * Accept adds the lead to his list; Reject tells the sender. Checked again whenever leads change (live socket).
 */
export function LeadShareInbox() {
  const { data: session } = useSession();
  const myId = String((session?.user as any)?.id || "");
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const enabled = ["salesman", "sales"].includes(role);
  const [rows, setRows] = useState<any[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState("");

  const check = async () => {
    try {
      const json = await (await fetch("/api/crm/leads?shareInbox=1")).json();
      if (!json.success) return;
      const next: any[] = json.data || [];
      setRows((prev) => {
        if (next.some((l) => !prev.some((p) => p._id === l._id))) {
          setDismissed(false);
          playNotificationSound();
        }
        return next;
      });
    } catch {
      /* checked again on the next change */
    }
  };

  useEffect(() => {
    if (enabled) check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  useLive(["/api/crm/leads", "/api/notifications"], () => check(), enabled);

  const show = useExclusivePopup("lead-share-inbox", enabled && rows.length > 0 && !dismissed);
  if (!enabled) return null;

  const respond = async (lead: any, decision: "accept" | "reject") => {
    setBusy(lead._id + decision);
    try {
      const json = await (
        await fetch("/api/crm/leads", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: lead._id, shareRespond: { decision } }),
        })
      ).json();
      if (!json.success) throw new Error(json.error || "Could not save");
      toast.success(json.message);
      setRows((r) => r.filter((x) => x._id !== lead._id));
    } catch (e: any) {
      toast.error(e.message || "Could not save");
    } finally {
      setBusy("");
    }
  };

  return (
    <Dialog open={show} onOpenChange={(o) => { if (!o) setDismissed(true); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>🤝 Lead shared with you ({rows.length})</DialogTitle>
          <DialogDescription>Accept to add the lead to your list. The product you get goes on the bill under your name.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {rows.map((l) => {
            const mine = (l.sharedWith || []).find((s: any) => s.staffId === myId && s.status === "pending") || {};
            return (
              <div key={l._id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <p className="font-bold text-slate-900">{l.customerName} <span className="font-mono text-xs text-slate-500">{l.mobile}</span></p>
                <p className="text-xs text-slate-700">Wants: <b>{mine.products || "—"}</b></p>
                <p className="text-[11px] text-slate-500">
                  From {mine.requestedBy || l.assignedStaff}
                  {l.interestedProduct ? ` · lead: ${l.interestedProduct}` : ""}
                  {mine.note ? ` · “${mine.note}”` : ""}
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => respond(l, "reject")} className="text-rose-600 border-rose-200">
                    Reject
                  </Button>
                  <Button size="sm" disabled={!!busy} onClick={() => respond(l, "accept")} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                    {busy === l._id + "accept" ? "Adding..." : "Accept"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
