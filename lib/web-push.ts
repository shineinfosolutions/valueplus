/**
 * Web Push (RFC 8030) for a phone or browser that has agreed to notifications:
 * the message is encrypted for that device (RFC 8291, aes128gcm) and the request is
 * signed with our VAPID key (RFC 8292), so the push service (Google's FCM for Android
 * and Chrome, Microsoft's for Edge, …) accepts it and only the device can read it.
 *
 * Web Crypto only — no Node-specific code — so the same file runs on Cloudflare Workers
 * and on Node.
 */

const enc = new TextEncoder();

export const b64u = {
  encode(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text: string): Uint8Array {
    const pad = "=".repeat((4 - (text.length % 4)) % 4);
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

// Newer TypeScript types a Uint8Array as possibly shared memory; Web Crypto and fetch want plain bytes.
const bs = (u: Uint8Array) => u as unknown as BufferSource;

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/**
 * Where a device's push address may point. The address comes from the browser, so it is
 * only trusted when it is one of the real push services — otherwise a signed-in user could
 * make this server send requests to any address they like.
 */
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com", // Chrome, Android, the installed app
  "push.services.mozilla.com", // Firefox
  "notify.windows.com", // Edge
  "push.apple.com", // Safari
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
    return PUSH_HOST_SUFFIXES.some((s) => u.hostname === s || u.hostname.endsWith(`.${s}`));
  } catch {
    return false;
  }
}

/** Is a VAPID key pair set up (as Worker secrets)? */
export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || "";
}

// ── VAPID ─────────────────────────────────────────────────────────────────────
let signingKey: { id: string; key: CryptoKey } | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  const pub = process.env.VAPID_PUBLIC_KEY || "";
  const d = process.env.VAPID_PRIVATE_KEY || "";
  const id = `${pub}:${d.length}`;
  if (signingKey?.id === id) return signingKey.key;
  const raw = b64u.decode(pub);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("VAPID public key is not a valid P-256 key");
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: b64u.encode(raw.slice(1, 33)), y: b64u.encode(raw.slice(33, 65)), d, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  signingKey = { id, key };
  return key;
}

async function vapidAuthorization(endpoint: string): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.encode(
    enc.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: process.env.VAPID_SUBJECT || "https://valuplus.shineinfosolutions.in",
      })
    )
  );
  const data = enc.encode(`${header}.${claims}`);
  // Web Crypto returns the raw r||s signature a JWT's ES256 wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await getSigningKey(), bs(data)));
  return `vapid t=${header}.${claims}.${b64u.encode(sig)}, k=${process.env.VAPID_PUBLIC_KEY}`;
}

// ── Encryption (RFC 8291, aes128gcm) ──────────────────────────────────────────
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", bs(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: bs(salt), info: bs(info) }, key, bytes * 8));
}

/** One encrypted record: salt · record size · sender key · ciphertext. `fixed` is for tests only. */
export async function encryptPayload(
  plain: Uint8Array,
  userPublicKey: Uint8Array,
  authSecret: Uint8Array,
  fixed?: { salt?: Uint8Array; ephemeral?: CryptoKeyPair }
): Promise<Uint8Array> {
  if (plain.length > 3800) throw new Error("Push message is too long");
  const uaKey = await crypto.subtle.importKey("raw", bs(userPublicKey), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph =
    fixed?.ephemeral ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), userPublicKey, senderPublic), 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", bs(cek), "AES-GCM", false, ["encrypt"]);
  // 0x02 closes the only record.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(nonce) }, aes, bs(concat(plain, new Uint8Array([2])))));
  const recordSize = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, recordSize, new Uint8Array([senderPublic.length]), senderPublic, cipher);
}

// ── Sending ───────────────────────────────────────────────────────────────────
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** The device is gone (uninstalled, permission removed) — forget this address. */
  gone: boolean;
  error?: string;
}

export async function sendWebPush(
  target: PushTarget,
  message: Record<string, unknown>,
  options: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high"; timeoutMs?: number } = {}
): Promise<PushResult> {
  try {
    if (!pushConfigured()) return { ok: false, status: 0, gone: false, error: "Push is not set up on the server" };
    if (!isAllowedPushEndpoint(target.endpoint)) return { ok: false, status: 0, gone: true, error: "Not a push service address" };

    const body = await encryptPayload(enc.encode(JSON.stringify(message)), b64u.decode(target.p256dh), b64u.decode(target.auth));
    const res = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(target.endpoint),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(options.ttl ?? 86400),
        Urgency: options.urgency ?? "high",
      },
      body: bs(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (e: any) {
    return { ok: false, status: 0, gone: false, error: e?.message || String(e) };
  }
}
