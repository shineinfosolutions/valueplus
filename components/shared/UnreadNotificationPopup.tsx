"use client";

import { useExclusivePopup } from "@/lib/popup-queue";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import { playNotificationSound } from "@/lib/notification-sound";

/**
 * Pops up the unread notifications once: a notification that has been shown on this device is not shown again
 * (it stays in the bell, unread, until it is opened or marked read). Opening it, or "Mark read", reads it at once
 * and it never comes back.
 */
const POPPED_KEY = "vp-popped-notifications";
const readPopped = (): Set<string> => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(POPPED_KEY) || "[]"));
  } catch {
    return new Set<string>();
  }
};
const savePopped = (s: Set<string>) => {
  try {
    localStorage.setItem(POPPED_KEY, JSON.stringify(Array.from(s).slice(-300)));
  } catch {
    /* fine */
  }
};

export function UnreadNotificationPopup() {
  const { data: session } = useSession();
  const router = useRouter();
  const userId = String((session?.user as any)?.id || "");
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  // Read by this person in this session: never put back by a poll that was already on its way.
  const readIds = useRef<Set<string>>(new Set());

  const check = useCallback(async (reshowAll: boolean) => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (!json.success) return;
      const unread: any[] = (json.data || []).filter((n: any) => !n.readAt && !readIds.current.has(String(n._id)));
      const popped = readPopped();
      // Only the ones not shown on this device before come up in the pop-up.
      const fresh = unread.filter((n) => !popped.has(String(n._id)));
      setItems((cur) => (fresh.length > 0 ? fresh : cur.filter((n) => unread.some((u) => String(u._id) === String(n._id)))));
      if (fresh.length > 0) {
        fresh.forEach((n) => popped.add(String(n._id)));
        savePopped(popped);
        setOpen(true);
        playNotificationSound();
      }
      if (unread.length === 0) setOpen(false);
    } catch {
      /* try again on the next round */
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    check(true);
    const timer = setInterval(() => check(false), 20000);
    return () => clearInterval(timer);
  }, [userId, check]);

  const markRead = async (body: { id?: string; all?: boolean }) => {
    if (body.all) items.forEach((n) => readIds.current.add(String(n._id)));
    else if (body.id) readIds.current.add(body.id);
    setItems((list) => (body.all ? [] : list.filter((n) => String(n._id) !== body.id)));
    try {
      await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      /* it stays unread and shows again */
    }
  };

  useEffect(() => {
    if (open && items.length === 0) setOpen(false);
  }, [open, items.length]);

  const showPopup = useExclusivePopup("unread-notifications", open);
  if (!userId) return null;

  return (
    <Dialog open={showPopup} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#3F63AD]" /> {items.length === 1 ? "1 unread notification" : `${items.length} unread notifications`}
          </DialogTitle>
          <DialogDescription>Open one or press Mark read and it is cleared for good. Anything left stays in the bell.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {items.slice(0, 20).map((n) => (
            <div key={n._id} className="rounded-lg border border-blue-100 bg-blue-50/60 p-3">
              <p className="text-sm font-bold text-slate-900">{n.title}</p>
              {n.message && <p className="text-xs text-slate-600 mt-0.5">{n.message}</p>}
              <div className="flex gap-2 mt-2">
                {n.link && (
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      markRead({ id: String(n._id) });
                      setOpen(false);
                      router.push(n.link);
                    }}
                  >
                    Open
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markRead({ id: String(n._id) })}>
                  Mark read
                </Button>
              </div>
            </div>
          ))}
          {items.length > 20 && <p className="text-xs text-slate-500">+{items.length - 20} more in the bell</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
          <Button onClick={() => { markRead({ all: true }); setOpen(false); }}>Mark all read</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
