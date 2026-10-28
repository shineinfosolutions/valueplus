import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import RolePermission from "@/models/RolePermission";
import { requirePermission, invalidatePermissionCache } from "@/lib/requirePermission";
import { ALL_PERMISSIONS, Permission, defaultPermissionsForRole } from "@/lib/permissions";

/** Roles that can be configured. Mirrors the enum on the User model. */
const CONFIGURABLE_ROLES = [
  "manager",
  "accounts",
  "cashier",
  "salesman",
  "sales",
  "warehouse",
  "hr",
  "driver",
  "supplier",
];

export async function GET() {
  const gate = await requirePermission("roles.manage");
  if (!gate.ok) return gate.response;

  try {
    await connectToDatabase();
    const stored = await RolePermission.find({}).lean();
    const overrides = new Map<string, string[]>();
    for (const row of stored as any[]) {
      overrides.set(String(row.role).toLowerCase(), row.permissions || []);
    }

    const roles = CONFIGURABLE_ROLES.map((role) => ({
      role,
      permissions: overrides.get(role) ?? defaultPermissionsForRole(role),
      isCustomised: overrides.has(role),
      defaults: defaultPermissionsForRole(role),
    }));

    return NextResponse.json({
      success: true,
      data: { roles, allPermissions: ALL_PERMISSIONS },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const gate = await requirePermission("roles.manage");
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const role = String(body.role || "").toLowerCase().trim();

    if (!role) {
      return NextResponse.json({ success: false, error: "Role is required" }, { status: 400 });
    }
    // Admin keeps every permission by definition; letting it be edited is the one
    // way to lock everybody out of the permission screen itself.
    if (role === "admin") {
      return NextResponse.json(
        { success: false, error: "The admin role always holds every permission and cannot be edited." },
        { status: 400 }
      );
    }

    const permissions = (Array.isArray(body.permissions) ? body.permissions : []).filter(
      (p: string) => ALL_PERMISSIONS.includes(p as Permission)
    );

    await connectToDatabase();
    const saved = await RolePermission.findOneAndUpdate(
      { role },
      { role, permissions, updatedBy: gate.actor.name },
      { new: true, upsert: true }
    );

    invalidatePermissionCache();
    return NextResponse.json({ success: true, data: saved });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requirePermission("roles.manage");
  if (!gate.ok) return gate.response;

  try {
    const { searchParams } = new URL(req.url);
    const role = String(searchParams.get("role") || "").toLowerCase().trim();
    if (!role) {
      return NextResponse.json({ success: false, error: "Role is required" }, { status: 400 });
    }

    await connectToDatabase();
    await RolePermission.findOneAndDelete({ role });
    invalidatePermissionCache();

    return NextResponse.json({ success: true, message: `${role} reset to its default permissions` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
