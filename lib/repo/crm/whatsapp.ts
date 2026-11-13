/**
 * WhatsApp outbox and settings (collections `whatsapp_messages`, `whatsapp_settings`).
 *
 * SECRET: whatsappSettings.cloudApi_accessToken. Only `whatsappSettingsWithToken*` reads it — the one Mongo read
 * that returns it (`.select("+cloudApi.accessToken")`, used to send / retry a message and to check credentials
 * before switching provider). Every other read leaves the column out of the SELECT itself.
 */
import connectToDatabase from "@/lib/db";
import WhatsAppMessage from "@/models/WhatsAppMessage";
import WhatsAppSetting from "@/models/WhatsAppSetting";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { castObjectIdHex, containsArg, hydrateAll, likeContains, loadLean, resolveDb } from "./rebuild";

const TOKEN_COL = "cloudApi_accessToken";

// ---------------------------------------------------------------------------
// GET /api/whatsapp (the outbox: rows + tab counts)
// ---------------------------------------------------------------------------

export interface OutboxArgs {
  status?: string | null;
  audience?: string | null;
  event?: string | null;
  /** Already trimmed, as the route does. */
  q?: string;
  /** Already computed by the route: Math.min(Number(limit) || 200, 1000). */
  limit: number;
}

/** Returns [rows, pending, sent, failed], as the route's Promise.all. */
export async function whatsappOutboxMongo({ status, audience, event, q = "", limit }: OutboxArgs): Promise<[any[], number, number, number]> {
  await connectToDatabase();
  const filter: any = {};
  if (status && status !== "all") filter.status = status;
  if (audience && audience !== "all") filter.audience = audience;
  if (event && event !== "all") filter.event = event;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ entityRef: rx }, { toName: rx }, { toNumber: rx }, { message: rx }];
  }
  return Promise.all([
    WhatsAppMessage.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
    WhatsAppMessage.countDocuments({ status: "pending" }),
    WhatsAppMessage.countDocuments({ status: "sent" }),
    WhatsAppMessage.countDocuments({ status: "failed" }),
  ]) as any;
}

export async function whatsappOutboxD1({ status, audience, event, q = "", limit }: OutboxArgs, db?: D1DatabaseLike): Promise<[any[], number, number, number]> {
  const d = resolveDb(db);
  const where: string[] = [];
  const args: unknown[] = [];
  if (status && status !== "all") (where.push("status = ?"), args.push(status));
  if (audience && audience !== "all") (where.push("audience = ?"), args.push(audience));
  if (event && event !== "all") (where.push("event = ?"), args.push(event));
  if (q) {
    // The route escapes q, so it is always a literal: LIKE '%q%'.
    where.push(`(${["entityRef", "toName", "toNumber", "message"].map(likeContains).join(" OR ")})`);
    for (let i = 0; i < 4; i++) args.push(containsArg(q));
  }
  // Mongo: limit(0) = no limit, a negative limit = its absolute value.
  const n = Math.abs(Math.trunc(Number(limit) || 0));
  const [rows, counts] = await Promise.all([
    loadLean(d, "whatsapp_messages", {
      where: where.length ? where.join(" AND ") : undefined,
      args,
      orderBy: "createdAt DESC, id ASC",
      limit: n === 0 ? undefined : n,
    }),
    d
      .prepare(
        "SELECT COALESCE(SUM(status = 'pending'), 0) AS pending, COALESCE(SUM(status = 'sent'), 0) AS sent, COALESCE(SUM(status = 'failed'), 0) AS failed FROM whatsappMessages"
      )
      .first<any>(),
  ]);
  return [rows, Number(counts?.pending ?? 0), Number(counts?.sent ?? 0), Number(counts?.failed ?? 0)];
}

// ---------------------------------------------------------------------------
// getWhatsAppSettings() (lib/whatsapp/notify.ts): GET /api/whatsapp/settings, every notification, the outbox PUT
// ---------------------------------------------------------------------------

/**
 * The read part of getWhatsAppSettings (it creates the default document when there is none; that write stays on
 * Mongo, so a null from D1 means "fall back"). The token is deselected (select: false in the model).
 */
export async function whatsappSettingsMongo(): Promise<any> {
  await connectToDatabase();
  return WhatsAppSetting.findOne({});
}

export async function whatsappSettingsD1(_args?: unknown, db?: D1DatabaseLike): Promise<any> {
  // findOne({}) with no sort = natural order; a single document in practice. D1: the oldest one.
  const docs = await loadLean(resolveDb(db), "whatsapp_settings", { omit: [TOKEN_COL], orderBy: "createdAt ASC, id ASC", limit: 1 });
  if (!docs.length) return null;
  return hydrateAll(WhatsAppSetting, docs, { "cloudApi.accessToken": 0 })[0];
}

// ---------------------------------------------------------------------------
// WhatsAppSetting.findById(id).select("+cloudApi.accessToken") (notify.ts queueMessage, retry.ts, settings PUT)
// ---------------------------------------------------------------------------

export async function whatsappSettingsWithTokenMongo({ id }: { id: string }): Promise<any> {
  await connectToDatabase();
  return WhatsAppSetting.findById(id).select("+cloudApi.accessToken");
}

/** The ONLY read that returns the access token, as its Mongo read does. */
export async function whatsappSettingsWithTokenD1({ id }: { id: string }, db?: D1DatabaseLike): Promise<any> {
  if (id === null || id === undefined) return null; // findById(null / undefined) finds nothing
  const hex = castObjectIdHex(id);
  const docs = await loadLean(resolveDb(db), "whatsapp_settings", { where: "id = ?", args: [hex], limit: 1 });
  if (!docs.length) return null;
  return hydrateAll(WhatsAppSetting, docs)[0];
}
