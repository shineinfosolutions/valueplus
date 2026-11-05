// ValuePlus ERP Service Worker
//
// v3: pages (HTML) and the build's own files (/_next/) always come from the network. Serving a cached page after a
// deploy made it ask for CSS / JS files of the old build that no longer exist, so the app opened unstyled and stuck
// on "AUTHENTICATING". Only icons and the manifest are kept for offline use; a new name clears every old cache.
const CACHE_NAME = "valueplus-v3";
const STATIC_ASSETS = [
  "/manifest.json",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn("PWA: Static cache add error", err);
      });
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // API calls, pages and the build's files go straight to the network (the browser handles them as usual).
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/") || req.mode === "navigate") return;
  if (!/\.(png|jpg|jpeg|svg|ico|webp|json)$/i.test(url.pathname)) return;

  // Icons and the manifest: network first, the cached copy when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});

// ── Push notifications ───────────────────────────────────────────────────────
// The server sends a small encrypted message ({ title, body, link }) when something
// is assigned to or needs the person. It is shown even when the app is closed.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "ValuePlus ERP", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "ValuePlus ERP";
  const link = typeof data.link === "string" && data.link.startsWith("/") ? data.link : "/";
  const nid = typeof data.nid === "string" ? data.nid : "";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // The app is open and on screen: it shows the message itself (and is told to look now),
      // so the person does not get it twice.
      if (windows.some((c) => c.visibilityState === "visible")) {
        windows.forEach((c) => c.postMessage({ type: "push", title, link, nid }));
        return;
      }
      // The app may be alive but in the background: its page can play the chime itself (the service
      // worker cannot play sound), besides the phone's own notification sound below.
      windows.forEach((c) => c.postMessage({ type: "push-sound" }));
      await self.registration.showNotification(title, {
        body: data.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { link, nid },
        // Vibrates and is not silent, so the phone plays its notification sound.
        vibrate: [250, 120, 250, 120, 250],
        silent: false,
        // A new tag every time: a notification that replaces an earlier one with the same tag can arrive
        // without sound on some phones. renotify makes any replacement alert again.
        renotify: true,
        tag: "vp-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
        timestamp: Date.now(),
      });
    })()
  );
});

// Tapping the notification opens the app on the right page.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  const nid = (event.notification.data && event.notification.data.nid) || "";
  event.waitUntil(
    (async () => {
      // Tapping it is reading it: mark it read at once (the person is signed in in this browser).
      if (nid) {
        try {
          await fetch("/api/notifications", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: nid }) });
        } catch (e) {
          /* it stays unread and is marked when the app opens it */
        }
      }
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(link);
            } catch (e) {
              /* fall through: the window is focused anyway */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(link);
    })()
  );
});
