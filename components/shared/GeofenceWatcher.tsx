"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { todayInIndia } from "@/lib/today";
import { ATTENDANCE_LIVE_PATHS } from "@/components/providers/RealtimeProvider";
import {
  GEOFENCE_CONFIRM_MS,
  GEOFENCE_ENTER_M,
  GEOFENCE_EXIT_M,
  GEOFENCE_MIN_HIDDEN_MS,
  GEOFENCE_ROLES,
  GEOFENCE_SURE_EXIT_M,
  MAX_GPS_ERROR_M,
  STORE,
  distanceM,
} from "@/lib/store-location";

/**
 * Geofence on the phone: while a staff member is checked in (and not checked out), follow the phone's
 * position and tell the server (POST /api/staff/presence) only when they cross the store boundary, plus
 * once when the app comes back after being closed for a while. The server records the time outside
 * (lib/presence.ts).
 *
 * No timers: `watchPosition` calls back when the phone moves. A web app gets no position while it is
 * closed or the screen is locked, so that time is sent as "unknown" (`hiddenMs`) instead of guessed.
 * Mounted once in the dashboard layout; renders nothing.
 */

type Fix = { lat: number; lng: number; accuracy: number; at: number };
const STATE_KEY = "vp-geofence";

const readState = (key: string): "in" | "out" | null => {
  try {
    const v = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    return v?.key === key ? v.state : null;
  } catch {
    return null;
  }
};
// When the app went to the background, kept on the device too: an app that was swiped away starts afresh
// and would otherwise not know it had been closed.
const HIDDEN_KEY = "vp-geofence-hidden";
const readHidden = (key: string): number | null => {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "null");
    return v?.key === key && Number.isFinite(v.at) ? v.at : null;
  } catch {
    return null;
  }
};
const saveHidden = (key: string, at: number | null) => {
  try {
    if (at === null) localStorage.removeItem(HIDDEN_KEY);
    else localStorage.setItem(HIDDEN_KEY, JSON.stringify({ key, at }));
  } catch {
    /* fine */
  }
};
const saveState = (key: string, state: "in" | "out") => {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ key, state }));
  } catch {
    /* fine */
  }
};

export function GeofenceWatcher() {
  const { data: session } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const userName = session?.user?.name || "Staff Member";
  const tracked = GEOFENCE_ROLES.includes(role);
  const today = todayInIndia();

  // The same query (key and request) as AttendancePunchWidget, so the two share one cached answer.
  const { data: attendanceList = [] } = useQuery({
    queryKey: ["my-attendance", today, userName],
    enabled: tracked && !!session?.user?.name,
    queryFn: async () => {
      const res = await fetch(`/api/staff/attendance?date=${today}&staff=${encodeURIComponent(userName)}`);
      const json = await res.json();
      return json.success ? json.data : [];
    },
    meta: { live: ATTENDANCE_LIVE_PATHS },
  });
  const rec: any = attendanceList[0];
  const onShift =
    tracked &&
    !!rec?.checkInTime &&
    rec.checkInTime !== "--" &&
    !(rec.checkOutTime && rec.checkOutTime !== "--") &&
    rec.status !== "On Leave";

  const stateKey = `${today}|${userName}`;
  const firstOut = useRef<Fix | null>(null);
  const hiddenAt = useRef<number | null>(null);
  const resumePending = useRef(false);

  useEffect(() => {
    if (!onShift || typeof navigator === "undefined" || !navigator.geolocation) return;

    let watchId: number | null = null;
    let sending = false;

    const send = async (fix: Fix, event: "move" | "resume", hiddenMs = 0) => {
      if (sending) return;
      sending = true;
      try {
        const res = await fetch("/api/staff/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, hiddenMs }),
          keepalive: true,
        });
        const json = await res.json().catch(() => null);
        const state = json?.data?.state;
        if (state === "in" || state === "out") saveState(stateKey, state);
      } catch {
        // Offline: the next crossing (or the next time the app opens) tells the server again.
      } finally {
        sending = false;
      }
    };

    const onFix = (p: GeolocationPosition) => {
      const fix: Fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() };
      if (!(fix.accuracy <= MAX_GPS_ERROR_M)) return; // too vague to say in or out
      const d = distanceM(fix.lat, fix.lng, STORE.lat, STORE.lng);
      const known = readState(stateKey);

      // The app is back after being closed: one report covers the closed stretch and where they are now.
      if (resumePending.current) {
        resumePending.current = false;
        const hiddenMs = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
        hiddenAt.current = null;
        saveHidden(stateKey, null);
        if (hiddenMs >= GEOFENCE_MIN_HIDDEN_MS) {
          firstOut.current = null;
          send(fix, "resume", hiddenMs);
          return;
        }
      }

      if (d <= GEOFENCE_ENTER_M) {
        firstOut.current = null;
        if (known !== "in") send(fix, "move");
      } else if (d > GEOFENCE_EXIT_M) {
        if (known === "out") return;
        // Well outside: one reading is enough. Just outside: wait for a second one a minute later.
        const sure = d > GEOFENCE_SURE_EXIT_M || (firstOut.current && fix.at - firstOut.current.at >= GEOFENCE_CONFIRM_MS);
        if (sure) {
          firstOut.current = null;
          send(fix, "move");
        } else if (!firstOut.current) {
          firstOut.current = fix;
        }
      }
      // Between the two circles: no change (stops flapping at the door).
    };

    const start = () => {
      if (watchId !== null) return;
      watchId = navigator.geolocation.watchPosition(onFix, () => {}, { enableHighAccuracy: true, maximumAge: 30000, timeout: 60000 });
    };
    const stop = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        saveHidden(stateKey, hiddenAt.current);
        stop();
      } else {
        resumePending.current = hiddenAt.current !== null;
        start();
      }
    };

    // Opened again after being swiped away: the closed stretch is reported with the first position.
    const stored = readHidden(stateKey);
    if (stored && hiddenAt.current === null) {
      hiddenAt.current = stored;
      resumePending.current = true;
    }
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [onShift, stateKey]);

  return null;
}
