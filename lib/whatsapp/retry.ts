import WhatsAppSetting from "@/models/WhatsAppSetting";

/**
 * Re-send one message through the Cloud API.
 *
 * Kept apart from notify.ts so the outbox route can retry a row without pulling
 * in the whole notification pipeline, and so the access token is fetched here —
 * the settings document the caller holds has it deselected.
 */
export async function notifyRetry(
  settings: any,
  toNumber: string,
  message: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const withToken: any = await WhatsAppSetting.findById(settings._id).select(
    "+cloudApi.accessToken"
  );
  const cfg = withToken?.cloudApi || {};

  if (!cfg.phoneNumberId || !cfg.accessToken) {
    return { ok: false, error: "Cloud API credentials are not set." };
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
      return { ok: false, error: json?.error?.message || `Cloud API returned ${res.status}` };
    }
    return { ok: true, id: json?.messages?.[0]?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not reach the WhatsApp Cloud API" };
  }
}
