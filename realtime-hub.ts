// Live updates over WebSocket, replacing the screens' timers that asked the server every few seconds.
//
// One Durable Object ("global") holds every open app's socket. Nothing is sent but "this changed" signals:
// after a successful write, worker.ts (and lib/realtime.ts, for writes made outside a request such as the cron)
// tells the hub which API path changed, the hub passes it to the sockets, and each screen that shows data from
// that path fetches it again through the normal signed-in API. So no data travels over the socket.
//
// The hub uses the WebSocket Hibernation API: between messages it is evicted from memory and an open socket
// costs no CPU time. "ping" is answered by the runtime itself (setWebSocketAutoResponse) without waking it.
import { DurableObject } from "cloudflare:workers";

export interface RealtimeMessage {
  /** API paths (e.g. "/api/estimates") or named events (e.g. "notification-read") that changed. */
  paths: string[];
  /** Only these users' sockets (User _id). */
  users?: string[];
  /** Only these roles' sockets. */
  roles?: string[];
}

export class RealtimeHub extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as any);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket", { status: 426 });
      }
      const userId = request.headers.get("x-user-id") || "";
      const role = (request.headers.get("x-user-role") || "").toLowerCase();
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      // Tags let a message go to one person's devices or one role only.
      this.ctx.acceptWebSocket(server, [`u:${userId}`, `r:${role}`]);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/publish" && request.method === "POST") {
      const msg = (await request.json().catch(() => null)) as RealtimeMessage | null;
      if (!msg || !Array.isArray(msg.paths) || msg.paths.length === 0) return new Response("Bad message", { status: 400 });

      let sockets: WebSocket[];
      if (msg.users?.length || msg.roles?.length) {
        const set = new Set<WebSocket>();
        for (const u of msg.users || []) for (const ws of this.ctx.getWebSockets(`u:${u}`)) set.add(ws);
        for (const r of msg.roles || []) for (const ws of this.ctx.getWebSockets(`r:${String(r).toLowerCase()}`)) set.add(ws);
        sockets = Array.from(set);
      } else {
        sockets = this.ctx.getWebSockets();
      }

      const data = JSON.stringify({ type: "change", paths: msg.paths });
      for (const ws of sockets) {
        try {
          ws.send(data);
        } catch {
          // Already closing; the runtime drops it.
        }
      }
      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  }

  // The app sends nothing but "ping" (answered without waking the hub); anything else is ignored.
  async webSocketMessage(): Promise<void> {}

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // 1005 / 1006 cannot be sent back; the socket is gone either way.
    }
  }

  async webSocketError(): Promise<void> {}
}
