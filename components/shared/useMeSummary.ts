"use client";

import { useCallback } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { summaryLivePaths, type MeSummary } from "@/lib/me-summary";

export const ME_SUMMARY_KEY = "me-summary";

/**
 * The one shared "my status" query behind the bell and the pop-ups in the dashboard layout
 * (GET /api/me/summary). Every component that calls this reads the same cached answer, so a page
 * open costs one request instead of one per component. It is refreshed when any path it depends on
 * changes (live-update socket, or a save in this tab), via `meta.live`.
 *
 * The key carries the user id, so a shared phone never shows the previous person's answer.
 */
export function useMeSummary() {
  const { data: session } = useSession();
  const userId = String((session?.user as any)?.id || "");
  const role = String((session?.user as any)?.role || "").toLowerCase();

  return useQuery({
    queryKey: [ME_SUMMARY_KEY, userId],
    enabled: !!userId,
    queryFn: async (): Promise<MeSummary> => {
      const res = await fetch("/api/me/summary", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not load");
      return json.data as MeSummary;
    },
    meta: { live: summaryLivePaths(role) },
    // A failed check is simply tried again on the next change, as each component's own call was.
    retry: false,
  });
}

/**
 * Ask for a fresh summary now (the bell does on return to the app, on reconnect and on a push).
 * A check already on its way is reused, not cancelled and sent again.
 */
export function useRefreshMeSummary() {
  const queryClient = useQueryClient();
  return useCallback(
    (onlyIfOlderThanMs = 0) => {
      if (onlyIfOlderThanMs > 0) {
        const newest = Math.max(
          0,
          ...queryClient.getQueriesData({ queryKey: [ME_SUMMARY_KEY] }).map(([key]) => queryClient.getQueryState(key)?.dataUpdatedAt || 0)
        );
        if (Date.now() - newest < onlyIfOlderThanMs) return;
      }
      queryClient.invalidateQueries({ queryKey: [ME_SUMMARY_KEY] }, { cancelRefetch: false });
    },
    [queryClient]
  );
}
