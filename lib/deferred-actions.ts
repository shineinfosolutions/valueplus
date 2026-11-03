import { NextResponse } from "next/server";
import { getActor, SessionActor } from "@/lib/requirePermission";
import { deferredContext } from "@/lib/deferred-context";
import { createChangeRequest } from "@/lib/change-requests";
import connectToDatabase from "@/lib/db";

/**
 * "The Store Manager may do it, but the Admin must say yes."
 *
 * For a Manager, the routes below do NOT carry out the change: they save the exact request (method, address and what
 * was sent, without any PIN) as a waiting approval for the Admin. When the Admin approves, the same route is run
 * again as the Admin (`executeDeferred`), so it does exactly what an Admin doing it directly would, and nothing is
 * written to the books until then. Rejecting leaves everything as it was.
 */

const HANDLERS: Record<string, () => Promise<any>> = {
  "/api/invoices": () => import("@/app/api/invoices/route"),
  "/api/purchase-entries": () => import("@/app/api/purchase-entries/route"),
  "/api/items": () => import("@/app/api/items/route"),
  "/api/customers": () => import("@/app/api/customers/route"),
  "/api/suppliers": () => import("@/app/api/suppliers/route"),
  "/api/inventory/adjustment": () => import("@/app/api/inventory/adjustment/route"),
  "/api/stock-transfers": () => import("@/app/api/stock-transfers/route"),
};

const SYSTEM_KEYS = new Set(["_id", "__v", "createdAt", "updatedAt", "pin", "reason", "password"]);

/** Only what really changes, as { field: value } before and after, for the Admin to read. */
export function diffFields(current: any, body: any): { before: any; after: any } {
  const before: any = {};
  const after: any = {};
  if (!current || !body) return { before, after };
  for (const k of Object.keys(body)) {
    if (SYSTEM_KEYS.has(k)) continue;
    const a = current[k];
    const b = body[k];
    if (a === undefined && (b === "" || b === null)) continue;
    const same = typeof b === "object" || typeof a === "object" ? JSON.stringify(a) === JSON.stringify(b) : String(a ?? "") === String(b ?? "");
    if (!same && typeof b !== "object") {
      before[k] = a ?? "";
      after[k] = b;
    }
  }
  return { before, after };
}

export interface DeferInfo {
  /** What the Admin is asked, e.g. "Delete item VP0001". */
  title: string;
  description: string;
  /** One waiting request per target. */
  target: string;
  reason?: string;
  before?: any;
  after?: any;
  amount?: number;
  /** What the route already read from the request (a body can only be read once). */
  body?: any;
}

/** Saves the Manager's request (already read from `req`) as a waiting approval and gives the answer to send back. */
export async function deferManagerRequest(req: Request, actor: SessionActor, info: DeferInfo): Promise<NextResponse> {
  await connectToDatabase();
  const url = new URL(req.url);
  url.searchParams.delete("pin");
  let body: any = info.body ?? null;
  if (body === null) {
    try {
      const text = await req.clone().text();
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
  }
  if (body && typeof body === "object") {
    body = { ...body };
    delete body.pin;
  }

  const reason = String(info.reason || body?.reason || url.searchParams.get("reason") || "").trim() || "Requested by the Store Manager";
  const made = await createChangeRequest({
    kind: "deferred",
    target: info.target,
    title: info.title,
    description: info.description,
    amount: info.amount,
    actor,
    reason,
    // The Admin always sees what is asked: the changed fields when known, otherwise the request itself.
    before: info.before && Object.keys(info.before).length ? info.before : { Now: "As it is" },
    after: info.after && Object.keys(info.after).length ? info.after : { Now: info.title },
    data: { method: req.method, path: url.pathname + (url.search || ""), body },
    baseVersion: "",
  });
  if (!made.ok) return NextResponse.json({ success: false, error: made.error }, { status: 409 });
  return NextResponse.json({ success: true, pending: true, message: "Sent to the Admin for approval. Nothing changes until the Admin approves it." });
}

/** For a Store Manager: save the request for the Admin and return the response; for anyone else (or an approved re-run): null, carry on. */
export async function deferIfManager(req: Request, info: DeferInfo | (() => Promise<DeferInfo>)): Promise<NextResponse | null> {
  if (deferredContext.getStore()) return null;
  const actor = await getActor();
  if (!actor || actor.role !== "manager") return null;
  const resolved = typeof info === "function" ? await info() : info;
  return deferManagerRequest(req, actor, resolved);
}

/** Carries out an approved request: the saved route is run again as the approving Admin. */
export async function executeDeferred(
  data: { method: string; path: string; body: any },
  approver: SessionActor
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = new URL(data.path, "https://internal.local");
  const load = HANDLERS[url.pathname];
  if (!load) return { ok: false, error: "This kind of request can no longer be carried out." };
  const mod = await load();
  const fn = mod[String(data.method || "").toUpperCase()];
  if (typeof fn !== "function") return { ok: false, error: "This kind of request can no longer be carried out." };

  const hasBody = data.body !== null && data.body !== undefined && data.method !== "GET";
  const req = new Request(url.toString(), {
    method: data.method,
    headers: { "content-type": "application/json" },
    body: hasBody ? JSON.stringify(data.body) : undefined,
  });
  try {
    const res: Response = await deferredContext.run({ approver }, () => fn(req));
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) return { ok: false, error: json?.error || "The change could not be made." };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "The change could not be made." };
  }
}
