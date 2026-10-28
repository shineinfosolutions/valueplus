import { NextResponse } from "next/server";
import { getActor } from "@/lib/requirePermission";
import { requirePinAndPermission } from "@/lib/securityPin";
import { Permission } from "@/lib/permissions";

/**
 * Shared gate for destructive actions (cancel / delete) across any entity —
 * originally lived only in the invoices route, duplicated here so purchase
 * entries can require the same signed-in user + role + supervisor PIN check
 * instead of the plain `confirm()` dialog that previously guarded nothing.
 */
export async function authoriseDestructiveAction(
  req: Request,
  permission: Permission,
  pin: string,
  reason: string
) {
  const actor = await getActor();
  if (!actor) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: "You must be signed in to do this." },
        { status: 401 }
      ),
    };
  }

  const trimmedReason = String(reason || "").trim();
  if (trimmedReason.length < 3) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: "A reason is required and must say what happened." },
        { status: 400 }
      ),
    };
  }

  const check = await requirePinAndPermission(actor, permission, pin);
  if (!check.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: check.error, pinFailed: true },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true as const,
    actor,
    reason: trimmedReason,
    usedLegacyPin: Boolean(check.usedLegacyPin),
    ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "",
    userAgent: req.headers.get("user-agent") || "",
  };
}
