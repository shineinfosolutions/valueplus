import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import WhatsAppSetting from "@/models/WhatsAppSetting";
import { getActor } from "@/lib/requirePermission";
import { getWhatsAppSettings } from "@/lib/whatsapp/notify";
import { DEFAULT_EVENT_STATE, EVENT_LIST, WHATSAPP_EVENTS, normalisePhone } from "@/lib/whatsapp/events";

export async function GET() {
  try {
    const settings = await getWhatsAppSettings();

    return NextResponse.json({
      success: true,
      data: {
        provider: settings.provider,
        enabled: settings.enabled,
        adminNumbers: settings.adminNumbers || [],
        notifyCustomer: settings.notifyCustomer,
        businessName: settings.businessName,
        events: { ...DEFAULT_EVENT_STATE, ...(settings.events || {}) },
        eventLabels: WHATSAPP_EVENTS,
        eventList: EVENT_LIST,
        cloudApi: {
          phoneNumberId: settings.cloudApi?.phoneNumberId || "",
          apiVersion: settings.cloudApi?.apiVersion || "v21.0",
          templateName: settings.cloudApi?.templateName || "",
          templateLanguage: settings.cloudApi?.templateLanguage || "en",
          // Never returned; only whether one is stored.
          hasAccessToken: Boolean(settings.cloudApi?.accessToken),
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();

    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
    }
    if (actor.role !== "admin" && actor.role !== "manager") {
      return NextResponse.json(
        { success: false, error: "Only an admin or manager can change WhatsApp settings." },
        { status: 403 }
      );
    }

    const settings = await getWhatsAppSettings();
    const update: any = { updatedBy: actor.name };

    if (body.provider === "manual" || body.provider === "cloud-api") {
      update.provider = body.provider;
    }
    if (typeof body.enabled === "boolean") update.enabled = body.enabled;
    if (typeof body.notifyCustomer === "boolean") update.notifyCustomer = body.notifyCustomer;
    if (typeof body.businessName === "string") update.businessName = body.businessName.trim();

    if (Array.isArray(body.adminNumbers)) {
      // Stored normalised, so a number typed as "+91 75100-02806" and one typed
      // as "7510002806" are the same entry and both reach WhatsApp.
      const cleaned = body.adminNumbers
        .map((n: string) => normalisePhone(n))
        .filter(Boolean) as string[];
      const bad = body.adminNumbers.filter((n: string) => n?.trim() && !normalisePhone(n));
      if (bad.length) {
        return NextResponse.json(
          { success: false, error: `Not a usable WhatsApp number: ${bad.join(", ")}` },
          { status: 400 }
        );
      }
      update.adminNumbers = Array.from(new Set(cleaned));
    }

    if (body.events && typeof body.events === "object") {
      const events: Record<string, boolean> = {};
      for (const key of EVENT_LIST) {
        events[key] = Boolean(body.events[key]);
      }
      update.events = events;
    }

    if (body.cloudApi) {
      update["cloudApi.phoneNumberId"] = String(body.cloudApi.phoneNumberId || "").trim();
      update["cloudApi.apiVersion"] = String(body.cloudApi.apiVersion || "v21.0").trim();
      update["cloudApi.templateName"] = String(body.cloudApi.templateName || "").trim();
      update["cloudApi.templateLanguage"] = String(body.cloudApi.templateLanguage || "en").trim();
      // An empty token means "leave the stored one alone", so re-saving the form
      // without retyping the secret does not wipe it.
      if (body.cloudApi.accessToken) {
        update["cloudApi.accessToken"] = String(body.cloudApi.accessToken).trim();
      }
    }

    // Switching to the Cloud API without credentials would silently fail every
    // message, so it is refused up front rather than discovered later.
    if (update.provider === "cloud-api") {
      const withToken: any = await WhatsAppSetting.findById(settings._id).select(
        "+cloudApi.accessToken"
      );
      const phoneId = update["cloudApi.phoneNumberId"] ?? withToken?.cloudApi?.phoneNumberId;
      const token = update["cloudApi.accessToken"] ?? withToken?.cloudApi?.accessToken;
      if (!phoneId || !token) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Add the Phone Number ID and Access Token before switching to the Cloud API, otherwise every message would fail.",
          },
          { status: 400 }
        );
      }
    }

    await WhatsAppSetting.findByIdAndUpdate(settings._id, { $set: update });
    return NextResponse.json({ success: true, message: "WhatsApp settings saved" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
