"use client";

import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { liveOf, shouldRefreshAfterWrite, staleTimeOf, writtenApiPath } from "@/lib/live-paths";

/**
 * Data freshness across the whole app.
 *
 * This used to cache every query for five minutes with `refetchOnMount` and
 * `refetchOnWindowFocus` both off, which meant that after raising a bill the
 * dashboard, the ledgers and the invoice list all kept serving stale numbers
 * until the page was reloaded by hand. Then it swung the other way: every save
 * refreshed every query on screen and every query refetched on each return to
 * the tab — many API calls (each one a paid Worker run) for one save.
 *
 * Screens now stay current with fewer calls:
 *
 *  1. A successful write refreshes only what it can have changed. A query that
 *     lists its API paths in `meta.live` (see RealtimeProvider) refreshes only
 *     when the write's path matches one of them — the same rule the live-update
 *     socket uses. A query without `meta.live` still refreshes after every write,
 *     as before, because nothing else would tell it.
 *  2. Mount and reconnect refetch stale data. Returning to the tab refetches only
 *     queries without `meta.live`: the ones with it are kept current by the
 *     live-update socket, so a refetch on focus would only repeat what it said.
 *  3. A BroadcastChannel repeats the signal (with the written paths) to the
 *     app's other tabs, so billing in one window updates a dashboard in another.
 *
 * Writes are caught in two places — the mutation cache for `useMutation`, and a
 * fetch wrapper that sees every non-GET call to our API (useMutation's fetches
 * included). Both funnel into one debounced refresh, so a save that fires
 * several requests still costs a single refresh.
 *
 * Master data (categories, brands, units, plans, company profile) changes
 * rarely: such a query can keep its answer longer with
 * `staleTime: MASTER_DATA_STALE_TIME`, or `meta: { staleTime: "master" }`.
 * It still refreshes after a write as described above.
 */

const REFRESH_CHANNEL = "valueplus-data-changed";
const DEBOUNCE_MS = 250;

/** Signals some screens already dispatch; still honoured, not replaced. Each names what it changed. */
const LEGACY_EVENTS: Record<string, string[]> = {
  "erp-invoice-created": ["/api/invoices"],
  "erp-payment-created": ["/api/payments"],
  "erp-customer-updated": ["/api/customers"],
  "erp-purchase-created": ["/api/purchase-entries"],
  "erp-warehouses-updated": ["/api/warehouses"],
};

export { MASTER_DATA_STALE_TIME } from "@/lib/live-paths";

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  // Shared by the mutation cache and the fetch wrapper so the two never
  // double-refresh for the same save.
  const invalidateRef = useRef<(broadcast: boolean, changed: string[] | "all") => void>(() => {});

  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache({
          // The mutation's own fetch already reported its path (fetch wrapper below). A mutation
          // may name the paths it writes in `meta.live`; otherwise only queries without
          // `meta.live` are refreshed here — the live ones hear about the write from the
          // wrapper or the live-update socket.
          onSuccess: (_data, _vars, _ctx, mutation) => invalidateRef.current(true, liveOf(mutation.options) || []),
        }),
        defaultOptions: {
          queries: {
            // Short enough that a screen reopened moments later is current, long
            // enough that flipping between tabs is not a burst of requests.
            staleTime: (query) => staleTimeOf(query.meta),
            gcTime: 30 * 60 * 1000,
            // Kept current by the live-update socket when the query has `meta.live`.
            refetchOnWindowFocus: (query) => !liveOf(query),
            refetchOnMount: true,
            refetchOnReconnect: true,
            retry: 1,
          },
        },
      })
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Paths written since the last refresh; "all" when one of the saves did not say.
    let pending: string[] | "all" = [];
    let pendingBroadcast = false;

    let channel: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      try {
        channel = new BroadcastChannel(REFRESH_CHANNEL);
      } catch {
        channel = null;
      }
    }

    const invalidate = (broadcast: boolean, changed: string[] | "all") => {
      pending = changed === "all" || pending === "all" ? "all" : [...pending, ...changed];
      pendingBroadcast = pendingBroadcast || broadcast;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const paths = pending;
        const send = pendingBroadcast;
        pending = [];
        pendingBroadcast = false;
        queryClient.invalidateQueries({ predicate: (q) => shouldRefreshAfterWrite(q, paths) });
        if (send && channel) {
          try {
            channel.postMessage({ at: Date.now(), paths });
          } catch {
            // Losing cross-tab sync must not affect this tab.
          }
        }
      }, DEBOUNCE_MS);
    };

    invalidateRef.current = invalidate;

    // A message from another tab refreshes here, but is not re-broadcast. An older tab's
    // message carries no paths: refresh everything, as that tab expects.
    if (channel) {
      channel.onmessage = (e: MessageEvent) => {
        const paths = e?.data?.paths;
        invalidate(false, paths === "all" || !Array.isArray(paths) ? "all" : paths.map(String));
      };
    }

    const legacyHandlers = Object.entries(LEGACY_EVENTS).map(([name, paths]) => {
      const handler = () => invalidate(true, paths);
      window.addEventListener(name, handler);
      return [name, handler] as const;
    });

    // Catch writes that never go through useMutation. Only non-GET calls to our
    // own API count, and the refresh they cause is a GET, so this cannot feed
    // itself.
    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      try {
        const method = String(
          init?.method || (typeof input === "object" && "method" in input ? input.method : "GET")
        );

        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : (input as Request)?.url || "";

        const path = writtenApiPath(method, url, response.ok);
        if (path) invalidate(true, [path]);
      } catch {
        // Never let the wrapper break the request it is watching.
      }
      return response;
    };

    return () => {
      if (timer) clearTimeout(timer);
      channel?.close();
      window.fetch = originalFetch;
      legacyHandlers.forEach(([name, handler]) => window.removeEventListener(name, handler));
      invalidateRef.current = () => {};
    };
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
