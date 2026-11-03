import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Tell the open apps that something changed, over the live-update WebSocket (realtime-hub.ts).
 *
 * Every successful write to /api/* is already announced by worker.ts under its own path. Use this for the rest:
 * a change that screens watch under another path (a bill that creates an approval request → "/api/approvals"),
 * a message for certain people only (a new notification → its recipients), or a write made outside a request
 * (the cron). Best effort and never awaited: it can not fail or slow the action that triggered it.
 * Off Workers (`next dev`) there is no hub and it does nothing.
 */
export function publishChange(paths: string[], target?: { users?: string[]; roles?: string[] }) {
  if (paths.length === 0) return;
  try {
    const { env, ctx } = getCloudflareContext();
    const ns = (env as any)?.REALTIME;
    if (!ns) return;
    const hub = ns.get(ns.idFromName("global"));
    const body = JSON.stringify({ paths, users: target?.users, roles: target?.roles });
    ctx.waitUntil(
      hub
        .fetch("https://realtime/publish", { method: "POST", body })
        .catch((e: unknown) => console.warn("realtime publish failed:", e))
    );
  } catch {
    // Not running on Workers.
  }
}
