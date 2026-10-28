import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import authOptions from "@/lib/authOptions";
import connectToDatabase from "@/lib/db";
import RolePermission from "@/models/RolePermission";
import { Permission, permissionsForRole, roleHasPermission } from "@/lib/permissions";

export interface SessionActor {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: Permission[];
}

/** Overrides are read per request but cached briefly — this map changes rarely. */
let overrideCache: { at: number; data: Record<string, Permission[]> } | null = null;
const OVERRIDE_TTL_MS = 30_000;

export async function loadPermissionOverrides(): Promise<Record<string, Permission[]>> {
  if (overrideCache && Date.now() - overrideCache.at < OVERRIDE_TTL_MS) {
    return overrideCache.data;
  }
  try {
    await connectToDatabase();
    const rows = await RolePermission.find({}).lean();
    const data: Record<string, Permission[]> = {};
    for (const row of rows as any[]) {
      data[String(row.role).toLowerCase()] = (row.permissions || []) as Permission[];
    }
    overrideCache = { at: Date.now(), data };
    return data;
  } catch {
    // A database hiccup must not hand out access it shouldn't, nor deny access it
    // should — falling back to an empty override map means the defaults apply.
    return {};
  }
}

/** Drop the cache so a permission edit takes effect immediately. */
export function invalidatePermissionCache() {
  overrideCache = null;
}

/** The signed-in user, or null when there is no session. */
export async function getActor(): Promise<SessionActor | null> {
  const session = await getServerSession(authOptions);
  const user: any = session?.user;
  if (!user) return null;

  const role = String(user.role || "").toLowerCase();
  const overrides = await loadPermissionOverrides();

  return {
    id: String(user.id || ""),
    name: String(user.name || "Unknown"),
    email: String(user.email || ""),
    role,
    permissions: permissionsForRole(role, overrides),
  };
}

export interface PermissionFailure {
  ok: false;
  response: NextResponse;
}
export interface PermissionSuccess {
  ok: true;
  actor: SessionActor;
}

/**
 * Gate a route handler on one permission.
 *
 * Usage:
 *   const gate = await requirePermission("ledger.vendor.view");
 *   if (!gate.ok) return gate.response;
 *   // gate.actor is the signed-in user
 */
export async function requirePermission(
  permission: Permission
): Promise<PermissionSuccess | PermissionFailure> {
  const actor = await getActor();

  if (!actor) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "You must be signed in to do this." },
        { status: 401 }
      ),
    };
  }

  const overrides = await loadPermissionOverrides();
  if (!roleHasPermission(actor.role, permission, overrides)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: `Your role (${actor.role || "unknown"}) does not have permission to do this.`,
          requiredPermission: permission,
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true, actor };
}
