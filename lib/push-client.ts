"use client";

import { signOut } from "next-auth/react";

/**
 * This device's side of push notifications: asking for permission, signing the device up
 * with the server, and signing it off again on log out. Runs in the browser and in the
 * installed Android app (which is the same website).
 */

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

const sleep = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, sleep(ms)]);

function keyToBytes(base64Url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob(base64Url.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export interface DeviceResult {
  ok: boolean;
  permission: NotificationPermission | "unsupported";
  reason?: string;
}

/**
 * Makes this device receive the signed-in person's notifications. With `askPermission` it
 * first asks the person to allow notifications (that has to come from a tap); without it,
 * it only works if they already allowed them — so it can run quietly each time the app opens.
 */
export async function registerThisDevice(options: { askPermission?: boolean } = {}): Promise<DeviceResult> {
  if (!pushSupported()) {
    return { ok: false, permission: "unsupported", reason: "This browser cannot receive push notifications." };
  }
  try {
    let permission = Notification.permission;
    if (permission === "default" && options.askPermission) permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, permission };

    const registration =
      (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("/sw.js"));
    const ready = await withTimeout(navigator.serviceWorker.ready, 10_000);
    void registration;

    const keyRes = await fetch("/api/push/key", { cache: "no-store" });
    const keyJson = await keyRes.json().catch(() => ({}));
    if (!keyRes.ok || !keyJson.publicKey) {
      return { ok: false, permission, reason: keyJson.error || "Push notifications are not available right now." };
    }
    const appKey = keyToBytes(keyJson.publicKey);

    let sub = await ready.pushManager.getSubscription();
    // A device signed up with a different server key (e.g. the key was changed) cannot be reached any more.
    const current = sub?.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey as ArrayBuffer) : null;
    if (sub && (!current || !sameBytes(current, appKey))) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) {
      sub = await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey as unknown as BufferSource });
    }

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.success) return { ok: false, permission, reason: json.error || "The server did not accept this device." };
    return { ok: true, permission };
  } catch (e: any) {
    return { ok: false, permission: Notification.permission, reason: e?.message || "Could not turn on notifications on this device." };
  }
}

/** Stops notifications to this device (called when someone logs out, so the next person does not get them). */
export async function removeThisDevice(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const sub = await registration?.pushManager.getSubscription();
    if (!sub) return;
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
    await sub.unsubscribe();
  } catch {
    /* logging out must never be held up by this */
  }
}

/** A test notification to the signed-in person's own devices. */
export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch("/api/push/test", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!json.success) return { ok: false, message: json.error || "The test could not be sent." };
    if (!json.devices) return { ok: false, message: "No device is signed up for this account yet." };
    if (json.sent > 0) return { ok: true, message: `Test sent to ${json.sent} device${json.sent === 1 ? "" : "s"} — it should appear in a moment.` };
    return { ok: false, message: "The test could not be delivered to the device. Try turning alerts off and on again." };
  } catch {
    return { ok: false, message: "The test could not be sent." };
  }
}

/** Log out, first stopping notifications to this device (waits at most a couple of seconds). */
export async function signOutAndForgetDevice(options?: Parameters<typeof signOut>[0]) {
  await Promise.race([removeThisDevice(), new Promise((resolve) => setTimeout(resolve, 2500))]);
  return signOut(options);
}
