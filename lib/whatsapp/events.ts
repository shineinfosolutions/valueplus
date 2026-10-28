/**
 * Every event that can raise a WhatsApp notification, and the text it produces.
 *
 * Templates live here rather than at the call sites so the wording of an alert is
 * changed in one place, and so the admin alert and the customer update for the
 * same event can never drift apart.
 *
 * Two audiences, deliberately worded differently:
 *   admin    — internal, terse, carries the staff name and the reference number
 *   customer — polite, no internal detail, never names the staff involved
 */

export type WhatsAppAudience = "admin" | "customer";

export const WHATSAPP_EVENTS = {
  "complaint.created": "New complaint raised",
  "complaint.status": "Complaint status changed",
  "walkin.created": "New walk-in enquiry",
  "walkin.status": "Walk-in enquiry status changed",
  "lead.created": "New lead added",
  "lead.status": "Lead status changed",
} as const;

export type WhatsAppEvent = keyof typeof WHATSAPP_EVENTS;

export const EVENT_LIST = Object.keys(WHATSAPP_EVENTS) as WhatsAppEvent[];

/** Events that are on unless an admin turns them off. */
export const DEFAULT_EVENT_STATE: Record<string, boolean> = {
  "complaint.created": true,
  "complaint.status": true,
  "walkin.created": true,
  "walkin.status": true,
  "lead.created": false,
  "lead.status": false,
};

/**
 * Normalise an Indian mobile number to the digits WhatsApp expects.
 *
 * Accepts "7510002806", "+91 75100 02806", "0751-000-2806" and returns
 * "917510002806", or null when it is not a usable 10-digit Indian number.
 */
export function normalisePhone(raw: string | undefined | null): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;

  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 13 && digits.startsWith("091")) return digits.slice(1);
  // Anything else is either already an international number or unusable; a
  // plausible length is passed through, a short one is rejected.
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/** A wa.me link that opens WhatsApp with the message already typed. */
export function buildWaLink(toNumber: string, message: string): string {
  return `https://wa.me/${toNumber}?text=${encodeURIComponent(message)}`;
}

interface TemplateContext {
  businessName: string;
  /** Who performed the action, for the internal alert only. */
  actor?: string;
}

export interface MessagePair {
  admin: string;
  customer: string | null;
}

const money = (n: any) =>
  Number(n) ? `Rs ${Number(n).toLocaleString("en-IN")}` : "";

const line = (label: string, value: any) =>
  value ? `${label}: ${value}\n` : "";

/**
 * Build the admin and customer text for one event.
 *
 * A null customer message means this event has nothing worth telling the
 * customer — a new lead being logged, for instance, is internal news only.
 */
export function buildMessages(
  event: WhatsAppEvent,
  entity: any,
  ctx: TemplateContext,
  previousStatus?: string
): MessagePair {
  const biz = ctx.businessName || "Value Plus";
  const by = ctx.actor ? `\nBy: ${ctx.actor}` : "";

  switch (event) {
    case "complaint.created":
      return {
        admin:
          `*NEW COMPLAINT* ${entity.ticketNumber}\n\n` +
          line("Customer", entity.customerName) +
          line("Phone", entity.customerPhone) +
          line("Issue", entity.issueTitle) +
          line("Type", entity.complaintType) +
          line("Priority", entity.priority) +
          line("Product", entity.productName) +
          line("Invoice", entity.invoiceNumber) +
          line("Assigned to", entity.assignedTo) +
          by,
        customer:
          `Hello ${entity.customerName},\n\n` +
          `Your complaint has been registered with ${biz}.\n\n` +
          `Ticket No: *${entity.ticketNumber}*\n` +
          line("Issue", entity.issueTitle) +
          `\nOur team will contact you shortly. Please keep this ticket number for reference.\n\n` +
          `- ${biz}`,
      };

    case "complaint.status": {
      const wasIs = previousStatus
        ? `${previousStatus} -> *${entity.status}*`
        : `*${entity.status}*`;
      // Only the outcomes a customer would care about are worth a message; the
      // internal hops between them are noise on their phone.
      const customerWorthy = ["Action Taken", "Resolved", "Closed"].includes(entity.status);
      const friendly: Record<string, string> = {
        "Action Taken": "Action has been taken on your complaint.",
        Resolved: "Your complaint has been resolved.",
        Closed: "Your complaint has been closed.",
      };

      return {
        admin:
          `*COMPLAINT UPDATE* ${entity.ticketNumber}\n\n` +
          line("Customer", entity.customerName) +
          line("Phone", entity.customerPhone) +
          `Status: ${wasIs}\n` +
          line("Issue", entity.issueTitle) +
          line("Action", entity.actionTaken) +
          line("Notes", entity.resolutionNotes) +
          by,
        customer: customerWorthy
          ? `Hello ${entity.customerName},\n\n` +
            `${friendly[entity.status]}\n\n` +
            `Ticket No: *${entity.ticketNumber}*\n` +
            line("Issue", entity.issueTitle) +
            (entity.actionTaken ? `Action: ${entity.actionTaken}\n` : "") +
            `\nPlease let us know if you have any other questions.\n\n- ${biz}`
          : null,
      };
    }

    case "walkin.created":
      return {
        admin:
          `*NEW WALK-IN ENQUIRY*\n\n` +
          line("Customer", entity.customerName) +
          line("Phone", entity.mobile) +
          line("Reason", entity.reason) +
          line("Product", entity.interestedProduct) +
          line("Budget", money(entity.budget)) +
          line("Staff", entity.staff) +
          line("Follow-up", entity.followUpDate) +
          line("Notes", entity.notes) +
          by,
        customer:
          `Hello ${entity.customerName},\n\n` +
          `Thank you for visiting the ${biz} showroom.\n\n` +
          line("Your enquiry", entity.interestedProduct) +
          `\nOur team will contact you shortly.\n\n- ${biz}`,
      };

    case "walkin.status":
      return {
        admin:
          `*WALK-IN UPDATE*\n\n` +
          line("Customer", entity.customerName) +
          line("Phone", entity.mobile) +
          `Status: ${previousStatus ? `${previousStatus} -> ` : ""}*${entity.status}*\n` +
          line("Product", entity.interestedProduct) +
          line("Lead", entity.leadId) +
          by,
        customer: null,
      };

    case "lead.created":
      return {
        admin:
          `*NEW LEAD* ${entity.leadId || ""}\n\n` +
          line("Customer", entity.customerName) +
          line("Phone", entity.mobile) +
          line("Source", entity.source) +
          line("Product", entity.interestedProduct) +
          line("Value", money(entity.estimatedValue)) +
          line("Assigned", entity.assignedStaff) +
          line("Follow-up", entity.followUpDate) +
          by,
        customer: null,
      };

    case "lead.status": {
      const converted = entity.status === "Converted";
      return {
        admin:
          `*LEAD UPDATE* ${entity.leadId || ""}\n\n` +
          line("Customer", entity.customerName) +
          line("Phone", entity.mobile) +
          `Status: ${previousStatus ? `${previousStatus} -> ` : ""}*${entity.status}*\n` +
          line("Product", entity.interestedProduct) +
          line("Value", money(entity.estimatedValue)) +
          line("Assigned", entity.assignedStaff) +
          by,
        customer: converted
          ? `Hello ${entity.customerName},\n\n` +
            `Thank you for choosing ${biz}. Your purchase is confirmed.\n\n- ${biz}`
          : null,
      };
    }

    default:
      return { admin: "", customer: null };
  }
}

/** The phone number the customer message should go to, per entity shape. */
export function customerPhoneOf(entity: any): string | null {
  return normalisePhone(entity?.customerPhone || entity?.mobile || entity?.phone);
}

/** A short reference for the outbox listing. */
export function entityRefOf(event: WhatsAppEvent, entity: any): string {
  if (event.startsWith("complaint")) return entity?.ticketNumber || "";
  if (event.startsWith("lead")) return entity?.leadId || "";
  return entity?.customerName || "";
}

export function entityTypeOf(event: WhatsAppEvent): string {
  if (event.startsWith("complaint")) return "Complaint";
  if (event.startsWith("lead")) return "Lead";
  return "WalkInQuery";
}
