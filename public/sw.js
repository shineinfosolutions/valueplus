// ValuePlus ERP Service Worker
const CACHE_NAME = "valueplus-v2.5";
const STATIC_ASSETS = [
  "/",
  "/dashboard",
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
  // Pass through non-GET and API requests directly to network
  if (event.request.method !== "GET" || event.request.url.includes("/api/")) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
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
