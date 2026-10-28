"use client";

import { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { ShieldAlert } from "lucide-react";
import { Permission, roleHasPermission } from "@/lib/permissions";

interface PermissionPayload {
  role: string;
  name?: string;
  permissions: Permission[];
}

/**
 * The current user's effective permissions.
 *
 * Falls back to the session role's defaults while the request is in flight, so a
 * page does not flash "Access Denied" at an admin on every navigation.
 */
export function usePermissions() {
  const { data: session, status } = useSession();
  const sessionRole = String((session?.user as any)?.role || "").toLowerCase();

  const { data, isLoading } = useQuery<PermissionPayload>({
    queryKey: ["my-permissions"],
    queryFn: async () => {
      const res = await fetch("/api/auth/permissions");
      const json = await res.json();
      return json.success ? json.data : { role: sessionRole, permissions: [] };
    },
    staleTime: 60_000,
    enabled: status === "authenticated",
  });

  const role = data?.role || sessionRole;
  const loading = status === "loading" || (status === "authenticated" && isLoading);

  const can = (permission: Permission): boolean => {
    if (role === "admin") return true;
    if (!data) return roleHasPermission(role, permission);
    return data.permissions.includes(permission);
  };

  return { role, can, loading };
}

export function AccessDenied({ permission }: { permission?: Permission }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center mb-4">
        <ShieldAlert className="w-7 h-7 text-red-500" />
      </div>
      <h2 className="text-lg font-bold text-slate-900">Access Denied</h2>
      <p className="text-sm text-muted-foreground mt-1.5 max-w-md">
        Your role does not have access to this screen. Ask an administrator to grant it
        from Settings &rarr; Role Permissions.
      </p>
      {permission && (
        <p className="mt-3 text-[11px] font-mono text-slate-400">Required: {permission}</p>
      )}
    </div>
  );
}

/**
 * Wrap a page's content to gate it on a permission. The API behind the page is
 * gated separately — this only stops the screen from rendering.
 */
export function RoleGuard({
  permission,
  children,
  fallback,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can, loading } = usePermissions();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-[#30539C] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!can(permission)) {
    return <>{fallback ?? <AccessDenied permission={permission} />}</>;
  }

  return <>{children}</>;
}
