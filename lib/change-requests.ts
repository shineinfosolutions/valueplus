import { NextResponse } from "next/server";
import StoreActivityApproval from "@/models/StoreActivityApproval";
import AuditLog from "@/models/AuditLog";
import { getActor, SessionActor } from "@/lib/requirePermission";
import { verifySecurityPin } from "@/lib/securityPin";
import { notifyAdmins } from "@/lib/notify";

/**
 * Changing a saved payment or bill after the fact.
 *
 *   Admin          — makes the change straight away (PIN + a reason, and it is logged).
 *   Store Manager  — sends it as a request. NOTHING changes until the Admin approves
 *                    it on the Approvals screen; the Admin sees what it was and what
 *                    it would become, and rejecting leaves everything as it was.
 *   Everyone else  — cannot do it.
 *
 * A request is only ever created here, on the server, from what the Manager sent
 * through the screen that changes it — never from the open approvals API — and it
 * is applied by the same code the Admin's direct change uses.
 */

export const ADMIN_ROLES = ["admin", "superadmin"];

export type ChangeKind = "payment_edit" | "payment_delete" | "invoice_edit" | "purchase_correction" | "backdated_purchase" | "deferred";

export const CHANGE_KINDS: ChangeKind[] = ["payment_edit", "payment_delete", "invoice_edit", "purchase_correction", "deferred"];

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => ({
  ok: false as const,
  response: NextResponse.json({ success: false, error, ...extra }, { status }),
});

/** Who is asking, are they allowed, is the PIN right — and whether this is a direct change or a request. */
export async function authoriseChange(req: Request, pin: string, reason: string) {
  const actor = await getActor();
  if (!actor) return fail(401, "You must be signed in to do this.");

  const isAdmin = ADMIN_ROLES.includes(actor.role);
  const isManager = actor.role === "manager";
  if (!isAdmin && !isManager) {
    return fail(403, "Only the Admin or the Store Manager can change this. Please ask one of them.");
  }

  const trimmedReason = String(reason || "").trim();
  if (trimmedReason.length < 3) return fail(400, "A reason is required and must say what is being corrected.");

  const check = await verifySecurityPin(actor, pin);
  if (!check.ok) return fail(403, check.error || "Incorrect PIN.", { pinFailed: true });

  return {
    ok: true as const,
    actor,
    mode: (isAdmin ? "direct" : "request") as "direct" | "request",
    reason: trimmedReason,
    usedLegacyPin: Boolean(check.usedLegacyPin),
    ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "",
    userAgent: req.headers.get("user-agent") || "",
  };
}

/** One line in the audit trail. Never lets a logging problem undo the change itself. */
export async function auditChange(entry: {
  action: string;
  entityType: string;
  entityRef: string;
  entityId?: string;
  partyName?: string;
  amount?: number;
  reason: string;
  actor: { id?: string; name: string; role?: string };
  ip?: string;
  userAgent?: string;
  usedLegacyPin?: boolean;
  metadata?: any;
}) {
  try {
    await AuditLog.create({
      action: entry.action,
      entityType: entry.entityType,
      entityRef: entry.entityRef,
      entityId: entry.entityId,
      partyName: entry.partyName,
      amount: entry.amount,
      reason: entry.reason,
      performedBy: entry.actor.name,
      performedByUserId: entry.actor.id,
      performedByRole: entry.actor.role,
      pinVerified: true,
      usedLegacyPin: entry.usedLegacyPin,
      ip: entry.ip,
      userAgent: entry.userAgent,
      metadata: entry.metadata,
    });
  } catch (e) {
    console.warn("Notice: audit log write failed:", e);
  }
}

/** The first few things a request changes, as " · field: old → new", for the Admin's notification. */
function changeSummary(before: any, after: any): string {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return "";
  const parts = Object.keys({ ...before, ...after })
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .slice(0, 3)
    .map((k) => {
      const show = (v: any) => (Array.isArray(v) ? `${v.length} line${v.length === 1 ? "" : "s"}` : typeof v === "object" && v ? "…" : String(v ?? "—"));
      return `${k}: ${show(before[k])} → ${show(after[k])}`;
    });
  return parts.length ? ` · ${parts.join(", ")}` : "";
}

/** A version stamp, so an approval can tell the record changed after the request was made. */
export const versionOf = (doc: any) => String(doc?.updatedAt ? new Date(doc.updatedAt).getTime() : "");

/** Sends a Store Manager's change to the Admin. One waiting request per record. */
export async function createChangeRequest(input: {
  kind: ChangeKind;
  /** What the request is about, e.g. "payment:<id>" — one waiting request per target. */
  target: string;
  title: string;
  description: string;
  amount?: number;
  storeName?: string;
  actor: SessionActor;
  reason: string;
  /** What it is now / what it would become — shown to the Admin. */
  before: any;
  after: any;
  /** What is needed to apply it later. */
  data: any;
  baseVersion: string;
  meta?: { ip?: string; userAgent?: string; usedLegacyPin?: boolean };
}): Promise<{ ok: true; request: any } | { ok: false; error: string }> {
  const waiting = await StoreActivityApproval.findOne({ status: "pending", "payload.target": input.target }).lean();
  if (waiting) {
    return { ok: false, error: "A change for this is already waiting for the Admin's approval. Wait for it to be decided first." };
  }

  const activityId = `ACT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}-${Math.floor(100 + Math.random() * 900)}`;
  const request = await StoreActivityApproval.create({
    activityId,
    storeName: input.storeName || "Store",
    storeInchargeName: input.actor.name,
    storeInchargeEmail: input.actor.email || input.actor.name,
    activityType: "general",
    title: input.title,
    description: input.description,
    amount: Number(input.amount) || 0,
    payload: {
      kind: input.kind,
      target: input.target,
      requestedBy: { id: input.actor.id, name: input.actor.name, email: input.actor.email, role: input.actor.role },
      reason: input.reason,
      before: input.before,
      after: input.after,
      data: input.data,
      baseVersion: input.baseVersion,
    },
    status: "pending",
  });

  await auditChange({
    action: "change.requested",
    entityType: "ChangeRequest",
    entityRef: input.target,
    entityId: String(request._id),
    partyName: input.title,
    amount: input.amount,
    reason: input.reason,
    actor: input.actor,
    ip: input.meta?.ip,
    userAgent: input.meta?.userAgent,
    usedLegacyPin: input.meta?.usedLegacyPin,
    metadata: { kind: input.kind, before: input.before, after: input.after, activityId },
  });

  try {
    await notifyAdmins({
      type: "approval_request",
      title: `🔔 Approval needed: ${input.title}`,
      message: `${input.actor.name} · ${input.description}${changeSummary(input.before, input.after)}`,
      link: "/admin/approvals",
      createdBy: input.actor.name,
    });
  } catch (e) {
    console.warn("Notice: could not notify the Admin of the request:", e);
  }
  return { ok: true, request };
}

/**
 * Applies an approved request. Anything that is no longer true — the record was
 * changed, cancelled or deleted since — stops it with a plain message and the
 * request stays waiting, so the Admin can reject it or ask for it again.
 */
export async function executeChangeRequest(
  approval: any,
  approver: SessionActor
): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = approval.payload || {};
  const by = `${p.requestedBy?.name || approval.storeInchargeName} (Store Manager), approved by ${approver.name}`;
  const stale = "This record was changed after the request was made. Reject this request and ask for it again.";

  switch (p.kind as ChangeKind) {
    case "payment_edit":
    case "payment_delete": {
      const PaymentTransaction = (await import("@/models/PaymentTransaction")).default;
      const { editPayment, removePayment, summarisePayment } = await import("@/lib/payment-change");
      const pay: any = await PaymentTransaction.findById(p.data?.paymentId);
      if (!pay) return { ok: false, error: "This payment no longer exists." };
      if (versionOf(pay) !== p.baseVersion) return { ok: false, error: stale };

      if (p.kind === "payment_edit") {
        const r = await editPayment(pay, p.data.changes || {}, approver);
        if (!r.ok) return { ok: false, error: r.error };
        await auditChange({
          action: "payment.edit",
          entityType: "Payment",
          entityRef: pay.transactionId,
          entityId: String(pay._id),
          partyName: pay.partyName,
          amount: p.data.changes?.amount ?? pay.amount,
          reason: `${p.reason} — ${by}`,
          actor: approver,
          metadata: { before: r.before, after: r.after, requestedBy: p.requestedBy },
        });
      } else {
        const before = summarisePayment(pay);
        await removePayment(pay);
        await auditChange({
          action: "payment.delete",
          entityType: "Payment",
          entityRef: pay.transactionId,
          entityId: String(pay._id),
          partyName: pay.partyName,
          amount: pay.amount,
          reason: `${p.reason} — ${by}`,
          actor: approver,
          metadata: { before, requestedBy: p.requestedBy },
        });
      }
      return { ok: true };
    }

    case "invoice_edit": {
      const Invoice = (await import("@/models/Invoice")).default;
      const { fullEditInvoice } = await import("@/lib/invoice-full-edit");
      const inv: any = await Invoice.findOne({ invoiceNumber: p.data?.invoiceNumber });
      if (!inv) return { ok: false, error: "This bill no longer exists." };
      if (versionOf(inv) !== p.baseVersion) return { ok: false, error: stale };
      const r = await fullEditInvoice(inv, p.data.invoice || {}, approver, `${p.reason} — ${by}`, {});
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true };
    }

    case "purchase_correction": {
      const PurchaseEntry = (await import("@/models/PurchaseEntry")).default;
      const { applyPurchaseCorrection } = await import("@/lib/purchase-correction");
      const entry: any = await PurchaseEntry.findOne({ billNo: p.data?.billNo });
      if (!entry) return { ok: false, error: "This purchase bill no longer exists." };
      if (versionOf(entry) !== p.baseVersion) return { ok: false, error: stale };
      const r = await applyPurchaseCorrection(entry, p.data.changes || {}, approver);
      if (!r.ok) return { ok: false, error: r.error };
      await auditChange({
        action: "purchase-entry.correct",
        entityType: "PurchaseEntry",
        entityRef: entry.billNo,
        entityId: String(entry._id),
        partyName: entry.supplierName,
        amount: Number(entry.total) || 0,
        reason: `${p.reason} — ${by}`,
        actor: approver,
        metadata: { before: r.before, after: r.after, requestedBy: p.requestedBy },
      });
      return { ok: true };
    }

    case "deferred": {
      // Any other change the Store Manager asked for (cancel / delete a bill, an item, a party, a stock change...):
      // the same route is run again as the approving Admin.
      const { executeDeferred } = await import("@/lib/deferred-actions");
      return executeDeferred(p.data || {}, approver);
    }

    default:
      // Other kinds (e.g. a back-dated bill) are decided by the approvals route itself.
      return { ok: true };
  }
}
