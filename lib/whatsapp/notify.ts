import connectToDatabase from "@/lib/db";
import WhatsAppSetting from "@/models/WhatsAppSetting";
import WhatsAppMessage from "@/models/WhatsAppMessage";
import {
  WhatsAppEvent,
  DEFAULT_EVENT_STATE,
  buildMessages,
  buildWaLink,
  customerPhoneOf,
  entityRefOf,
  entityTypeOf,
  normalisePhone,
} from "@/lib/whatsapp/events";

/**
 * Raise the WhatsApp notifications for one event.
 *
 * This is called from inside the CRM save routes, so the single most important
 * property is that it can never break the save it is attached to. Every path is
 * wrapped: a missing config, an unreachable database, a malformed phone number —
 * all of them log and return, they never throw back into the caller.
 *
 * Messages are written to the outbox regardless of provider. With the manual
 * provider they sit as `pending` with a wa.me link for a person to click; with
 * the Cloud API they are attempted immediately and marked sent or failed.
 */

const DEFAULT_ADMIN_NUMBERS = ["917510002806"];

export interface NotifyOptions {
  event: WhatsAppEvent;
  entity: any;
  /** Previous status, so a status-change message can say what it changed from. */
  previousStatus?: string;
  /** Who did it — shown in the internal alert only. */
  actor?: string;
}

/** Load the settings document, creating the default one on first use. */
export async function getWhatsAppSettings() {
  await connectToDatabase();
  let settings = await WhatsAppSetting.findOne({});

  if (!settings) {
    settings = await WhatsAppSetting.create({
      provider: "manual",
      enabled: true,
      adminNumbers: DEFAULT_ADMIN_NUMBERS,
      notifyCustomer: true,
      events: { ...DEFAULT_EVENT_STATE },
      businessName: "Value Plus",
    });
  }

  return settings;
}

/** Post one message through Meta's Cloud API. */
async function sendViaCloudApi(
  settings: any,
  toNumber: string,
  message: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const cfg = settings.cloudApi || {};
  if (!cfg.phoneNumberId || !cfg.accessToken) {
    return { ok: false, error: "Cloud API is selected but the credentials are not set." };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${cfg.apiVersion || "v21.0"}/${cfg.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: toNumber,
          type: "text",
          text: { preview_url: false, body: message },
        }),
      }
    );

    const json = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        error: json?.error?.message || `Cloud API returned ${res.status}`,
      };
    }
    return { ok: true, id: json?.messages?.[0]?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not reach the WhatsApp Cloud API" };
  }
}

/** Write one outbox row, sending it now when the provider can. */
async function queueMessage(params: {
  settings: any;
  event: WhatsAppEvent;
  audience: "admin" | "customer";
  toNumber: string;
  toName: string;
  message: string;
  entityType: string;
  entityRef: string;
  entityId?: string;
  actor?: string;
}) {
  const { settings, ...rest } = params;
  const provider = settings.provider === "cloud-api" ? "cloud-api" : "manual";

  const row: any = {
    event: rest.event,
    audience: rest.audience,
    toNumber: rest.toNumber,
    toName: rest.toName,
    message: rest.message,
    waLink: buildWaLink(rest.toNumber, rest.message),
    entityType: rest.entityType,
    entityRef: rest.entityRef,
    entityId: rest.entityId || "",
    provider,
    triggeredBy: rest.actor || "",
    status: "pending",
    attempts: 0,
  };

  if (provider === "cloud-api") {
    const withToken = await WhatsAppSetting.findById(settings._id).select("+cloudApi.accessToken");
    const result = await sendViaCloudApi(withToken, rest.toNumber, rest.message);
    row.attempts = 1;
    if (result.ok) {
      row.status = "sent";
      row.sentAt = new Date();
      row.providerMessageId = result.id || "";
    } else {
      // A failed send still leaves the row behind, so nothing is lost and the
      // outbox can retry it or fall back to the wa.me link.
      row.status = "failed";
      row.error = result.error || "";
    }
  }

  return WhatsAppMessage.create(row);
}

/**
 * Raise both the admin alert and (where the template has one) the customer
 * update for an event. Returns how many rows were written; never throws.
 */
export async function notifyWhatsApp(options: NotifyOptions): Promise<number> {
  try {
    const { event, entity, previousStatus, actor } = options;
    if (!entity) return 0;

    const settings = await getWhatsAppSettings();
    if (!settings.enabled) return 0;

    const eventState = settings.events || {};
    const isOn = eventState[event] ?? DEFAULT_EVENT_STATE[event] ?? false;
    if (!isOn) return 0;

    const messages = buildMessages(
      event,
      entity,
      { businessName: settings.businessName || "Value Plus", actor },
      previousStatus
    );

    const entityType = entityTypeOf(event);
    const entityRef = entityRefOf(event, entity);
    const entityId = entity?._id ? String(entity._id) : "";
    let written = 0;

    // Internal alert, one per configured admin number.
    const adminNumbers = (settings.adminNumbers?.length
      ? settings.adminNumbers
      : DEFAULT_ADMIN_NUMBERS
    )
      .map((n: string) => normalisePhone(n))
      .filter(Boolean) as string[];

    if (messages.admin) {
      for (const number of adminNumbers) {
        await queueMessage({
          settings,
          event,
          audience: "admin",
          toNumber: number,
          toName: "Admin",
          message: messages.admin,
          entityType,
          entityRef,
          entityId,
          actor,
        });
        written += 1;
      }
    }

    // Customer update, only where the template produced one.
    if (settings.notifyCustomer && messages.customer) {
      const customerNumber = customerPhoneOf(entity);
      if (customerNumber) {
        await queueMessage({
          settings,
          event,
          audience: "customer",
          toNumber: customerNumber,
          toName: entity.customerName || "Customer",
          message: messages.customer,
          entityType,
          entityRef,
          entityId,
          actor,
        });
        written += 1;
      }
    }

    return written;
  } catch (err) {
    // Deliberately swallowed. A notification is never worth failing the complaint,
    // enquiry or lead that triggered it.
    console.warn("Notice: WhatsApp notification skipped:", err);
    return 0;
  }
}
