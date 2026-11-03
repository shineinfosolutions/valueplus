"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useQueryClient, type Query } from "@tanstack/react-query";

/**
 * Live updates: one WebSocket per open app (served by realtime-hub.ts through worker.ts at /realtime).
 *
 * The server sends only "these API paths changed" — e.g. `{ type: "change", paths: ["/api/estimates"] }` after
 * someone saves an estimate. Screens say which paths their data comes from and fetch again only when one of
 * them changes, instead of asking the server on a timer:
 *
 *  - React Query:  useQuery({ ..., meta: { live: ["/api/estimates", "/api/invoices"] } })
 *  - anything else: useLive(["/api/discount-approvals"], () => check())
 *
 * A path matches itself and everything under it ("/api/staff/attendance" also matches "/api/staff/attendance/photo").
 * After the socket was down (phone asleep, network lost) every subscriber refreshes once, since changes may have
 * been missed meanwhile. Without a hub (`next dev`) nothing is pushed; screens still refresh on focus as before.
 */

type Listener = { paths: string[]; run: () => void };
type Subscribe = (listener: Listener) => () => void;

const RealtimeContext = createContext<Subscribe>(() => () => {});

const PING_MS = 45_000; // answered by the hub's runtime without waking it; keeps proxies from closing an idle socket
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const MAX_FAILED_TRIES = 6; // then wait for the app to come back to the front / online before trying again
const COALESCE_MS = 300; // one save often writes several paths; refetch once

const norm = (p: string) => p.toLowerCase().replace(/\/+$/, "");
const matches = (changed: string, watched: string) => changed === watched || changed.startsWith(`${watched}/`);
const anyMatch = (changed: string[], watched: string[]) => watched.some((w) => changed.some((c) => matches(c, norm(w))));
const liveOf = (q: Query): string[] | null => {
  const live = (q.meta as any)?.live;
  return Array.isArray(live) && live.length ? live : null;
};

export default function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const queryClient = useQueryClient();
  const listeners = useRef(new Set<Listener>());

  const subscribe: Subscribe = useCallback((listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || typeof window === "undefined" || !("WebSocket" in window)) return;

    let ws: WebSocket | null = null;
    let stopped = false;
    let retryMs = RETRY_MIN_MS;
    let failedTries = 0; // attempts in a row that never opened (signed out, no hub on `next dev` ...)
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let wasOpen = false; // reconnecting after a drop → catch up once
    let pending: string[] | "all" = [];

    const flush = () => {
      flushTimer = null;
      const changed = pending;
      pending = [];
      const hit = (paths: string[]) => changed === "all" || anyMatch(changed, paths);
      queryClient.invalidateQueries({
        predicate: (q) => {
          const live = liveOf(q);
          return !!live && hit(live);
        },
      });
      listeners.current.forEach((l) => {
        if (!hit(l.paths)) return;
        try {
          l.run();
        } catch (e) {
          console.warn("live update failed:", e);
        }
      });
    };
    const queue = (changed: string[] | "all") => {
      pending = changed === "all" || pending === "all" ? "all" : [...pending, ...changed.map(norm)];
      if (!flushTimer) flushTimer = setTimeout(flush, COALESCE_MS);
    };

    const connect = () => {
      if (stopped || (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      const url = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/realtime`;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        scheduleRetry();
        return;
      }
      ws = socket;
      let opened = false;
      socket.onopen = () => {
        opened = true;
        retryMs = RETRY_MIN_MS;
        failedTries = 0;
        if (wasOpen) queue("all");
        wasOpen = true;
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send("ping");
        }, PING_MS);
      };
      socket.onmessage = (e) => {
        if (e.data === "pong") return;
        try {
          const msg = JSON.parse(String(e.data));
          if (msg?.type === "change" && Array.isArray(msg.paths)) queue(msg.paths.map(String));
        } catch {
          // Not ours.
        }
      };
      socket.onclose = () => {
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (ws === socket) ws = null;
        if (!opened) failedTries++;
        scheduleRetry();
      };
      socket.onerror = () => {
        // onclose follows and retries.
      };
    };

    const scheduleRetry = () => {
      // A hidden or offline app waits: it reconnects the moment it is back (see below), not on a timer.
      if (stopped || retryTimer || document.visibilityState !== "visible" || !navigator.onLine) return;
      if (failedTries >= MAX_FAILED_TRIES) return;
      const wait = retryMs + Math.floor(Math.random() * 500);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, wait);
    };

    const onBack = () => {
      if (document.visibilityState !== "visible") return;
      retryMs = RETRY_MIN_MS;
      failedTries = 0;
      connect();
    };

    connect();
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("online", onBack);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("online", onBack);
      if (retryTimer) clearTimeout(retryTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (flushTimer) clearTimeout(flushTimer);
      ws?.close(1000, "signed out");
      ws = null;
    };
  }, [status, queryClient]);

  return <RealtimeContext.Provider value={subscribe}>{children}</RealtimeContext.Provider>;
}

/**
 * Run `onChange` whenever one of these API paths changes on the server (anyone's write, any device).
 * For screens that do not read through React Query — those use `meta: { live: [...] }` instead.
 */
export function useLive(paths: string[], onChange: () => void, enabled = true) {
  const subscribe = useContext(RealtimeContext);
  const run = useRef(onChange);
  run.current = onChange;
  const key = paths.join("|");

  useEffect(() => {
    if (!enabled) return;
    return subscribe({ paths: key.split("|"), run: () => run.current() });
  }, [subscribe, key, enabled]);
}

/** Writes that move the cash book (cash bills, receipts, expenses, handovers, day close, approved changes). */
export const CASH_LIVE_PATHS = [
  "/api/cash-register",
  "/api/admin-cash",
  "/api/day-close",
  "/api/invoices",
  "/api/payments",
  "/api/expenses",
  "/api/vendors/payments",
  "/api/purchase-entries",
  "/api/approvals",
];

/** Writes that change someone's attendance for the day (check-in/out, breaks, leave). */
export const ATTENDANCE_LIVE_PATHS = ["/api/staff/attendance", "/api/staff/break", "/api/staff/leave-requests"];
