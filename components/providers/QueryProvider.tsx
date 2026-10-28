"use client";

import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";

/**
 * Data freshness across the whole app.
 *
 * This used to cache every query for five minutes with `refetchOnMount` and
 * `refetchOnWindowFocus` both off, which meant that after raising a bill the
 * dashboard, the ledgers and the invoice list all kept serving stale numbers
 * until the page was reloaded by hand.
 *
 * Screens now stay current on their own:
 *
 *  1. Any successful write invalidates the cache. React Query refetches only the
 *     queries that are actually mounted, so this costs one round trip for the
 *     screen in front of you — everything else is marked stale and refreshes the
 *     next time it is opened.
 *  2. Focus, mount and reconnect refetch too, so returning to a tab shows
 *     current data.
 *  3. A BroadcastChannel repeats the signal to the app's other tabs, so billing
 *     in one window updates a dashboard open in another.
 *
 * Writes are caught in two places — the mutation cache for `useMutation`, and a
 * fetch wrapper for the screens that still POST with a bare fetch. Both funnel
 * into one debounced invalidate, so a save that fires several requests still
 * costs a single refresh.
 */

const REFRESH_CHANNEL = "valueplus-data-changed";
const DEBOUNCE_MS = 250;

/** Signals some screens already dispatch; still honoured, not replaced. */
const LEGACY_EVENTS = [
  "erp-invoice-created",
  "erp-payment-created",
  "erp-customer-updated",
  "erp-purchase-created",
  "erp-warehouses-updated",
];

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  // Shared by the mutation cache and the fetch wrapper so the two never
  // double-invalidate for the same save.
  const invalidateRef = useRef<(broadcast?: boolean) => void>(() => {});

  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache({
          onSuccess: () => invalidateRef.current(true),
        }),
        defaultOptions: {
          queries: {
            // Short enough that a screen reopened moments later is current, long
            // enough that flipping between tabs is not a burst of requests.
            staleTime: 15 * 1000,
            gcTime: 30 * 60 * 1000,
            refetchOnWindowFocus: true,
            refetchOnMount: true,
            refetchOnReconnect: true,
            retry: 1,
          },
        },
      })
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    let channel: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      try {
        channel = new BroadcastChannel(REFRESH_CHANNEL);
      } catch {
        channel = null;
      }
    }

    const invalidate = (broadcast = false) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        queryClient.invalidateQueries();
        if (broadcast && channel) {
          try {
            channel.postMessage({ at: Date.now() });
          } catch {
            // Losing cross-tab sync must not affect this tab.
          }
        }
      }, DEBOUNCE_MS);
    };

    invalidateRef.current = invalidate;

    // A message from another tab refreshes here, but is not re-broadcast.
    if (channel) channel.onmessage = () => invalidate(false);

    const onLegacyEvent = () => invalidate(true);
    LEGACY_EVENTS.forEach((name) => window.addEventListener(name, onLegacyEvent));

    // Catch writes that never go through useMutation. Only non-GET calls to our
    // own API count, and the refresh they cause is a GET, so this cannot feed
    // itself. NextAuth manages its own state and is left alone.
    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      try {
        const method = String(
          init?.method || (typeof input === "object" && "method" in input ? input.method : "GET")
        ).toUpperCase();

        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : (input as Request)?.url || "";

        if (
          method !== "GET" &&
          method !== "HEAD" &&
          url.includes("/api/") &&
          !url.includes("/api/auth/") &&
          response.ok
        ) {
          invalidate(true);
        }
      } catch {
        // Never let the wrapper break the request it is watching.
      }
      return response;
    };

    return () => {
      if (timer) clearTimeout(timer);
      channel?.close();
      window.fetch = originalFetch;
      LEGACY_EVENTS.forEach((name) => window.removeEventListener(name, onLegacyEvent));
      invalidateRef.current = () => {};
    };
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
