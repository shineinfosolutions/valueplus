"use client";

import { useExclusivePopup } from "@/lib/popup-queue";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { pushSupported, registerThisDevice } from "@/lib/push-client";

const ASKED_KEY = "vp-notify-asked-at";
const ASK_AGAIN_MS = 24 * 60 * 60 * 1000;

/**
 * Asks to allow notifications on this device (so alerts arrive with a sound even when the app is
 * closed) — right when the app is first opened, on the login screen, before anyone signs in; after
 * that once a day until answered. The browser / Android permission can only be requested from a tap,
 * so this explains it first and asks on the button. Once allowed, the device is signed up for the
 * person's notifications as soon as they log in (the bell does that).
 */
export function NotificationPermissionPrompt() {
  const { data: session } = useSession();
  const userId = String((session?.user as any)?.id || "");
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported()) return;
    const permission = window.Notification.permission;
    if (permission === "granted") return;
    let last = 0;
    try {
      last = Number(localStorage.getItem(ASKED_KEY)) || 0;
    } catch {
      /* ask anyway */
    }
    if (permission === "denied") {
      // Blocked earlier: only a reminder, and only once in a while.
      if (Date.now() - last < ASK_AGAIN_MS * 7) return;
      setBlocked(true);
    } else if (Date.now() - last < ASK_AGAIN_MS) {
      return;
    }
    // Wait until no other pop-up is on screen, so two dialogs never stack. The very first time (never
    // asked on this device) it comes up at once.
    const firstTime = last === 0;
    const t = setInterval(() => {
      if (!document.querySelector('[role="dialog"]')) {
        clearInterval(t);
        setOpen(true);
      }
    }, firstTime ? 800 : 3000);
    return () => clearInterval(t);
  }, []);

  const remember = () => {
    try {
      localStorage.setItem(ASKED_KEY, String(Date.now()));
    } catch {
      /* fine */
    }
  };

  const allow = async () => {
    setBusy(true);
    // Signed in: ask and sign this device up. Not signed in yet (login screen): only ask; the device is signed up at login.
    const r = userId
      ? await registerThisDevice({ askPermission: true })
      : await window.Notification.requestPermission().then((permission) => ({ ok: permission === "granted", permission, reason: "" }));
    setBusy(false);
    remember();
    if (r.ok) {
      toast.success("Notifications are on for this device.");
      setOpen(false);
    } else if (r.permission === "denied") {
      setBlocked(true);
    } else {
      toast.error(r.reason || "Could not turn on notifications.");
      setOpen(false);
    }
  };

  const showPopup = useExclusivePopup("notification-permission", open);
  return (
    <Dialog open={showPopup} onOpenChange={(o) => { if (!o) { remember(); setOpen(false); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="w-5 h-5 text-[#30539C]" /> Turn on notifications
          </DialogTitle>
          <DialogDescription>
            Get a sound alert for new bills, tasks, targets and approvals, even when the app is closed.
          </DialogDescription>
        </DialogHeader>
        {blocked ? (
          <p className="text-xs text-slate-600 leading-relaxed rounded-lg bg-amber-50 border border-amber-200 p-3">
            Notifications are blocked for this app. Open your phone Settings, then Apps, then ValuePlus, then Notifications, and switch them on.
          </p>
        ) : (
          <p className="text-xs text-slate-600 leading-relaxed">Your phone will ask for permission. Choose Allow.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { remember(); setOpen(false); }}>Not now</Button>
          {!blocked && (
            <Button disabled={busy} onClick={allow}>
              {busy ? "Asking…" : "Allow notifications"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
