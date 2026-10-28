"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { RoleGuard } from "@/components/shared/role-guard";
import { PERMISSION_LABELS, Permission } from "@/lib/permissions";
import { ExportMenu } from "@/components/shared/ExportMenu";

const ROLE_LABELS: Record<string, string> = {
  manager: "Store Manager",
  accounts: "Accounts",
  cashier: "Cashier",
  salesman: "Salesman",
  sales: "Sales",
  warehouse: "Warehouse / Godown",
  hr: "HR",
  driver: "Driver",
  supplier: "Supplier (external login)",
};

interface RoleRow {
  role: string;
  permissions: Permission[];
  isCustomised: boolean;
  defaults: Permission[];
}

export default function RolePermissionsPage() {
  return (
    <RoleGuard permission="roles.manage">
      <RolePermissionsInner />
    </RoleGuard>
  );
}

function RolePermissionsInner() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, Permission[]>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["role-permissions"],
    queryFn: async () => {
      const res = await fetch("/api/roles");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as { roles: RoleRow[]; allPermissions: Permission[] };
    },
  });

  useEffect(() => {
    if (!data) return;
    const next: Record<string, Permission[]> = {};
    for (const row of data.roles) next[row.role] = [...row.permissions];
    setDraft(next);
  }, [data]);

  const save = useMutation({
    mutationFn: async (role: string) => {
      const res = await fetch("/api/roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, permissions: draft[role] || [] }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json;
    },
    onSuccess: (_d, role) => {
      toast.success(`${ROLE_LABELS[role] || role} permissions saved`);
      queryClient.invalidateQueries({ queryKey: ["role-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const reset = useMutation({
    mutationFn: async (role: string) => {
      const res = await fetch(`/api/roles?role=${role}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json;
    },
    onSuccess: () => {
      toast.success("Reset to defaults");
      queryClient.invalidateQueries({ queryKey: ["role-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = (role: string, permission: Permission) => {
    setDraft((prev) => {
      const current = prev[role] || [];
      return {
        ...prev,
        [role]: current.includes(permission)
          ? current.filter((p) => p !== permission)
          : [...current, permission],
      };
    });
  };

  const isDirty = (row: RoleRow) => {
    const current = draft[row.role] || [];
    if (current.length !== row.permissions.length) return true;
    return current.some((p) => !row.permissions.includes(p));
  };

  return (
    <PageShell
      title="Role Permissions"
      subtitle="Who can open which ledger, record payments, and authorise a cancel or delete"
      breadcrumbs={[{ label: "Settings" }, { label: "Role Permissions" }]}
      actions={
        <ExportMenu
          title="Role Permissions"
          subtitle={`${data?.roles.length || 0} roles`}
          data={(data?.roles || []).map((row) => ({
            Role: ROLE_LABELS[row.role] || row.role,
            Status: row.isCustomised ? "Customised" : "Default",
            "Permissions Granted": (draft[row.role] || []).length,
            "Total Permissions": data?.allPermissions.length || 0,
          }))}
          filename="role-permissions"
        />
      }
    >
      <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 flex gap-3">
        <ShieldCheck className="w-5 h-5 text-[#3F63AD] shrink-0 mt-0.5" />
        <div className="text-xs text-slate-700 space-y-1">
          <p className="font-semibold text-slate-900">
            These permissions are enforced on the server, not just in the menu.
          </p>
          <p>
            A role without a permission cannot reach the data by typing the URL or calling the API
            directly. The admin role always holds every permission and is not listed here.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <div className="w-8 h-8 border-3 border-[#30539C] border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <div className="space-y-4">
          {data?.roles.map((row) => (
            <div key={row.role} className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <h3 className="font-bold text-slate-900">{ROLE_LABELS[row.role] || row.role}</h3>
                  <Badge variant={row.isCustomised ? "warning" : "secondary"} className="text-[10px]">
                    {row.isCustomised ? "Customised" : "Default"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {(draft[row.role] || []).length} of {data.allPermissions.length} permissions
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {row.isCustomised && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => reset.mutate(row.role)}
                      disabled={reset.isPending}
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reset
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => save.mutate(row.role)}
                    disabled={!isDirty(row) || save.isPending}
                  >
                    <Save className="w-3.5 h-3.5 mr-1.5" /> Save
                  </Button>
                </div>
              </div>

              <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.allPermissions.map((permission) => {
                  const checked = (draft[row.role] || []).includes(permission);
                  return (
                    <label
                      key={permission}
                      className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(row.role, permission)}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-xs font-semibold text-slate-800">
                          {PERMISSION_LABELS[permission] || permission}
                        </p>
                        <p className="text-[10px] font-mono text-slate-400">{permission}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
