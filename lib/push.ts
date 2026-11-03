import PushSubscription from "@/models/PushSubscription";
import { pushConfigured, sendWebPush } from "@/lib/web-push";

export interface PushMessage {
  title: string;
  body?: string;
  /** A page of this app (e.g. "/staff/tasks") the notification opens. */
  link?: string;
  /** The notification this push is for (tapping it marks it read). */
  nid?: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Only a page of this site: a notification must not be able to open anywhere else. */
const safeLink = (link?: string) => (link && /^\/(?!\/)/.test(link) ? clip(link, 300) : "/");

/** After this many failures in a row a device is dropped (it can sign up again by opening the app). */
const MAX_FAILURES = 8;

/**
 * Sends a notification to every phone/browser registered for these users. Best effort: it
 * never throws and never holds up the action that caused it for long (each push has a short
 * time limit and they all go at once).
 */
export async function pushToUsers(
  userIds: string[],
  message: PushMessage
): Promise<{ devices: number; sent: number; failed: number; removed: number }> {
  const none = { devices: 0, sent: 0, failed: 0, removed: 0 };
  try {
    if (!pushConfigured() || userIds.length === 0) return none;
    const subs = await PushSubscription.find({ userId: { $in: userIds.map(String) } }).limit(300).lean();
    if (subs.length === 0) return none;

    const payload = { title: clip(message.title || "ValuePlus ERP", 120), body: clip(message.body || "", 300), link: safeLink(message.link), nid: message.nid && /^[a-f0-9]{24}$/i.test(message.nid) ? message.nid : "" };
    const results = await Promise.all(
      subs.map(async (s) => ({ s, r: await sendWebPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload) }))
    );

    const gone = results.filter((x) => x.r.gone).map((x) => x.s.endpoint);
    const ok = results.filter((x) => x.r.ok).map((x) => x.s.endpoint);
    const failed = results.filter((x) => !x.r.ok && !x.r.gone).map((x) => x.s.endpoint);

    if (gone.length) await PushSubscription.deleteMany({ endpoint: { $in: gone } });
    if (ok.length) await PushSubscription.updateMany({ endpoint: { $in: ok } }, { $set: { failCount: 0, lastSuccessAt: new Date() } });
    if (failed.length) {
      await PushSubscription.updateMany({ endpoint: { $in: failed } }, { $inc: { failCount: 1 } });
      await PushSubscription.deleteMany({ endpoint: { $in: failed }, failCount: { $gte: MAX_FAILURES } });
    }
    return { devices: subs.length, sent: ok.length, failed: failed.length, removed: gone.length };
  } catch (e) {
    console.warn("Notice: push notification failed:", e);
    return none;
  }
}
