import StoreActivityApproval from "@/models/StoreActivityApproval";
import { notifyAdmins } from "@/lib/notify";

/**
 * Changes that wait for the Admin. Anyone other than the Admin who back-dates
 * a bill or a payment, or corrects a saved bill or payment, only files a
 * request; nothing is written until the Admin approves it on /admin/approvals
 * (see app/api/approvals/route.ts, which carries the change out).
 *
 * payload.kind says what is waiting:
 *   invoice_create — a back-dated bill, held whole (payload.body is the bill)
 *   invoice_edit   — a full edit of a saved bill (payload.invoice, payload.reason)
 *   payment_create — a back-dated payment (payload.data)
 *   payment_edit   — a correction to a saved payment (payload.paymentId, payload.changes)
 */

export const isAdminRole = (role: any) => ["admin", "superadmin"].includes(String(role || "").toLowerCase());

export type ApprovalActor = { name: string; email?: string; id?: string; role?: string };

export async function requestAdminApproval(opts: {
  actor: ApprovalActor;
  storeName?: string;
  title: string;
  description: string;
  amount?: number;
  payload: Record<string, any>;
}) {
  const approval = await StoreActivityApproval.create({
    activityId: `ACT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}-${Math.floor(100 + Math.random() * 900)}`,
    storeName: opts.storeName || "Store",
    storeInchargeName: opts.actor.name,
    storeInchargeEmail: opts.actor.email || opts.actor.name,
    activityType: "general",
    title: opts.title,
    description: opts.description,
    amount: Number(opts.amount) || 0,
    payload: {
      ...opts.payload,
      requestedBy: { name: opts.actor.name, email: opts.actor.email || "", id: opts.actor.id || "", role: opts.actor.role || "" },
    },
    status: "pending",
  });
  try {
    await notifyAdmins({
      type: "approval_request",
      title: `🔔 ${opts.title}`,
      message: `${opts.actor.name} · ${opts.description}`,
      link: "/admin/approvals",
      createdBy: opts.actor.name,
    });
  } catch (err) {
    console.warn("Notice: approval notification:", err);
  }
  return approval;
}

/** A request of this kind about this record is already waiting for the Admin. */
export async function pendingApprovalFor(kind: string, match: Record<string, any>) {
  const query: any = { status: "pending", "payload.kind": kind };
  for (const [k, v] of Object.entries(match)) query[`payload.${k}`] = v;
  return StoreActivityApproval.findOne(query).lean();
}
