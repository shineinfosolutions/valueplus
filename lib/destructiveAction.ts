import { deferredContext } from "@/lib/deferred-context";
import { deferManagerRequest } from "@/lib/deferred-actions";
import { NextResponse } from "next/server";
import { getActor } from "@/lib/requirePermission";
import { requirePinAndPermission, verifySecurityPin } from "@/lib/securityPin";
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
  reason: string,
  /** What the route already read from the request (a body can only be read once). */
  body?: any
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

  // An approved request of the Store Manager is being carried out: the Manager already gave the PIN and the reason.
  if (deferredContext.getStore()) {
    return {
      ok: true as const,
      actor,
      reason: trimmedReason,
      usedLegacyPin: false,
      ip: "",
      userAgent: "",
    };
  }

  // A Store Manager only sends a request (the Admin decides), so his role permission is not what stops it: his PIN is checked.
  const check = actor.role === "manager" ? await verifySecurityPin(actor, pin) : await requirePinAndPermission(actor, permission, pin);
  if (!check.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: check.error, pinFailed: true },
        { status: 403 }
      ),
    };
  }

  // A Store Manager does not cancel / delete: the request goes to the Admin, who decides.
  if (actor.role === "manager") {
    const url = new URL(req.url);
    const what = permission.startsWith("invoice") ? "bill" : "purchase bill";
    const verb = permission.endsWith("delete") ? "Delete" : "Cancel";
    const ref = String(url.searchParams.get("invoiceNumber") || url.searchParams.get("id") || body?.invoiceNumber || body?.billNo || body?.id || "");
    const response = await deferManagerRequest(req, actor, {
      title: `${verb} ${what}${ref ? ` ${ref}` : ""}`,
      description: `${verb} a ${what}${ref ? ` (${ref})` : ""}. Reason: ${trimmedReason}`,
      target: `${permission}:${req.method}:${url.pathname}${url.search.replace(/[?&](pin)=[^&]*/g, "")}`.slice(0, 300),
      reason: trimmedReason,
      body,
    });
    return { ok: false as const, response };
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
