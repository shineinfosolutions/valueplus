"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

/** Roles that can ask for (Store Manager) or make (Admin) a change to a saved payment or bill. */
export function useChangeRole() {
  const { data: session } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const isAdmin = role === "admin" || role === "superadmin";
  const isManager = role === "manager";
  return { role, isAdmin, isManager, canChange: isAdmin || isManager };
}

/**
 * The changes still waiting for the Admin: the Admin sees all of them, a Store Manager
 * sees the ones they sent. `has("payment:<id>")` says whether that record has one
 * waiting — shown as an "Edit pending" badge, and a second request is not allowed.
 */
export function usePendingChanges() {
  const { canChange } = useChangeRole();
  const query = useQuery({
    queryKey: ["pending-changes"],
    enabled: canChange,
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/approvals?status=pending", { cache: "no-store" });
      const json = await res.json();
      return json.success ? (json.data as any[]) : [];
    },
  });
  const targets = useMemo(() => {
    const m = new Map<string, any>();
    for (const a of query.data || []) if (a?.payload?.target) m.set(a.payload.target, a);
    return m;
  }, [query.data]);
  return { has: (target: string) => targets.has(target), get: (target: string) => targets.get(target), refetch: query.refetch };
}
