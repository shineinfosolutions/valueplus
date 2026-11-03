"use client";

import { installSoundUnlock, playNotificationSound } from "@/lib/notification-sound";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Bell, CheckCheck, ShieldAlert, BellRing, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { pushSupported, registerThisDevice, sendTestPush } from "@/lib/push-client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * The bell at the top of every page: the signed-in user's own notifications —
 * a task or sales target given to them, an approval answered, and for admins a
 * new approval request — plus, for admins, the count of approvals waiting.
 *
 * Checked every 10 seconds while the page is open, and at once when the tab
 * comes back into view or the connection returns. Anything new since the last
 * check pops up on screen, and as a phone/desktop notification once the user
 * has turned those on from the bell.
 */

const POLL_MS = 10_000;

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationBell() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const isAdmin = role === "admin" || role === "superadmin";

  const [items, setItems] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [canAlert, setCanAlert] = useState<NotificationPermission | "unsupported">("unsupported");
  // This device is signed up to receive notifications even when the app is closed.
  const [deviceOn, setDeviceOn] = useState(false);
  const [testing, setTesting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Newest notification already seen; null until the first load, so opening the
  // app doesn't pop up everything that arrived earlier.
  const lastSeenRef = useRef<string | null>(null);
  const markReadRef = useRef<(body: { id?: string; all?: boolean }) => void>(() => {});

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) setCanAlert(window.Notification.permission);
    installSoundUnlock();
  }, []);

  // A device that already allowed notifications is (re)signed up quietly for whoever is logged in
  // now — so a shared phone sends notifications to the person using it, and nobody else.
  const userId = String((session?.user as any)?.id || "");
  useEffect(() => {
    if (!userId || !pushSupported() || window.Notification.permission !== "granted") return;
    let cancelled = false;
    registerThisDevice({ askPermission: false }).then((r) => {
      if (!cancelled) setDeviceOn(r.ok);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    try {
      const res = await fetch("/api/notifications", { signal, cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (!json.success) return;
      const list: any[] = json.data || [];
      setItems(list);
      setUnread(json.unreadCount || 0);

      const newest = list[0]?.createdAt || null;
      if (lastSeenRef.current !== null) {
        const fresh = list.filter((n) => !n.readAt && n.createdAt > (lastSeenRef.current as string)).reverse();
        if (fresh.length > 0) playNotificationSound();
        for (const n of fresh) {
          toast(n.title, {
            description: n.message,
            duration: 8000,
            action: n.link ? { label: "Open", onClick: () => { markReadRef.current({ id: String(n._id) }); router.push(n.link); } } : undefined,
          });
          if ("Notification" in window && window.Notification.permission === "granted") {
            try {
              const shown = new window.Notification(n.title, { body: n.message, icon: "/icons/icon-192.png", tag: String(n._id) });
              shown.onclick = () => {
                window.focus();
                markReadRef.current({ id: String(n._id) });
                if (n.link) router.push(n.link);
              };
            } catch {
              /* some mobile browsers only allow notifications from a service worker */
            }
          }
        }
      }
      if (newest && (lastSeenRef.current === null || newest > lastSeenRef.current)) lastSeenRef.current = newest;
      if (lastSeenRef.current === null) lastSeenRef.current = "";

      if (isAdmin) {
        const a = await fetch("/api/approvals?status=pending", { signal, cache: "no-store" });
        if (a.ok) {
          const aj = await a.json();
          if (aj.success) setPendingApprovals(aj.pendingCount || 0);
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") console.warn("Notifications check skipped (network unavailable)");
    }
  }, [isAdmin, router]);

  useEffect(() => {
    if (!session?.user) return;
    const controller = new AbortController();
    load(controller.signal);
    const interval = setInterval(() => load(controller.signal), POLL_MS);
    const onBack = () => load(controller.signal);
    const onVisible = () => document.visibilityState === "visible" && load(controller.signal);
    window.addEventListener("online", onBack);
    window.addEventListener("focus", onBack);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener("online", onBack);
      window.removeEventListener("focus", onBack);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session?.user, load]);

  const markRead = async (body: { id?: string; all?: boolean }) => {
    setItems((list) => list.map((n) => (body.all || n._id === body.id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n)));
    setUnread((u) => (body.all ? 0 : Math.max(0, u - 1)));
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      /* re-synced on the next check */
    }
  };

  markReadRef.current = markRead;

  // A push that arrives while the app is open is not shown by the phone (the app shows it itself),
  // so the service worker tells us and we look straight away instead of waiting for the next check.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "push") load();
      // A push arrived while the app is alive but in the background: play the chime too.
      if (e.data?.type === "push-sound") playNotificationSound();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [load]);

  const open = (n: any) => {
    if (!n.readAt) markRead({ id: n._id });
    setMenuOpen(false);
    if (n.link) router.push(n.link);
  };

  const turnOnAlerts = async () => {
    if (!("Notification" in window)) return;
    const result = await registerThisDevice({ askPermission: true });
    setCanAlert(result.permission);
    setDeviceOn(result.ok);
    if (result.ok) {
      toast.success("Alerts are on — new notifications will reach this device even when the app is closed.");
    } else if (result.permission === "denied") {
      toast.error("Alerts are blocked on this device. Allow notifications for this app in the phone's settings.");
    } else if (result.permission === "granted") {
      toast.warning(result.reason || "Pop-up alerts are on, but this device could not be set up for background alerts.");
    }
  };

  const runTest = async () => {
    setTesting(true);
    const r = await sendTestPush();
    setTesting(false);
    if (r.ok) toast.success(r.message);
    else toast.error(r.message);
  };

  const badge = unread + (isAdmin ? pendingApprovals : 0);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={badge > 0 ? `${badge} new notifications` : "Notifications"}
          className="relative w-11 h-11 flex items-center justify-center rounded-full hover:bg-slate-100 active:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#30539C]/40"
        >
          <Bell className={cn("w-5 h-5", badge > 0 && "text-slate-800")} />
          {badge > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 bg-red-600 text-white text-[10px] font-black rounded-full border-2 border-white flex items-center justify-center animate-pulse">
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} collisionPadding={12} className="w-[calc(100vw-24px)] sm:w-[360px] rounded-2xl shadow-2xl p-0 overflow-hidden border-slate-200">
        <div className="bg-slate-900 text-white px-3 py-2 flex items-center justify-between gap-2">
          <div>
            <p className="font-bold text-[13px] leading-tight">Notifications</p>
            <p className="text-[10px] text-slate-300">{unread > 0 ? `${unread} unread` : "You're all caught up"}</p>
          </div>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markRead({ all: true })}
                className="text-[11px] font-bold text-amber-400 hover:underline flex items-center gap-1"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
            <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close notifications" className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {isAdmin && pendingApprovals > 0 && (
          <Link
            href="/admin/approvals"
            onClick={() => setMenuOpen(false)}
            className="flex items-center justify-between gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-xs font-bold text-amber-900 hover:bg-amber-100"
          >
            <span className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              {pendingApprovals} approval {pendingApprovals === 1 ? "request" : "requests"} waiting
            </span>
            <span className="text-amber-700">Review →</span>
          </Link>
        )}

        <div className="max-h-[50vh] sm:max-h-[360px] overflow-y-auto divide-y">
          {items.length === 0 ? (
            <div className="p-6 text-center">
              <Bell className="w-7 h-7 text-slate-300 mx-auto mb-1.5" />
              <p className="text-xs font-bold text-slate-700">No notifications yet</p>
              <p className="text-[11px] text-slate-400">Tasks, targets and approvals for you will show here.</p>
            </div>
          ) : (
            items.map((n) => (
              <button
                key={n._id}
                type="button"
                onClick={() => open(n)}
                className={cn("w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors flex gap-2", !n.readAt && "bg-blue-50/50")}
              >
                <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", n.readAt ? "bg-transparent" : "bg-[#3F63AD]")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-xs text-slate-900", !n.readAt ? "font-bold" : "font-medium")}>{n.title}</span>
                  {n.message && <span className="block text-[11px] text-slate-600 line-clamp-2 mt-0.5">{n.message}</span>}
                  <span className="block text-[10px] text-slate-400 mt-0.5">
                    {timeAgo(n.createdAt)}
                    {n.createdBy ? ` · from ${n.createdBy}` : ""}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        {canAlert === "default" && (
          <button
            type="button"
            onClick={turnOnAlerts}
            className="w-full px-4 py-2.5 border-t bg-slate-50 text-xs font-bold text-[#30539C] hover:bg-slate-100 flex items-center justify-center gap-1.5"
          >
            <BellRing className="w-3.5 h-3.5" /> Turn on alerts on this device (works even when the app is closed)
          </button>
        )}
        {canAlert === "granted" && !deviceOn && pushSupported() && (
          <button
            type="button"
            onClick={turnOnAlerts}
            className="w-full px-4 py-2.5 border-t bg-amber-50 text-xs font-bold text-amber-900 hover:bg-amber-100 flex items-center justify-center gap-1.5"
          >
            <BellRing className="w-3.5 h-3.5" /> Finish setting up alerts for when the app is closed
          </button>
        )}
        {canAlert === "granted" && deviceOn && (
          <div className="px-4 py-2 border-t bg-emerald-50/60 flex items-center justify-between gap-2 text-[11px] text-emerald-900">
            <span className="font-semibold">Alerts are on for this device</span>
            <button type="button" onClick={() => playNotificationSound()} className="font-bold text-[#30539C] hover:underline">
              Play sound
            </button>
            <button type="button" onClick={runTest} disabled={testing} className="font-bold text-[#30539C] hover:underline disabled:opacity-50">
              {testing ? "Sending…" : "Send a test"}
            </button>
          </div>
        )}
        {canAlert === "denied" && (
          <p className="px-4 py-2.5 border-t bg-slate-50 text-[11px] text-slate-600">
            Alerts are blocked for this app. Allow notifications in the phone&apos;s settings to get them when the app is closed.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
