"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * One "filter by staff" dropdown used across the app (dashboard lead pipeline, staff pages), so it looks and
 * behaves the same everywhere. The value is the person's name as stored on the records ("all" = everyone,
 * UNASSIGNED = records given to no one / "Sales Team"). Names are compared with `sameStaff`, which ignores
 * case and a bracketed suffix such as "(Sales Executive)".
 *
 * Render it only for roles that may look at other people's records; everyone else's lists are already
 * limited to their own by the server.
 */

export const ALL_STAFF = "all";
export const UNASSIGNED = "__unassigned__";

/** Client-safe copy of lib/staff-incentive.ts `normName` (that file imports models). */
export const normStaff = (n: any) => String(n || "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const UNASSIGNED_NAMES = new Set(["", "sales team", "staff", "unassigned"]);

/** Does a record's staff name match the filter value? */
export function sameStaff(recordName: any, filter: string): boolean {
  if (!filter || filter === ALL_STAFF) return true;
  if (filter === UNASSIGNED) return UNASSIGNED_NAMES.has(normStaff(recordName));
  return normStaff(recordName) === normStaff(filter);
}

/** Roles that may filter by staff (see other people's records). */
export const STAFF_FILTER_ROLES = ["admin", "superadmin", "manager", "hr"];

const INACTIVE = new Set(["inactive", "terminated", "suspended"]);

export interface StaffOption {
  id: string;
  name: string;
  role: string;
}

/** Active users (everyone but suppliers), optionally only some roles. Cached for 5 minutes. */
export function useStaffList(roles?: string[]) {
  const { data = [] } = useQuery({
    queryKey: ["staff-filter-users"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const json = await (await fetch("/api/users")).json();
      return (json.success && Array.isArray(json.data) ? json.data : []) as any[];
    },
  });
  const key = (roles || []).join("|");
  return useMemo<StaffOption[]>(() => {
    const allowed = key ? key.split("|") : null;
    return data
      .filter((u) => !INACTIVE.has(String(u.status || "").toLowerCase()))
      .filter((u) => String(u.role || "").toLowerCase() !== "supplier")
      .filter((u) => !allowed || allowed.includes(String(u.role || "").toLowerCase()))
      .map((u) => ({ id: String(u._id), name: String(u.name || "").replace(/\s*\(.*\)\s*$/, "").trim(), role: String(u.role || "") }))
      .filter((u) => u.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, key]);
}

/**
 * The filter value kept in the address bar (`?staff=`), so a refresh or a shared link keeps it.
 * Reads `window.location` directly instead of useSearchParams, which would need a Suspense boundary.
 */
export function useStaffParam(param = "staff"): [string, (v: string) => void] {
  const [value, setValue] = useState(ALL_STAFF);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get(param);
    if (v) setValue(v);
  }, [param]);
  const update = (v: string) => {
    setValue(v);
    try {
      const url = new URL(window.location.href);
      if (!v || v === ALL_STAFF) url.searchParams.delete(param);
      else url.searchParams.set(param, v);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // The filter still works; only the address is not updated.
    }
  };
  return [value, update];
}

interface StaffFilterProps {
  value: string;
  onChange: (v: string) => void;
  /** Only list these roles (e.g. ["salesman", "sales"]). */
  roles?: string[];
  /** Count shown after each name, keyed by `normStaff(name)`; UNASSIGNED for the unassigned option. */
  counts?: Record<string, number>;
  /** Total shown on "All staff". */
  total?: number;
  /** Offer "Unassigned / Sales Team". */
  includeUnassigned?: boolean;
  className?: string;
  placeholder?: string;
}

export function StaffFilter({ value, onChange, roles, counts, total, includeUnassigned, className, placeholder = "All staff" }: StaffFilterProps) {
  const staff = useStaffList(roles);
  const count = (k: string) => (counts && counts[k] != null ? ` (${counts[k]})` : counts ? " (0)" : "");
  // A value from the address bar that is not in the list (e.g. a former employee) is still shown.
  const known = value === ALL_STAFF || value === UNASSIGNED || staff.some((s) => normStaff(s.name) === normStaff(value));

  return (
    <Select value={value || ALL_STAFF} onValueChange={onChange}>
      <SelectTrigger className={cn("h-8 text-xs font-semibold gap-1.5", className)} aria-label="Filter by staff">
        <Users className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={ALL_STAFF}>
          {placeholder}
          {total != null ? ` (${total})` : ""}
        </SelectItem>
        {includeUnassigned && <SelectItem value={UNASSIGNED}>Unassigned / Sales Team{count(UNASSIGNED)}</SelectItem>}
        {!known && <SelectItem value={value}>{value}</SelectItem>}
        {staff.map((s) => (
          <SelectItem key={s.id} value={s.name}>
            {s.name}
            {count(normStaff(s.name))}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
