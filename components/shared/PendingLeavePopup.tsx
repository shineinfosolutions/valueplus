"use client";

import { useExclusivePopup } from "@/lib/popup-queue";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { playNotificationSound } from "@/lib/notification-sound";

const KIND_LABEL: Record<string, string> = { leave: "Leave", break: "Break", emergency: "Emergency leave" };

/**
 * Pops up for the Admin (leave, emergency leave, break) and the Store Manager (break) when a staff member
 * sends a request, with all the details and Approve / Reject. Checks every 20 seconds.
 */
export function PendingLeavePopup() {
  const { data: session } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const isReviewer = ["admin", "superadmin", "manager"].includes(role);
  const [fresh, setFresh] = useState<any[]>([]);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isReviewer) return;
    let stop = false;
    const check = async () => {
      try {
        const json = await (await fetch("/api/staff/leave-requests?status=pending&decidable=1")).json();
        if (stop || !json.success) return;
        const news = (json.data as any[]).filter((r) => !seen.current.has(String(r._id)));
        news.forEach((r) => seen.current.add(String(r._id)));
        if (news.length > 0) {
          setFresh((prev) => [...prev, ...news]);
          playNotificationSound();
        }
      } catch {
        /* try again on the next round */
      }
    };
    check();
    const timer = setInterval(check, 20000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [isReviewer]);

  const showPopup = useExclusivePopup("pending-leave", fresh.length > 0);
  if (!isReviewer) return null;

  const decide = async (r: any, decision: "approve" | "reject") => {
    let note = "";
    if (decision === "reject") {
      const n = window.prompt("Reason for rejecting (optional):");
      if (n === null) return;
      note = n;
    }
    const json = await (await fetch("/api/staff/leave-requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r._id, decision, note }) })).json();
    if (json.success) {
      toast.success(json.message);
      setFresh((prev) => prev.filter((x) => x._id !== r._id));
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
    } else {
      toast.error(json.error || "Could not save the decision");
    }
  };

  return (
    <Dialog open={showPopup} onOpenChange={(open) => { if (!open) setFresh([]); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{fresh.length === 1 ? "New request from staff" : `${fresh.length} requests from staff`}</DialogTitle>
          <DialogDescription>Check the details and approve or reject.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {fresh.map((r) => (
            <div key={r._id} className={`rounded-lg border p-3 text-sm ${r.kind === "emergency" ? "border-rose-300 bg-rose-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex justify-between gap-2">
                <span className="font-bold">{r.staffName} <span className="text-xs font-normal capitalize text-slate-500">({r.staffRole})</span></span>
                <span className="text-xs font-black">{KIND_LABEL[r.kind]}</span>
              </div>
              <p className="text-xs text-slate-700 mt-1">
                {r.kind === "break" ? `${r.breakMinutes} minute break, today` : `${r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`} · ${r.days} day${r.days === 1 ? "" : "s"}`}
              </p>
              {r.reason && <p className="text-xs mt-1 whitespace-pre-wrap">Reason: {r.reason}</p>}
              <div className="mt-2 flex gap-2">
                <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => decide(r, "approve")}>Approve</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs text-rose-700 border-rose-300" onClick={() => decide(r, "reject")}>Reject</Button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setFresh([])}>Later</Button>
          <Button onClick={() => { setFresh([]); router.push("/staff/leave-requests"); }}>Open requests</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
